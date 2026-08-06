import type { AudioBufferState } from "../hooks/useAudioProcessing";

/**
 * Start a Pileup capture session with no samples from the previous input.
 * Incrementing the version also invalidates any producer observation made
 * before the reset.
 */
export function resetPileupAudioWindow(state: AudioBufferState): void {
  state.samples.fill(0);
  state.version += 1;
  state.endSample = 0;
}
