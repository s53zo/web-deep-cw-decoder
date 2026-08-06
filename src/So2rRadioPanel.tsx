import { Box, Flex, NativeSelect, Stack, Text, Tooltip } from "@mantine/core";
import {
  DECODE_WINDOW_OPTIONS,
  FILTER_WIDTH_OPTIONS,
  MAX_FREQ_HZ,
  MIN_FREQ_HZ,
  PILEUP_WINDOW_S,
  type DecodeWindowSeconds,
} from "./const";
import { DecodeDisplay } from "./DecodeDisplay";
import { PileupWaterfallVisualization } from "./PileupWaterfallVisualization";
import type { So2rChannelState } from "./hooks/useSo2rChannel";
import type { So2rPileupChannelState } from "./hooks/useSo2rPileupChannel";
import { Scope } from "./Scope";
import { StreamingTranscriptDisplay } from "./StreamingTranscriptDisplay";
import type { InferenceBackend } from "./utils/inferenceProtocol";
import { parseNumberOption } from "./utils/optionUtils";

type So2rRadioPanelProps = {
  label: "LEFT RADIO" | "RIGHT RADIO";
  channelIndex: 0 | 1;
  stream: MediaStream | null;
  filterFreq: number;
  setFilterFreq: (frequency: number) => void;
  filterWidth: number;
  setFilterWidth: (width: number) => void;
  decodeWindowSeconds: DecodeWindowSeconds;
  setDecodeWindowSeconds: (seconds: DecodeWindowSeconds) => void;
  backend: InferenceBackend;
  decoder: So2rChannelState;
  decoderMode: "standard" | "pileup";
  pileupDecoder: So2rPileupChannelState;
};

