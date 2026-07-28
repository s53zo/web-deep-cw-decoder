import assert from "node:assert/strict";
import test from "node:test";

import {
  audioToShiftedSpectrogramTensor,
  audioToSpectrogramTensor,
} from "../src/utils/spectrogramUtils.ts";

const CAPTURE_SAMPLE_RATE = 9600;
const MODEL_SAMPLE_RATE = 3200;
const FFT_LENGTH = 256;
const HOP_LENGTH = 48;
const START_BIN = 32;
const END_BIN = 97;
const FREQUENCY_BINS = END_BIN - START_BIN;

function referenceModelSpectrogram(audio: Float32Array): Float32Array {
  const resampledLength = Math.round(
    (audio.length * MODEL_SAMPLE_RATE) / CAPTURE_SAMPLE_RATE,
  );
  const resampled = new Float32Array(resampledLength);
  for (let index = 0; index < resampledLength; index += 1) {
    const sourcePosition =
      (index * CAPTURE_SAMPLE_RATE) / MODEL_SAMPLE_RATE;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, audio.length - 1);
    const fraction = sourcePosition - leftIndex;
    resampled[index] =
      audio[leftIndex] * (1 - fraction) + audio[rightIndex] * fraction;
  }

  const pad = FFT_LENGTH / 2;
  const padded = new Float32Array(resampled.length + pad * 2);
  for (let index = 0; index < pad; index += 1) {
    padded[index] = resampled[pad - index];
    padded[pad + resampled.length + index] =
      resampled[resampled.length - 2 - index];
  }
  padded.set(resampled, pad);

  const frameCount =
    Math.floor((padded.length - FFT_LENGTH) / HOP_LENGTH) + 1;
  const output = new Float32Array(frameCount * FREQUENCY_BINS);
  const window = Float32Array.from(
    { length: FFT_LENGTH },
    (_, index) =>
      0.5 - 0.5 * Math.cos((2 * Math.PI * index) / FFT_LENGTH),
  );

  for (let frame = 0; frame < frameCount; frame += 1) {
    const frameOffset = frame * HOP_LENGTH;
    for (let bin = START_BIN; bin < END_BIN; bin += 1) {
      let real = 0;
      let imaginary = 0;
      for (let sample = 0; sample < FFT_LENGTH; sample += 1) {
        const value = Math.fround(
          padded[frameOffset + sample] * window[sample],
        );
        const angle = (-2 * Math.PI * bin * sample) / FFT_LENGTH;
        real += value * Math.cos(angle);
        imaginary += value * Math.sin(angle);
      }
      output[frame * FREQUENCY_BINS + bin - START_BIN] = Math.log1p(
        Math.hypot(real, imaginary),
      );
    }
  }

  return output;
}

function makeTestAudio(length: number): Float32Array {
  return Float32Array.from({ length }, (_, index) => {
    const time = index / CAPTURE_SAMPLE_RATE;
    return (
      0.55 * Math.sin(2 * Math.PI * 615 * time) +
      0.2 * Math.sin(2 * Math.PI * 925 * time + 0.3) +
      0.03 * Math.sin(2 * Math.PI * 137 * time)
    );
  });
}

test("matches the published DeepCW preprocessing algorithm", () => {
  const audio = makeTestAudio(960);
  const actual = audioToSpectrogramTensor(audio, null, 800);
  assert.ok(actual);

  const expected = referenceModelSpectrogram(audio);
  assert.deepEqual(actual.dims, [1, 1, 7, 65]);
  assert.equal(actual.data.length, expected.length);

  let maximumError = 0;
  for (let index = 0; index < expected.length; index += 1) {
    maximumError = Math.max(
      maximumError,
      Math.abs(actual.data[index] - expected[index]),
    );
  }
  assert.ok(
    maximumError < 2e-4,
    `Maximum spectrogram error ${maximumError} exceeded tolerance.`,
  );
});

test("moves a selected CW tone to the model's 800 Hz center bin", () => {
  const frequency = 1000;
  const audio = Float32Array.from({ length: 2880 }, (_, index) =>
    Math.sin((2 * Math.PI * frequency * index) / CAPTURE_SAMPLE_RATE),
  );
  const shifted = audioToShiftedSpectrogramTensor(audio, frequency, 100);
  assert.ok(shifted);

  const middleFrame = Math.floor(shifted.dims[2] / 2);
  const frame = shifted.data.subarray(
    middleFrame * FREQUENCY_BINS,
    (middleFrame + 1) * FREQUENCY_BINS,
  );
  const peakIndex = frame.indexOf(Math.max(...frame));

  assert.equal(peakIndex, 32);
});
