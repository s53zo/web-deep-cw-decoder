import type { DecodeWindowSeconds } from "../const";
import { useDecode } from "../useDecode";
import type { InferenceBackend } from "../utils/inferenceProtocol";
import { useAudioProcessing } from "./useAudioProcessing";
import { useStreamingDecode } from "./useStreamingDecode";

type UseSo2rChannelParams = {
  stream: MediaStream | null;
  enabled: boolean;
  channelIndex: 0 | 1;
  filterFreq: number;
  filterWidth: number;
  decodeWindowSeconds: DecodeWindowSeconds;
  backend: InferenceBackend;
};

export function useSo2rChannel({
  stream,
  enabled,
  channelIndex,
  filterFreq,
  filterWidth,
  decodeWindowSeconds,
  backend,
}: UseSo2rChannelParams) {
  const activeStream = enabled ? stream : null;
  const audioBufferRef = useAudioProcessing(
    activeStream,
    decodeWindowSeconds,
    channelIndex,
    2,
  );
  const decode = useDecode({
    filterFreq,
    filterWidth,
    stream: activeStream,
    language: "EN",
    backend,
    decodeWindowSeconds,
    audioBufferRef,
    enabled,
  });
  const streaming = useStreamingDecode({
    filterFreq,
    filterWidth,
    stream: activeStream,
    language: "EN",
    backend,
    channelIndex,
    inputChannelCount: 2,
    enabled,
  });

  return {
    loaded: decode.loaded && streaming.loaded,
    loadError: decode.loadError ?? streaming.loadError,
    isDecoding: decode.isDecoding || streaming.isDecoding,
    currentText: decode.currentText,
    currentTextTick: decode.currentTextTick,
    currentTextVersion: decode.currentTextVersion,
    segments: streaming.segments,
    pendingText: streaming.pendingText,
  };
}

export type So2rChannelState = ReturnType<typeof useSo2rChannel>;
