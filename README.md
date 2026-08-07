# DeepCW SO2R fork

This repository is a focused fork of
[e04's DeepCW web decoder](https://github.com/e04/web-deep-cw-decoder). It adds
contest-oriented SO2R operation and a private local Pileup mode while retaining
the original DeepCW decoder and audio preprocessing.

For general DeepCW documentation, model information, benchmarks, screenshots,
and upstream development, see the
[original repository](https://github.com/e04/web-deep-cw-decoder) and the
[DeepCW Engine](https://github.com/e04/deepcw-engine). The original hosted
decoder is available at <https://cw.e04.workers.dev/>.

## Changes in this fork

### SO2R stereo decoding

- Adds an SO2R mode with channel 0 assigned to the left radio and channel 1 to
  the right radio.
- Positively verifies a two-channel capture before decoding and keeps the two
  audio paths, scopes, filters, decoder state, and transcripts isolated.
- Uses a side-by-side desktop layout that stacks responsively on narrow screens.
- Disables audio THRU in SO2R to avoid accidentally mixing the radios.

### Stereo audio over the LAN

- Adds a VDO.Ninja network-stereo input for sending two-channel audio from a
  Windows 11 computer to the decoder running on macOS.
- Uses the fixed stream ID `S53M_Vaneca`, prefers PCM/L16 when available, and
  otherwise requests high-bitrate stereo Opus with voice processing disabled.
- Reports verified channel count, negotiated codec and sample rate, and whether
  the selected WebRTC path is direct peer-to-peer or a TURN relay.
- Includes reconnect handling, browser audio activation, level meters, and
  strict cleanup of WebRTC and Web Audio resources.

### Private SO2R Pileup mode

- Adds a separate Pileup decoder option without changing the Standard decoder.
- Runs e04's separately licensed native CWM detector, narrow decoder, and WASM
  runtime entirely in the browser after the user selects the files locally.
- Stores selected private files only in that browser origin's IndexedDB. The
  files are not included in this repository, downloaded by the application, or
  copied into production builds.
- Runs independent native workers for the left and right radios with a bounded
  latest-only queue and a maximum of five tracked signals per radio.
- Preserves e04's detector grid, tracking thresholds, eight-second window,
  200 ms analysis cadence, batched 15-bin decoding, and 1.5-second text hold.

### Pileup waterfall visualization

- Places decoded characters directly over each detected waterfall signal using
  model-frame positions and the captured-audio sample timeline.
- Shows per-character confidence using e04's CTC confidence calculation and
  styling curve.
- Adds a frequency-aligned current detector-probability strip with presence and
  lock markers.
- Uses stable colored backgrounds for tracking, decoding, holding, and expiry,
  with deterministic collision handling for nearby lanes.
- Keeps the existing lane cards and accumulated transcripts below each scope.

### Reliability and privacy checks

- Pins and verifies the public English model used by Standard mode.
- Adds synthetic regression tests for stereo isolation, network cleanup,
  detector/tracker behavior, CTC confidence, visualization coordinates,
  animation cleanup, and stale-session rejection.
- Adds private-model smoke tests and a concurrent two-radio benchmark for local
  development.
- Verifies every production build for accidentally copied, embedded, base64
  encoded, hashed, or path-referenced private Pileup assets.

## Run this fork locally

```bash
npm install
npm run dev
```

Open the URL printed by Vite, normally <http://localhost:5173/>. Standard mode
downloads and verifies the pinned public English model automatically. Private
Pileup assets must be supplied through **LOAD LOCAL PILEUP FILES** and remain
local to the browser.

Useful validation commands:

```bash
npm test
npm run lint
npm run build
npm run smoke:pileup
npm run smoke:pileup-worker
npm run benchmark:pileup
```

The private smoke and benchmark commands require the licensed local Pileup files
and never publish their contents.

## Attribution

DeepCW and its models are developed by e04; refer to the upstream repositories
for their licensing and documentation. Network transport uses the official
`@vdoninja/sdk` package. Its notices are preserved in
[`public/third-party-notices.txt`](public/third-party-notices.txt).
