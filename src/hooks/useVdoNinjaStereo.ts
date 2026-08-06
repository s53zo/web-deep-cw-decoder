import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type VDONinjaSDK from "@vdoninja/sdk";
import { SAMPLE_RATE } from "../const";
import { registerAudioContext } from "../utils/audioContextActivation";
import { releaseNetworkStereoSession } from "../utils/networkStereoCleanup";
import {
  extractNetworkAudioDiagnostics,
  reduceNetworkStereoPhase,
  requestStereoOpusInAnswer,
  validateStreamId,
  type NetworkAudioDiagnostics,
  type NetworkStereoAction,
  type NetworkStereoPhase,
  type RTCStatsLike,
} from "../utils/networkStereo";

type MeterGraph = {
  close: () => void;
};

type PlayoutSink = {
  close: () => void;
};

type SDKAnswerConnection = { pc: RTCPeerConnection };
type SDKWithAnswerHook = VDONinjaSDK & {
  _createAnswer?: (
    connection: SDKAnswerConnection,
  ) => Promise<RTCSessionDescriptionInit>;
};

type ActiveSession = {
  generation: number;
  streamId: string;
  sdk: VDONinjaSDK;
  listeners: Array<{ event: string; handler: EventListener }>;
  peerConnection: RTCPeerConnection | null;
  peerConnectionHandler: (() => void) | null;
  retryTimer: number | null;
  statsTimer: number | null;
  viewInFlight: boolean;
  track: MediaStreamTrack | null;
  candidateStream: MediaStream | null;
  meterGraph: MeterGraph | null;
  playoutSink: PlayoutSink | null;
  monoEvidencePolls: number;
  stereoVerified: boolean;
};

export type StereoLevels = {
  left: number;
  right: number;
};

const EMPTY_DIAGNOSTICS: NetworkAudioDiagnostics = {
  codec: null,
  mimeType: null,
  sampleRate: null,
  channelCount: null,
  stereoState: "unknown",
  stereoEvidence: null,
  route: null,
};

const STATUS_LABELS: Record<NetworkStereoPhase, string> = {
  idle: "IDLE",
  connecting: "CONNECTING",
  waiting: "WAITING FOR WINDOWS",
  connected: "CONNECTED",
  reconnecting: "RECONNECTING",
  disconnected: "DISCONNECTED",
  error: "ERROR",
};

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.min(1, Math.sqrt(sum / samples.length));
}

function createStereoMeterGraph(
  stream: MediaStream,
  onLevels: (levels: StereoLevels) => void,
): MeterGraph {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = context.createMediaStreamSource(stream);
  source.channelInterpretation = "discrete";
  const splitter = context.createChannelSplitter(2);
  const leftAnalyser = context.createAnalyser();
  const rightAnalyser = context.createAnalyser();
  const silentOutput = context.createGain();
  leftAnalyser.fftSize = 256;
  rightAnalyser.fftSize = 256;
  silentOutput.gain.value = 0;

  source.connect(splitter);
  if (splitter.numberOfOutputs !== 2) {
    void context.close();
    throw new Error("The browser could not create two isolated audio channels.");
  }
  splitter.connect(leftAnalyser, 0);
  splitter.connect(rightAnalyser, 1);
  leftAnalyser.connect(silentOutput);
  rightAnalyser.connect(silentOutput);
  silentOutput.connect(context.destination);
  const unregisterAudioContext = registerAudioContext(context);

  const leftSamples = new Float32Array(leftAnalyser.fftSize);
  const rightSamples = new Float32Array(rightAnalyser.fftSize);
  let frameId = 0;
  let lastUpdate = 0;
  const update = (timestamp: number) => {
    if (timestamp - lastUpdate >= 100) {
      leftAnalyser.getFloatTimeDomainData(leftSamples);
      rightAnalyser.getFloatTimeDomainData(rightSamples);
      onLevels({ left: rms(leftSamples), right: rms(rightSamples) });
      lastUpdate = timestamp;
    }
    frameId = requestAnimationFrame(update);
  };
  frameId = requestAnimationFrame(update);

  return {
    close: () => {
      unregisterAudioContext();
      cancelAnimationFrame(frameId);
      source.disconnect();
      splitter.disconnect();
      leftAnalyser.disconnect();
      rightAnalyser.disconnect();
      silentOutput.disconnect();
      void context.close();
    },
  };
}

