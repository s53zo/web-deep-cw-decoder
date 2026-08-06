// These values and the island/peak algorithm below intentionally mirror e04's
// current native-CWM Pileup worker. Keep changes synchronized with that reference;
// they are model behavior, not UI tuning knobs.
export const PILEUP_BIN_RESOLUTION_HZ = 12.5;
export const PILEUP_DETECTION_THRESHOLD = 0.1;
export const PILEUP_LOCK_THRESHOLD = 0.5;
export const PILEUP_MAX_DETECTED_CANDIDATES = 100;

export type PileupProbabilityBin = {
  frequency: number;
  probability: number;
};

export type PileupDetectionCandidate = {
  frequency: number;
  probability: number;
  startBin: number;
  endBin: number;
};

type CandidateGroup = {
  start: number;
  end: number;
  peakIndex: number;
};

const SPLIT_PROMINENCE = 0.15;
const SPLIT_VALLEY_RATIO = 0.75;
const BASE_HALF_WIDTH_BINS = 1;
const MAX_HALF_WIDTH_BINS = 7;
const ADJACENT_STRONG_BIN_THRESHOLD = 0.5;

function splitPresenceIsland(
  bins: readonly PileupProbabilityBin[],
  start: number,
  end: number,
): CandidateGroup[] {
  const probability = (index: number) => bins[index]?.probability ?? 0;
  const peaks: number[] = [];
  for (let index = start; index <= end; index += 1) {
    const risesFromLeft = index === start || probability(index) >= probability(index - 1);
    const fallsToRight = index === end || probability(index) > probability(index + 1);
    if (risesFromLeft && fallsToRight) peaks.push(index);
  }

  const valleys: number[] = [];
  for (let peak = 0; peak < peaks.length - 1; peak += 1) {
    let valley = peaks[peak] + 1;
    for (let index = peaks[peak] + 1; index < peaks[peak + 1]; index += 1) {
      if (probability(index) < probability(valley)) valley = index;
    }
    valleys.push(valley);
  }

  while (peaks.length > 1) {
    let mergeIndex = -1;
    let weakestProminence = Number.POSITIVE_INFINITY;
    for (let index = 0; index < valleys.length; index += 1) {
      const lowerPeak = Math.min(
        probability(peaks[index]),
        probability(peaks[index + 1]),
      );
      const valleyProbability = probability(valleys[index]);
      const prominence = lowerPeak - valleyProbability;
      const shouldSplit =
        prominence >= SPLIT_PROMINENCE ||
        valleyProbability <= lowerPeak * SPLIT_VALLEY_RATIO;
      if (!shouldSplit && prominence < weakestProminence) {
        weakestProminence = prominence;
        mergeIndex = index;
      }
    }
    if (mergeIndex < 0) break;

    const removeLeft =
      probability(peaks[mergeIndex]) < probability(peaks[mergeIndex + 1]);
    const removedValley = valleys[mergeIndex];
    if (removeLeft) {
      if (
        mergeIndex > 0 &&
        probability(removedValley) < probability(valleys[mergeIndex - 1])
      ) {
        valleys[mergeIndex - 1] = removedValley;
      }
      peaks.splice(mergeIndex, 1);
    } else {
      if (
        mergeIndex + 1 < valleys.length &&
        probability(removedValley) < probability(valleys[mergeIndex + 1])
      ) {
        valleys[mergeIndex + 1] = removedValley;
      }
      peaks.splice(mergeIndex + 1, 1);
    }
    valleys.splice(mergeIndex, 1);
  }

  const groups: CandidateGroup[] = [];
  let groupStart = start;
  peaks.forEach((peakIndex, index) => {
    const groupEnd = index < valleys.length ? valleys[index] : end;
    groups.push({ start: groupStart, end: groupEnd, peakIndex });
    groupStart = groupEnd + 1;
  });
  return groups;
}

