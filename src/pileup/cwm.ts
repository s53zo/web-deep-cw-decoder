export const PILEUP_DETECTOR_TASK = "cw_bin_presence_probability";
export const PILEUP_DECODER_TASK = "ctc_log_probs";
export const PILEUP_MODEL_SAMPLE_RATE = 3200;

export type CwmRole = "detector" | "decoder";

export type CwmManifest = {
  task: string;
  sample_rate: number;
  profile_name?: string;
  model_architecture?: string;
  model_family?: string;
  num_classes?: number;
  chars?: string[];
  blank_index?: number;
  presence_threshold?: number;
  bin_width_hz?: number;
  target_bin_range?: [number, number];
  spectrogram_frequency_bins?: number;
  [key: string]: unknown;
};

export type ParsedCwm = {
  role: CwmRole;
  version: number;
  manifest: CwmManifest;
  manifestLength: number;
  dataOffset: number;
  byteLength: number;
};

const CWM_MAGIC = [0x43, 0x57, 0x4d, 0x31] as const;
const CWM_HEADER_BYTES = 12;
const MAX_MANIFEST_BYTES = 1024 * 1024;

function hasBytes(
  bytes: Uint8Array,
  expected: readonly number[],
  offset = 0,
): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function classifyCwmManifest(manifest: CwmManifest): CwmRole {
  if (manifest.task === PILEUP_DETECTOR_TASK) return "detector";
  if (manifest.task === PILEUP_DECODER_TASK) return "decoder";
  throw new Error(
    `Unsupported CWM1 task “${String(manifest.task)}”. Expected ${PILEUP_DETECTOR_TASK} or ${PILEUP_DECODER_TASK}.`,
  );
}

export function parseCwmPackage(data: ArrayBuffer): ParsedCwm {
  const bytes = new Uint8Array(data);
  if (bytes.byteLength < CWM_HEADER_BYTES || !hasBytes(bytes, CWM_MAGIC)) {
    throw new Error("The selected model is not a CWM1 package.");
  }

  const view = new DataView(data);
  const version = view.getUint32(4, true);
  const manifestLength = view.getUint32(8, true);
  const dataOffset = CWM_HEADER_BYTES + manifestLength;
  if (version !== 1) {
    throw new Error(`Unsupported CWM1 package version ${version}.`);
  }
  if (
    manifestLength === 0 ||
    manifestLength > MAX_MANIFEST_BYTES ||
    dataOffset > bytes.byteLength
  ) {
    throw new Error("The CWM1 manifest length is invalid.");
  }

  let manifest: CwmManifest;
  try {
    manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(CWM_HEADER_BYTES, dataOffset),
      ),
    ) as CwmManifest;
  } catch {
    throw new Error("The CWM1 manifest is not valid UTF-8 JSON.");
  }

  if (
    !manifest ||
    typeof manifest !== "object" ||
    typeof manifest.task !== "string"
  ) {
    throw new Error("The CWM1 manifest does not declare a task.");
  }
  if (manifest.sample_rate !== PILEUP_MODEL_SAMPLE_RATE) {
    throw new Error(
      `The CWM1 model expects ${String(manifest.sample_rate)} Hz; Pileup requires ${PILEUP_MODEL_SAMPLE_RATE} Hz.`,
    );
  }

  const role = classifyCwmManifest(manifest);
  if (
    role === "detector" &&
    (manifest.model_architecture !== "tiny_edge_conv" ||
      manifest.model_family !== "cw_bin_detector" ||
      manifest.bin_width_hz !== 12.5 ||
      manifest.presence_threshold !== 0.5 ||
      !Array.isArray(manifest.target_bin_range) ||
      manifest.target_bin_range.length !== 2 ||
      !manifest.target_bin_range.every(Number.isFinite))
  ) {
    throw new Error(
      "The detector is not the expected 12.5 Hz tiny_edge_conv CWM model.",
    );
  }
  if (
    role === "decoder" &&
    (manifest.model_architecture !== "conformer_ctc" ||
      manifest.model_family !== "conformer_ctc" ||
      manifest.spectrogram_frequency_bins !== 15 ||
      !Array.isArray(manifest.chars) ||
      manifest.chars.length !== 41 ||
      !manifest.chars.every((character) => typeof character === "string") ||
      manifest.blank_index !== manifest.chars.length ||
      manifest.num_classes !== manifest.chars.length + 1)
  ) {
    throw new Error("The decoder is not the expected 15-bin conformer CTC model.");
  }

  return {
    role,
    version,
    manifest,
    manifestLength,
    dataOffset,
    byteLength: bytes.byteLength,
  };
}

export function validatePileupModelPair(
  detectorData: ArrayBuffer,
  decoderData: ArrayBuffer,
): { detector: ParsedCwm; decoder: ParsedCwm } {
  const detector = parseCwmPackage(detectorData);
  const decoder = parseCwmPackage(decoderData);
  if (detector.role !== "detector" || decoder.role !== "decoder") {
    throw new Error("The detector and decoder CWM1 files are swapped.");
  }
  return { detector, decoder };
}

export function validateDeepCwRuntimeWasm(data: ArrayBuffer): void {
  const bytes = new Uint8Array(data);
  if (
    bytes.byteLength < 8 ||
    !hasBytes(bytes, [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
  ) {
    throw new Error("The selected runtime is not a WebAssembly 1 binary.");
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
