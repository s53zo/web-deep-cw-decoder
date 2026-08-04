import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVdoNinjaSenderUrl,
  extractNetworkAudioDiagnostics,
  NETWORK_STEREO_STREAM_ID,
  reduceNetworkStereoPhase,
  requestStereoOpusInAnswer,
  validateStreamId,
  type RTCStatsLike,
} from "../src/utils/networkStereo.ts";

test("adds required stereo and quality parameters to the Opus answer", () => {
  const answer = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=rtpmap:111 opus/48000/2",
    "a=fmtp:111 minptime=10;useinbandfec=1;usedtx=1",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=rtpmap:96 VP8/90000",
    "",
  ].join("\r\n");

  const negotiated = requestStereoOpusInAnswer(answer);
  assert.match(negotiated, /a=fmtp:111 minptime=10;useinbandfec=1/);
  assert.match(negotiated, /stereo=1/);
  assert.match(negotiated, /sprop-stereo=1/);
  assert.match(negotiated, /usedtx=0/);
  assert.match(negotiated, /maxaveragebitrate=256000/);
  assert.match(negotiated, /m=video 9 UDP\/TLS\/RTP\/SAVPF 96/);
  assert.ok(negotiated.endsWith("\r\n"));
});

test("creates an Opus fmtp line when the browser answer omitted one", () => {
  const answer = [
    "v=0",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=rtpmap:111 opus/48000/2",
  ].join("\n");

  assert.match(
    requestStereoOpusInAnswer(answer),
    /a=fmtp:111 stereo=1;sprop-stereo=1;usedtx=0;maxaveragebitrate=256000/,
  );
});

test("uses the fixed contest stream identifier", () => {
  assert.equal(NETWORK_STEREO_STREAM_ID, "S53M_Vaneca");
  assert.equal(validateStreamId(NETWORK_STEREO_STREAM_ID), "S53M_Vaneca");
});

test("validates stream identifiers without silently changing them", () => {
  assert.equal(validateStreamId("  DeepCW_test_123  "), "DeepCW_test_123");
  assert.throws(() => validateStreamId("contains-a-dash"), /letters, numbers/);
  assert.throws(() => validateStreamId(""), /1–64/);
  assert.throws(() => validateStreamId("x".repeat(65)), /1–64/);
});

test("builds an audio-only stereo sender link with voice processing disabled", () => {
  const url = new URL(buildVdoNinjaSenderUrl("deepcw_test"));
  assert.equal(url.origin, "https://vdo.ninja");
  assert.equal(url.searchParams.get("push"), "deepcw_test");
  assert.equal(url.searchParams.get("vd"), "0");
  assert.equal(url.searchParams.get("stereo"), "1");
  assert.equal(url.searchParams.get("proaudio"), "1");
  assert.equal(url.searchParams.get("inputchannels"), "2");
  assert.equal(url.searchParams.get("micsamplerate"), "48000");
  assert.equal(url.searchParams.get("aec"), "0");
  assert.equal(url.searchParams.get("agc"), "0");
  assert.equal(url.searchParams.get("denoise"), "0");
  assert.equal(url.searchParams.get("voiceisolation"), "0");
  // VDO.Ninja enables DTX whenever the parameter exists, even as `dtx=0`.
  assert.equal(url.searchParams.has("dtx"), false);
  assert.equal(url.searchParams.has("usedtx"), false);
  assert.equal(url.searchParams.get("oab"), "256");
});

test("models connect, wait, verify, recover, reconnect, and cleanup transitions", () => {
  let phase = reduceNetworkStereoPhase("idle", "connect");
  assert.equal(phase, "connecting");
  phase = reduceNetworkStereoPhase(phase, "signaling-connected");
  assert.equal(phase, "waiting");
  phase = reduceNetworkStereoPhase(phase, "stereo-verified");
  assert.equal(phase, "connected");
  phase = reduceNetworkStereoPhase(phase, "recovering");
  assert.equal(phase, "reconnecting");
  phase = reduceNetworkStereoPhase(phase, "connection-lost");
  assert.equal(phase, "waiting");
  phase = reduceNetworkStereoPhase(phase, "stereo-verified");
  assert.equal(phase, "connected");
  phase = reduceNetworkStereoPhase(phase, "disconnect");
  assert.equal(phase, "disconnected");
  assert.equal(
    reduceNetworkStereoPhase("disconnected", "connection-lost"),
    "disconnected",
  );
});

function opusStats(candidateType: "host" | "relay" = "host"): RTCStatsLike[] {
  return [
    {
      id: "inbound-audio",
      type: "inbound-rtp",
      kind: "audio",
      codecId: "codec-opus",
    },
    {
      id: "codec-opus",
      type: "codec",
      payloadType: 111,
      mimeType: "audio/opus",
      clockRate: 48_000,
      channels: 2,
      sdpFmtpLine: "minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1",
    },
    {
      id: "transport",
      type: "transport",
      selectedCandidatePairId: "pair",
    },
    {
      id: "pair",
      type: "candidate-pair",
      state: "succeeded",
      nominated: true,
      localCandidateId: "local",
      remoteCandidateId: "remote",
    },
    { id: "local", type: "local-candidate", candidateType },
    { id: "remote", type: "remote-candidate", candidateType: "host" },
  ];
}

