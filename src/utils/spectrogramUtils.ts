import { STFT } from "../stft.ts";
import {
  BIN_RESOLUTION,
  DECODABLE_MAX_FREQ_HZ,
  DECODABLE_MIN_FREQ_HZ,
  MODEL_FFT_LENGTH,
  MODEL_HOP_LENGTH,
  MODEL_SAMPLE_RATE,
  NARROW_SHIFT_BINS,
  PILEUP_FILTER_WIDTH_HZ,
  SAMPLE_RATE,
} from "../const.ts";
import { applyBandpassFilter } from "./audioFilters.ts";

const stft = new STFT(MODEL_FFT_LENGTH, MODEL_HOP_LENGTH);
const TOTAL_BINS = MODEL_FFT_LENGTH / 2 + 1;
const START_BIN = Math.ceil(DECODABLE_MIN_FREQ_HZ / BIN_RESOLUTION);
const END_BIN =
  Math.floor(DECODABLE_MAX_FREQ_HZ / BIN_RESOLUTION) + 1;
const CROPPED_BINS = END_BIN - START_BIN;
const NORMAL_CENTER_BIN = Math.round((START_BIN + END_BIN - 1) / 2); // bin 64 = 800Hz
const NARROW_CENTER_IDX = Math.floor(NARROW_SHIFT_BINS / 2);

if (END_BIN > TOTAL_BINS) {
  throw new Error("Configured decode band exceeds the FFT spectrum.");
}

if (CROPPED_BINS !== 65) {
  throw new Error(`Model input must remain 65 bins, got ${CROPPED_BINS}.`);
}

function resampleForModel(audio: Float32Array): Float32Array {
  if (audio.length === 0) {
    return audio;
  }

  const targetLength = Math.round(
    (audio.length * MODEL_SAMPLE_RATE) / SAMPLE_RATE,
  );
  const output = new Float32Array(targetLength);

  for (let index = 0; index < targetLength; index += 1) {
    const sourcePosition = (index * SAMPLE_RATE) / MODEL_SAMPLE_RATE;
    const leftIndex = Math.floor(sourcePosition);
    const rightIndex = Math.min(leftIndex + 1, audio.length - 1);
    const fraction = sourcePosition - leftIndex;
    output[index] =
      audio[leftIndex] * (1 - fraction) + audio[rightIndex] * fraction;
  }

  return output;
}

function reflectPadForCenteredFrames(audio: Float32Array): Float32Array {
  const pad = Math.floor(MODEL_FFT_LENGTH / 2);
  if (audio.length <= pad + 1) {
    return new Float32Array(0);
  }

  const padded = new Float32Array(audio.length + pad * 2);
  for (let index = 0; index < pad; index += 1) {
    padded[index] = audio[pad - index];
    padded[pad + audio.length + index] =
      audio[audio.length - 2 - index];
  }
  padded.set(audio, pad);
  return padded;
}

function prepareModelAudio(audio: Float32Array): Float32Array {
  return reflectPadForCenteredFrames(resampleForModel(audio));
}

function getMagnitude(complexFrame: Float32Array, bin: number): number {
  const real = complexFrame[bin * 2];
  const imaginary = complexFrame[bin * 2 + 1];
  return Math.log1p(Math.hypot(real, imaginary));
}

export function audioToSpectrogramTensor(
  audio: Float32Array,
  filterFreq: number | null,
  filterWidth: number
): { data: Float32Array; dims: [number, 1, number, number] } | null {
  let processedAudio = audio;
  if (filterFreq !== null && filterWidth > 0) {
    processedAudio = applyBandpassFilter(
      audio,
      SAMPLE_RATE,
      filterFreq,
      filterWidth
    );
  }
  processedAudio = prepareModelAudio(processedAudio);

  const timeSteps = stft.getFrameCount(processedAudio.length);
  if (timeSteps === 0) {
    return null;
  }

  const flattenedSpectrogram = new Float32Array(timeSteps * CROPPED_BINS);
  stft.forEachSpectrum(processedAudio, (complexFrame, frameIndex) => {
    const offset = frameIndex * CROPPED_BINS;
    for (let bin = START_BIN; bin < END_BIN; bin++) {
      flattenedSpectrogram[offset + bin - START_BIN] = getMagnitude(
        complexFrame,
        bin,
      );
    }
  });

  return {
    data: flattenedSpectrogram,
    dims: [1, 1, timeSteps, CROPPED_BINS],
  };
}

/**
 * Compute spectrogram with frequency bin shifting.
 * Extracts only `bandwidth` Hz around targetFreq, places it at 800Hz (model center).
 * All other bins are zero-filled for the 65-bin English model.
 */
