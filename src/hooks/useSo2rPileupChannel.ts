import { useCallback, useEffect, useRef, useState } from "react";
import {
  PILEUP_WINDOW_S,
  SAMPLE_RATE,
} from "../const";
import { loadPileupAssetBundle } from "../pileup/assets";
import { resetPileupAudioWindow } from "../pileup/audioWindow";
import { LatestOnlyQueue } from "../pileup/latestOnlyQueue";
import type {
  PileupWorkerMetrics,
  PileupWorkerRequest,
  PileupWorkerResponse,
  PileupLaneDecodeResult,
  PileupProbabilityFrame,
} from "../pileup/protocol";
import { PileupSessionGate } from "../pileup/sessionGate";
import {
  pileupVisualizationSessionKey,
  resolvePileupLaneStatus,
  type PileupVisualStatus,
} from "../pileup/visualization";
import {
  getVisiblePileupTracks,
  mergePileupTranscript,
  PILEUP_MAX_LANES_PER_RADIO,
  PILEUP_TEXT_HOLD_MS,
  updatePileupTracks,
  type PileupLaneTrack,
  type TrackedPileupSignal,
} from "../pileup/tracking";
import { useAudioProcessing } from "./useAudioProcessing";

// Match e04's current native-CWM live-analysis minimum interval. The latest-only
// queue below makes this safe when two SO2R workers briefly take longer.
const ANALYSIS_INTERVAL_MS = 200;
const MIN_READY_AUDIO_SECONDS = 2;

export type PileupLaneStatus = PileupVisualStatus;

export type So2rPileupLane = PileupLaneTrack & {
  status: PileupLaneStatus;
  liveText: string;
  transcript: string;
  characterSpans: PileupLaneDecodeResult["characterSpans"];
  frameCount: number;
  windowEndSample: number;
};

export type So2rPileupMetrics = PileupWorkerMetrics & {
  queueDepth: number;
  droppedAnalyses: number;
  analysisIntervalMs: number;
};

type UseSo2rPileupChannelParams = {
  stream: MediaStream | null;
  enabled: boolean;
  channelIndex: 0 | 1;
  filterFreq: number;
  filterWidth: number;
  assetSignature: string;
};

type AnalysisSnapshot = {
  audio: Float32Array;
  minFrequencyHz: number;
  maxFrequencyHz: number;
  tracks: PileupLaneTrack[];
  windowEndSample: number;
};

const PILEUP_EXPIRING_AFTER_MS = 500;

function probabilityFramesDiffer(
  previous: PileupProbabilityFrame | null,
  next: PileupProbabilityFrame,
): boolean {
  if (
    !previous ||
    previous.firstFrequencyHz !== next.firstFrequencyHz ||
    previous.binWidthHz !== next.binWidthHz ||
    previous.probabilities.length !== next.probabilities.length
  ) {
    return true;
  }
  for (let index = 0; index < next.probabilities.length; index += 1) {
    if (
      Math.abs(
        next.probabilities[index]! - previous.probabilities[index]!,
      ) >= 0.002
    ) {
      return true;
    }
  }
  return false;
}

function createSessionId(channelIndex: number): string {
  return `${channelIndex}:${crypto.randomUUID()}`;
}

