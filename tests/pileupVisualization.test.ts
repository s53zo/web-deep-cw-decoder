import assert from "node:assert/strict";
import test from "node:test";

import {
  PILEUP_PROBABILITY_THRESHOLDS,
  SampleTimelineClock,
  characterFrameToX,
  confidenceOpacity,
  frequencyToWaterfallY,
  laneBackground,
  pileupVisualizationSessionKey,
  placePileupLanes,
  probabilityBinFrequency,
  probabilityMarkerX,
  probabilityTransitionEase,
  resolvePileupLaneStatus,
  startAnimationLoop,
  waterfallScrollOffsetPx,
} from "../src/pileup/visualization.ts";

test("maps and clamps frequency using the waterfall's reversed axis", () => {
  assert.equal(frequencyToWaterfallY(1500, 100, 1500, 280), 0);
  assert.equal(frequencyToWaterfallY(800, 100, 1500, 280), 140);
  assert.equal(frequencyToWaterfallY(100, 100, 1500, 280), 280);
  assert.equal(frequencyToWaterfallY(2000, 100, 1500, 280), 0);
  assert.equal(frequencyToWaterfallY(-20, 100, 1500, 280), 280);
});

test("positions characters by frame spans and scrolls from the sample anchor", () => {
  assert.equal(characterFrameToX(19, 20, 100, 800), 160);
  assert.equal(waterfallScrollOffsetPx(96_000, 76_800, 8, 800), 200);
  assert.equal(waterfallScrollOffsetPx(70_000, 76_800, 8, 800), 0);
});

test("maps detector bins and exposes the presence and lock markers", () => {
  assert.equal(probabilityBinFrequency(400, 12.5, 4), 450);
  assert.deepEqual(PILEUP_PROBABILITY_THRESHOLDS, [0.1, 0.5]);
  assert.equal(probabilityMarkerX(0.1, 40), 4);
  assert.equal(probabilityMarkerX(0.5, 40), 20);
});

test("probability transitions use the original 140 ms quadratic ease-out", () => {
  assert.equal(probabilityTransitionEase(-1), 0);
  assert.equal(probabilityTransitionEase(0.5), 0.75);
  assert.equal(probabilityTransitionEase(2), 1);
});

test("uses e04 confidence opacity with a visible clamped floor", () => {
  assert.equal(confidenceOpacity(-1), 0.08);
  assert.equal(confidenceOpacity(2), 1);
  assert.ok(confidenceOpacity(0.5) > 0.27);
  assert.ok(confidenceOpacity(0.5) < 0.29);
});

test("status backgrounds are stable and distinct", () => {
  const colors = ["tracking", "decoding", "holding", "expiring"].map(
    (status) => laneBackground(status as Parameters<typeof laneBackground>[0]),
  );
  assert.equal(new Set(colors).size, 4);
  assert.equal(laneBackground("decoding"), laneBackground("decoding"));
});

test("detector expiry takes precedence over text retained in the audio window", () => {
  assert.equal(resolvePileupLaneStatus(false, false, 0), "tracking");
  assert.equal(resolvePileupLaneStatus(true, false, 0), "decoding");
  assert.equal(resolvePileupLaneStatus(false, true, 0), "holding");
  assert.equal(resolvePileupLaneStatus(true, false, 500), "expiring");
  assert.equal(resolvePileupLaneStatus(false, true, 800), "expiring");
});

test("collision placement is deterministic, separated, and bounded to five lanes", () => {
  const lanes = Array.from({ length: 7 }, (_, index) => ({
    id: index + 1,
    frequency: 800 + index,
  }));
  const first = placePileupLanes(lanes, 100, 1500, 256, 24, 5);
  const second = placePileupLanes(lanes, 100, 1500, 256, 24, 5);
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  const sortedRows = first.map(({ rowY }) => rowY).sort((a, b) => a - b);
  sortedRows.slice(1).forEach((row, index) => {
    assert.ok(row - sortedRows[index]! >= 24 - 1e-9);
  });
  first.forEach(({ rowY }) => assert.ok(rowY >= 12 && rowY <= 244));
});

test("left and right timeline clocks remain isolated and reset on reconnect", () => {
  const left = new SampleTimelineClock();
  const right = new SampleTimelineClock();
  left.observe(9_600, 1000);
  right.observe(96_000, 1000);
  assert.equal(left.at(1500), 14_400);
  assert.equal(right.at(1500), 100_800);
  left.reset();
  left.observe(0, 2000);
  assert.equal(left.at(2000), 0);
  assert.equal(right.at(2000), 105_600);
});

test("stream, model, and radio changes force a fresh overlay session", () => {
  const current = pileupVisualizationSessionKey(0, "stream-a", "models-a");
  assert.notEqual(
    current,
    pileupVisualizationSessionKey(1, "stream-a", "models-a"),
  );
  assert.notEqual(
    current,
    pileupVisualizationSessionKey(0, "stream-b", "models-a"),
  );
  assert.notEqual(
    current,
    pileupVisualizationSessionKey(0, "stream-a", "models-b"),
  );
  assert.equal(
    pileupVisualizationSessionKey(0, null, "models-a"),
    "0:stopped:models-a",
  );
});

test("animation loop cancellation prevents callbacks after cleanup", () => {
  let nextId = 0;
  let cancelled = -1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const schedule = (callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  };
  const rendered: number[] = [];
  const stop = startAnimationLoop(
    (now) => rendered.push(now),
    schedule,
    (id) => {
      cancelled = id;
      callbacks.delete(id);
    },
  );
  callbacks.get(1)?.(10);
  assert.deepEqual(rendered, [10]);
  stop();
  assert.equal(cancelled, 2);
  assert.equal(callbacks.size, 1);
  callbacks.get(1)?.(20);
  assert.deepEqual(rendered, [10]);
});
