import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";

import { createDeepCwNativeRuntime } from "../src/pileup/nativeRuntime.ts";
import { decodePredictionsDetailed } from "../src/utils/textDecoder.ts";

const toArrayBuffer = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const load = async (path) => toArrayBuffer(await readFile(path));
const average = (values) =>
  values.reduce((total, value) => total + value, 0) / values.length;
const percentile95 = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
};

const runtime = await createDeepCwNativeRuntime(await load(workerData.runtime));
const detector = runtime.createDetector(await load(workerData.detector));
const decoder = runtime.createNarrowDecoder(await load(workerData.decoder));
const audio = new Float32Array(8 * 9600);
const tracks = [500, 650, 800, 950, 1100].map((frequency) => ({
  frequency,
  startFrequency: frequency - 25,
  endFrequency: frequency + 25,
}));

detector.runAudioBins(audio, 400, 1200);
const warmupLogits = decoder.runAudioNarrowBatch(audio, tracks);
decodePredictionsDetailed(
  warmupLogits,
  [tracks.length, decoder.getFrameCount(audio.length), decoder.numClasses],
  "en",
  true,
);

const detectorTimes = [];
const decoderTimes = [];
const totalTimes = [];
for (let run = 0; run < workerData.runs; run += 1) {
  const startedAt = performance.now();
  detector.runAudioBins(audio, 400, 1200);
  const detectorFinishedAt = performance.now();
  const logits = decoder.runAudioNarrowBatch(audio, tracks);
  decodePredictionsDetailed(
    logits,
    [tracks.length, decoder.getFrameCount(audio.length), decoder.numClasses],
    "en",
    true,
  );
  const finishedAt = performance.now();
  detectorTimes.push(detectorFinishedAt - startedAt);
  decoderTimes.push(finishedAt - detectorFinishedAt);
  totalTimes.push(finishedAt - startedAt);
}
detector.dispose();
decoder.dispose();
parentPort.postMessage({
  channel: workerData.channel,
  runs: workerData.runs,
  lanes: tracks.length,
  detectorAvgMs: average(detectorTimes),
  decoderAvgMs: average(decoderTimes),
  totalAvgMs: average(totalTimes),
  totalP95Ms: percentile95(totalTimes),
});
