import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const assetsRoot = join(projectRoot, "dist", "assets");
const workerFilename = (await readdir(assetsRoot)).find(
  (filename) => filename.startsWith("pileupWorker-") && filename.endsWith(".js"),
);
if (!workerFilename) throw new Error("The production Pileup worker was not built.");

const privateRoot = join(projectRoot, ".local-private", "pileup-models");
const load = async (filename) => {
  const data = await readFile(join(privateRoot, filename));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
const runtimeWasm = await load("deepcw-core.wasm");
const detectorModel = await load("detect_cw_model.cwm");
const decoderModel = await load("model_en_narrow_small.cwm");
const worker = new Worker(
  new URL("./pileup-worker-node-wrapper.mjs", import.meta.url),
  {
    workerData: {
      workerUrl: pathToFileURL(join(assetsRoot, workerFilename)).href,
    },
  },
);

const waitForMessage = (predicate) =>
  new Promise((resolve, reject) => {
    const onMessage = (message) => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      worker.off("message", onMessage);
      worker.off("error", onError);
    };
    worker.on("message", onMessage);
    worker.on("error", onError);
  });

await waitForMessage((message) => message.type === "nodeWrapperReady");
const sessionId = "production-worker-smoke";
const initialized = waitForMessage(
  (message) => message.type === "initialized" && message.sessionId === sessionId,
);
worker.postMessage(
  {
    type: "initialize",
    requestId: 1,
    sessionId,
    runtimeWasm,
    detectorModel,
    decoderModel,
  },
  [runtimeWasm, detectorModel, decoderModel],
);
await initialized;

const audio = new Float32Array(8 * 9600);
const tracks = [500, 650, 800, 950, 1100].map((frequency, index) => ({
  id: index + 1,
  frequency,
  probability: 0.8,
  startBin: Math.round((frequency - 25) / 12.5),
  endBin: Math.round((frequency + 25) / 12.5),
  lastSeen: performance.now(),
}));
const analysis = waitForMessage(
  (message) =>
    message.type === "analysisResult" && message.sessionId === sessionId,
);
worker.postMessage(
  {
    type: "analyze",
    requestId: 2,
    sessionId,
    audio,
    minFrequencyHz: 400,
    maxFrequencyHz: 1200,
    tracks,
    windowEndSample: audio.length,
  },
  [audio.buffer],
);
const result = await analysis;
if (
  result.decodeResults.length !== tracks.length ||
  result.probabilityFrame.binWidthHz !== 12.5 ||
  !(result.probabilityFrame.probabilities instanceof Float32Array)
) {
  throw new Error("The production worker returned an invalid structured result.");
}
console.log(
  JSON.stringify(
    {
      passed: true,
      productionWorker: workerFilename,
      candidates: result.candidates.length,
      decodedLanes: result.decodeResults.length,
      probabilityBins: result.probabilityFrame.probabilities.length,
      metrics: result.metrics,
    },
    null,
    2,
  ),
);
await worker.terminate();
