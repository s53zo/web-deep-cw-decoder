/// <reference lib="webworker" />

import { validatePileupModelPair } from "../pileup/cwm";
import {
  buildProbabilityBins,
  groupPileupCandidates,
  PILEUP_BIN_RESOLUTION_HZ,
} from "../pileup/detection";
import {
  createDeepCwNativeRuntime,
  type NativeDetector,
  type NativeNarrowDecoder,
} from "../pileup/nativeRuntime";
import type {
  PileupWorkerRequest,
  PileupWorkerResponse,
} from "../pileup/protocol";
import { decodePredictionsDetailed } from "../utils/textDecoder";

const context = self as unknown as DedicatedWorkerGlobalScope;
const NARROW_FREQUENCY_BINS = 15;
const BASE_NARROW_BINS = 3;

let activeSessionId: string | null = null;
let detector: NativeDetector | null = null;
let decoder: NativeNarrowDecoder | null = null;

function respond(
  response: PileupWorkerResponse,
  transfer: Transferable[] = [],
): void {
  context.postMessage(response, transfer);
}

function disposeSessions(): void {
  detector?.dispose();
  decoder?.dispose();
  detector = null;
  decoder = null;
  activeSessionId = null;
}

function trackFrequencyRange(track: {
  frequency: number;
  startBin: number;
  endBin: number;
}) {
  const centerBin = Math.round(track.frequency / PILEUP_BIN_RESOLUTION_HZ);
  const leftCapacity = Math.floor(NARROW_FREQUENCY_BINS / 2);
  const rightCapacity = NARROW_FREQUENCY_BINS - leftCapacity - 1;
  const baseHalfWidth = Math.floor(BASE_NARROW_BINS / 2);
  const maximumHalfWidth = Math.floor(NARROW_FREQUENCY_BINS / 2);
  const startBin = Math.max(
    centerBin - Math.min(maximumHalfWidth, leftCapacity),
    Math.min(track.startBin, centerBin - baseHalfWidth),
  );
  const endBin = Math.min(
    centerBin + Math.min(maximumHalfWidth, rightCapacity),
    Math.max(track.endBin, centerBin + baseHalfWidth),
  );
  return {
    frequency: track.frequency,
    startFrequency: startBin * PILEUP_BIN_RESOLUTION_HZ,
    endFrequency: endBin * PILEUP_BIN_RESOLUTION_HZ,
  };
}

context.onmessage = async (event: MessageEvent<PileupWorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === "initialize") {
      disposeSessions();
      validatePileupModelPair(message.detectorModel, message.decoderModel);

      const runtime = await createDeepCwNativeRuntime(message.runtimeWasm);
      detector = runtime.createDetector(message.detectorModel);
      decoder = runtime.createNarrowDecoder(message.decoderModel);
      activeSessionId = message.sessionId;
      respond({
        type: "initialized",
        requestId: message.requestId,
        sessionId: message.sessionId,
        detectorThreshold: detector.presenceThreshold,
      });
      return;
    }

    if (message.type === "dispose") {
      disposeSessions();
      respond({
        type: "disposed",
        requestId: message.requestId,
        sessionId: message.sessionId,
      });
      return;
    }

    if (
      message.sessionId !== activeSessionId ||
      !detector ||
      !decoder
    ) {
      throw new Error("The Pileup worker session is not initialized.");
    }

    const totalStartedAt = performance.now();
    const detectorStartedAt = performance.now();
    const probabilities = detector.runAudioBins(
      message.audio,
      message.minFrequencyHz,
      message.maxFrequencyHz,
    );
    const candidates = groupPileupCandidates(
      buildProbabilityBins(probabilities, message.minFrequencyHz),
    );
    const detectorMs = performance.now() - detectorStartedAt;

    const decodeResults: Extract<
      PileupWorkerResponse,
      { type: "analysisResult" }
    >["decodeResults"] = [];
    const decoderStartedAt = performance.now();
    if (message.tracks.length > 0) {
      const logits = decoder.runAudioNarrowBatch(
        message.audio,
        message.tracks.map(trackFrequencyRange),
      );
      const frameCount = decoder.getFrameCount(message.audio.length);
      const results = decodePredictionsDetailed(
        logits,
        [message.tracks.length, frameCount, decoder.numClasses],
        "en",
        true,
      );
      message.tracks.forEach((track, index) => {
        const result = results[index];
        if (!result) return;
        decodeResults.push({
          trackId: track.id,
          frequency: track.frequency,
          displayText: result.displayText,
          plainText: result.plainText,
          characterSpans: result.characterSpans.map((span) => ({
            ...span,
            confidence: span.confidence ?? 0,
          })),
          frameCount,
          windowEndSample: message.windowEndSample,
        });
      });
    }
    const decoderMs = performance.now() - decoderStartedAt;
    const firstFrequencyHz =
      Math.max(
        0,
        Math.floor(Math.max(0, message.minFrequencyHz) / PILEUP_BIN_RESOLUTION_HZ),
      ) * PILEUP_BIN_RESOLUTION_HZ;
    respond({
      type: "analysisResult",
      requestId: message.requestId,
      sessionId: message.sessionId,
      candidates,
      probabilityFrame: {
        firstFrequencyHz,
        binWidthHz: PILEUP_BIN_RESOLUTION_HZ,
        probabilities,
      },
      decodeResults,
      metrics: {
        detectorMs,
        decoderMs,
        totalMs: performance.now() - totalStartedAt,
        decodedLanes: message.tracks.length,
      },
    }, [probabilities.buffer]);
  } catch (error) {
    if (message.type === "initialize") disposeSessions();
    respond({
      type: "error",
      requestId: message.requestId,
      sessionId: message.sessionId,
      error: error instanceof Error ? error.message : "Unknown Pileup worker error.",
    });
  }
};

export {};
