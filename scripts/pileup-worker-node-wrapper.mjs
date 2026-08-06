import { parentPort, workerData } from "node:worker_threads";

globalThis.self = globalThis;
globalThis.postMessage = (message, transfer = []) =>
  parentPort.postMessage(message, transfer);
await import(workerData.workerUrl);
parentPort.on("message", (data) => globalThis.onmessage({ data }));
parentPort.postMessage({ type: "nodeWrapperReady" });
