import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as ort from "onnxruntime-web";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const modelPath = path.join(
  repositoryRoot,
  "public",
  "models",
  "model_en.onnx",
);
const metadataPath = `${modelPath}.json`;

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
assert.deepEqual(
  {
    sampleRate: metadata.sample_rate,
    fftLength: metadata.fft_length,
    hopLength: metadata.hop_length,
    minFrequency: metadata.spectrogram_min_freq_hz,
    maxFrequency: metadata.spectrogram_max_freq_hz,
    frequencyBins: metadata.spectrogram_frequency_bins,
    normalization: metadata.normalization,
    inputName: metadata.onnx_input_name,
    outputName: metadata.onnx_output_name,
    classes: metadata.num_classes,
  },
  {
    sampleRate: 3200,
    fftLength: 256,
    hopLength: 48,
    minFrequency: 400,
    maxFrequency: 1200,
    frequencyBins: 65,
    normalization: "log1p",
    inputName: "spectrogram",
    outputName: "log_probs",
    classes: 42,
  },
);

const modelData = new Uint8Array(await readFile(modelPath));
const session = await ort.InferenceSession.create(modelData, {
  executionProviders: ["wasm"],
});

assert.deepEqual(session.inputNames, ["spectrogram"]);
assert.deepEqual(session.outputNames, ["log_probs"]);

const timeSteps = 101;
const input = new ort.Tensor(
  "float32",
  new Float32Array(timeSteps * metadata.spectrogram_frequency_bins),
  [1, 1, timeSteps, metadata.spectrogram_frequency_bins],
);
const result = await session.run({ spectrogram: input });
assert.deepEqual(result.log_probs.dims, [1, timeSteps, metadata.num_classes]);
assert.ok(
  Array.from(result.log_probs.data).every((value) =>
    Number.isFinite(Number(value)),
  ),
  "Model output must contain only finite values.",
);

await session.release();
console.log("English DeepCW model metadata, protobuf, and inference are valid.");
