export const VDO_NINJA_SENDER_ORIGIN = "https://vdo.ninja/";
export const NETWORK_STEREO_STREAM_ID = "S53M_Vaneca";

export type NetworkStereoPhase =
  | "idle"
  | "connecting"
  | "waiting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type NetworkStereoAction =
  | "connect"
  | "signaling-connected"
  | "track-received"
  | "stereo-verified"
  | "recovering"
  | "connection-lost"
  | "fail"
  | "disconnect";

export type NetworkRoute = "direct" | "relay" | null;
export type StereoEvidence = "track-settings" | "negotiated-codec" | null;
export type StereoState = "stereo" | "mono" | "unknown";

export type NetworkAudioDiagnostics = {
  codec: string | null;
  mimeType: string | null;
  sampleRate: number | null;
  channelCount: number | null;
  stereoState: StereoState;
  stereoEvidence: StereoEvidence;
  route: NetworkRoute;
};

export type RTCStatsLike = {
  id?: string;
  type?: string;
  kind?: string;
  mediaType?: string;
  codecId?: string;
  payloadType?: number;
  mimeType?: string;
  clockRate?: number;
  channels?: number;
  sdpFmtpLine?: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  state?: string;
  nominated?: boolean;
  selected?: boolean;
};

const STREAM_ID_PATTERN = /^[A-Za-z0-9_]{1,64}$/;

export function validateStreamId(value: string): string {
  const streamId = value.trim();
  if (!STREAM_ID_PATTERN.test(streamId)) {
    throw new Error(
      "Stream ID must contain 1–64 letters, numbers, or underscores.",
    );
  }
  return streamId;
}

export function buildVdoNinjaSenderUrl(streamIdValue: string): string {
  const streamId = validateStreamId(streamIdValue);
  const url = new URL(VDO_NINJA_SENDER_ORIGIN);
  url.searchParams.set("push", streamId);
  url.searchParams.set("vd", "0");
  url.searchParams.set("stereo", "1");
  url.searchParams.set("proaudio", "1");
  url.searchParams.set("inputchannels", "2");
  url.searchParams.set("micsamplerate", "48000");
  url.searchParams.set("aec", "0");
  url.searchParams.set("agc", "0");
  url.searchParams.set("denoise", "0");
  url.searchParams.set("voiceisolation", "0");
  url.searchParams.set("oab", "256");
  return url.toString();
}

const REQUIRED_OPUS_STEREO_PARAMETERS: ReadonlyArray<readonly [string, string]> = [
  ["stereo", "1"],
  ["sprop-stereo", "1"],
  ["usedtx", "0"],
  ["maxaveragebitrate", "256000"],
];

/** Opt the SDK viewer into the stereo Opus stream offered by VDO.Ninja. */
export function requestStereoOpusInAnswer(sdp: string): string {
  const newline = sdp.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = sdp.endsWith(newline);
  const lines = sdp.split(/\r?\n/);
  if (hadTrailingNewline && lines.at(-1) === "") lines.pop();

  let inAudioSection = false;
  const opusPayloads = new Set<string>();
  for (const line of lines) {
    if (line.startsWith("m=")) inAudioSection = line.startsWith("m=audio ");
    if (!inAudioSection) continue;
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?\s*$/i);
    if (match) opusPayloads.add(match[1]);
  }

  for (const payload of opusPayloads) {
    const fmtpPrefix = `a=fmtp:${payload}`;
    const rtpMapIndex = lines.findIndex((line) =>
      line.toLowerCase().startsWith(`a=rtpmap:${payload} opus/`),
    );
    const sectionEnd = lines.findIndex(
      (line, index) => index > rtpMapIndex && line.startsWith("m="),
    );
    const fmtpOffset = lines
      .slice(rtpMapIndex + 1, sectionEnd < 0 ? undefined : sectionEnd)
      .findIndex((line) =>
        line.toLowerCase().startsWith(`${fmtpPrefix.toLowerCase()} `),
      );
    const fmtpIndex = fmtpOffset < 0 ? -1 : rtpMapIndex + 1 + fmtpOffset;
    const parameters = new Map<string, string>();
    if (fmtpIndex >= 0) {
      const rawParameters = lines[fmtpIndex].slice(fmtpPrefix.length).trim();
      for (const part of rawParameters.split(";")) {
        const [rawKey, ...rawValue] = part.trim().split("=");
        if (rawKey) parameters.set(rawKey.toLowerCase(), rawValue.join("="));
      }
    }
    for (const [key, value] of REQUIRED_OPUS_STEREO_PARAMETERS) {
      parameters.set(key, value);
    }
    const fmtpLine = `${fmtpPrefix} ${Array.from(parameters, ([key, value]) =>
      value ? `${key}=${value}` : key,
    ).join(";")}`;

    if (fmtpIndex >= 0) {
      lines[fmtpIndex] = fmtpLine;
    } else {
      lines.splice(rtpMapIndex + 1, 0, fmtpLine);
    }
  }

  return `${lines.join(newline)}${hadTrailingNewline ? newline : ""}`;
}

