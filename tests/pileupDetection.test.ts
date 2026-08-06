import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProbabilityBins,
  groupPileupCandidates,
  PILEUP_BIN_RESOLUTION_HZ,
} from "../src/pileup/detection.ts";

test("maps detector outputs to the original 12.5 Hz bin grid", () => {
  const bins = buildProbabilityBins(
    Float32Array.from([0.1, 0.2, 0.3]),
    407,
  );
  assert.deepEqual(
    bins.map((bin) => bin.frequency),
    [400, 412.5, 425],
  );
  assert.equal(PILEUP_BIN_RESOLUTION_HZ, 12.5);
});

test("groups adjacent detector probabilities into one refined signal", () => {
  const bins = buildProbabilityBins(
    Float32Array.from([0.02, 0.2, 0.85, 0.3, 0.02]),
    775,
  );
  const candidates = groupPileupCandidates(bins);
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].frequency > 799 && candidates[0].frequency < 806);
  assert.ok(candidates[0].probability > 0.84);
  assert.ok(candidates[0].startBin < candidates[0].endBin);
});

test("rejects bins below the detector presence threshold", () => {
  const bins = buildProbabilityBins(
    Float32Array.from([0.01, 0.05, 0.09]),
    500,
  );
  assert.deepEqual(groupPileupCandidates(bins), []);
});