export function So2rRadioPanel({
  label,
  channelIndex,
  stream,
  filterFreq,
  setFilterFreq,
  filterWidth,
  setFilterWidth,
  decodeWindowSeconds,
  setDecodeWindowSeconds,
  backend,
  decoder,
  decoderMode,
  pileupDecoder,
}: So2rRadioPanelProps) {
  const isPileup = decoderMode === "pileup";
  const effectiveWindowSeconds = isPileup
    ? PILEUP_WINDOW_S
    : decodeWindowSeconds;
  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-dark-5)",
        background: "var(--mantine-color-dark-8)",
        height: "100%",
      }}
    >
      <Stack gap={6}>
        <Flex
          px={8}
          pt={6}
          gap="md"
          align="flex-end"
          justify="space-between"
          wrap="wrap"
        >
          <Stack gap={0}>
            <Text size="sm" fw={800}>
              {label}
            </Text>
            <Text size="xs" c="dimmed">
              CHANNEL {channelIndex} · CENTER {filterFreq} Hz
            </Text>
          </Stack>
          <Flex gap="sm" align="flex-end" wrap="wrap">
            {isPileup ? (
              <Stack gap={0}>
                <Text size="xs" fw={500}>
                  {label} WINDOW
                </Text>
                <Text size="sm">{PILEUP_WINDOW_S} s · Native WASM</Text>
              </Stack>
            ) : (
              <NativeSelect
                label={`${label} WINDOW`}
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
                rightSection="s"
                style={{ width: "fit-content" }}
              />
            )}
            <Tooltip
              label={`Click the ${label.toLowerCase()} scope to move its decode band. Use the mouse wheel to fine-tune it.`}
              withArrow
            >
              <Box>
                <NativeSelect
                  label={`${label} BANDWIDTH`}
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
                  rightSection="Hz"
                  style={{ width: "fit-content" }}
                />
              </Box>
            </Tooltip>
          </Flex>
        </Flex>

        <Stack gap={0}>
          <Text px={8} size="xs" fw={700} c="dimmed">
            {label} SCOPE
          </Text>
          {stream ? (
            <Box style={{ position: "relative" }}>
              <Scope
                stream={stream}
                channelIndex={channelIndex}
                inputChannelCount={2}
                setFilterFreq={setFilterFreq}
                filterFreq={filterFreq}
                filterWidth={filterWidth}
                decodeWindowSeconds={effectiveWindowSeconds}
                minFreqHz={MIN_FREQ_HZ}
                maxFreqHz={MAX_FREQ_HZ}
              />
              {isPileup && (
                <PileupWaterfallVisualization
                  key={pileupDecoder.visualizationSessionKey}
                  decoder={pileupDecoder}
                  minFrequencyHz={MIN_FREQ_HZ}
                  maxFrequencyHz={MAX_FREQ_HZ}
                />
              )}
            </Box>
          ) : (
            <Box
              style={{
                height: "256px",
                width: "100%",
                background: "var(--mantine-color-dark-9)",
              }}
            />
          )}
        </Stack>

        {isPileup ? (
          <Stack gap={6} px={8} pb={8}>
            <Flex justify="space-between" gap="xs" wrap="wrap">
              <Text size="xs" fw={700} c="dimmed">
                {label} PILEUP LANES ({pileupDecoder.lanes.length}/
                {pileupDecoder.maxLanes})
              </Text>
              <Text size="xs" c="dimmed">
                DET {pileupDecoder.metrics.detectorMs.toFixed(1)} ms · DEC{" "}
                {pileupDecoder.metrics.decoderMs.toFixed(1)} ms · Q{" "}
                {pileupDecoder.metrics.queueDepth} · DROP{" "}
                {pileupDecoder.metrics.droppedAnalyses} ·{" "}
                {pileupDecoder.metrics.analysisIntervalMs} ms cadence
              </Text>
            </Flex>
            {pileupDecoder.lanes.length === 0 ? (
              <Box
                p="sm"
                style={{ background: "var(--mantine-color-dark-9)" }}
              >
                <Text size="sm" c="dimmed">
                  {!stream
                    ? "Start the stereo input to scan this radio passband."
                    : !pileupDecoder.loaded
                      ? `Initializing ${label.toLowerCase()} Pileup worker…`
                      : "Scanning the selected passband for CW signals…"}
                </Text>
              </Box>
            ) : (
              pileupDecoder.lanes.map((lane) => (
                <Box
                  key={lane.id}
                  p={6}
                  style={{
                    border: "1px solid var(--mantine-color-dark-5)",
                    background: "var(--mantine-color-dark-9)",
                  }}
                >
                  <Flex justify="space-between" gap="xs" wrap="wrap">
                    <Text size="xs" fw={800}>
                      {lane.frequency} Hz
                    </Text>
                    <Text
                      size="xs"
                      c={lane.status === "decoding" ? "green.4" : "dimmed"}
                    >
                      {lane.status.toUpperCase()} ·{" "}
                      {Math.round(lane.probability * 100)}%
                    </Text>
                  </Flex>
                  <Text
                    size="md"
                    fw={700}
                    style={{ minHeight: "24px", whiteSpace: "pre-wrap" }}
                  >
                    {lane.liveText || " "}
                  </Text>
                  <Text
                    size="xs"
                    c="dimmed"
                    style={{ minHeight: "18px", whiteSpace: "pre-wrap" }}
                  >
                    {lane.transcript || "No transcript yet"}
                  </Text>
                </Box>
              ))
            )}
          </Stack>
        ) : (
          <>
            <Stack gap={0}>
              <Text px={8} size="xs" fw={700} c="dimmed">
                {label} LIVE DECODE
              </Text>
              <DecodeDisplay
                text={decoder.currentText}
                isDecoding={decoder.isDecoding}
                decodeWindowSeconds={decodeWindowSeconds}
                animationTick={decoder.currentTextTick}
                animationVersion={decoder.currentTextVersion}
              />
            </Stack>

            <Stack gap={0} pb={6}>
              <Text px={8} size="xs" fw={700} c="dimmed">
                {label} TRANSCRIPT
              </Text>
              <StreamingTranscriptDisplay
                segments={decoder.segments}
                pendingText={decoder.pendingText}
                variant="en"
                backgroundColor="var(--mantine-color-dark-9)"
                backend={backend}
              />
            </Stack>
          </>
        )}
      </Stack>
    </Box>
  );
}