export function useSo2rPileupChannel({
  stream,
  enabled,
  channelIndex,
  filterFreq,
  filterWidth,
  assetSignature,
}: UseSo2rPileupChannelParams) {
  const activeStream = enabled ? stream : null;
  const audioBufferRef = useAudioProcessing(
    activeStream,
    PILEUP_WINDOW_S,
    channelIndex,
    2,
  );
  const [loaded, setLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lanes, setLanes] = useState<So2rPileupLane[]>([]);
  const [probabilityFrame, setProbabilityFrame] =
    useState<PileupProbabilityFrame | null>(null);
  const [isDecoding, setIsDecoding] = useState(false);
  const [metrics, setMetrics] = useState<So2rPileupMetrics>({
    detectorMs: 0,
    decoderMs: 0,
    totalMs: 0,
    decodedLanes: 0,
    queueDepth: 0,
    droppedAnalyses: 0,
    analysisIntervalMs: ANALYSIS_INTERVAL_MS,
  });
  const filterRef = useRef({ filterFreq, filterWidth });
  filterRef.current = { filterFreq, filterWidth };
  const getTimelineSample = useCallback(
    () => audioBufferRef.current.endSample,
    [audioBufferRef],
  );
  const visualizationSessionKey = pileupVisualizationSessionKey(
    channelIndex,
    activeStream?.id ?? null,
    assetSignature,
  );

  useEffect(() => {
    if (!enabled || !assetSignature) {
      setLoaded(false);
      setLoadProgress(0);
      setLoadError(null);
      setLanes([]);
      setProbabilityFrame(null);
      setIsDecoding(false);
      return;
    }

    let cancelled = false;
    let nextRequestId = 1;
    let trackedSignals: TrackedPileupSignal[] = [];
    let visibleTracks: PileupLaneTrack[] = [];
    let nextTrackId = 1;
    let lastProducedVersion = -1;
    let lastProducedAt = 0;
    let draining = false;
    let workerReady = false;
    resetPileupAudioWindow(audioBufferRef.current);
    const sessionId = createSessionId(channelIndex);
    const sessionGate = new PileupSessionGate(sessionId);
    const worker = new Worker(
      new URL("../workers/pileupWorker.ts", import.meta.url),
      { type: "module" },
    );
    const queue = new LatestOnlyQueue<AnalysisSnapshot>();
    const pending = new Map<
      number,
      {
        resolve: (response: PileupWorkerResponse) => void;
        reject: (error: Error) => void;
      }
    >();
    const laneState = new Map<
      number,
      {
        liveText: string;
        transcript: string;
        lastNonEmptyAt: number;
        decodeResult: PileupLaneDecodeResult | null;
      }
    >();

    const callWorker = <T extends PileupWorkerResponse>(
      request: PileupWorkerRequest,
      transfer: Transferable[] = [],
    ): Promise<T> =>
      new Promise((resolve, reject) => {
        sessionGate.register(request.requestId);
        pending.set(request.requestId, {
          resolve: (response) => resolve(response as T),
          reject,
        });
        worker.postMessage(request, transfer);
      });

    worker.onmessage = (event: MessageEvent<PileupWorkerResponse>) => {
      const response = event.data;
      if (!sessionGate.accept(response.sessionId, response.requestId)) return;
      const request = pending.get(response.requestId);
      if (!request) return;
      pending.delete(response.requestId);
      if (response.type === "error") {
        request.reject(new Error(response.error));
      } else {
        request.resolve(response);
      }
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || "The Pileup worker failed.");
      pending.forEach(({ reject }) => reject(error));
      pending.clear();
      if (!cancelled) setLoadError(error.message);
    };

    const publishLanes = (
      decodeResults: readonly PileupLaneDecodeResult[],
      now: number,
    ) => {
      const resultByTrack = new Map(
        decodeResults.map((result) => [result.trackId, result]),
      );
      const activeIds = new Set(visibleTracks.map((track) => track.id));
      for (const id of laneState.keys()) {
        if (!activeIds.has(id)) laneState.delete(id);
      }
      const nextLanes = visibleTracks.map((track) => {
        const previous = laneState.get(track.id) ?? {
          liveText: "",
          transcript: "",
          lastNonEmptyAt: 0,
          decodeResult: null,
        };
        const result = resultByTrack.get(track.id);
        const nextText = result?.displayText ?? "";
        const nextPlainText = result?.plainText ?? nextText;
        const hasText = nextText.trim().length > 0;
        const shouldHold =
          !hasText &&
          previous.liveText.length > 0 &&
          now - previous.lastNonEmptyAt < PILEUP_TEXT_HOLD_MS;
        const nextState = {
          liveText: hasText ? nextText : shouldHold ? previous.liveText : "",
          transcript: hasText
            ? mergePileupTranscript(previous.transcript, nextPlainText)
            : previous.transcript,
          lastNonEmptyAt: hasText ? now : previous.lastNonEmptyAt,
          decodeResult: hasText
            ? result ?? previous.decodeResult
            : shouldHold
              ? previous.decodeResult
              : null,
        };
        laneState.set(track.id, nextState);
        return {
          ...track,
          liveText: nextState.liveText,
          transcript: nextState.transcript,
          characterSpans: nextState.decodeResult?.characterSpans ?? [],
          frameCount: nextState.decodeResult?.frameCount ?? 0,
          windowEndSample: nextState.decodeResult?.windowEndSample ?? 0,
          status: resolvePileupLaneStatus(
            hasText,
            shouldHold,
            now - track.lastSeen,
            PILEUP_EXPIRING_AFTER_MS,
          ),
        };
      });
      if (!cancelled) setLanes(nextLanes);
    };

    const drain = async () => {
      if (draining || cancelled) return;
      draining = true;
      try {
        while (!cancelled) {
          const snapshot = queue.take();
          if (!snapshot) break;
          try {
            const requestId = nextRequestId++;
            const response = await callWorker<
              Extract<PileupWorkerResponse, { type: "analysisResult" }>
            >(
              {
                type: "analyze",
                requestId,
                sessionId,
                audio: snapshot.audio,
                minFrequencyHz: snapshot.minFrequencyHz,
                maxFrequencyHz: snapshot.maxFrequencyHz,
                tracks: snapshot.tracks,
                windowEndSample: snapshot.windowEndSample,
              },
              [snapshot.audio.buffer],
            );
            if (cancelled || response.sessionId !== sessionId) return;
            const now = performance.now();
            trackedSignals = updatePileupTracks(
              trackedSignals,
              response.candidates,
              now,
              () => nextTrackId++,
            );
            visibleTracks = getVisiblePileupTracks(trackedSignals, now);
            publishLanes(response.decodeResults, now);
            setProbabilityFrame((previous) =>
              probabilityFramesDiffer(previous, response.probabilityFrame)
                ? response.probabilityFrame
                : previous,
            );
            setMetrics({
              ...response.metrics,
              queueDepth: queue.depth,
              droppedAnalyses: queue.droppedCount,
              analysisIntervalMs: ANALYSIS_INTERVAL_MS,
            });
          } finally {
            queue.complete();
          }
        }
      } catch (error) {
        if (!cancelled) {
          workerReady = false;
          queue.clear();
          setLoadError(
            error instanceof Error ? error.message : "Pileup inference failed.",
          );
          setIsDecoding(false);
        }
      } finally {
        draining = false;
      }
    };

    const initialize = async () => {
      setLoaded(false);
      setLoadProgress(0.05);
      setLoadError(null);
      setLanes([]);
      setProbabilityFrame(null);
      try {
        const bundle = await loadPileupAssetBundle();
        if (cancelled) return;
        setLoadProgress(0.35);
        const requestId = nextRequestId++;
        await callWorker<
          Extract<PileupWorkerResponse, { type: "initialized" }>
        >(
          {
            type: "initialize",
            requestId,
            sessionId,
            runtimeWasm: bundle.runtime,
            detectorModel: bundle.detector,
            decoderModel: bundle.decoder,
          },
          [bundle.runtime, bundle.detector, bundle.decoder],
        );
        if (cancelled) return;
        workerReady = true;
        setLoadProgress(1);
        setLoaded(true);
        setIsDecoding(Boolean(activeStream));
      } catch (error) {
        if (!cancelled) {
          worker.terminate();
          setLoadError(
            error instanceof Error
              ? error.message
              : "Failed to initialize Pileup models.",
          );
          setLoadProgress(0);
          setLoaded(false);
          setIsDecoding(false);
        }
      }
    };

    const producer = window.setInterval(() => {
      if (cancelled || !activeStream || !workerReady) return;
      const audio = audioBufferRef.current;
      const now = performance.now();
      if (
        audio.version === lastProducedVersion ||
        audio.endSample < MIN_READY_AUDIO_SECONDS * SAMPLE_RATE ||
        now - lastProducedAt < ANALYSIS_INTERVAL_MS
      ) {
        return;
      }
      lastProducedVersion = audio.version;
      lastProducedAt = now;
      const { filterFreq: center, filterWidth: width } = filterRef.current;
      queue.enqueue({
        audio: audio.samples.slice(),
        minFrequencyHz: Math.max(0, center - width / 2),
        maxFrequencyHz: Math.min(SAMPLE_RATE / 2, center + width / 2),
        tracks: visibleTracks.slice(0, PILEUP_MAX_LANES_PER_RADIO),
        windowEndSample: audio.endSample,
      });
      setMetrics((current) => ({
        ...current,
        queueDepth: queue.depth,
        droppedAnalyses: queue.droppedCount,
      }));
      void drain();
    }, 25);

    void initialize();
    return () => {
      cancelled = true;
      window.clearInterval(producer);
      queue.clear();
      workerReady = false;
      sessionGate.close();
      pending.forEach(({ reject }) =>
        reject(new Error("The Pileup worker session was stopped.")),
      );
      pending.clear();
      worker.terminate();
      trackedSignals = [];
      visibleTracks = [];
      laneState.clear();
      setLoaded(false);
      setLoadProgress(0);
      setLanes([]);
      setProbabilityFrame(null);
      setIsDecoding(false);
    };
  }, [
    activeStream,
    assetSignature,
    audioBufferRef,
    channelIndex,
    enabled,
  ]);

  return {
    loaded,
    loadProgress,
    loadError,
    lanes,
    probabilityFrame,
    isDecoding,
    metrics,
    maxLanes: PILEUP_MAX_LANES_PER_RADIO,
    runtimeLabel: "Native WASM",
    getTimelineSample,
    visualizationSessionKey,
  };
}

export type So2rPileupChannelState = ReturnType<typeof useSo2rPileupChannel>;
