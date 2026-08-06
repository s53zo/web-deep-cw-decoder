import assert from "node:assert/strict";
import test from "node:test";

import type { PileupDetectionCandidate } from "../src/pileup/detection.ts";
import {
  getVisiblePileupTracks,
  mergePileupTranscript,
  PILEUP_MAX_LANES_PER_RADIO,
  updatePileupTracks,
} from "../src/pileup/tracking.ts";

const candidate = (
  frequency: number,
  probability = 0.9,
): PileupDetectionCandidate => ({
  frequency,
  probability,
  startBin: Math.round(frequency / 12.5) - 2,
  endBin: Math.round(frequency / 12.5) + 2,
});

test("stabilizes a moving candidate without creating duplicate lanes", () => {
  let nextId = 1;
  let tracks = updatePileupTracks([], [candidate(800)], 0, () => nextId++);
  tracks = updatePileupTracks(tracks, [candidate(806)], 400, () => nextId++);
  tracks = updatePileupTracks(tracks, [candidate(802)], 800, () => nextId++);
  const visible = getVisiblePileupTracks(tracks, 800);
  assert.equal(tracks.length, 1);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 1);
  assert.ok(visible[0].frequency >= 800 && visible[0].frequency <= 806);
});

test("requires about 400 ms of repeated detection before showing a lane", () => {
  let nextId = 1;
  let tracks = updatePileupTracks([], [candidate(800)], 0, () => nextId++);
  tracks = updatePileupTracks(tracks, [candidate(800)], 200, () => nextId++);
  assert.deepEqual(getVisiblePileupTracks(tracks, 200), []);
  tracks = updatePileupTracks(tracks, [candidate(800)], 400, () => nextId++);
  assert.equal(getVisiblePileupTracks(tracks, 400).length, 1);
});

test("does not lock a new lane below the original 0.5 probability threshold", () => {
  let nextId = 1;
  const tracks = updatePileupTracks(
    [],
    [candidate(800, 0.49)],
    0,
    () => nextId++,
  );
  assert.deepEqual(tracks, []);
});

test("keeps left and right candidate state independent", () => {
  let nextLeftId = 1;
  let nextRightId = 1;
  let left = updatePileupTracks([], [candidate(600)], 0, () => nextLeftId++);
  let right = updatePileupTracks([], [candidate(1000)], 0, () => nextRightId++);
  for (const now of [200, 400]) {
    left = updatePileupTracks(left, [candidate(600)], now, () => nextLeftId++);
    right = updatePileupTracks(
      right,
      [candidate(1000)],
      now,
      () => nextRightId++,
    );
  }

  assert.deepEqual(
    getVisiblePileupTracks(left, 400).map((track) => track.frequency),
    [600],
  );
  assert.deepEqual(
    getVisiblePileupTracks(right, 400).map((track) => track.frequency),
    [1000],
  );

  left = updatePileupTracks(left, [candidate(625)], 600, () => nextLeftId++);
  assert.equal(getVisiblePileupTracks(right, 600)[0]?.frequency, 1000);
});

test("expires inactive lanes and enforces the per-radio lane bound", () => {
  let nextId = 1;
  const candidates = Array.from({ length: 10 }, (_, index) =>
    candidate(300 + index * 50),
  );
  let tracks = updatePileupTracks([], candidates, 0, () => nextId++);
  for (let now = 400; now <= 4800; now += 400) {
    tracks = updatePileupTracks(tracks, candidates, now, () => nextId++);
  }
  assert.equal(
    getVisiblePileupTracks(tracks, 4800).length,
    PILEUP_MAX_LANES_PER_RADIO,
  );
  tracks = updatePileupTracks(tracks, [], 8500, () => nextId++);
  assert.equal(
    getVisiblePileupTracks(tracks, 8500).length,
    PILEUP_MAX_LANES_PER_RADIO,
  );
  tracks = updatePileupTracks(tracks, [], 10000, () => nextId++);
  assert.deepEqual(getVisiblePileupTracks(tracks, 10000), []);
});

test("merges overlapping decode windows into an accumulated transcript", () => {
  assert.equal(mergePileupTranscript("CQ TEST", "TEST DE S53M"), "CQ TEST DE S53M");
  assert.equal(mergePileupTranscript("CQ TEST", "CQ TEST"), "CQ TEST");
  assert.equal(mergePileupTranscript("", "  CQ   TEST "), "CQ TEST");
});
