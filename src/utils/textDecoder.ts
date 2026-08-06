import type { Tensor } from "onnxruntime-web";
import { ENGLISH_CONFIG, JAPANESE_CONFIG } from "../const.ts";

type DecoderConfig = typeof ENGLISH_CONFIG | typeof JAPANESE_CONFIG;
export type WordSpaceSpan = {
  startFrame: number;
  endFrame: number;
};
export type CharacterSpan = {
  char: string;
  startFrame: number;
  endFrame: number;
  /** Present for Pileup results; mean selected-class probability, clamped 0..1. */
  confidence?: number;
};

export type ConfidentCharacterSpan = CharacterSpan & { confidence: number };

export type DecodedPredictionResult = {
  displayText: string;
  plainText: string;
  wordSpaceSpans: WordSpaceSpan[];
  characterSpans: CharacterSpan[];
};

function replaceConsecutiveChars(str: string): string {
  const regex = /(\S)\1+/g;
  return str.replace(regex, (match, p1) => {
    return p1 + " ".repeat(match.length - 1);
  });
}

function decodeCtcForDisplay(
  predIndices: number[],
  vocabulary: string[],
  blankIndex: number,
): string {
  const decodedChars: string[] = [];
  let previousIndex: number | null = null;

  for (const index of predIndices) {
    if (index === blankIndex) {
      decodedChars.push(" ");
      previousIndex = null;
      continue;
    }

    if (index === previousIndex) {
      decodedChars.push(" ");
      continue;
    }

    previousIndex = index;
    decodedChars.push(vocabulary[index] ?? " ");
  }

  return decodedChars.join("");
}

function getDecoderConfig(lang: "en" | "ja"): DecoderConfig {
  return lang === "ja" ? JAPANESE_CONFIG : ENGLISH_CONFIG;
}

type FramePrediction = {
  index: number;
  confidence: number;
};

export function getClassProbability(
  values: ArrayLike<number>,
  selectedIndex: number,
): number {
  return getClassProbabilityAt(values, 0, values.length, selectedIndex);
}

function getClassProbabilityAt(
  values: ArrayLike<number>,
  offset: number,
  length: number,
  selectedIndex: number,
): number {
  let sum = 0;
  let normalized = true;
  let maximum = -Infinity;
  for (let index = 0; index < length; index += 1) {
    const value = Number(values[offset + index]);
    if (!Number.isFinite(value)) return 0;
    sum += value;
    maximum = Math.max(maximum, value);
    if (value < 0 || value > 1) normalized = false;
  }

  if (normalized && sum >= 0.98 && sum <= 1.02) {
    return Math.max(
      0,
      Math.min(1, Number(values[offset + selectedIndex] ?? 0)),
    );
  }

  let denominator = 0;
  for (let index = 0; index < length; index += 1) {
    denominator += Math.exp(Number(values[offset + index]) - maximum);
  }
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  const probability =
    Math.exp(Number(values[offset + selectedIndex] ?? -Infinity) - maximum) /
    denominator;
  return Math.max(0, Math.min(1, probability));
}

function getFramePredictions(
  pred: Tensor["data"],
  predShape: Tensor["dims"],
): FramePrediction[][] {
  const [batchSize, timeSteps, numClasses] = predShape;
  const outputPredictions: FramePrediction[][] = [];

  for (let i = 0; i < batchSize; i++) {
    const framePredictions: FramePrediction[] = [];
    for (let t = 0; t < timeSteps; t++) {
      let maxProb = -Infinity;
      let maxIndex = 0;
      const offset = i * timeSteps * numClasses + t * numClasses;

      for (let c = 0; c < numClasses; c++) {
        // @ts-expect-error - Tensor data type is not properly typed
        if (pred[offset + c] > maxProb) {
          // @ts-expect-error - Tensor data type is not properly typed
          maxProb = pred[offset + c];
          maxIndex = c;
        }
      }
      framePredictions.push({
        index: maxIndex,
        confidence: getClassProbabilityAt(
          pred as ArrayLike<number>,
          offset,
          numClasses,
          maxIndex,
        ),
      });
    }
    outputPredictions.push(framePredictions);
  }

  return outputPredictions;
}

function getPredictionIndices(
  pred: Tensor["data"],
  predShape: Tensor["dims"],
): number[][] {
  const [batchSize, timeSteps, numClasses] = predShape;
  const outputIndices: number[][] = [];

  for (let batch = 0; batch < batchSize; batch += 1) {
    const predIndices: number[] = [];
    for (let frame = 0; frame < timeSteps; frame += 1) {
      let maximum = -Infinity;
      let maximumIndex = 0;
      const offset =
        batch * timeSteps * numClasses + frame * numClasses;
      for (let classIndex = 0; classIndex < numClasses; classIndex += 1) {
        // @ts-expect-error - Tensor data type is not properly typed
        if (pred[offset + classIndex] > maximum) {
          // @ts-expect-error - Tensor data type is not properly typed
          maximum = pred[offset + classIndex];
          maximumIndex = classIndex;
        }
      }
      predIndices.push(maximumIndex);
    }
    outputIndices.push(predIndices);
  }

  return outputIndices;
}

