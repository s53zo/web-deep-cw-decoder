type WasmFunction = (...args: number[]) => number;

type NativeModule = {
  memory: WebAssembly.Memory;
  exports: WebAssembly.Exports;
  malloc: WasmFunction;
  free: WasmFunction;
  readCString: (pointer: number) => string;
};

export type NativeDetector = {
  presenceThreshold: number;
  metadata: Record<string, unknown>;
  runAudioBins: (
    audio: Float32Array,
    minFrequencyHz: number,
    maxFrequencyHz: number,
  ) => Float32Array;
  dispose: () => void;
};

export type NarrowTrackInput = {
  frequency: number;
  startFrequency: number;
  endFrequency: number;
};

export type NativeNarrowDecoder = {
  numClasses: number;
  metadata: Record<string, unknown>;
  getFrameCount: (audioSampleCount: number) => number;
  runAudioNarrowBatch: (
    audio: Float32Array,
    tracks: readonly NarrowTrackInput[],
  ) => Float32Array;
  dispose: () => void;
};

function getFunction(
  exports: WebAssembly.Exports,
  name: string,
): WasmFunction {
  const value = exports[name];
  if (typeof value !== "function") {
    throw new Error(`The DeepCW runtime is missing export ${name}.`);
  }
  return value as WasmFunction;
}

function createImports(getMemory: () => WebAssembly.Memory | null) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const environment = [
    "USER=web_user",
    "LOGNAME=web_user",
    "PATH=/",
    "PWD=/",
    "HOME=/home/web_user",
    `LANG=${(globalThis.navigator?.language ?? "C").replace("-", "_")}.UTF-8`,
    "_=./deepcw-core",
  ];

  const views = () => {
    const memory = getMemory();
    if (!memory) throw new Error("DeepCW runtime memory is not initialized.");
    return {
      bytes: new Uint8Array(memory.buffer),
      view: new DataView(memory.buffer),
    };
  };

  const abort = () => {
    throw new WebAssembly.RuntimeError("DeepCW runtime aborted.");
  };
  const clockTimeGet = (clockId: number, _precision: number, output: number) => {
    if (clockId < 0 || clockId > 3) return 28;
    const milliseconds = clockId === 0 ? Date.now() : performance.now();
    views().view.setBigInt64(
      output,
      BigInt(Math.round(milliseconds * 1_000_000)),
      true,
    );
    return 0;
  };
  const monotonicNow = () => performance.now();
  const resizeHeap = (requestedBytes: number) => {
    const memory = getMemory();
    if (!memory) return 0;
    const currentBytes = memory.buffer.byteLength;
    if (requestedBytes <= currentBytes) return 1;
    const maximumBytes = 2_147_483_648;
    if (requestedBytes > maximumBytes) return 0;
    const targetBytes = Math.min(
      maximumBytes,
      Math.max(requestedBytes, Math.ceil(currentBytes * 1.2)),
    );
    try {
      memory.grow(Math.ceil((targetBytes - currentBytes) / 65_536));
      return 1;
    } catch {
      return 0;
    }
  };
  const environmentGet = (pointerArray: number, stringBuffer: number) => {
    const { bytes, view } = views();
    let offset = 0;
    environment.forEach((entry, index) => {
      const encoded = encoder.encode(`${entry}\0`);
      view.setUint32(pointerArray + index * 4, stringBuffer + offset, true);
      bytes.set(encoded, stringBuffer + offset);
      offset += encoded.byteLength;
    });
    return 0;
  };
  const environmentSizesGet = (countPointer: number, sizePointer: number) => {
    const { view } = views();
    const byteLength = environment.reduce(
      (total, entry) => total + encoder.encode(entry).byteLength + 1,
      0,
    );
    view.setUint32(countPointer, environment.length, true);
    view.setUint32(sizePointer, byteLength, true);
    return 0;
  };
  const fdWrite = (
    descriptor: number,
    ioVectors: number,
    vectorCount: number,
    bytesWrittenPointer: number,
  ) => {
    const { bytes, view } = views();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (let index = 0; index < vectorCount; index += 1) {
      const pointer = view.getUint32(ioVectors + index * 8, true);
      const length = view.getUint32(ioVectors + index * 8 + 4, true);
      chunks.push(bytes.slice(pointer, pointer + length));
      total += length;
    }
    const output = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    });
    const message = decoder.decode(output).replace(/\n$/, "");
    if (message) (descriptor === 1 ? console.log : console.error)(message);
    view.setUint32(bytesWrittenPointer, total, true);
    return 0;
  };

  // Names correspond to the stable import ABI exposed by the original
  // deepcw-core single-thread Emscripten build. The runtime binary itself is
  // supplied locally by the user and is never part of this application bundle.
  return {
    a: {
      a: fdWrite,
      b: clockTimeGet,
      c: resizeHeap,
      d: abort,
      e: monotonicNow,
      f: environmentGet,
      g: environmentSizesGet,
    },
  } satisfies WebAssembly.Imports;
}

