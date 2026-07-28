type AudioChannelSource = Pick<
  AudioBuffer,
  "getChannelData" | "numberOfChannels"
>;

export function getIsolatedAudioChannel(
  inputBuffer: AudioChannelSource,
  channelIndex: number,
): Float32Array {
  if (
    !Number.isInteger(channelIndex) ||
    channelIndex < 0 ||
    channelIndex >= inputBuffer.numberOfChannels
  ) {
    throw new RangeError(
      `Audio channel ${channelIndex} is unavailable; input has ${inputBuffer.numberOfChannels} channel(s).`,
    );
  }

  return inputBuffer.getChannelData(channelIndex);
}

export function getProcessorInputChannelCount(
  channelIndex: number,
  inputChannelCount: number,
): number {
  return Math.max(1, channelIndex + 1, inputChannelCount);
}
