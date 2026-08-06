import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const privateRoot = join(projectRoot, ".local-private", "pileup-models");
const files = {
  runtime: join(privateRoot, "deepcw-core.wasm"),
  detector: join(privateRoot, "detect_cw_model.cwm"),
  decoder: join(privateRoot, "model_en_narrow_small.cwm"),
};
await Promise.all(Object.values(files).map((path) => access(path)));

const runs = 10;
const runWorker = (channel) =>
  new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./benchmark-pileup-worker.mjs", import.meta.url),
      { workerData: { channel, runs, ...files } },
    );
    worker.once("message", resolve);
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`Benchmark worker exited with ${code}.`));
    });
  });

const wallStartedAt = performance.now();
const cpuStarted = process.cpuUsage();
const results = await Promise.all([runWorker("left"), runWorker("right")]);
const wallMs = performance.now() - wallStartedAt;
const cpu = process.cpuUsage(cpuStarted);
const aggregateCpuMs = (cpu.user + cpu.system) / 1000;

console.log(
  JSON.stringify(
    {
      engine: "Native WASM (single-thread runtime per radio worker)",
      audioWindowSeconds: 8,
      lanesPerRadio: 5,
      concurrentRadios: 2,
      runsPerRadio: runs,
      wallMs,
      aggregateCpuMs,
      estimatedAverageCpuCores: aggregateCpuMs / wallMs,
      results,
    },
    null,
    2,
  ),
);
