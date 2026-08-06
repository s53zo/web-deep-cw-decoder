import {
  PILEUP_BIN_RESOLUTION_HZ,
  PILEUP_LOCK_THRESHOLD,
  type PileupDetectionCandidate,
} from "./detection.ts";

export const PILEUP_MAX_LANES_PER_RADIO = 5;
export const PILEUP_TEXT_HOLD_MS = 1500;

// These tracking constants and transitions mirror e04's current native-CWM
// Pileup implementation; five lanes also matches the public repository's bound.
const MIN_TRACK_SEPARATION_HZ = PILEUP_BIN_RESOLUTION_HZ * 2.5;
const UNCONFIRMED_MATCH_HZ = MIN_TRACK_SEPARATION_HZ;
const CONFIRMED_MATCH_HZ = PILEUP_BIN_RESOLUTION_HZ;
const SCORE_DECAY_PER_SECOND = 1;
const CONFIRM_SCORE = 0.8;
const MAX_SCORE = 5;
const NEW_TRACK_SCORE = 0.6;
const SNAPSHOT_TRACK_SCORE = 5;
const MATCH_SCORE_WINDOW_SECONDS = 0.4;
const UNCONFIRMED_FREQUENCY_ALPHA = 0.5;
const CONFIRMED_FREQUENCY_ALPHA = 0.15;
const WIDTH_ALPHA = 0.25;
const REPORTED_WIDTH_HYSTERESIS = 0.75;
const MIN_HALF_WIDTH_BINS = 1;
const MAX_NARROW_BINS = 15;

export type TrackedPileupSignal = {
  id: number;
  frequency: number;
  reportedFrequency: number;
  probability: number;
  score: number;
  confirmed: boolean;
  leftWidthBins: number;
  rightWidthBins: number;
  reportedLeftWidthBins: number;
  reportedRightWidthBins: number;
  firstSeen: number;
  lastSeen: number;
};

export type PileupLaneTrack = {
  id: number;
  frequency: number;
  probability: number;
  startBin: number;
  endBin: number;
  lastSeen: number;
};

function decayedScore(track: TrackedPileupSignal, now: number): number {
  return (
    track.score -
    (Math.max(0, now - track.lastSeen) / 1000) * SCORE_DECAY_PER_SECOND
  );
}

function isTrackAlive(track: TrackedPileupSignal, now: number): boolean {
  return decayedScore(track, now) > 0;
}

function candidateWidths(candidate: PileupDetectionCandidate) {
  const centerBin = candidate.frequency / PILEUP_BIN_RESOLUTION_HZ;
  const maxHalfWidth = Math.floor(MAX_NARROW_BINS / 2);
  return {
    left:
      candidate.startBin == null
        ? MIN_HALF_WIDTH_BINS
        : Math.min(maxHalfWidth, Math.max(0, centerBin - candidate.startBin)),
    right:
      candidate.endBin == null
        ? MIN_HALF_WIDTH_BINS
        : Math.min(maxHalfWidth, Math.max(0, candidate.endBin - centerBin)),
  };
}

function roundedHalfWidth(value: number): number {
  return Math.max(MIN_HALF_WIDTH_BINS, Math.round(value));
}

function createTrack(
  candidate: PileupDetectionCandidate,
  now: number,
  id: number,
  score: number,
  confirmed: boolean,
): TrackedPileupSignal {
  const width = candidateWidths(candidate);
  return {
    id,
    frequency: candidate.frequency,
    reportedFrequency: candidate.frequency,
    probability: candidate.probability,
    score,
    confirmed,
    leftWidthBins: width.left,
    rightWidthBins: width.right,
    reportedLeftWidthBins: roundedHalfWidth(width.left),
    reportedRightWidthBins: roundedHalfWidth(width.right),
    firstSeen: now,
    lastSeen: now,
  };
}