export function audioToShiftedSpectrogramTensor(
  audio: Float32Array,
  targetFreq: number,
  bandwidth: number = PILEUP_FILTER_WIDTH_HZ,
): { data: Float32Array; dims: [number, 1, number, number] } | null {
  const processedAudio = prepareModelAudio(audio);
  const timeSteps = stft.getFrameCount(processedAudio.length);
  if (timeSteps === 0) return null;

  const targetBin = Math.round(targetFreq / BIN_RESOLUTION);
  const halfWidthBins = Math.ceil(bandwidth / 2 / BIN_RESOLUTION);
  const destCenterIdx = NORMAL_CENTER_BIN - START_BIN; // index 32 in cropped output

  const flattenedSpectrogram = new Float32Array(timeSteps * CROPPED_BINS);

  stft.forEachSpectrum(processedAudio, (complexFrame, frameIndex) => {
    const offset = frameIndex * CROPPED_BINS;
    for (let d = -halfWidthBins; d <= halfWidthBins; d++) {
      const srcBin = targetBin + d;
      const destIdx = destCenterIdx + d;
      if (
        srcBin >= 0 &&
        srcBin < TOTAL_BINS &&
        destIdx >= 0 &&
        destIdx < CROPPED_BINS
      ) {
        flattenedSpectrogram[offset + destIdx] = getMagnitude(
          complexFrame,
          srcBin,
        );
      }
    }
  });

  return {
    data: flattenedSpectrogram,
    dims: [1, 1, timeSteps, CROPPED_BINS],
  };
}

/**
 * Compute spectrogram for the 5-bin pileup model by extracting
 * only the centered narrow slice around the target frequency.
 */
export function audioToNarrowShiftedSpectrogramTensor(
  audio: Float32Array,
  targetFreq: number,
): { data: Float32Array; dims: [number, 1, number, number] } | null {
  const processedAudio = prepareModelAudio(audio);
  const timeSteps = stft.getFrameCount(processedAudio.length);
  if (timeSteps === 0) return null;

  const targetBin = Math.round(targetFreq / BIN_RESOLUTION);
  const flattenedSpectrogram = new Float32Array(timeSteps * NARROW_SHIFT_BINS);

  stft.forEachSpectrum(processedAudio, (complexFrame, frameIndex) => {
    const offset = frameIndex * NARROW_SHIFT_BINS;
    for (let d = -NARROW_CENTER_IDX; d <= NARROW_CENTER_IDX; d++) {
      const srcBin = targetBin + d;
      const destIdx = NARROW_CENTER_IDX + d;
      if (srcBin >= 0 && srcBin < TOTAL_BINS) {
        flattenedSpectrogram[offset + destIdx] = getMagnitude(
          complexFrame,
          srcBin,
        );
      }
    }
  });

  return {
    data: flattenedSpectrogram,
    dims: [1, 1, timeSteps, NARROW_SHIFT_BINS],
  };
}

export function audioToBinSequenceTensor(
  audio: Float32Array,
  minFreqHz: number,
  maxFreqHz: number,
): { data: Float32Array; dims: [number, 1, number]; frequencies: number[] } | null {
  const processedAudio = prepareModelAudio(audio);
  const timeSteps = stft.getFrameCount(processedAudio.length);
  if (timeSteps === 0) {
    return null;
  }

  const clampedMinFreqHz = Math.max(0, minFreqHz);
  const clampedMaxFreqHz = Math.min(MODEL_SAMPLE_RATE / 2, maxFreqHz);
  if (clampedMinFreqHz > clampedMaxFreqHz) {
    return null;
  }

  const minBin = Math.max(0, Math.floor(clampedMinFreqHz / BIN_RESOLUTION));
  const maxBin = Math.min(
    TOTAL_BINS - 1,
    Math.ceil(clampedMaxFreqHz / BIN_RESOLUTION),
  );
  const batchSize = maxBin - minBin + 1;

  if (batchSize <= 0) {
    return null;
  }

  const flattenedSequences = new Float32Array(batchSize * timeSteps);
  const frequencies = Array.from(
    { length: batchSize },
    (_, index) => (minBin + index) * BIN_RESOLUTION,
  );

  stft.forEachSpectrum(processedAudio, (complexFrame, frameIndex) => {
    for (let bin = minBin; bin <= maxBin; bin++) {
      const batchIndex = bin - minBin;
      flattenedSequences[batchIndex * timeSteps + frameIndex] =
        getMagnitude(complexFrame, bin);
    }
  });

  for (let batchIndex = 0; batchIndex < batchSize; batchIndex++) {
    const offset = batchIndex * timeSteps;
    let mean = 0;

    for (let frameIndex = 0; frameIndex < timeSteps; frameIndex++) {
      mean += flattenedSequences[offset + frameIndex];
    }

    mean /= timeSteps;

    let variance = 0;
    for (let frameIndex = 0; frameIndex < timeSteps; frameIndex++) {
      const centered = flattenedSequences[offset + frameIndex] - mean;
      variance += centered * centered;
    }

    const std = Math.max(Math.sqrt(variance / timeSteps), 1e-4);
    for (let frameIndex = 0; frameIndex < timeSteps; frameIndex++) {
      flattenedSequences[offset + frameIndex] =
        (flattenedSequences[offset + frameIndex] - mean) / std;
    }
  }

  return {
    data: flattenedSequences,
    dims: [batchSize, 1, timeSteps],
    frequencies,
  };
}
