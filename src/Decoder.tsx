import { useState, useRef, useEffect } from "react";
import { useMediaQuery } from "@mantine/hooks";
import {
  DEFAULT_DECODE_CENTER_FREQ_HZ,
  DEFAULT_DECODE_BANDWIDTH_HZ,
  DEFAULT_DECODE_WINDOW_S,
  DECODE_WINDOW_OPTIONS,
  FILTER_WIDTH_OPTIONS,
  MAX_FREQ_HZ,
  MIN_FREQ_HZ,
  SAMPLE_RATE,
  PILEUP_WINDOW_S,
  PILEUP_MIN_FREQ_HZ,
  PILEUP_MAX_FREQ_HZ,
  WIDE_LAYOUT_WIDTH_PX,
  type DecodeWindowSeconds,
} from "./const";
import { Scope } from "./Scope";
import { useDecode } from "./useDecode";
import { useAudioProcessing } from "./hooks/useAudioProcessing";
import { useAudioPassthrough } from "./hooks/useAudioPassthrough";
import { useFilteredPassthroughStream } from "./hooks/useFilteredPassthroughStream";
import { useLoadProgress } from "./hooks/useLoadProgress";
import { usePileupDecode } from "./hooks/usePileupDecode";
import { usePileupDetection } from "./hooks/usePileupDetection";
import { usePersistedState } from "./hooks/usePersistedState";
import { useStreamingDecode } from "./hooks/useStreamingDecode";
import { useSo2rChannel } from "./hooks/useSo2rChannel";
import { useVdoNinjaStereo } from "./hooks/useVdoNinjaStereo";
import { DecodeDisplay } from "./DecodeDisplay";
import { BenchmarkPanel } from "./BenchmarkPanel";
import { LoadProgressBars } from "./LoadProgressBars";
import { PileupOverlay } from "./PileupOverlay";
import { StreamingTranscriptDisplay } from "./StreamingTranscriptDisplay";
import { So2rRadioPanel } from "./So2rRadioPanel";
import { NetworkStereoControls } from "./NetworkStereoControls";
import type { PileupTrack } from "./utils/pileupCandidates";
import {
  Box,
  Button,
  Flex,
  NativeSelect,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  INFERENCE_BACKEND_OPTIONS,
  type InferenceBackend,
} from "./utils/inferenceProtocol";
import {
  buildVdoNinjaSenderUrl,
  generateSecureStreamId,
  validateStreamId,
} from "./utils/networkStereo";
import {
  hasMatchingOption,
  parseNumberOption,
  parseStringOption,
} from "./utils/optionUtils";

type DecoderMode = "normal" | "so2r" | "pileup" | "benchmark";
type DecoderLanguage = "EN" | "EN/JA";
type So2rInputSource = "local" | "network";

const MODE_OPTIONS = ["normal", "so2r", "pileup", "benchmark"] as const;
const AVAILABLE_MODE_OPTIONS = ["normal", "so2r", "benchmark"] as const;
const LANGUAGE_OPTIONS: readonly DecoderLanguage[] = ["EN", "EN/JA"];
const BACKEND_OPTIONS: readonly InferenceBackend[] =
  INFERENCE_BACKEND_OPTIONS.map((option) => option.value);
const SO2R_INPUT_SOURCE_OPTIONS = ["local", "network"] as const;

type CaptureInfo = {
  requestedChannelCount: 1 | 2;
  channelCount: number;
  sampleRate: number | null;
};

const isValidDecodeFrequency = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= MIN_FREQ_HZ &&
  value <= MAX_FREQ_HZ;