function updateMatchedTrack(
  track: TrackedPileupSignal,
  candidate: PileupDetectionCandidate,
  now: number,
): void {
  const elapsedSeconds = Math.max(0, now - track.lastSeen) / 1000;
  const matchedSeconds = Math.min(MATCH_SCORE_WINDOW_SECONDS, elapsedSeconds);
  const unmatchedSeconds = Math.max(0, elapsedSeconds - MATCH_SCORE_WINDOW_SECONDS);
  const probabilityWeight = Math.sqrt(candidate.probability);
  track.score = Math.min(
    MAX_SCORE,
    Math.max(
      track.score - unmatchedSeconds * SCORE_DECAY_PER_SECOND +
        matchedSeconds * probabilityWeight,
      NEW_TRACK_SCORE * probabilityWeight,
    ),
  );
  const alpha = track.confirmed
    ? CONFIRMED_FREQUENCY_ALPHA
    : UNCONFIRMED_FREQUENCY_ALPHA;
  track.frequency += (candidate.frequency - track.frequency) * alpha;
  const widths = candidateWidths(candidate);
  track.leftWidthBins =
    widths.left > track.leftWidthBins
      ? widths.left
      : track.leftWidthBins + (widths.left - track.leftWidthBins) * WIDTH_ALPHA;
  track.rightWidthBins =
    widths.right > track.rightWidthBins
      ? widths.right
      : track.rightWidthBins +
        (widths.right - track.rightWidthBins) * WIDTH_ALPHA;
  track.probability = candidate.probability;
  track.lastSeen = now;

  if (!track.confirmed && track.score >= CONFIRM_SCORE) {
    track.confirmed = true;
    track.reportedFrequency = track.frequency;
    track.reportedLeftWidthBins = roundedHalfWidth(track.leftWidthBins);
    track.reportedRightWidthBins = roundedHalfWidth(track.rightWidthBins);
  }
  if (
    Math.abs(track.frequency - track.reportedFrequency) >
    PILEUP_BIN_RESOLUTION_HZ / 2
  ) {
    track.reportedFrequency = track.frequency;
  }
  if (
    Math.abs(track.leftWidthBins - track.reportedLeftWidthBins) >
    REPORTED_WIDTH_HYSTERESIS
  ) {
    track.reportedLeftWidthBins = roundedHalfWidth(track.leftWidthBins);
  }
  if (
    Math.abs(track.rightWidthBins - track.reportedRightWidthBins) >
    REPORTED_WIDTH_HYSTERESIS
  ) {
    track.reportedRightWidthBins = roundedHalfWidth(track.rightWidthBins);
  }
}

function removeDuplicateTracks(
  tracks: TrackedPileupSignal[],
  now: number,
): TrackedPileupSignal[] {
  const preferred = [...tracks].sort(
    (left, right) =>
      Number(right.confirmed) - Number(left.confirmed) ||
      decayedScore(right, now) - decayedScore(left, now) ||
      left.firstSeen - right.firstSeen ||
      left.id - right.id,
  );
  const retained: TrackedPileupSignal[] = [];
  for (const track of preferred) {
    if (
      retained.every(
        (current) =>
          Math.abs(current.frequency - track.frequency) >=
          MIN_TRACK_SEPARATION_HZ,
      )
    ) {
      retained.push(track);
    }
  }
  const ids = new Set(retained.map((track) => track.id));
  return tracks.filter((track) => ids.has(track.id));
}

export function updatePileupTracks(
  currentTracks: readonly TrackedPileupSignal[],
  candidates: readonly PileupDetectionCandidate[],
  now: number,
  createTrackId: () => number,
): TrackedPileupSignal[] {
  const tracks = currentTracks.map((track) => ({ ...track }));
  const matches: Array<{
    trackIndex: number;
    candidateIndex: number;
    distanceHz: number;
    probability: number;
  }> = [];
  tracks.forEach((track, trackIndex) => {
    const matchRange = track.confirmed
      ? CONFIRMED_MATCH_HZ
      : UNCONFIRMED_MATCH_HZ;
    candidates.forEach((candidate, candidateIndex) => {
      const distanceHz = Math.abs(track.frequency - candidate.frequency);
      if (distanceHz <= matchRange) {
        matches.push({
          trackIndex,
          candidateIndex,
          distanceHz,
          probability: candidate.probability,
        });
      }
    });
  });
  matches.sort(
    (left, right) =>
      left.distanceHz - right.distanceHz ||
      right.probability - left.probability,
  );

  const matchedTracks = new Set<number>();
  const matchedCandidates = new Set<number>();
  matches.forEach((match) => {
    if (
      matchedTracks.has(match.trackIndex) ||
      matchedCandidates.has(match.candidateIndex)
    ) {
      return;
    }
    matchedTracks.add(match.trackIndex);
    matchedCandidates.add(match.candidateIndex);
    updateMatchedTrack(
      tracks[match.trackIndex]!,
      candidates[match.candidateIndex]!,
      now,
    );
  });

  candidates.forEach((candidate, candidateIndex) => {
    if (
      matchedCandidates.has(candidateIndex) ||
      candidate.probability < PILEUP_LOCK_THRESHOLD ||
      tracks.some(
        (track) =>
          Math.abs(track.frequency - candidate.frequency) <
          MIN_TRACK_SEPARATION_HZ,
      )
    ) {
      return;
    }
    tracks.push(
      createTrack(
        candidate,
        now,
        createTrackId(),
        NEW_TRACK_SCORE,
        false,
      ),
    );
  });

  return removeDuplicateTracks(
    tracks.filter((track) => isTrackAlive(track, now)),
    now,
  );
}

