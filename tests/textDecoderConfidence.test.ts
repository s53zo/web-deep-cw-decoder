import assert from "node:assert/strict";
import test from "node:test";

import { ENGLISH_CONFIG } from "../src/const.ts";
import {
  decodePredictionsDetailed,
  getClassProbability,
} from "../src/utils/textDecoder.ts";

test("uses normalized probabilities directly and stable softmax for logits", () => {
  assert.equal(getClassProbability([0.1, 0.7, 0.2], 1), 0.7);
  const probability = getClassProbability([-2, 0, 1], 2);
  const expected = Math.exp(1) / (Math.exp(-2) + Math.exp(0) + Math.exp(1));
  assert.ok(Math.abs(probability - expected) < 1e-12);
  assert.ok(
    Math.abs(
      getClassProbability([0.1, 0.7, 0.2].map(Math.log), 1) - 0.7,
    ) < 1e-12,
  );
  assert.equal(getClassProbability([Number.NaN, 1], 1), 0);
});

test("collapses CTC blanks and repetitions while averaging span confidence", () => {
  const classes = ENGLISH_CONFIG.VOCABULARY.length + 1;
  const a = ENGLISH_CONFIG.VOCABULARY.indexOf("A");
  const space = ENGLISH_CONFIG.VOCABULARY.indexOf(" ");
  const blank = ENGLISH_CONFIG.BLANK_INDEX;
  const frames = [
    [a, 0.8],
    [a, 0.6],
    [blank, 0.95],
    [a, 0.75],
    [space, 0.55],
    [space, 0.45],
  ] as const;
  const output = new Float32Array(frames.length * classes);
  frames.forEach(([selected, confidence], frame) => {
    const remainder = (1 - confidence) / (classes - 1);
    output.fill(remainder, frame * classes, (frame + 1) * classes);
    output[frame * classes + selected] = confidence;
  });

  const [decoded] = decodePredictionsDetailed(
    output,
    [1, frames.length, classes],
    "en",
    true,
  );
  assert.equal(decoded.plainText, "AA ");
  assert.deepEqual(
    decoded.characterSpans.map(({ char, startFrame, endFrame }) => ({
      char,
      startFrame,
      endFrame,
    })),
    [
      { char: "A", startFrame: 0, endFrame: 1 },
      { char: "A", startFrame: 3, endFrame: 3 },
      { char: " ", startFrame: 4, endFrame: 5 },
    ],
  );
  [0.7, 0.75, 0.5].forEach((expected, index) => {
    assert.ok(
      Math.abs(decoded.characterSpans[index]!.confidence - expected) < 1e-6,
    );
  });

  const [standardDetailed] = decodePredictionsDetailed(
    output,
    [1, frames.length, classes],
    "en",
  );
  assert.equal("confidence" in standardDetailed.characterSpans[0]!, false);
});
