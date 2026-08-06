import { useRef, useState, type ChangeEvent } from "react";
import { Box, Button, Flex, Progress, Stack, Text } from "@mantine/core";
import type { PileupAssetSummary } from "./pileup/assets";

type PileupAssetControlsProps = {
  assets: PileupAssetSummary[];
  ready: boolean;
  isLoading: boolean;
  leftProgress: number;
  rightProgress: number;
  onLoadFiles: (files: readonly File[]) => Promise<void>;
  onForget: () => Promise<void>;
};

export function PileupAssetControls({
  assets,
  ready,
  isLoading,
  leftProgress,
  rightProgress,
  onLoadFiles,
  onForget,
}: PileupAssetControlsProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (files.length === 0) return;
    setActionError(null);
    try {
      await onLoadFiles(files);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Failed to load local files.",
      );
    }
  };

  const forget = async () => {
    setActionError(null);
    try {
      await onForget();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Failed to forget local files.",
      );
    }
  };

  return (
    <Box
      p="xs"
      style={{
        width: "100%",
        border: "1px solid var(--mantine-color-dark-5)",
        background: "var(--mantine-color-dark-8)",
      }}
    >
      <Stack gap={6}>
        <Flex gap="xs" align="center" wrap="wrap">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".cwm,.wasm,application/wasm"
            onChange={(event) => void handleFiles(event)}
            style={{ display: "none" }}
          />
          <Button
            size="compact-sm"
            variant={ready ? "light" : "filled"}
            loading={isLoading}
            onClick={() => inputRef.current?.click()}
          >
            {ready ? "REPLACE LOCAL PILEUP FILES" : "LOAD LOCAL PILEUP FILES"}
          </Button>
          {ready ? (
            <Button
              size="compact-sm"
              variant="subtle"
              color="red"
              disabled={isLoading}
              onClick={() => void forget()}
            >
              FORGET LOCAL PILEUP FILES
            </Button>
          ) : null}
          <Text size="xs" c={ready ? "green.4" : "yellow.4"} fw={700}>
            {ready ? "PRIVATE FILES READY" : "THREE LOCAL FILES REQUIRED"}
          </Text>
        </Flex>

        {ready ? (
          <Text size="xs" c="dimmed">
            {[...assets]
              .sort((left, right) => left.role.localeCompare(right.role))
              .map((asset) => `${asset.role}: ${asset.filename}`)
              .join(" · ")}
          </Text>
        ) : (
          <Text size="xs" c="dimmed">
            Select the detector CWM1, narrow decoder CWM1, and
            deepcw-core.wasm together. They are validated locally and saved only
            in this browser&apos;s IndexedDB.
          </Text>
        )}

        {ready && (leftProgress < 1 || rightProgress < 1) ? (
          <Stack gap={2}>
            <Text size="xs" c="dimmed">
              LEFT WORKER {Math.round(leftProgress * 100)}%
            </Text>
            <Progress value={leftProgress * 100} size="xs" radius={0} />
            <Text size="xs" c="dimmed">
              RIGHT WORKER {Math.round(rightProgress * 100)}%
            </Text>
            <Progress value={rightProgress * 100} size="xs" radius={0} />
          </Stack>
        ) : null}

        <Text size="xs" c="dimmed">
          DeepCW never uploads these files. They are not placed in the service
          worker cache or a deployable asset directory.
        </Text>
        {actionError ? (
          <Text size="xs" c="red.4">
            {actionError}
          </Text>
        ) : null}
      </Stack>
    </Box>
  );
}