export const Decoder = () => {
  const [mode, setMode] = usePersistedState<DecoderMode>(
    "decoder.mode",
    "normal",
    (value): value is DecoderMode =>
      hasMatchingOption(value, AVAILABLE_MODE_OPTIONS),
  );
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [captureInfo, setCaptureInfo] = useState<CaptureInfo | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [so2rInputSource, setSo2rInputSourceState] =
    usePersistedState<So2rInputSource>(
      "decoder.so2r.inputSource",
      "local",
      (value): value is So2rInputSource =>
        hasMatchingOption(value, SO2R_INPUT_SOURCE_OPTIONS),
    );
  const [networkStreamId, setNetworkStreamId] = useState(() =>
    generateSecureStreamId(),
  );
  const networkStereo = useVdoNinjaStereo();
  const disconnectNetworkStereo = networkStereo.disconnect;
  const [filterFreq, setFilterFreq] = useState(DEFAULT_DECODE_CENTER_FREQ_HZ);
  const [filterWidth, setFilterWidth] = usePersistedState<number>(
    "decoder.filterWidth",
    800,
    (value): value is number => hasMatchingOption(value, FILTER_WIDTH_OPTIONS),
  );
  const [language, setLanguage] = usePersistedState<DecoderLanguage>(
    "decoder.language",
    "EN",
    (value): value is DecoderLanguage => value === "EN",
  );
  const [backend, setBackend] = usePersistedState<InferenceBackend>(
    "decoder.backend",
    "wasm",
    (value): value is InferenceBackend =>
      hasMatchingOption(value, BACKEND_OPTIONS),
  );
  const [decodeWindowSeconds, setDecodeWindowSeconds] =
    usePersistedState<DecodeWindowSeconds>(
      "decoder.decodeWindowSeconds",
      DEFAULT_DECODE_WINDOW_S,
      (value): value is DecodeWindowSeconds =>
        hasMatchingOption(value, DECODE_WINDOW_OPTIONS),
    );
  const [so2rLeftFilterFreq, setSo2rLeftFilterFreq] =
    usePersistedState<number>(
      "decoder.so2r.left.filterFreq",
      DEFAULT_DECODE_CENTER_FREQ_HZ,
      isValidDecodeFrequency,
    );
  const [so2rLeftFilterWidth, setSo2rLeftFilterWidth] =
    usePersistedState<number>(
      "decoder.so2r.left.filterWidth",
      DEFAULT_DECODE_BANDWIDTH_HZ,
      (value): value is number =>
        hasMatchingOption(value, FILTER_WIDTH_OPTIONS),
    );
  const [so2rLeftWindowSeconds, setSo2rLeftWindowSeconds] =
    usePersistedState<DecodeWindowSeconds>(
      "decoder.so2r.left.decodeWindowSeconds",
      DEFAULT_DECODE_WINDOW_S,
      (value): value is DecodeWindowSeconds =>
        hasMatchingOption(value, DECODE_WINDOW_OPTIONS),
    );
  const [so2rRightFilterFreq, setSo2rRightFilterFreq] =
    usePersistedState<number>(
      "decoder.so2r.right.filterFreq",
      DEFAULT_DECODE_CENTER_FREQ_HZ,
      isValidDecodeFrequency,
    );
  const [so2rRightFilterWidth, setSo2rRightFilterWidth] =
    usePersistedState<number>(
      "decoder.so2r.right.filterWidth",
      DEFAULT_DECODE_BANDWIDTH_HZ,
      (value): value is number =>
        hasMatchingOption(value, FILTER_WIDTH_OPTIONS),
    );
  const [so2rRightWindowSeconds, setSo2rRightWindowSeconds] =
    usePersistedState<DecodeWindowSeconds>(
      "decoder.so2r.right.decodeWindowSeconds",
      DEFAULT_DECODE_WINDOW_S,
      (value): value is DecodeWindowSeconds =>
        hasMatchingOption(value, DECODE_WINDOW_OPTIONS),
    );

  const [audioInputDevices, setAudioInputDevices] = useState<MediaDeviceInfo[]>(
    [],
  );
  const [selectedAudioInput, _setSelectedAudioInput] =
    usePersistedState<string>(
      "decoder.selectedAudioInput",
      "",
      (value): value is string => typeof value === "string",
    );
  const [selectedAudioOutput, setSelectedAudioOutput] =
    usePersistedState<string>(
      "decoder.selectedAudioOutput",
      "",
      (value): value is string => typeof value === "string",
    );

  const pileupTracksRef = useRef<PileupTrack[]>([]);
  const previousModeRef = useRef<DecoderMode>(mode);
  const captureRequestIdRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(stream);
  streamRef.current = stream;

  const isSo2r = mode === "so2r";
  const isPileup = mode === "pileup";
  const isBenchmark = mode === "benchmark";
  const isNetworkSo2r = isSo2r && so2rInputSource === "network";
  let networkSenderUrl: string | null = null;
  try {
    networkSenderUrl = buildVdoNinjaSenderUrl(networkStreamId);
  } catch {
    networkSenderUrl = null;
  }
  const localDecoderStream =
    stream &&
    captureInfo &&
    (isSo2r
      ? captureInfo.requestedChannelCount === 2
      : captureInfo.requestedChannelCount === 1)
      ? stream
      : null;
  const decoderStream = isNetworkSo2r
    ? networkStereo.stream
    : localDecoderStream;
  const {
    isSupported: isPassthroughSupported,
    audioOutputDevices,
    syncAudioOutputDevices,
  } = useAudioPassthrough(selectedAudioOutput, () => setSelectedAudioOutput(""));
  useFilteredPassthroughStream({
    stream: isSo2r ? null : decoderStream,
    enabled: mode === "normal",
    selectedAudioOutput,
    filterFreq: isPileup ? null : filterFreq,
    filterWidth,
  });

  useEffect(() => {
    if (
      selectedAudioInput &&
      audioInputDevices.length > 0 &&
      !audioInputDevices.some(
        (device) => device.deviceId === selectedAudioInput,
      )
    ) {
      _setSelectedAudioInput("");
    }
  }, [audioInputDevices, selectedAudioInput, _setSelectedAudioInput]);

  useEffect(() => {
    let cancelled = false;
    const refreshInputs = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setAudioInputDevices(
            devices.filter((device) => device.kind === "audioinput"),
          );
        }
      } catch (error) {
        console.error("Failed to list audio input devices.", error);
      }
    };
    const handleDeviceChange = () => {
      void refreshInputs();
    };

    void refreshInputs();
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange,
      );
    };
  }, []);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = mode;

    const crossedSo2rBoundary =
      (previousMode === "so2r") !== (mode === "so2r");
    if (!isBenchmark && !crossedSo2rBoundary) {
      return;
    }

    captureRequestIdRef.current += 1;
    stream?.getTracks().forEach((track) => track.stop());
    void disconnectNetworkStereo();
    setStream(null);
    setCaptureInfo(null);
    setCaptureError(null);
    setCaptureNotice(null);
    setIsStarting(false);
  }, [disconnectNetworkStereo, isBenchmark, mode, stream]);

  useEffect(
    () => () => {
      captureRequestIdRef.current += 1;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  const effectiveWindowSeconds = isPileup
    ? PILEUP_WINDOW_S
    : decodeWindowSeconds;
  const progressLanguage = isPileup || isSo2r ? "EN" : language;

  const audioBufferRef = useAudioProcessing(
    isSo2r ? null : decoderStream,
    effectiveWindowSeconds,
  );
  const loadProgress = useLoadProgress(
    backend,
    progressLanguage,
    isPileup ? "narrow" : "standard",
    isPileup,
  );

  const {
    loaded,
    loadedJa,
    loadError: normalLoadError,
    currentText,
    currentTextTick,
    currentTextVersion,
    currentTextJa,
    currentTextJaTick,
    currentTextJaVersion,
    isDecoding,
  } = useDecode({
    filterFreq: isPileup ? null : filterFreq,
    filterWidth,
    stream: decoderStream,
    language: isPileup ? "EN" : language,
    backend,
    decodeWindowSeconds: effectiveWindowSeconds,
    audioBufferRef,
    enabled: mode === "normal",
  });

  const {
    segments: streamingSegments,
    pendingText: streamingPendingText,
    pendingTextJa: streamingPendingTextJa,
    loadError: streamingLoadError,
  } = useStreamingDecode({
    filterFreq: isPileup ? null : filterFreq,
    filterWidth,
    stream: decoderStream,
    language: isPileup ? "EN" : language,
    backend,
    enabled: mode === "normal",
  });

  const {
    tracks: pileupTracks,
    loaded: pileupDetectionLoaded,
    loadError: pileupDetectionLoadError,
  } = usePileupDetection({
    stream: decoderStream,
    backend,
    audioBufferRef,
    enabled: isPileup,
    minFreqHz: PILEUP_MIN_FREQ_HZ,
    maxFreqHz: PILEUP_MAX_FREQ_HZ,
  });

  useEffect(() => {
    pileupTracksRef.current = pileupTracks;
  }, [pileupTracks]);

  const {
    textMap,
    isDecoding: isPileupDecoding,
    loaded: pileupLoaded,
    loadError: pileupLoadError,
  } = usePileupDecode({
    stream: decoderStream,
    backend,
    audioBufferRef,
    tracksRef: pileupTracksRef,
    enabled: isPileup,
    decodeWindowSeconds: effectiveWindowSeconds,
  });

  const so2rLeftDecoder = useSo2rChannel({
    stream: decoderStream,
    enabled: isSo2r,
    channelIndex: 0,
    filterFreq: so2rLeftFilterFreq,
    filterWidth: so2rLeftFilterWidth,
    decodeWindowSeconds: so2rLeftWindowSeconds,
    backend,
  });
  const so2rRightDecoder = useSo2rChannel({
    stream: decoderStream,
    enabled: isSo2r,
    channelIndex: 1,
    filterFreq: so2rRightFilterFreq,
    filterWidth: so2rRightFilterWidth,
    decodeWindowSeconds: so2rRightWindowSeconds,
    backend,
  });

  const setSelectedAudioInput = (deviceId: string) => {
    _setSelectedAudioInput(deviceId);
    setCaptureError(null);
    setCaptureNotice(null);
    if (stream) {
      void getStream(deviceId);
    }
  };

  const setSo2rInputSource = (source: So2rInputSource) => {
    if (source === so2rInputSource) return;
    captureRequestIdRef.current += 1;
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setCaptureInfo(null);
    setCaptureError(null);
    setCaptureNotice(null);
    setIsStarting(false);
    void networkStereo.disconnect();
    setSo2rInputSourceState(source);
  };

  const connectNetworkStereo = async () => {
    try {
      const streamId = validateStreamId(networkStreamId);
      setCaptureError(null);
      setCaptureNotice(null);
      await networkStereo.connect(streamId);
    } catch (error) {
      setCaptureError(
        error instanceof Error
          ? error.message
          : "Failed to start the network stereo receiver.",
      );
    }
  };

  const refreshAudioDevices = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(
      (device) => device.kind === "audioinput",
    );
    setAudioInputDevices(audioInputs);
    syncAudioOutputDevices(devices);
  };

  const prepareAudioInputSelection = async () => {
    const requestId = captureRequestIdRef.current + 1;
    captureRequestIdRef.current = requestId;
    setCaptureError(null);
    setCaptureNotice(null);
    setIsStarting(true);

    let permissionStream: MediaStream | null = null;
    try {
      permissionStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      permissionStream.getTracks().forEach((track) => track.stop());
      permissionStream = null;

      if (captureRequestIdRef.current !== requestId) {
        return;
      }

      await refreshAudioDevices();
      setCaptureNotice(
        "Select your two-channel interface under STEREO INPUT, then click START.",
      );
    } catch (error) {
      permissionStream?.getTracks().forEach((track) => track.stop());
      if (captureRequestIdRef.current !== requestId) {
        return;
      }
      setCaptureError(
        error instanceof Error
          ? error.message
          : "Microphone permission is required to list audio inputs.",
      );
    } finally {
      if (captureRequestIdRef.current === requestId) {
        setIsStarting(false);
      }
    }
  };

  const getStream = async (selectedAudioInput?: string) => {
    const requestId = captureRequestIdRef.current + 1;
    captureRequestIdRef.current = requestId;
    const requestedChannelCount: 1 | 2 = isSo2r ? 2 : 1;

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    setStream(null);
    setCaptureInfo(null);
    setCaptureError(null);
    setCaptureNotice(null);
    setIsStarting(true);

    let newStream: MediaStream | null = null;

    try {
      newStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedAudioInput
            ? { exact: selectedAudioInput }
            : undefined,
          sampleRate: SAMPLE_RATE,
          channelCount:
            requestedChannelCount === 2 ? { exact: 2 } : 1,
          echoCancellation: false,
          autoGainControl: false,
          noiseSuppression: false,
        },
      });

      if (captureRequestIdRef.current !== requestId) {
        newStream.getTracks().forEach((track) => track.stop());
        return;
      }

      const audioTrack = newStream.getAudioTracks()[0];
      if (!audioTrack) {
        throw new Error("The selected input did not provide an audio track.");
      }

      try {
        await refreshAudioDevices();
      } catch (error) {
        console.error("Failed to refresh audio devices.", error);
      }

      const settings = audioTrack.getSettings();
      const actualChannelCount = settings.channelCount ?? 0;
      if (requestedChannelCount === 2 && actualChannelCount < 2) {
        throw new Error(
          "SO2R requires a verified stereo input. The selected device did not report two captured channels.",
        );
      }

      setCaptureInfo({
        requestedChannelCount,
        channelCount: actualChannelCount || requestedChannelCount,
        sampleRate: settings.sampleRate ?? null,
      });
      setStream(newStream);
      newStream = null;

    } catch (error) {
      newStream?.getTracks().forEach((track) => track.stop());
      if (captureRequestIdRef.current !== requestId) {
        return;
      }

      const isStereoConstraintFailure =
        requestedChannelCount === 2 &&
        error instanceof DOMException &&
        error.name === "OverconstrainedError";
      const message = isStereoConstraintFailure
        ? "SO2R requires a stereo input device. The selected input could not provide two channels."
        : error instanceof Error
          ? error.message
          : "Failed to start the selected audio input.";
      setCaptureError(message);
    } finally {
      if (captureRequestIdRef.current === requestId) {
        setIsStarting(false);
      }
    }
  };

  const loadError = isPileup
    ? (pileupDetectionLoadError ?? pileupLoadError)
    : isSo2r
    ? (so2rLeftDecoder.loadError ?? so2rRightDecoder.loadError)
    : isBenchmark
    ? null
    : (normalLoadError ?? streamingLoadError);
  const isLoading = isPileup
    ? !pileupLoaded || !pileupDetectionLoaded
    : isSo2r
    ? !so2rLeftDecoder.loaded || !so2rRightDecoder.loaded
    : isBenchmark
    ? false
    : !loaded || (language === "EN/JA" && !loadedJa);
  const showJapaneseDisplay = mode === "normal" && language === "EN/JA";
  const isActive =
    !isBenchmark &&
    (isNetworkSo2r ? networkStereo.isActive : stream !== null || isStarting);
  const scopeHeight = isPileup ? 768 : 256;
  const isWideViewport = useMediaQuery("(min-width: 801px)", true, {
    getInitialValueInEffect: false,
  });
  const showSideControls = useMediaQuery(
    `(min-width: ${WIDE_LAYOUT_WIDTH_PX}px)`,
    true,
    {
      getInitialValueInEffect: false,
    },
  );
  const showControlsBesideContent = showSideControls && !isSo2r;
  const decoderEdgePadding = isWideViewport ? 8 : 0;
  const controlJustify = showControlsBesideContent ? "flex-start" : "flex-end";
  const controlPanelStyle = showControlsBesideContent
    ? { width: "420px", maxWidth: "100%" }
    : undefined;
  const controlRowStyle = showControlsBesideContent
    ? { width: "100%" }
    : undefined;
  const contentWidthSelectStyle = { width: "fit-content" } as const;

  const mainContent = isBenchmark ? (
    <BenchmarkPanel />
  ) : isSo2r ? (
    <Box px={decoderEdgePadding}>
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: isWideViewport
            ? "repeat(2, minmax(0, 1fr))"
            : "minmax(0, 1fr)",
          gap: "var(--mantine-spacing-sm)",
          alignItems: "stretch",
        }}
      >
        <So2rRadioPanel
          label="LEFT RADIO"
          channelIndex={0}
          stream={decoderStream}
          filterFreq={so2rLeftFilterFreq}
          setFilterFreq={setSo2rLeftFilterFreq}
          filterWidth={so2rLeftFilterWidth}
          setFilterWidth={setSo2rLeftFilterWidth}
          decodeWindowSeconds={so2rLeftWindowSeconds}
          setDecodeWindowSeconds={setSo2rLeftWindowSeconds}
          backend={backend}
          decoder={so2rLeftDecoder}
        />
        <So2rRadioPanel
          label="RIGHT RADIO"
          channelIndex={1}
          stream={decoderStream}
          filterFreq={so2rRightFilterFreq}
          setFilterFreq={setSo2rRightFilterFreq}
          filterWidth={so2rRightFilterWidth}
          setFilterWidth={setSo2rRightFilterWidth}
          decodeWindowSeconds={so2rRightWindowSeconds}
          setDecodeWindowSeconds={setSo2rRightWindowSeconds}
          backend={backend}
          decoder={so2rRightDecoder}
        />
      </Box>
    </Box>
  ) : (
    <Stack gap={0}>
      <Box px={decoderEdgePadding}>
        <Flex gap={0}>
          <Box pos="relative" style={{ flex: 1, minWidth: 0 }}>
            {decoderStream ? (
              <Scope
                stream={decoderStream}
                setFilterFreq={setFilterFreq}
                filterFreq={isPileup ? null : filterFreq}
                filterWidth={filterWidth}
                decodeWindowSeconds={effectiveWindowSeconds}
                disableInteraction={isPileup}
                height={scopeHeight}
                brightness={isPileup ? 0.75 : 1}
                maxDevicePixelRatio={isPileup ? 1.25 : undefined}
                {...(isPileup && {
                  minFreqHz: PILEUP_MIN_FREQ_HZ,
                  maxFreqHz: PILEUP_MAX_FREQ_HZ,
                })}
              />
            ) : (
              <Box
                style={{
                  height: `${scopeHeight}px`,
                  width: "100%",
                  background: "var(--mantine-color-dark-9)",
                }}
              />
            )}
            {isPileup && decoderStream && (
              <PileupOverlay
                tracks={pileupTracks}
                textMap={textMap}
                isDecoding={isPileupDecoding}
                decodeWindowSeconds={effectiveWindowSeconds}
                minFreqHz={PILEUP_MIN_FREQ_HZ}
                maxFreqHz={PILEUP_MAX_FREQ_HZ}
              />
            )}
          </Box>
        </Flex>
      </Box>

      {!isPileup && (
        <Box px={decoderEdgePadding}>
          <Stack gap="xs">
            <Stack gap={0}>
              <DecodeDisplay
                text={currentText}
                isDecoding={isDecoding}
                decodeWindowSeconds={decodeWindowSeconds}
                animationTick={currentTextTick}
                animationVersion={currentTextVersion}
              />

              {showJapaneseDisplay && (
                <DecodeDisplay
                  text={currentTextJa}
                  isDecoding={isDecoding}
                  backgroundColor="#36021e"
                  decodeWindowSeconds={decodeWindowSeconds}
                  animationTick={currentTextJaTick}
                  animationVersion={currentTextJaVersion}
                />
              )}
            </Stack>

            <Stack gap={0}>
              <StreamingTranscriptDisplay
                segments={streamingSegments}
                pendingText={streamingPendingText}
                variant="en"
                backgroundColor="var(--mantine-color-dark-9)"
                backend={backend}
              />
              {showJapaneseDisplay && (
                <StreamingTranscriptDisplay
                  segments={streamingSegments}
                  pendingText={streamingPendingTextJa}
                  variant="ja"
                  backgroundColor="#36021e"
                  backend={backend}
                  enableRedecodePopup
                />
              )}
            </Stack>
          </Stack>
        </Box>
      )}
    </Stack>
  );

  const controlPanel = (
    <Stack
      gap="xs"
      align={showControlsBesideContent ? "flex-start" : "flex-end"}
      style={controlPanelStyle}
    >
      <Flex
        gap="md"
        justify={controlJustify}
        wrap="wrap"
        style={controlRowStyle}
      >
        <NativeSelect
          label="MODE"
          data={[
            { value: "normal", label: "Normal" },
            { value: "so2r", label: "SO2R" },
            {
              value: "pileup",
              label: "Pileup (model unavailable)",
              disabled: true,
            },
            { value: "benchmark", label: "Benchmark" },
          ]}
          value={mode}
          onChange={(event) => {
            const nextMode = parseStringOption(
              event.currentTarget.value,
              MODE_OPTIONS,
            );
            if (nextMode !== undefined) {
              setMode(nextMode);
            }
          }}
          style={contentWidthSelectStyle}
        />
        {!isBenchmark && (
          <>
            <NativeSelect
              label="ENGINE"
              data={INFERENCE_BACKEND_OPTIONS}
              value={backend}
              onChange={(event) => {
                const nextBackend = parseStringOption(
                  event.currentTarget.value,
                  BACKEND_OPTIONS,
                );
                if (nextBackend !== undefined) {
                  setBackend(nextBackend);
                }
              }}
              style={contentWidthSelectStyle}
            />
          </>
        )}
      </Flex>
      {!isBenchmark && (
        <>
          <Flex
            gap="md"
            justify={controlJustify}
            wrap="wrap"
            style={controlRowStyle}
          >
            {isSo2r ? (
              <NativeSelect
                w={220}
                label="SO2R INPUT SOURCE"
                data={[
                  { value: "local", label: "Local stereo device" },
                  { value: "network", label: "Network stereo" },
                ]}
                value={so2rInputSource}
                onChange={(event) => {
                  const nextSource = parseStringOption(
                    event.currentTarget.value,
                    SO2R_INPUT_SOURCE_OPTIONS,
                  );
                  if (nextSource !== undefined) setSo2rInputSource(nextSource);
                }}
                disabled={isStarting}
              />
            ) : null}
            {!isNetworkSo2r ? (
              <Tooltip
                label={
                  isSo2r
                    ? "If the list is empty, click START once to grant microphone permission."
                    : "Select the audio input to capture."
                }
                withArrow
              >
                <Box>
                  <NativeSelect
                    w={200}
                    label={isSo2r ? "STEREO INPUT" : "INPUT"}
                    data={[
                      {
                        value: "",
                        label:
                          audioInputDevices.length === 0
                            ? "Click START to list inputs"
                            : "Select input",
                        disabled: true,
                      },
                      ...audioInputDevices.map((device) => ({
                        value: device.deviceId,
                        label:
                          device.label ||
                          `Device ${audioInputDevices.indexOf(device) + 1}`,
                      })),
                    ]}
                    value={selectedAudioInput}
                    onChange={(event) =>
                      setSelectedAudioInput(event.currentTarget.value)
                    }
                    disabled={isStarting || audioInputDevices.length === 0}
                  />
                </Box>
              </Tooltip>
            ) : null}
            {isPassthroughSupported && !isSo2r && (
              <NativeSelect
                w={200}
                label="THRU"
                data={[
                  { value: "", label: "None" },
                  ...audioOutputDevices.map((device) => ({
                    value: device.deviceId,
                    label:
                      device.label ||
                      `Device ${audioOutputDevices.indexOf(device) + 1}`,
                  })),
                ]}
                value={selectedAudioOutput}
                onChange={(event) =>
                  setSelectedAudioOutput(event.currentTarget.value)
                }
                disabled={!stream}
              />
            )}
            {isSo2r && (
              <Text size="xs" c="dimmed" maw={200}>
                THRU is disabled in SO2R to preserve left/right isolation.
              </Text>
            )}
          </Flex>
          {isNetworkSo2r ? (
            <NetworkStereoControls
              streamId={networkStreamId}
              setStreamId={setNetworkStreamId}
              senderUrl={networkSenderUrl}
              onGenerateStreamId={() =>
                setNetworkStreamId(generateSecureStreamId())
              }
              phase={networkStereo.phase}
              statusLabel={networkStereo.statusLabel}
              diagnostics={networkStereo.diagnostics}
              levels={networkStereo.levels}
              disabled={networkStereo.isActive}
            />
          ) : null}
          <Flex
            gap="md"
            justify={controlJustify}
            wrap="wrap"
            style={controlRowStyle}
          >
            {!isPileup && !isSo2r && (
              <>
                <NativeSelect
                  label="WINDOW"
                  data={DECODE_WINDOW_OPTIONS.map((seconds) => ({
                    value: seconds.toString(),
                    label: seconds.toString(),
                  }))}
                  value={decodeWindowSeconds.toString()}
                  onChange={(event) => {
                    const nextWindowSeconds = parseNumberOption(
                      event.currentTarget.value,
                      DECODE_WINDOW_OPTIONS,
                    );
                    if (nextWindowSeconds !== undefined) {
                      setDecodeWindowSeconds(nextWindowSeconds);
                    }
                  }}
                  rightSection={"s"}
                  style={contentWidthSelectStyle}
                />
                <Tooltip
                  label="Click the scope to move the decode band. Use the mouse wheel to fine-tune it."
                  withArrow
                >
                  <Box>
                    <NativeSelect
                      label="BANDWIDTH"
                      data={FILTER_WIDTH_OPTIONS.map((width) => ({
                        value: width.toString(),
                        label: width.toString(),
                      }))}
                      value={filterWidth.toString()}
                      onChange={(event) => {
                        const nextWidth = parseNumberOption(
                          event.currentTarget.value,
                          FILTER_WIDTH_OPTIONS,
                        );
                        if (nextWidth !== undefined) {
                          setFilterWidth(nextWidth);
                        }
                      }}
                      rightSection={"Hz"}
                      style={contentWidthSelectStyle}
                    />
                  </Box>
                </Tooltip>
                <NativeSelect
                  label="CW LANG"
                  data={[
                    { value: "EN", label: "EN" },
                    {
                      value: "EN/JA",
                      label: "EN/JA (model unavailable)",
                      disabled: true,
                    },
                  ]}
                  value={language}
                  onChange={(event) => {
                    const nextLanguage = parseStringOption(
                      event.currentTarget.value,
                      LANGUAGE_OPTIONS,
                    );
                    if (nextLanguage !== undefined) {
                      setLanguage(nextLanguage);
                    }
                  }}
                  style={contentWidthSelectStyle}
                />
              </>
            )}
            {isSo2r && (
              <Text size="xs" c="dimmed">
                Both radios share the selected engine and English model.
              </Text>
            )}
          </Flex>
        </>
      )}
    </Stack>
  );

  return (
    <Stack gap={8}>
      {!isBenchmark && (
        <Box px={8}>
          <Flex justify="space-between" align="flex-start">
            <Flex gap="sm" align="flex-start" style={{ flex: 1, minWidth: 0 }}>
              <Button
                w={200}
                color={isActive ? "red" : "indigo"}
                onClick={() => {
                  if (isNetworkSo2r) {
                    if (networkStereo.isActive) {
                      void networkStereo.disconnect();
                    } else {
                      void connectNetworkStereo();
                    }
                  } else if (isActive) {
                    captureRequestIdRef.current += 1;
                    stream?.getTracks().forEach((track) => track.stop());
                    setStream(null);
                    setCaptureInfo(null);
                    setCaptureError(null);
                    setCaptureNotice(null);
                    setIsStarting(false);
                  } else if (isSo2r && !selectedAudioInput) {
                    void prepareAudioInputSelection();
                  } else {
                    void getStream(selectedAudioInput || undefined);
                  }
                }}
                disabled={!isActive && isLoading}
              >
                {isNetworkSo2r
                  ? networkStereo.isActive
                    ? "DISCONNECT"
                    : "CONNECT"
                  : isActive
                    ? "STOP"
                    : "START"}
              </Button>
              <Box style={{ flex: 1, minWidth: 0, maxWidth: "400px" }}>
                <LoadProgressBars progress={loadProgress} />
                {isSo2r && !isNetworkSo2r && captureInfo ? (
                  <Text size="xs" c="dimmed">
                    CAPTURE: {captureInfo.channelCount} channels ·{" "}
                    {captureInfo.sampleRate == null
                      ? "sample rate not reported"
                      : `${captureInfo.sampleRate.toLocaleString()} Hz`}
                  </Text>
                ) : null}
              </Box>
              {(captureError ?? networkStereo.error ?? loadError) && (
                <Box
                  style={{
                    color: "var(--mantine-color-red-4)",
                    fontSize: "14px",
                  }}
                >
                  {captureError ?? networkStereo.error ?? loadError}
                </Box>
              )}
              {captureNotice &&
              !isNetworkSo2r &&
              !captureError &&
              !loadError ? (
                <Text size="xs" c="dimmed">
                  {captureNotice}
                </Text>
              ) : null}
            </Flex>
          </Flex>
        </Box>
      )}

      {showControlsBesideContent ? (
        <Flex gap="md" align="flex-start">
          <Box style={{ flex: 1, minWidth: 0 }}>{mainContent}</Box>
          <Box pr={8}>{controlPanel}</Box>
        </Flex>
      ) : (
        <>
          {mainContent}
          <Box px={8}>{controlPanel}</Box>
        </>
      )}
    </Stack>
  );
};