function decodeCtcPlain(
  predIndices: number[],
  vocabulary: string[],
  blankIndex: number,
): string {
  const decodedChars: string[] = [];
  let previousIndex: number | null = null;

  for (const index of predIndices) {
    if (index === blankIndex) {
      previousIndex = null;
      continue;
    }

    if (index === previousIndex) {
      continue;
    }

    previousIndex = index;
    decodedChars.push(vocabulary[index] ?? "");
  }

  return decodedChars.join("");
}

function getWordSpaceSpans(
  predIndices: number[],
  vocabulary: string[],
): WordSpaceSpan[] {
  const spaceIndex = vocabulary.indexOf(" ");
  if (spaceIndex < 0) {
    return [];
  }

  const spans: WordSpaceSpan[] = [];
  let currentStart = -1;

  predIndices.forEach((index, frameIndex) => {
    if (index === spaceIndex) {
      if (currentStart < 0) {
        currentStart = frameIndex;
      }
      return;
    }

    if (currentStart >= 0) {
      spans.push({ startFrame: currentStart, endFrame: frameIndex - 1 });
      currentStart = -1;
    }
  });

  if (currentStart >= 0) {
    spans.push({
      startFrame: currentStart,
      endFrame: predIndices.length - 1,
    });
  }

  return spans;
}

function getCharacterSpans(
  predIndices: number[],
  frameConfidences: number[] | null,
  vocabulary: string[],
  blankIndex: number,
): CharacterSpan[] {
  const spans: CharacterSpan[] = [];
  let previousIndex: number | null = null;
  let activeSpanIndex = -1;

  predIndices.forEach((index, frameIndex) => {
    if (index === blankIndex) {
      previousIndex = null;
      activeSpanIndex = -1;
      return;
    }

    if (index === previousIndex) {
      if (activeSpanIndex >= 0) {
        const span = spans[activeSpanIndex];
        span.endFrame = frameIndex;
        if (frameConfidences && span.confidence != null) {
          const previousFrameCount = frameIndex - span.startFrame;
          span.confidence =
            (span.confidence * previousFrameCount +
              frameConfidences[frameIndex]) /
            (previousFrameCount + 1);
        }
      }
      return;
    }

    previousIndex = index;
    const char = vocabulary[index] ?? "";
    if (!char) {
      activeSpanIndex = -1;
      return;
    }

    spans.push({
      char,
      startFrame: frameIndex,
      endFrame: frameIndex,
      ...(frameConfidences
        ? {
            confidence: Math.max(
              0,
              Math.min(1, frameConfidences[frameIndex] ?? 0),
            ),
          }
        : {}),
    });
    activeSpanIndex = spans.length - 1;
  });

  return spans;
}

export function decodePredictionsDetailed(
  pred: Tensor["data"],
  predShape: Tensor["dims"],
  lang: "en" | "ja" = "en",
  includeConfidence = false,
): DecodedPredictionResult[] {
  const outputResults: DecodedPredictionResult[] = [];

  const config = getDecoderConfig(lang);
  const vocabulary = config.VOCABULARY;
  const framePredictionBatches = includeConfidence
    ? getFramePredictions(pred, predShape)
    : null;
  const predictionIndexBatches = includeConfidence
    ? framePredictionBatches!.map((batch) => batch.map(({ index }) => index))
    : getPredictionIndices(pred, predShape);

  for (let batchIndex = 0; batchIndex < predictionIndexBatches.length; batchIndex += 1) {
    const predIndices = predictionIndexBatches[batchIndex]!;
    const frameConfidences = includeConfidence
      ? framePredictionBatches![batchIndex]!.map(({ confidence }) => confidence)
      : null;
    const displayText =
      "BLANK_INDEX" in config
        ? decodeCtcForDisplay(predIndices, vocabulary, config.BLANK_INDEX)
        : replaceConsecutiveChars(
            predIndices.map((index) => vocabulary[index] ?? "").join(""),
          );

    const plainText =
      "BLANK_INDEX" in config
        ? decodeCtcPlain(predIndices, vocabulary, config.BLANK_INDEX)
        : predIndices.map((index) => vocabulary[index] ?? "").join("");

    outputResults.push({
      displayText,
      plainText,
      wordSpaceSpans: getWordSpaceSpans(predIndices, vocabulary),
      characterSpans:
        "BLANK_INDEX" in config
          ? getCharacterSpans(
              predIndices,
              frameConfidences,
              vocabulary,
              config.BLANK_INDEX,
            )
          : predIndices.map((index, frameIndex) => ({
              char: vocabulary[index] ?? "",
              startFrame: frameIndex,
              endFrame: frameIndex,
              ...(frameConfidences
                ? { confidence: frameConfidences[frameIndex] ?? 0 }
                : {}),
            })),
    });
  }

  return outputResults;
}

export function decodePredictions(
  pred: Tensor["data"],
  predShape: Tensor["dims"],
  lang: "en" | "ja" = "en",
): string[] {
  return decodePredictionsDetailed(pred, predShape, lang).map(
    (result) => result.displayText,
  );
}
