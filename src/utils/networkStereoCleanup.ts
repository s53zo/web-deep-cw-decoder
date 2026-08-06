export type NetworkStereoCleanupSession = {
  retryTimer: number | null;
  statsTimer: number | null;
  peerConnection: {
    removeEventListener: (event: string, handler: EventListener) => void;
  } | null;
  peerConnectionHandler: EventListener | null;
  listeners: Array<{ event: string; handler: EventListener }>;
  sdk: {
    off: (event: string, handler: EventListener) => unknown;
    stopViewing: (streamId: string) => unknown;
    disconnect: () => Promise<unknown>;
  };
  streamId: string;
  track: Pick<MediaStreamTrack, "onended" | "stop"> | null;
  meterGraph: { close: () => void } | null;
  playoutSink: { close: () => void } | null;
};

export async function releaseNetworkStereoSession(
  session: NetworkStereoCleanupSession,
  clearTimeoutFn: (timerId: number) => void = globalThis.clearTimeout,
  clearIntervalFn: (timerId: number) => void = globalThis.clearInterval,
): Promise<void> {
  if (session.retryTimer != null) clearTimeoutFn(session.retryTimer);
  if (session.statsTimer != null) clearIntervalFn(session.statsTimer);
  if (session.peerConnection && session.peerConnectionHandler) {
    session.peerConnection.removeEventListener(
      "connectionstatechange",
      session.peerConnectionHandler,
    );
  }
  session.listeners.forEach(({ event, handler }) => session.sdk.off(event, handler));
  if (session.track) session.track.onended = null;
  session.meterGraph?.close();
  session.playoutSink?.close();
  try {
    session.sdk.stopViewing(session.streamId);
  } catch (stopError) {
    console.warn("VDO.Ninja view did not stop cleanly.", stopError);
  }
  session.track?.stop();
  try {
    await session.sdk.disconnect();
  } catch (disconnectError) {
    console.warn("VDO.Ninja disconnect did not finish cleanly.", disconnectError);
  }
}
