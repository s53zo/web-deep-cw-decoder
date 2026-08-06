import assert from "node:assert/strict";
import test from "node:test";

import { LatestOnlyQueue } from "../src/pileup/latestOnlyQueue.ts";
import { resetPileupAudioWindow } from "../src/pileup/audioWindow.ts";
import { PileupSessionGate } from "../src/pileup/sessionGate.ts";

test("bounds pending analysis to the latest snapshot", () => {
  const queue = new LatestOnlyQueue<number>();
  queue.enqueue(1);
  assert.equal(queue.take(), 1);
  queue.enqueue(2);
  queue.enqueue(3);
  assert.equal(queue.depth, 2);
  assert.equal(queue.droppedCount, 1);
  queue.complete();
  assert.equal(queue.take(), 3);
  queue.complete();
  assert.equal(queue.depth, 0);
});

test("rejects stale responses and clears pending work on cleanup", () => {
  const gate = new PileupSessionGate("current");
  gate.register(1);
  gate.register(2);
  assert.equal(gate.accept("old", 1), false);
  assert.equal(gate.accept("current", 99), false);
  assert.equal(gate.accept("current", 1), true);
  assert.equal(gate.accept("current", 1), false);
  gate.close();
  assert.equal(gate.pendingCount, 0);
  assert.equal(gate.accept("current", 2), false);
  assert.throws(() => gate.register(3), /session is closed/);
});

test("queue cleanup removes both in-flight and pending state", () => {
  const queue = new LatestOnlyQueue<number>();
  queue.enqueue(1);
  assert.equal(queue.take(), 1);
  queue.enqueue(2);
  queue.clear();
  assert.equal(queue.depth, 0);
  assert.equal(queue.take(), null);
});

test("a reconnected Pileup session cannot reuse the previous audio window", () => {
  const state = {
    samples: Float32Array.from([0.2, -0.4, 0.8]),
    version: 17,
    endSample: 96_000,
  };
  resetPileupAudioWindow(state);
  assert.deepEqual(Array.from(state.samples), [0, 0, 0]);
  assert.equal(state.version, 18);
  assert.equal(state.endSample, 0);
});
