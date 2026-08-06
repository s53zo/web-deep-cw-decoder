import { SAMPLE_RATE } from "../const.ts";
import {
  PILEUP_DETECTION_THRESHOLD,
  PILEUP_LOCK_THRESHOLD,
} from "./detection.ts";

export type PileupVisualStatus =
  | "tracking"
  | "decoding"
  | "holding"
  | "expiring";

export function resolvePileupLaneStatus(
  hasText: boolean,
  shouldHoldText: boolean,
  millisecondsSinceDetection: number,
  expiringAfterMs = 500,
): PileupVisualStatus {
  if (millisecondsSinceDetection >= expiringAfterMs) return "expiring";
  if (hasText) return "decoding";
  if (shouldHoldText) return "holding";
  return "tracking";
}

export const PILEUP_PROBABILITY_THRESHOLDS = [
  PILEUP_DETECTION_THRESHOLD,
  PILEUP_LOCK_THRESHOLD,
] as const;
export const PILEUP_PROBABILITY_TRANSITION_MS = 140;

export function probabilityTransitionEase(progress: number): number {
  const clamped = clamp01(progress);
  return 1 - (1 - clamped) * (1 - clamped);
}

export function pileupVisualizationSessionKey(
  channelIndex: 0 | 1,
  streamId: string | null,
  assetSignature: string,
): string {
  return `${channelIndex}:${streamId ?? "stopped"}:${assetSignature}`;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function frequencyToWaterfallY(
  frequencyHz: number,
  minFrequencyHz: number,
  maxFrequencyHz: number,
  heightPx: number,
): number {
  const range = Math.max(1, maxFrequencyHz - minFrequencyHz);
  const clamped = Math.max(
    minFrequencyHz,
    Math.min(maxFrequencyHz, frequencyHz),
  );
  return ((maxFrequencyHz - clamped) / range) * Math.max(0, heightPx);
}

export function probabilityBinFrequency(
  firstFrequencyHz: number,
  binWidthHz: number,
  index: number,
): number {
  return firstFrequencyHz + binWidthHz * index;
}

export function characterFrameToX(
  startFrame: number,
  endFrame: number,
  frameCount: number,
  widthPx: number,
): number {
  const centerFrame = (startFrame + endFrame + 1) / 2;
  return (centerFrame / Math.max(1, frameCount)) * Math.max(0, widthPx);
}

export function waterfallScrollOffsetPx(
  currentSample: number,
  windowEndSample: number,
  windowSeconds: number,
  widthPx: number,
): number {
  const elapsedSamples = Math.max(0, currentSample - windowEndSample);
  return (
    (elapsedSamples / Math.max(1, windowSeconds * SAMPLE_RATE)) *
    Math.max(0, widthPx)
  );
}

export function confidenceOpacity(confidence: number): number {
  // Matches e04's current native-CWM display curve. The non-zero floor keeps
  // uncertain characters visible instead of falsely presenting them as absent.
  return 0.08 + 0.92 * Math.pow(clamp01(confidence), 2.2);
}

export function probabilityMarkerX(probability: number, widthPx: number): number {
  return clamp01(probability) * Math.max(0, widthPx);
}

export function laneBackground(status: PileupVisualStatus): string {
  switch (status) {
    case "decoding":
      return "rgba(64, 192, 87, 0.27)";
    case "holding":
      return "rgba(74, 144, 226, 0.24)";
    case "expiring":
      return "rgba(174, 92, 92, 0.17)";
    default:
      return "rgba(74, 144, 226, 0.15)";
  }
}

export type PileupLanePlacement = {
  id: number;
  signalY: number;
  rowY: number;
};

export function placePileupLanes(
  lanes: readonly { id: number; frequency: number }[],
  minFrequencyHz: number,
  maxFrequencyHz: number,
  heightPx: number,
  minimumSpacingPx = 24,
  maximumLanes = 5,
): PileupLanePlacement[] {
  const halfRow = minimumSpacingPx / 2;
  const sorted = lanes
    .slice(0, maximumLanes)
    .map((lane) => ({
      id: lane.id,
      signalY: frequencyToWaterfallY(
        lane.frequency,
        minFrequencyHz,
        maxFrequencyHz,
        heightPx,
      ),
      rowY: 0,
    }))
    .sort((left, right) => left.signalY - right.signalY || left.id - right.id);

  sorted.forEach((lane, index) => {
    const desired = Math.max(halfRow, Math.min(heightPx - halfRow, lane.signalY));
    lane.rowY =
      index === 0
        ? desired
        : Math.max(desired, sorted[index - 1]!.rowY + minimumSpacingPx);
  });
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const maximum =
      index === sorted.length - 1
        ? heightPx - halfRow
        : sorted[index + 1]!.rowY - minimumSpacingPx;
    sorted[index]!.rowY = Math.min(sorted[index]!.rowY, maximum);
  }

  return sorted.sort((left, right) => left.id - right.id);
}

export class SampleTimelineClock {
  private sample = 0;
  private observedAtMs = 0;

  reset(): void {
    this.sample = 0;
    this.observedAtMs = 0;
  }

  observe(sample: number, nowMs: number): void {
    if (sample !== this.sample || this.observedAtMs === 0) {
      this.sample = sample;
      this.observedAtMs = nowMs;
    }
  }

  at(nowMs: number): number {
    if (this.observedAtMs === 0) return this.sample;
    return this.sample + ((nowMs - this.observedAtMs) / 1000) * SAMPLE_RATE;
  }
}

export function startAnimationLoop(
  render: (nowMs: number) => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancel: (id: number) => void = cancelAnimationFrame,
): () => void {
  let active = true;
  let frameId = 0;
  const tick = (nowMs: number) => {
    if (!active) return;
    render(nowMs);
    frameId = schedule(tick);
  };
  frameId = schedule(tick);
  return () => {
    active = false;
    cancel(frameId);
  };
}