test("verifies negotiated Opus stereo when channelCount metadata is missing", () => {
  const stats = opusStats();
  const codec = stats.find((entry) => entry.id === "codec-opus");
  assert.ok(codec);
  codec.sdpFmtpLine = "";
  const result = extractNetworkAudioDiagnostics({
    report: stats,
    trackSettings: {},
    receiverSdp: [
      "v=0",
      "m=audio 9 UDP/TLS/RTP/SAVPF 111",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;useinbandfec=1;stereo=1;sprop-stereo=1",
    ].join("\r\n"),
  });

  assert.equal(result.codec, "OPUS");
  assert.equal(result.sampleRate, 48_000);
  assert.equal(result.channelCount, 2);
  assert.equal(result.stereoState, "stereo");
  assert.equal(result.stereoEvidence, "negotiated-codec");
  assert.equal(result.route, "direct");
});

test("accepts reliable two-channel track settings as stereo evidence", () => {
  const result = extractNetworkAudioDiagnostics({
    report: [],
    trackSettings: { channelCount: 2, sampleRate: 48_000 },
  });
  assert.equal(result.stereoState, "stereo");
  assert.equal(result.stereoEvidence, "track-settings");
  assert.equal(result.channelCount, 2);
});

test("rejects a genuinely mono negotiated stream", () => {
  const stats = opusStats();
  const codec = stats.find((entry) => entry.id === "codec-opus");
  assert.ok(codec);
  codec.sdpFmtpLine = "minptime=10;stereo=0;sprop-stereo=0";
  const result = extractNetworkAudioDiagnostics({
    report: stats,
    trackSettings: { channelCount: 1, sampleRate: 48_000 },
    receiverSdp: [
      "v=0",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;stereo=0;sprop-stereo=0",
    ].join("\r\n"),
  });
  assert.equal(result.stereoState, "mono");
  assert.equal(result.channelCount, 1);
  assert.equal(result.stereoEvidence, null);
});

test("rejects explicit mono negotiation when track settings report two channels", () => {
  const stats = opusStats();
  const codec = stats.find((entry) => entry.id === "codec-opus");
  assert.ok(codec);
  codec.sdpFmtpLine = "minptime=10;stereo=0;sprop-stereo=0";

  const result = extractNetworkAudioDiagnostics({
    report: stats,
    trackSettings: { channelCount: 2, sampleRate: 48_000 },
    receiverSdp: [
      "v=0",
      "a=rtpmap:111 opus/48000/2",
      "a=fmtp:111 minptime=10;stereo=0;sprop-stereo=0",
    ].join("\r\n"),
  });

  assert.equal(result.stereoState, "mono");
  assert.equal(result.channelCount, 1);
  assert.equal(result.stereoEvidence, null);
});

test("does not claim stereo from the Opus channel capability alone", () => {
  const stats = opusStats();
  const codec = stats.find((entry) => entry.id === "codec-opus");
  assert.ok(codec);
  codec.sdpFmtpLine = "minptime=10;useinbandfec=1";

  const result = extractNetworkAudioDiagnostics({
    report: stats,
    trackSettings: {},
  });
  assert.equal(result.codec, "OPUS");
  assert.equal(result.stereoState, "unknown");
  assert.equal(result.channelCount, null);
});

test("labels PCM and relay transport only from runtime statistics", () => {
  const stats = opusStats("relay");
  const codec = stats.find((entry) => entry.id === "codec-opus");
  assert.ok(codec);
  codec.mimeType = "audio/L16";
  codec.clockRate = 32_000;
  codec.channels = 2;
  codec.sdpFmtpLine = "";

  const result = extractNetworkAudioDiagnostics({
    report: stats,
    trackSettings: {},
  });
  assert.equal(result.codec, "PCM/L16");
  assert.equal(result.sampleRate, 32_000);
  assert.equal(result.stereoState, "stereo");
  assert.equal(result.route, "relay");
});

test("does not guess a route when statistics contain multiple candidate pairs", () => {
  const stats = opusStats();
  stats.splice(2, 1); // Remove the authoritative transport-selected pair ID.
  stats.push({
    id: "second-pair",
    type: "candidate-pair",
    state: "succeeded",
    nominated: true,
    localCandidateId: "relay-local",
    remoteCandidateId: "remote",
  });
  stats.push({
    id: "relay-local",
    type: "local-candidate",
    candidateType: "relay",
  });

  const result = extractNetworkAudioDiagnostics({ report: stats });
  assert.equal(result.route, null);
});

test("does not guess a direct route when candidate type metadata is incomplete", () => {
  const stats = opusStats();
  const remote = stats.find((entry) => entry.id === "remote");
  assert.ok(remote);
  delete remote.candidateType;

  const result = extractNetworkAudioDiagnostics({ report: stats });
  assert.equal(result.route, null);
});

test("does not guess a direct route from an unrecognized candidate type", () => {
  const stats = opusStats();
  const remote = stats.find((entry) => entry.id === "remote");
  assert.ok(remote);
  remote.candidateType = "unknown";

  const result = extractNetworkAudioDiagnostics({ report: stats });
  assert.equal(result.route, null);
});
