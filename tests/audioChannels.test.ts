import assert from "node:assert/strict";
import test from "node:test";

import {
  getIsolatedAudioChannel,
  getProcessorInputChannelCount,
} from "../src/utils/audioChannels.ts";

const left = new Float32Array([1, 2, 3]);
const right = new Float32Array([-1, -2, -3]);
const stereoInput = {
  numberOfChannels: 2,
  getChannelData: (channelIndex: number) =>
    channelIndex === 0 ? left : right,
};

test("selects left and right audio without combining the channels", () => {
  assert.strictEqual(getIsolatedAudioChannel(stereoInput, 0), left);
  assert.strictEqual(getIsolatedAudioChannel(stereoInput, 1), right);
});

test("keeps a silent left channel silent when the right channel has signal", () => {
  const silentLeft = new Float32Array(3);
  const activeRight = new Float32Array([0.25, -0.5, 0.75]);
  const isolatedInput = {
    numberOfChannels: 2,
    getChannelData: (channelIndex: number) =>
      channelIndex === 0 ? silentLeft : activeRight,
  };

  assert.deepEqual(
    Array.from(getIsolatedAudioChannel(isolatedInput, 0)),
    [0, 0, 0],
  );
  assert.strictEqual(
    getIsolatedAudioChannel(isolatedInput, 1),
    activeRight,
  );
});

test("rejects a channel that the captured input does not contain", () => {
  assert.throws(
    () => getIsolatedAudioChannel(stereoInput, 2),
    /input has 2 channel\(s\)/,
  );
});

test("keeps both processor inputs available when reading the left channel", () => {
  assert.equal(getProcessorInputChannelCount(0, 2), 2);
  assert.equal(getProcessorInputChannelCount(1, 2), 2);
  assert.equal(getProcessorInputChannelCount(0, 1), 1);
});
