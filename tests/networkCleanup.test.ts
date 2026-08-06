import assert from "node:assert/strict";
import test from "node:test";

import {
  releaseNetworkStereoSession,
  type NetworkStereoCleanupSession,
} from "../src/utils/networkStereoCleanup.ts";

test("network session cleanup releases every owned resource", async () => {
  const calls: string[] = [];
  const connectionStateHandler = () => undefined;
  const sdkListener = () => undefined;
  const track = {
    onended: () => undefined,
    stop: () => calls.push("track.stop"),
  };
  const session = {
    retryTimer: 41,
    statsTimer: 42,
    peerConnection: {
      removeEventListener: (event: string, handler: EventListener) => {
        assert.equal(event, "connectionstatechange");
        assert.equal(handler, connectionStateHandler);
        calls.push("peer.removeListener");
      },
    },
    peerConnectionHandler: connectionStateHandler,
    listeners: [{ event: "track", handler: sdkListener }],
    sdk: {
      off: (event: string, handler: EventListener) => {
        assert.equal(event, "track");
        assert.equal(handler, sdkListener);
        calls.push("sdk.off");
      },
      stopViewing: (streamId: string) => {
        assert.equal(streamId, "deepcw_test");
        calls.push("sdk.stopViewing");
      },
      disconnect: async () => {
        calls.push("sdk.disconnect");
      },
    },
    streamId: "deepcw_test",
    track,
    meterGraph: { close: () => calls.push("meter.close") },
    playoutSink: { close: () => calls.push("playout.close") },
  } as unknown as NetworkStereoCleanupSession;

  await releaseNetworkStereoSession(
    session,
    (timerId) => calls.push(`timeout.clear:${timerId}`),
    (timerId) => calls.push(`interval.clear:${timerId}`),
  );

  assert.equal(track.onended, null);
  assert.deepEqual(calls, [
    "timeout.clear:41",
    "interval.clear:42",
    "peer.removeListener",
    "sdk.off",
    "meter.close",
    "playout.close",
    "sdk.stopViewing",
    "track.stop",
    "sdk.disconnect",
  ]);
});
