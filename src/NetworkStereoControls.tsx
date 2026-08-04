import {
  Box,
  Button,
  CopyButton,
  Flex,
  NativeSelect,
  Progress,
  Stack,
  Text,
} from "@mantine/core";
import type { StereoLevels } from "./hooks/useVdoNinjaStereo";
import type {
  NetworkAudioDiagnostics,
  NetworkStereoPhase,
} from "./utils/networkStereo";
import type { AudioContextActivationState } from "./utils/audioContextActivation";

type NetworkStereoControlsProps = {
  streamId: string;
  senderUrl: string | null;
  phase: NetworkStereoPhase;
  statusLabel: string;
  diagnostics: NetworkAudioDiagnostics;
  levels: StereoLevels;
  audioActivationState: AudioContextActivationState;
  onEnableMacAudio: () => void;
};

function meterPercent(level: number): number {
  if (level <= 0) return 0;
  const decibels = 20 * Math.log10(level);
  return Math.max(0, Math.min(100, ((decibels + 60) / 60) * 100));
}

function diagnosticValue(value: string | number | null, fallback: string) {
  return value == null ? fallback : value;
}

export function NetworkStereoControls({
  streamId,
  senderUrl,
  phase,
  statusLabel,
  diagnostics,
  levels,
  audioActivationState,
  onEnableMacAudio,
}: NetworkStereoControlsProps) {
  const isError = phase === "error";
  const statusColor = isError
    ? "red"
    : phase === "connected"
      ? "green"
      : phase === "reconnecting"
        ? "yellow"
        : "dimmed";

  return (
    <Box
      p="sm"
      style={{
        width: "100%",
        border: "1px solid var(--mantine-color-dark-5)",
        background: "var(--mantine-color-dark-8)",
      }}
    >
      <Stack gap="xs">
        <Flex gap="sm" wrap="wrap" align="flex-end">
          <Box style={{ flex: "1 1 280px" }}>
            <Text size="xs" fw={700} c="dimmed">
              FIXED VDO.NINJA STREAM ID
            </Text>
            <Text>{streamId}</Text>
          </Box>
          <CopyButton value={senderUrl ?? ""} timeout={2_000}>
            {({ copied, copy }) => (
              <Button onClick={copy} disabled={!senderUrl}>
                {copied ? "COPIED" : "COPY WINDOWS LINK"}
              </Button>
            )}
          </CopyButton>
          <NativeSelect
            label="TRANSPORT"
            value="automatic"
            data={[
              {
                value: "automatic",
                label: "Auto: PCM/L16, then Opus Pro",
              },
            ]}
            disabled
          />
        </Flex>

        {senderUrl ? (
          <Text size="xs" c="blue.4" style={{ overflowWrap: "anywhere" }}>
            {senderUrl}
          </Text>
        ) : null}

        <Flex gap="lg" wrap="wrap">
          <Text size="xs" c={statusColor} fw={700}>
            STATUS: {statusLabel}
          </Text>
          <Text size="xs" c="dimmed">
            CODEC: {diagnosticValue(diagnostics.codec, "NOT VERIFIED")}
          </Text>
          <Text size="xs" c="dimmed">
            RATE:{" "}
            {diagnostics.sampleRate == null
              ? "NOT REPORTED"
              : `${diagnostics.sampleRate.toLocaleString()} Hz`}
          </Text>
          <Text size="xs" c="dimmed">
            CHANNELS: {diagnosticValue(diagnostics.channelCount, "NOT VERIFIED")}
          </Text>
          <Text size="xs" c="dimmed">
            PATH:{" "}
            {diagnostics.route === "direct"
              ? "DIRECT P2P"
              : diagnostics.route === "relay"
                ? "TURN RELAY"
                : "NOT VERIFIED"}
          </Text>
        </Flex>

        {phase === "connected" && audioActivationState === "suspended" ? (
          <Flex gap="sm" align="center" wrap="wrap">
            <Button color="yellow" onClick={onEnableMacAudio}>
              ENABLE MAC AUDIO
            </Button>
            <Text size="xs" c="yellow.4">
              Chrome paused DeepCW audio processing. Click once to start the
              meters, waterfalls, and both decoders.
            </Text>
          </Flex>
        ) : null}

        <Flex gap="md" wrap="wrap">
          <Box style={{ flex: "1 1 220px" }}>
            <Text size="xs" fw={700} c="dimmed">
              LEFT / CHANNEL 0
            </Text>
            <Progress value={meterPercent(levels.left)} color="blue" size="sm" />
          </Box>
          <Box style={{ flex: "1 1 220px" }}>
            <Text size="xs" fw={700} c="dimmed">
              RIGHT / CHANNEL 1
            </Text>
            <Progress value={meterPercent(levels.right)} color="orange" size="sm" />
          </Box>
        </Flex>

        <Text size="xs" c="dimmed">
          Open the copied link in Chrome or Edge on Windows, select the stereo
          interface, and start sharing. DeepCW will decode only after two channels
          are positively verified.
        </Text>
      </Stack>
    </Box>
  );
}
