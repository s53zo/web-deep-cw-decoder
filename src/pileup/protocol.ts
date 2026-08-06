import type { PileupDetectionCandidate } from "./detection";
import type { PileupLaneTrack } from "./tracking";
import type { ConfidentCharacterSpan } from "../utils/textDecoder";

export type PileupProbabilityFrame = {
  firstFrequencyHz: number;
  binWidthHz: number;
  probabilities: Float32Array;
};

export type PileupLaneDecodeResult = {
  trackId: number;
  frequency: number;
  displayText: string;
  plainText: string;
  characterSpans: ConfidentCharacterSpan[];
  frameCount: number;
  windowEndSample: number;
};

export type PileupWorkerRequest =
  | {
      type: "initialize";
      requestId: number;
      sessionId: string;
      runtimeWasm: ArrayBuffer;
      detectorModel: ArrayBuffer;
      decoderModel: ArrayBuffer;
    }
  | {
      type: "analyze";
      requestId: number;
      sessionId: string;
      audio: Float32Array;
      minFrequencyHz: number;
      maxFrequencyHz: number;
      tracks: PileupLaneTrack[];
      windowEndSample: number;
    }
  | {
      type: "dispose";
      requestId: number;
      sessionId: string;
    };

export type PileupWorkerMetrics = {
  detectorMs: number;
  decoderMs: number;
  totalMs: number;
  decodedLanes: number;
};

export type PileupWorkerResponse =
  | {
      type: "initialized";
      requestId: number;
      sessionId: string;
      detectorThreshold: number;
    }
  | {
      type: "analysisResult";
      requestId: number;
      sessionId: string;
      candidates: PileupDetectionCandidate[];
      probabilityFrame: PileupProbabilityFrame;
      decodeResults: PileupLaneDecodeResult[];
      metrics: PileupWorkerMetrics;
    }
  | {
      type: "disposed";
      requestId: number;
      sessionId: string;
    }
  | {
      type: "error";
      requestId: number;
      sessionId: string;
      error: string;
    };