function createMutedPlayoutSink(stream: MediaStream): PlayoutSink {
  const element = document.createElement("audio");
  element.autoplay = true;
  element.muted = true;
  element.preload = "none";
  element.hidden = true;
  element.setAttribute("playsinline", "");
  element.setAttribute("aria-hidden", "true");
  element.srcObject = stream;
  document.body.appendChild(element);

  // Chrome does not always start a remote WebRTC receiver when its only
  // consumers are MediaStreamAudioSourceNodes. A muted media element provides
  // the native playout clock without changing DeepCW's decoded audio path.
  void element.play().catch((playError) => {
    console.warn("Unable to start the network audio playout clock.", playError);
  });

  return {
    close: () => {
      element.pause();
      element.srcObject = null;
      element.remove();
    },
  };
}

function getOriginalAudioStream(
  track: MediaStreamTrack,
  streams: readonly MediaStream[] | undefined,
): MediaStream {
  return (
    streams?.find((stream) =>
      stream.getAudioTracks().some((candidate) => candidate === track),
    ) ?? new MediaStream([track])
  );
}

function statsToArray(report: RTCStatsReport): RTCStatsLike[] {
  const entries: RTCStatsLike[] = [];
  report.forEach((entry) => entries.push(entry as RTCStatsLike));
  return entries;
}

function preferLosslessThenOpus(pc: RTCPeerConnection): void {
  const codecs = RTCRtpReceiver.getCapabilities?.("audio")?.codecs;
  if (!codecs?.length) return;
  const priority = (codec: RTCRtpCodec) => {
    const mimeType = codec.mimeType.toLowerCase();
    if (mimeType === "audio/l16") return 0;
    if (mimeType === "audio/opus") return 1;
    return 2;
  };
  const orderedCodecs = [...codecs].sort(
    (left, right) => priority(left) - priority(right),
  );
  for (const transceiver of pc.getTransceivers()) {
    if (transceiver.receiver.track.kind !== "audio") continue;
    try {
      transceiver.setCodecPreferences?.(orderedCodecs);
    } catch (codecError) {
      console.warn("Unable to set the preferred network audio codecs.", codecError);
    }
  }
}

function installStereoAnswerNegotiation(sdk: VDONinjaSDK): void {
  const sdkWithHook = sdk as SDKWithAnswerHook;
  if (typeof sdkWithHook._createAnswer !== "function") {
    throw new Error(
      "This VDO.Ninja SDK version cannot negotiate the required stereo receiver.",
    );
  }
  sdkWithHook._createAnswer = async ({ pc }: SDKAnswerConnection) => {
    if (!pc) throw new Error("No VDO.Ninja peer connection is available.");
    preferLosslessThenOpus(pc);
    const answer = await pc.createAnswer();
    const stereoAnswer: RTCSessionDescriptionInit = {
      type: answer.type,
      sdp: answer.sdp ? requestStereoOpusInAnswer(answer.sdp) : answer.sdp,
    };
    await pc.setLocalDescription(stereoAnswer);
    return pc.localDescription ?? stereoAnswer;
  };
}