function refinePeakFrequency(
  bins: readonly PileupProbabilityBin[],
  peakIndex: number,
): number {
  const peak = bins[peakIndex];
  if (!peak) return 0;
  const left = bins[peakIndex - 1]?.probability;
  const right = bins[peakIndex + 1]?.probability;
  if (left == null || right == null) return peak.frequency;
  const curvature = left - 2 * peak.probability + right;
  if (curvature >= -1e-6) return peak.frequency;
  const offset = Math.max(
    -0.5,
    Math.min(0.5, (0.5 * (left - right)) / curvature),
  );
  return peak.frequency + offset * PILEUP_BIN_RESOLUTION_HZ;
}

function candidateFromGroup(
  bins: readonly PileupProbabilityBin[],
  group: CandidateGroup,
): PileupDetectionCandidate {
  const peak = bins[group.peakIndex]!;
  const peakBin = Math.round(peak.frequency / PILEUP_BIN_RESOLUTION_HZ);
  const islandStartBin = Math.round(
    (bins[group.start]?.frequency ?? peak.frequency) / PILEUP_BIN_RESOLUTION_HZ,
  );
  const islandEndBin = Math.round(
    (bins[group.end]?.frequency ?? peak.frequency) / PILEUP_BIN_RESOLUTION_HZ,
  );
  let startBin = Math.max(
    peakBin - MAX_HALF_WIDTH_BINS,
    Math.min(islandStartBin, peakBin - BASE_HALF_WIDTH_BINS),
  );
  let endBin = Math.min(
    peakBin + MAX_HALF_WIDTH_BINS,
    Math.max(islandEndBin, peakBin + BASE_HALF_WIDTH_BINS),
  );
  const probabilityByBin = new Map(
    bins.map((bin) => [
      Math.round(bin.frequency / PILEUP_BIN_RESOLUTION_HZ),
      bin.probability,
    ]),
  );
  while (
    startBin > peakBin - MAX_HALF_WIDTH_BINS &&
    (probabilityByBin.get(startBin - 1) ?? 0) >= ADJACENT_STRONG_BIN_THRESHOLD
  ) {
    startBin -= 1;
  }
  while (
    endBin < peakBin + MAX_HALF_WIDTH_BINS &&
    (probabilityByBin.get(endBin + 1) ?? 0) >= ADJACENT_STRONG_BIN_THRESHOLD
  ) {
    endBin += 1;
  }
  return {
    frequency: refinePeakFrequency(bins, group.peakIndex),
    probability: peak.probability,
    startBin,
    endBin,
  };
}

export function buildProbabilityBins(
  probabilities: Float32Array,
  minFrequencyHz: number,
): PileupProbabilityBin[] {
  const firstBin = Math.max(
    0,
    Math.floor(Math.max(0, minFrequencyHz) / PILEUP_BIN_RESOLUTION_HZ),
  );
  return Array.from(probabilities, (rawProbability, index) => ({
    frequency: (firstBin + index) * PILEUP_BIN_RESOLUTION_HZ,
    probability: Math.max(0, Math.min(1, Number(rawProbability))),
  }));
}

export function groupPileupCandidates(
  bins: readonly PileupProbabilityBin[],
  presenceThreshold = PILEUP_DETECTION_THRESHOLD,
): PileupDetectionCandidate[] {
  const candidates: PileupDetectionCandidate[] = [];
  let islandStart = -1;
  for (let index = 0; index <= bins.length; index += 1) {
    const present =
      index < bins.length && bins[index]!.probability >= presenceThreshold;
    if (present && islandStart < 0) islandStart = index;
    if (!present && islandStart >= 0) {
      splitPresenceIsland(bins, islandStart, index - 1).forEach((group) =>
        candidates.push(candidateFromGroup(bins, group)),
      );
      islandStart = -1;
    }
  }
  return candidates
    .sort((left, right) => right.probability - left.probability)
    .slice(0, PILEUP_MAX_DETECTED_CANDIDATES);
}