async function instantiateNativeModule(
  runtimeWasm: ArrayBuffer,
): Promise<NativeModule> {
  let memory: WebAssembly.Memory | null = null;
  const instance = await WebAssembly.instantiate(
    runtimeWasm,
    createImports(() => memory),
  );
  const exports = instance.instance.exports;
  const exportedMemory = exports.h;
  if (!(exportedMemory instanceof WebAssembly.Memory)) {
    throw new Error("The selected runtime does not expose DeepCW memory.");
  }
  memory = exportedMemory;

  // Run static constructors after memory and imports are ready.
  getFunction(exports, "i")();
  return {
    memory,
    exports,
    malloc: getFunction(exports, "I"),
    free: getFunction(exports, "J"),
    readCString: (pointer) => {
      if (!pointer) return "";
      const bytes = new Uint8Array(exportedMemory.buffer);
      let end = pointer;
      while (end < bytes.byteLength && bytes[end] !== 0) end += 1;
      return new TextDecoder().decode(bytes.subarray(pointer, end));
    },
  };
}

function copyToWasm(module: NativeModule, data: Uint8Array): number {
  const pointer = module.malloc(data.byteLength);
  if (!pointer) throw new Error("DeepCW runtime could not allocate model memory.");
  new Uint8Array(module.memory.buffer).set(data, pointer);
  return pointer;
}

function allocateFloats(module: NativeModule, count: number): number {
  if (count <= 0) return 0;
  const pointer = module.malloc(count * Float32Array.BYTES_PER_ELEMENT);
  if (!pointer) throw new Error("DeepCW runtime could not allocate an inference buffer.");
  return pointer;
}

function writeFloats(
  module: NativeModule,
  pointer: number,
  values: Float32Array,
): void {
  new Float32Array(module.memory.buffer).set(
    values,
    pointer / Float32Array.BYTES_PER_ELEMENT,
  );
}

function readFloats(
  module: NativeModule,
  pointer: number,
  count: number,
): Float32Array {
  const start = pointer / Float32Array.BYTES_PER_ELEMENT;
  return new Float32Array(
    new Float32Array(module.memory.buffer).slice(start, start + count),
  );
}

function parseMetadata(module: NativeModule, pointer: number): Record<string, unknown> {
  try {
    return JSON.parse(module.readCString(pointer)) as Record<string, unknown>;
  } catch {
    throw new Error("The DeepCW runtime returned invalid model metadata.");
  }
}

export type DeepCwNativeRuntime = {
  createDetector: (modelData: ArrayBuffer) => NativeDetector;
  createNarrowDecoder: (modelData: ArrayBuffer) => NativeNarrowDecoder;
};

