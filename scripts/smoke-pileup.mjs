import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createDeepCwNativeRuntime } from "../src/pileup/nativeRuntime.ts";
import {
  buildProbabilityBins,
  groupPileupCandidates,
} from "../src/pileup/detection.ts";

const SAMPLE_RATE = 9600;
const BLANK_INDEX = 41;
const VOCABULARY = [
  ",", ".", "/", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  "?", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L",
  "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", " ",
];
const MORSE = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.",
  H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.",
  O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-",
  V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..", "0": "-----",
  "1": ".----", "2": "..---", "3": "...--", "4": "....-", "5": ".....",
  "6": "-....", "7": "--...", "8": "---..", "9": "----.",
};

function addCw(audio, frequency, message, wordsPerMinute, amplitude, startSeconds) {
  const dotSeconds = 1.2 / wordsPerMinute;
  const rampSamples = Math.round(0.004 * SAMPLE_RATE);
  let time = startSeconds;
  for (const character of message) {
    if (character === " ") {
      time += 7 * dotSeconds;
      continue;
    }
    const symbols = MORSE[character];
    for (let symbol = 0; symbol < symbols.length; symbol += 1) {
      const duration = (symbols[symbol] === "-" ? 3 : 1) * dotSeconds;
      const start = Math.round(time * SAMPLE_RATE);
      const end = Math.min(audio.length, Math.round((time + duration) * SAMPLE_RATE));
      for (let sample = start; sample < end; sample += 1) {
        const envelope = Math.min(
          1,
          (sample - start) / rampSamples,
          (end - sample - 1) / rampSamples,
        );
        audio[sample] +=
          amplitude * envelope *
          Math.sin((2 * Math.PI * frequency * sample) / SAMPLE_RATE);
      }
      time += duration + (symbol < symbols.length - 1 ? dotSeconds : 0);
    }
    time += 3 * dotSeconds;
  }
}

function decodeCtc(data, batchSize, frames, classes) {
  const texts = [];
  for (let batch = 0; batch < batchSize; batch += 1) {
    let previous = null;
    let text = "";
    for (let frame = 0; frame < frames; frame += 1) {
      const offset = (batch * frames + frame) * classes;
      let maximum = Number.NEGATIVE_INFINITY;
      let index = 0;
      for (let classIndex = 0; classIndex < classes; classIndex += 1) {
        if (data[offset + classIndex] > maximum) {
          maximum = data[offset + classIndex];
          index = classIndex;
        }
      }
      if (index === BLANK_INDEX) {
        previous = null;
      } else if (index !== previous) {
        text += VOCABULARY[index] ?? "";
        previous = index;
      }
    }
    texts.push(text);
  }
  return texts;
}

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const privateRoot = join(projectRoot, ".local-private", "pileup-models");
const toArrayBuffer = (buffer) =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
const load = async (filename) =>
  toArrayBuffer(await readFile(join(privateRoot, filename)));

const audio = new Float32Array(8 * SAMPLE_RATE);
addCw(audio, 600, "CQ TEST DE S53M", 22, 0.35, 0.3);
addCw(audio, 1000, "CQ DE W1AW", 28, 0.3, 0.5);
let noiseSeed = 1;
for (let index = 0; index < audio.length; index += 1) {
  noiseSeed = (noiseSeed * 1_664_525 + 1_013_904_223) >>> 0;
  audio[index] += ((noiseSeed / 2 ** 32) * 2 - 1) * 0.015;
}

const runtime = await createDeepCwNativeRuntime(await load("deepcw-core.wasm"));
const detector = runtime.createDetector(await load("detect_cw_model.cwm"));
const decoder = runtime.createNarrowDecoder(
  await load("model_en_narrow_small.cwm"),
);
try {
  const probabilities = detector.runAudioBins(audio, 400, 1200);
  const candidates = groupPileupCandidates(
    buildProbabilityBins(probabilities, 400),
  ).filter((candidate) => candidate.probability >= 0.5);
  const tracks = candidates.map((candidate) => ({
    frequency: candidate.frequency,
    startFrequency: candidate.startBin * 12.5,
    endFrequency: candidate.endBin * 12.5,
  }));
  const logits = decoder.runAudioNarrowBatch(audio, tracks);
  const texts = decodeCtc(
    logits,
    tracks.length,
    decoder.getFrameCount(audio.length),
    decoder.numClasses,
  );
  const results = tracks.map((track, index) => ({
    frequency: track.frequency,
    probability: candidates[index].probability,
    text: texts[index],
  }));
  const expected = [
    { frequency: 600, text: "CQ TEST DE S53M" },
    { frequency: 1000, text: "CQ DE W1AW" },
  ];
  for (const signal of expected) {
    const match = results.find(
      (result) => Math.abs(result.frequency - signal.frequency) <= 25,
    );
    if (!match || !match.text.includes(signal.text)) {
      throw new Error(`Failed to detect and decode ${signal.frequency} Hz.`);
    }
  }
  console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally {
  detector.dispose();
  decoder.dispose();
}