export function reduceNetworkStereoPhase(
  phase: NetworkStereoPhase,
  action: NetworkStereoAction,
): NetworkStereoPhase {
  switch (action) {
    case "connect":
      return "connecting";
    case "signaling-connected":
    case "track-received":
      return "waiting";
    case "stereo-verified":
      return "connected";
    case "recovering":
      return "reconnecting";
    case "connection-lost":
      return phase === "idle" || phase === "disconnected"
        ? phase
        : "waiting";
    case "fail":
      return "error";
    case "disconnect":
      return "disconnected";
  }
}

function normalizeCodecName(mimeType: string | null): string | null {
  if (!mimeType) return null;
  const codec = mimeType.split("/").at(-1)?.toUpperCase() ?? null;
  if (codec === "L16") return "PCM/L16";
  return codec;
}

function asStatsArray(
  report: Iterable<RTCStatsLike> | ReadonlyArray<RTCStatsLike>,
): RTCStatsLike[] {
  return Array.from(report);
}

function getSelectedCandidatePair(stats: RTCStatsLike[]): RTCStatsLike | null {
  const transport = stats.find(
    (entry) => entry.type === "transport" && entry.selectedCandidatePairId,
  );
  if (transport?.selectedCandidatePairId) {
    const selected = stats.find(
      (entry) => entry.id === transport.selectedCandidatePairId,
    );
    if (selected) return selected;
  }

  const explicitlySelected = stats.find(
    (entry) => entry.type === "candidate-pair" && entry.selected === true,
  );
  if (explicitlySelected) return explicitlySelected;

  const nominatedPairs = stats.filter(
    (entry) =>
      entry.type === "candidate-pair" &&
      entry.nominated === true &&
      entry.state === "succeeded",
  );
  return nominatedPairs.length === 1 ? nominatedPairs[0] : null;
}

const DIRECT_CANDIDATE_TYPES = new Set(["host", "srflx", "prflx"]);

function getRoute(stats: RTCStatsLike[]): NetworkRoute {
  const pair = getSelectedCandidatePair(stats);
  if (!pair) return null;

  const local = stats.find((entry) => entry.id === pair.localCandidateId);
  const remote = stats.find((entry) => entry.id === pair.remoteCandidateId);
  const localType = local?.candidateType;
  const remoteType = remote?.candidateType;
  if (localType === "relay" || remoteType === "relay") return "relay";
  return localType &&
    remoteType &&
    DIRECT_CANDIDATE_TYPES.has(localType) &&
    DIRECT_CANDIDATE_TYPES.has(remoteType)
    ? "direct"
    : null;
}

function getCodecFromStats(stats: RTCStatsLike[]): RTCStatsLike | null {
  const inbound = stats.find(
    (entry) =>
      entry.type === "inbound-rtp" &&
      (entry.kind === "audio" || entry.mediaType === "audio"),
  );
  if (!inbound) return null;
  if (inbound.codecId) {
    const codec = stats.find((entry) => entry.id === inbound.codecId);
    if (codec) return codec;
  }
  if (inbound.payloadType != null) {
    return (
      stats.find(
        (entry) =>
          entry.type === "codec" &&
          entry.payloadType === inbound.payloadType,
      ) ?? null
    );
  }
  return null;
}