export function createSnapshotPileupTracks(
  candidates: readonly PileupDetectionCandidate[],
  now: number,
  createTrackId: () => number,
): TrackedPileupSignal[] {
  return candidates
    .filter((candidate) => candidate.probability >= PILEUP_LOCK_THRESHOLD)
    .sort((left, right) => right.probability - left.probability)
    .filter(
      (candidate, index, all) =>
        all
          .slice(0, index)
          .every(
            (current) =>
              Math.abs(current.frequency - candidate.frequency) >=
              MIN_TRACK_SEPARATION_HZ,
          ),
    )
    .slice(0, PILEUP_MAX_LANES_PER_RADIO)
    .map((candidate) =>
      createTrack(
        candidate,
        now,
        createTrackId(),
        SNAPSHOT_TRACK_SCORE,
        true,
      ),
    );
}

export function getVisiblePileupTracks(
  tracks: readonly TrackedPileupSignal[],
  now: number,
): PileupLaneTrack[] {
  const selected = tracks
    .filter((track) => track.confirmed && isTrackAlive(track, now))
    .sort(
      (left, right) =>
        decayedScore(right, now) - decayedScore(left, now) ||
        left.firstSeen - right.firstSeen ||
        left.id - right.id,
    )
    .slice(0, PILEUP_MAX_LANES_PER_RADIO)
    .map((track) => ({
      id: track.id,
      frequency: Math.round(track.reportedFrequency),
      probability: track.probability,
      startBin:
        Math.round(track.reportedFrequency / PILEUP_BIN_RESOLUTION_HZ) -
        track.reportedLeftWidthBins,
      endBin:
        Math.round(track.reportedFrequency / PILEUP_BIN_RESOLUTION_HZ) +
        track.reportedRightWidthBins,
      lastSeen: track.lastSeen,
    }))
    .sort((left, right) => left.frequency - right.frequency);

  for (let index = 0; index < selected.length - 1; index += 1) {
    const left = selected[index]!;
    const right = selected[index + 1]!;
    if (left.endBin < right.startBin) continue;
    const leftCenter = Math.round(left.frequency / PILEUP_BIN_RESOLUTION_HZ);
    const rightCenter = Math.round(right.frequency / PILEUP_BIN_RESOLUTION_HZ);
    const boundary = Math.floor((leftCenter + rightCenter - 1) / 2);
    left.endBin = Math.max(left.startBin, Math.min(left.endBin, boundary));
    right.startBin = Math.min(
      right.endBin,
      Math.max(right.startBin, boundary + 1),
    );
  }
  return selected;
}

export function pileupTracksEqual(
  left: readonly PileupLaneTrack[],
  right: readonly PileupLaneTrack[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (track, index) =>
        track.id === right[index]?.id &&
        track.frequency === right[index]?.frequency &&
        track.startBin === right[index]?.startBin &&
        track.endBin === right[index]?.endBin &&
        track.probability === right[index]?.probability,
    )
  );
}

export function mergePileupTranscript(previous: string, next: string): string {
  const normalizedNext = next.replace(/\s+/g, " ").trim();
  if (!normalizedNext) return previous;
  const normalizedPrevious = previous.replace(/\s+/g, " ").trim();
  if (!normalizedPrevious) return normalizedNext;
  if (normalizedPrevious.endsWith(normalizedNext)) return normalizedPrevious;

  const maximumOverlap = Math.min(normalizedPrevious.length, normalizedNext.length);
  for (let overlap = maximumOverlap; overlap >= 3; overlap -= 1) {
    if (
      normalizedPrevious.slice(-overlap) === normalizedNext.slice(0, overlap)
    ) {
      return `${normalizedPrevious}${normalizedNext.slice(overlap)}`;
    }
  }
  return `${normalizedPrevious} ${normalizedNext}`;
}