export async function createDeepCwNativeRuntime(
  runtimeWasm: ArrayBuffer,
): Promise<DeepCwNativeRuntime> {
  const module = await instantiateNativeModule(runtimeWasm);
  const exports = module.exports;

  return {
    createDetector(modelData) {
      const weightsPointer = copyToWasm(module, new Uint8Array(modelData));
      const create = getFunction(exports, "C");
      const destroy = getFunction(exports, "D");
      const metadataJson = getFunction(exports, "E");
      const presenceThreshold = getFunction(exports, "F");
      const createSpectrogram = getFunction(exports, "G");
      const destroySpectrogram = getFunction(exports, "H");
      const batchSize = getFunction(exports, "t");
      const runAudioBins = getFunction(exports, "s");
      const model = create(weightsPointer, modelData.byteLength);
      if (!model) {
        module.free(weightsPointer);
        throw new Error("DeepCW could not create the pileup detector.");
      }
      const spectrogram = createSpectrogram();
      if (!spectrogram) {
        destroy(model);
        module.free(weightsPointer);
        throw new Error("DeepCW could not create detector preprocessing.");
      }
      let disposed = false;

      return {
        metadata: parseMetadata(module, metadataJson(model)),
        presenceThreshold: presenceThreshold(model),
        runAudioBins(audio, minFrequencyHz, maxFrequencyHz) {
          if (disposed) throw new Error("The pileup detector has been disposed.");
          const outputCount = batchSize(minFrequencyHz, maxFrequencyHz);
          if (outputCount <= 0 || audio.length === 0) return new Float32Array();
          const inputPointer = allocateFloats(module, audio.length);
          const outputPointer = allocateFloats(module, outputCount);
          try {
            writeFloats(module, inputPointer, audio);
            const written = runAudioBins(
              model,
              spectrogram,
              inputPointer,
              audio.length,
              minFrequencyHz,
              maxFrequencyHz,
              outputPointer,
            );
            if (written !== outputCount) {
              throw new Error(
                `Pileup detector returned ${written} bins; expected ${outputCount}.`,
              );
            }
            return readFloats(module, outputPointer, outputCount);
          } finally {
            module.free(inputPointer);
            module.free(outputPointer);
          }
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          destroy(model);
          destroySpectrogram(spectrogram);
          module.free(weightsPointer);
        },
      };
    },

    createNarrowDecoder(modelData) {
      const weightsPointer = copyToWasm(module, new Uint8Array(modelData));
      const create = getFunction(exports, "y");
      const destroy = getFunction(exports, "z");
      const metadataJson = getFunction(exports, "A");
      const numClasses = getFunction(exports, "B");
      const createSpectrogram = getFunction(exports, "G");
      const destroySpectrogram = getFunction(exports, "H");
      const frameCount = getFunction(exports, "k");
      const runAudioNarrowBatch = getFunction(exports, "p");
      const model = create(weightsPointer, modelData.byteLength);
      if (!model) {
        module.free(weightsPointer);
        throw new Error("DeepCW could not create the narrow decoder.");
      }
      const spectrogram = createSpectrogram();
      if (!spectrogram) {
        destroy(model);
        module.free(weightsPointer);
        throw new Error("DeepCW could not create decoder preprocessing.");
      }
      const classCount = numClasses(model);
      let disposed = false;

      return {
        metadata: parseMetadata(module, metadataJson(model)),
        numClasses: classCount,
        getFrameCount: (sampleCount) => frameCount(sampleCount),
        runAudioNarrowBatch(audio, tracks) {
          if (disposed) throw new Error("The narrow decoder has been disposed.");
          const frames = frameCount(audio.length);
          if (tracks.length === 0 || frames <= 0) return new Float32Array();
          const inputPointer = allocateFloats(module, audio.length);
          const frequencyPointer = allocateFloats(module, tracks.length);
          const startPointer = allocateFloats(module, tracks.length);
          const endPointer = allocateFloats(module, tracks.length);
          const outputCount = tracks.length * frames * classCount;
          const outputPointer = allocateFloats(module, outputCount);
          try {
            writeFloats(module, inputPointer, audio);
            writeFloats(
              module,
              frequencyPointer,
              Float32Array.from(tracks, (track) => track.frequency),
            );
            writeFloats(
              module,
              startPointer,
              Float32Array.from(tracks, (track) => track.startFrequency),
            );
            writeFloats(
              module,
              endPointer,
              Float32Array.from(tracks, (track) => track.endFrequency),
            );
            const status = runAudioNarrowBatch(
              model,
              spectrogram,
              inputPointer,
              audio.length,
              frequencyPointer,
              startPointer,
              endPointer,
              tracks.length,
              outputPointer,
            );
            if (status !== 0) {
              throw new Error(`Pileup decoder failed with code ${status}.`);
            }
            return readFloats(module, outputPointer, outputCount);
          } finally {
            module.free(inputPointer);
            module.free(frequencyPointer);
            module.free(startPointer);
            module.free(endPointer);
            module.free(outputPointer);
          }
        },
        dispose() {
          if (disposed) return;
          disposed = true;
          destroy(model);
          destroySpectrogram(spectrogram);
          module.free(weightsPointer);
        },
      };
    },
  };
}