function parseNegotiatedAudio(
  sdp: string | null | undefined,
  payloadType: number | undefined,
): { channels: number | null; stereo: boolean | null } {
  if (!sdp || payloadType == null) {
    return { channels: null, stereo: null };
  }

  const escapedPayload = payloadType.toString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rtpMap = sdp.match(
    new RegExp(`^a=rtpmap:${escapedPayload}\\s+[^/]+/\\d+(?:/(\\d+))?\\s*$`, "im"),
  );
  const fmtp = sdp.match(
    new RegExp(`^a=fmtp:${escapedPayload}\\s+(.+)$`, "im"),
  );
  const channels = rtpMap?.[1] ? Number(rtpMap[1]) : null;
  const fmtpValue = (fmtp?.[1] ?? "").trim();
  const hasStereo = /(?:^|;)\s*(?:sprop-)?stereo=1(?:;|$)/i.test(fmtpValue);
  const explicitlyMono = /(?:^|;)\s*(?:sprop-)?stereo=0(?:;|$)/i.test(
    fmtpValue,
  );
  return {
    channels: Number.isFinite(channels) ? channels : null,
    stereo: hasStereo ? true : explicitlyMono ? false : null,
  };
}

export function extractNetworkAudioDiagnostics({
  report,
  trackSettings,
  receiverSdp,
}: {
  report: Iterable<RTCStatsLike> | ReadonlyArray<RTCStatsLike>;
  trackSettings?: Pick<MediaTrackSettings, "channelCount" | "sampleRate">;
  receiverSdp?: string | null;
}): NetworkAudioDiagnostics {
  const stats = asStatsArray(report);
  const codec = getCodecFromStats(stats);
  const mimeType = codec?.mimeType ?? null;
  const codecName = normalizeCodecName(mimeType);
  const negotiated = parseNegotiatedAudio(receiverSdp, codec?.payloadType);
  const settingsChannels = trackSettings?.channelCount ?? null;
  const codecChannels = codec?.channels ?? negotiated.channels;
  const fmtp = codec?.sdpFmtpLine ?? "";
  const opusStereo = /(?:^|;)\s*(?:sprop-)?stereo=1(?:;|$)/i.test(fmtp);
  const opusMono = /(?:^|;)\s*(?:sprop-)?stereo=0(?:;|$)/i.test(fmtp);
  const isOpus = mimeType?.toLowerCase() === "audio/opus";
  const isPcm = mimeType?.toLowerCase() === "audio/l16";

  let stereoState: StereoState = "unknown";
  let stereoEvidence: StereoEvidence = null;
  let channelCount: number | null = settingsChannels ?? null;

  const hasMonoEvidence =
    settingsChannels === 1 ||
    codecChannels === 1 ||
    (isOpus && (opusMono || negotiated.stereo === false));

  if (hasMonoEvidence) {
    stereoState = "mono";
    channelCount = 1;
  } else if (settingsChannels != null && settingsChannels >= 2) {
    stereoState = "stereo";
    stereoEvidence = "track-settings";
    channelCount = settingsChannels;
  } else if (
    isOpus &&
    codecChannels != null &&
    codecChannels >= 2 &&
    (opusStereo || negotiated.stereo === true)
  ) {
    stereoState = "stereo";
    stereoEvidence = "negotiated-codec";
    channelCount = codecChannels;
  } else if (isPcm && codecChannels != null && codecChannels >= 2) {
    stereoState = "stereo";
    stereoEvidence = "negotiated-codec";
    channelCount = codecChannels;
  }

  return {
    codec: codecName,
    mimeType,
    sampleRate: codec?.clockRate ?? trackSettings?.sampleRate ?? null,
    channelCount,
    stereoState,
    stereoEvidence,
    route: getRoute(stats),
  };
}
