import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCwmPackage,
  PILEUP_DECODER_TASK,
  PILEUP_DETECTOR_TASK,
  validatePileupModelPair,
  validateDeepCwRuntimeWasm,
} from "../src/pileup/cwm.ts";

function syntheticCwm(manifest: Record<string, unknown>): ArrayBuffer {
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const bytes = new Uint8Array(12 + manifestBytes.length + 4);
  bytes.set([0x43, 0x57, 0x4d, 0x31]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setUint32(8, manifestBytes.length, true);
  bytes.set(manifestBytes, 12);
  bytes.set([1, 2, 3, 4], 12 + manifestBytes.length);
  return bytes.buffer;
}

function detectorManifest(overrides: Record<string, unknown> = {}) {
  return {
    task: PILEUP_DETECTOR_TASK,
    sample_rate: 3200,
    model_architecture: "tiny_edge_conv",
    model_family: "cw_bin_detector",
    bin_width_hz: 12.5,
    presence_threshold: 0.5,
    target_bin_range: [1, 127],
    ...overrides,
  };
}

function decoderManifest(overrides: Record<string, unknown> = {}) {
  const chars = Array.from({ length: 41 }, (_, index) => String(index));
  return {
    task: PILEUP_DECODER_TASK,
    sample_rate: 3200,
    model_architecture: "conformer_ctc",
    model_family: "conformer_ctc",
    spectrogram_frequency_bins: 15,
    chars,
    blank_index: chars.length,
    num_classes: chars.length + 1,
    ...overrides,
  };
}

test("validates and classifies the detector CWM1 manifest", () => {
  const parsed = parseCwmPackage(
    syntheticCwm(detectorManifest()),
  );
  assert.equal(parsed.role, "detector");
  assert.equal(parsed.version, 1);
  assert.equal(parsed.byteLength - parsed.dataOffset, 4);
});

test("validates and classifies the narrow decoder CWM1 manifest", () => {
  const parsed = parseCwmPackage(syntheticCwm(decoderManifest()));
  assert.equal(parsed.role, "decoder");
});

test("rejects corrupt, swapped-task, and incompatible CWM1 files", () => {
  assert.throws(() => parseCwmPackage(new ArrayBuffer(32)), /not a CWM1/);
  assert.throws(
    () =>
      parseCwmPackage(
        syntheticCwm({
          task: "unrelated_task",
          sample_rate: 3200,
        }),
      ),
    /Unsupported CWM1 task/,
  );
  assert.throws(
    () =>
      parseCwmPackage(
        syntheticCwm(detectorManifest({ sample_rate: 8000 })),
      ),
    /Pileup requires 3200 Hz/,
  );
  assert.throws(
    () =>
      parseCwmPackage(
        syntheticCwm(detectorManifest({ bin_width_hz: 25 })),
      ),
    /expected 12.5 Hz/,
  );
  assert.throws(
    () =>
      parseCwmPackage(
        syntheticCwm(decoderManifest({ num_classes: 41 })),
      ),
    /expected 15-bin conformer CTC/,
  );
});

test("accepts only a WebAssembly 1 runtime header", () => {
  validateDeepCwRuntimeWasm(
    Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]).buffer,
  );
  assert.throws(
    () => validateDeepCwRuntimeWasm(Uint8Array.from([0, 1, 2, 3]).buffer),
    /not a WebAssembly 1 binary/,
  );
});

test("rejects detector and decoder packages in swapped worker slots", () => {
  const detector = syntheticCwm(detectorManifest());
  const decoder = syntheticCwm(decoderManifest());
  assert.deepEqual(validatePileupModelPair(detector, decoder).detector.role, "detector");
  assert.throws(
    () => validatePileupModelPair(decoder, detector),
    /files are swapped/,
  );
});
