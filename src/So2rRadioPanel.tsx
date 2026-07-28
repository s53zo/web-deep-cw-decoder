import { Box, Flex, NativeSelect, Stack, Text, Tooltip } from "@mantine/core";
import {
  DECODE_WINDOW_OPTIONS,
  FILTER_WIDTH_OPTIONS,
  type DecodeWindowSeconds,
} from "./const";
import { DecodeDisplay } from "./DecodeDisplay";
import type { So2rChannelState } from "./hooks/useSo2rChannel";
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
}: So2rRadioPanelProps) {
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
            <Scope
              stream={stream}
              channelIndex={channelIndex}
              inputChannelCount={2}
              setFilterFreq={setFilterFreq}
              filterFreq={filterFreq}
              filterWidth={filterWidth}
              decodeWindowSeconds={decodeWindowSeconds}
            />
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
      </Stack>
    </Box>
  );
}