export function useVdoNinjaStereo() {
  const [phase, dispatch] = useReducer(
    (current: NetworkStereoPhase, action: NetworkStereoAction) =>
      reduceNetworkStereoPhase(current, action),
    "idle",
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [diagnostics, setDiagnostics] =
    useState<NetworkAudioDiagnostics>(EMPTY_DIAGNOSTICS);
  const [levels, setLevels] = useState<StereoLevels>({ left: 0, right: 0 });
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const sessionRef = useRef<ActiveSession | null>(null);

  const safeDispatch = useCallback((action: NetworkStereoAction) => {
    if (mountedRef.current) dispatch(action);
  }, []);

  const teardown = useCallback(
    async (nextPhase: "idle" | "disconnected" = "disconnected") => {
      const teardownGeneration = generationRef.current + 1;
      generationRef.current = teardownGeneration;
      const session = sessionRef.current;
      sessionRef.current = null;

      if (session) {
        await releaseNetworkStereoSession(
          session,
          (timerId) => window.clearTimeout(timerId),
          (timerId) => window.clearInterval(timerId),
        );
      }

      if (
        mountedRef.current &&
        generationRef.current === teardownGeneration &&
        sessionRef.current === null
      ) {
        setStream(null);
        setDiagnostics(EMPTY_DIAGNOSTICS);
        setLevels({ left: 0, right: 0 });
        setError(null);
        if (nextPhase === "disconnected") dispatch("disconnect");
      }
    },
    [],
  );

  const connect = useCallback(
    async (streamIdValue: string) => {
      const streamId = validateStreamId(streamIdValue);
      await teardown("idle");
      const generation = generationRef.current + 1;
      generationRef.current = generation;

      if (!mountedRef.current) return;
      setError(null);
      setDiagnostics(EMPTY_DIAGNOSTICS);
      setLevels({ left: 0, right: 0 });
      dispatch("connect");

      let VDONinjaSDKConstructor: typeof import("@vdoninja/sdk").default;
      try {
        ({ default: VDONinjaSDKConstructor } = await import("@vdoninja/sdk"));
      } catch (importError) {
        if (!mountedRef.current || generationRef.current !== generation) return;
        setError(
          importError instanceof Error
            ? importError.message
            : "Failed to load the VDO.Ninja SDK.",
        );
        dispatch("fail");
        return;
      }
      if (!mountedRef.current || generationRef.current !== generation) return;

      const sdk = new VDONinjaSDKConstructor({
        label: "DeepCW SO2R receiver",
        salt: "vdo.ninja",
        autoRecover: true,
        autoRelay: true,
        disconnectGracePeriod: 3_000,
        connectionTimeout: 10_000,
        recoveryTimeout: 5_000,
      });
      try {
        installStereoAnswerNegotiation(sdk);
      } catch (negotiationError) {
        if (!mountedRef.current || generationRef.current !== generation) return;
        setError(
          negotiationError instanceof Error
            ? negotiationError.message
            : "Unable to enable VDO.Ninja stereo negotiation.",
        );
        dispatch("fail");
        return;
      }
      const session: ActiveSession = {
        generation,
        streamId,
        sdk,
        listeners: [],
        peerConnection: null,
        peerConnectionHandler: null,
        retryTimer: null,
        statsTimer: null,
        viewInFlight: false,
        track: null,
        candidateStream: null,
        meterGraph: null,
        playoutSink: null,
        monoEvidencePolls: 0,
        stereoVerified: false,
      };
      sessionRef.current = session;

      const isCurrent = () =>
        mountedRef.current &&
        sessionRef.current === session &&
        generationRef.current === generation;

      const clearDecodedStream = () => {
        if (!isCurrent()) return;
        setStream(null);
        session.monoEvidencePolls = 0;
        session.stereoVerified = false;
      };

      const clearReceivedTrack = () => {
        session.meterGraph?.close();
        session.meterGraph = null;
        session.playoutSink?.close();
        session.playoutSink = null;
        if (session.track) {
          session.track.onended = null;
          session.track.stop();
        }
        session.track = null;
        session.candidateStream = null;
        if (isCurrent()) setLevels({ left: 0, right: 0 });
        clearDecodedStream();
      };

      const refreshDiagnostics = async () => {
        const pc = session.peerConnection;
        const track = session.track;
        if (!isCurrent() || !pc || !track) return;
        try {
          const report = await pc.getStats(track);
          if (!isCurrent()) return;
          const nextDiagnostics = extractNetworkAudioDiagnostics({
            report: statsToArray(report),
            trackSettings: track.getSettings(),
            receiverSdp: pc.localDescription?.sdp,
          });
          setDiagnostics(nextDiagnostics);

          if (nextDiagnostics.stereoState === "stereo") {
            session.monoEvidencePolls = 0;
            session.stereoVerified = true;
            if (session.candidateStream) setStream(session.candidateStream);
            setError(null);
            safeDispatch("stereo-verified");
          } else if (nextDiagnostics.stereoState === "mono") {
            session.stereoVerified = false;
            session.monoEvidencePolls += 1;
            if (session.monoEvidencePolls >= 3) {
              setStream(null);
              setError(
                "Network SO2R requires negotiated stereo. VDO.Ninja reported a mono audio stream.",
              );
              safeDispatch("fail");
            }
          } else {
            session.monoEvidencePolls = 0;
          }
        } catch (statsError) {
          console.warn("Unable to read VDO.Ninja WebRTC statistics.", statsError);
        }
      };

      const attachPeerConnection = (pc: RTCPeerConnection) => {
        if (!isCurrent() || session.peerConnection === pc) return;
        if (session.peerConnection && session.peerConnectionHandler) {
          session.peerConnection.removeEventListener(
            "connectionstatechange",
            session.peerConnectionHandler,
          );
        }
        session.peerConnection = pc;
        const handleConnectionState = () => {
          if (!isCurrent()) return;
          switch (pc.connectionState) {
            case "connected":
              safeDispatch(
                session.stereoVerified ? "stereo-verified" : "track-received",
              );
              void refreshDiagnostics();
              break;
            case "disconnected":
              safeDispatch("recovering");
              break;
            case "failed":
              clearDecodedStream();
              safeDispatch("recovering");
              break;
            case "closed":
              clearReceivedTrack();
              safeDispatch("connection-lost");
              break;
          }
        };
        session.peerConnectionHandler = handleConnectionState;
        pc.addEventListener("connectionstatechange", handleConnectionState);
        if (session.statsTimer != null) window.clearInterval(session.statsTimer);
        session.statsTimer = window.setInterval(
          () => void refreshDiagnostics(),
          1_000,
        );
        void refreshDiagnostics();
      };

      const scheduleView = (delayMs: number) => {
        if (!isCurrent() || session.retryTimer != null) return;
        session.retryTimer = window.setTimeout(() => {
          session.retryTimer = null;
          void requestView();
        }, delayMs);
      };

      async function requestView() {
        if (!isCurrent() || session.viewInFlight) return;
        session.viewInFlight = true;
        try {
          const pc = (await sdk.view(streamId, {
            audio: true,
            video: false,
            label: "DeepCW SO2R",
            downloads: false,
          })) as RTCPeerConnection | null;
          if (!isCurrent()) {
            // view() may finish its internal wait after an unmount/disconnect and
            // create a delayed SDK retry. Remove that stale intent immediately.
            sdk.stopViewing(streamId);
            return;
          }
          if (pc) {
            attachPeerConnection(pc);
          } else {
            sdk.stopViewing(streamId);
            safeDispatch("connection-lost");
            scheduleView(1_000);
          }
        } catch (viewError) {
          if (!isCurrent()) return;
          console.warn("VDO.Ninja view request failed; retrying.", viewError);
          safeDispatch("connection-lost");
          scheduleView(2_000);
        } finally {
          session.viewInFlight = false;
        }
      }

      const addListener = (event: string, handler: EventListener) => {
        sdk.on(event, handler);
        session.listeners.push({ event, handler });
      };

      addListener("connected", () => {
        if (isCurrent()) safeDispatch("signaling-connected");
      });
      addListener("reconnecting", () => {
        if (isCurrent()) safeDispatch("recovering");
      });
      addListener("reconnected", () => {
        if (!isCurrent()) return;
        safeDispatch(session.candidateStream ? "track-received" : "connection-lost");
        if (session.stereoVerified) {
          void refreshDiagnostics();
        } else {
          scheduleView(0);
        }
      });
      addListener("connectionRecovering", () => {
        if (isCurrent()) safeDispatch("recovering");
      });
      addListener("connectionRecovered", () => {
        if (!isCurrent()) return;
        safeDispatch(
          session.stereoVerified ? "stereo-verified" : "track-received",
        );
        void refreshDiagnostics();
      });
      addListener("connectionFailed", () => {
        if (!isCurrent()) return;
        clearReceivedTrack();
        safeDispatch("connection-lost");
        scheduleView(1_000);
      });
      addListener("peerDisconnected", () => {
        if (!isCurrent()) return;
        clearReceivedTrack();
        safeDispatch("connection-lost");
        scheduleView(6_000);
      });
      addListener("track", ((event: CustomEvent) => {
        if (!isCurrent()) return;
        const detail = event.detail as {
          track?: MediaStreamTrack;
          streams?: MediaStream[];
          streamID?: string | null;
          uuid?: string;
        };
        const track = detail.track;
        if (
          !track ||
          track.kind !== "audio" ||
          (detail.streamID != null && detail.streamID !== streamId)
        ) {
          return;
        }

        if (session.retryTimer != null) {
          window.clearTimeout(session.retryTimer);
          session.retryTimer = null;
        }
        if (detail.uuid) {
          const connectionGroup = sdk.connections.get(detail.uuid) as
            | { viewer?: { pc?: RTCPeerConnection } }
            | undefined;
          const replacementPc = connectionGroup?.viewer?.pc;
          if (replacementPc) attachPeerConnection(replacementPc);
        }
        if (session.track && session.track !== track) {
          session.track.onended = null;
          session.track.stop();
        }
        session.meterGraph?.close();
        session.playoutSink?.close();
        session.track = track;
        session.candidateStream = getOriginalAudioStream(track, detail.streams);
        session.playoutSink = createMutedPlayoutSink(session.candidateStream);
        session.monoEvidencePolls = 0;
        session.stereoVerified = false;
        try {
          session.meterGraph = createStereoMeterGraph(
            session.candidateStream,
            (nextLevels) => {
              if (isCurrent()) setLevels(nextLevels);
            },
          );
        } catch (meterError) {
          setError(
            meterError instanceof Error
              ? meterError.message
              : "Unable to split the network audio into two channels.",
          );
          safeDispatch("fail");
          return;
        }
        track.onended = () => {
          if (!isCurrent() || session.track !== track) return;
          session.meterGraph?.close();
          session.meterGraph = null;
          session.playoutSink?.close();
          session.playoutSink = null;
          session.track = null;
          session.candidateStream = null;
          clearDecodedStream();
          safeDispatch("connection-lost");
          scheduleView(1_000);
        };
        safeDispatch("track-received");
        void refreshDiagnostics();
      }) as EventListener);
      addListener("error", ((event: CustomEvent) => {
        if (!isCurrent()) return;
        const detail = event.detail as { error?: unknown } | undefined;
        const message =
          detail?.error instanceof Error
            ? detail.error.message
            : typeof detail?.error === "string"
              ? detail.error
              : "VDO.Ninja reported a network error.";
        if (/not (?:found|available)|no stream|does not exist/i.test(message)) {
          safeDispatch("connection-lost");
          scheduleView(1_000);
          return;
        }
        setError(message);
        clearReceivedTrack();
        safeDispatch("fail");
      }) as EventListener);

      try {
        await sdk.connect();
        if (!isCurrent()) return;
        safeDispatch("signaling-connected");
        await requestView();
      } catch (connectError) {
        if (!isCurrent()) return;
        setError(
          connectError instanceof Error
            ? connectError.message
            : "Failed to connect to VDO.Ninja signaling.",
        );
        safeDispatch("fail");
      }
    },
    [safeDispatch, teardown],
  );

  const disconnect = useCallback(async () => {
    await teardown("disconnected");
  }, [teardown]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void teardown("idle");
    };
  }, [teardown]);

  return {
    stream,
    phase,
    statusLabel: STATUS_LABELS[phase],
    diagnostics,
    levels,
    error,
    connect,
    disconnect,
    isActive: phase !== "idle" && phase !== "disconnected",
  };
}
