# DeepCW

A real-time Morse code (CW) decoder powered by a neural network model.

Launch DeepCW: https://cw.e04.workers.dev/

<img width="256" height="256" src="https://github.com/user-attachments/assets/780f899e-a59b-41b8-b785-1c6686f6da41" />

## Features

- **Real-time Morse code decoding** using deep learning
- **Robust decoding** for weak signals, QSB, and noisy conditions
- **Multi-channel decoding** for handling multiple CW signals
- **SO2R stereo decoding** with the left radio on channel 0 and right radio on channel 1
- **Audio pass-through** with deep-learning-based noise reduction
- **Cross-platform support** for Windows, macOS, Android, and iOS

## Run locally

Install the JavaScript dependencies and start the development server:

```bash
npm install
npm run dev
```

Then open the local URL printed by Vite, normally
<http://localhost:5173/>. The development and production build commands
automatically download the pinned public English model from
[deepcw-engine](https://github.com/e04/deepcw-engine) and verify its SHA-256
checksum before starting.

To check the model independently:

```bash
npm run models:verify
```

This verifies the published metadata, parses the ONNX protobuf, and runs a real
inference. It is also a useful diagnostic if the page reports a model-loading
error.

The browser keeps the existing 9.6 kHz capture path. Immediately before
inference, each isolated channel is converted with the model's published
settings: 3.2 kHz linear resampling, centered 256-sample Hann frames, 48-sample
hop, 400–1200 Hz / 65 bins, and `log1p` magnitude normalization.

The public engine distribution currently includes the standard English model.
Pileup mode and Japanese decoding remain visible but disabled because their
separate models are not publicly distributed with the engine. Normal,
Benchmark, and SO2R modes use the verified English model.

## SO2R stereo input

Select **SO2R** mode to decode two radios from one stereo capture device. DeepCW
requests and verifies a two-channel input, then keeps the channels isolated:

- channel 0 / left: **LEFT RADIO**
- channel 1 / right: **RIGHT RADIO**

Each radio has its own scope, decode band, bandwidth, window, live decode, and
streaming transcript. The inference engine is shared. Audio THRU is disabled in
SO2R mode so monitoring cannot accidentally combine the channels.

On macOS, configure the radio or audio interface as a two-channel input in
**Audio MIDI Setup**, route the left radio to input 1 and the right radio to
input 2. If the input list is initially empty, click **START** once and grant
microphone access. Select the interface under **STEREO INPUT**, then click
**START** again to begin decoding. Confirm that DeepCW reports two captured
channels and the expected sample rate.

<img width="800" src="https://github.com/user-attachments/assets/3207c5c0-7613-4448-a42b-aac08b8fd030" />

https://github.com/user-attachments/assets/ab01b136-e23f-42ae-a7ce-93f1839e5d48

## SO2R stereo over the LAN

DeepCW can receive the two radio channels directly from a Windows computer with
[VDO.Ninja](https://vdo.ninja/). The Mac does not need SonoBus, BlackHole, tab
capture, or another native audio application. The Windows browser only captures
and transports audio; model preprocessing and CW inference still run entirely in
DeepCW on the Mac.

Use a current stable version of Chrome or Edge on Windows and Chrome on macOS:

1. On the Mac, select **SO2R**, then set **SO2R INPUT SOURCE** to
   **Network stereo**.
2. Keep the generated private stream ID, or enter another 1–64 character ID made
   from letters, numbers, and underscores.
3. Select **COPY WINDOWS LINK** and transfer the link to the Windows computer.
   Treat the link like a temporary password; generate a new ID instead of sharing
   or permanently publishing it.
4. Select **CONNECT** on the Mac. It is safe to connect before or after starting
   the Windows sender.
5. Open the copied link in Chrome or Edge on Windows, allow microphone access,
   select the stereo interface, and start sharing. The link disables video,
   echo cancellation, automatic gain, noise suppression, and discontinuous
   transmission while requesting two 48 kHz input channels.
6. Wait for DeepCW to show **CONNECTED** and **CHANNELS: 2**. Decoding does not
   begin until the received stream has positive stereo evidence from the audio
   track or negotiated WebRTC codec.

The status panel reports only runtime evidence. **CODEC** and **RATE** come from
the received RTP codec, while **PATH** says **DIRECT P2P** only when WebRTC
statistics identify a selected non-relay candidate pair. **TURN RELAY** means the
media is using a relay instead of staying on the direct LAN path.

### Transport quality and privacy

The receiver uses the official `@vdoninja/sdk` package pinned at version 1.5.5.
That SDK is MPL-2.0 licensed and its package source remains unmodified;
attribution, license, and source information are preserved in
[`public/third-party-notices.txt`](public/third-party-notices.txt). VDO.Ninja's
public WebSocket service performs the initial signaling, so an internet
connection is normally required to establish a session. WebRTC media is encrypted
and attempts a direct peer-to-peer path; the status panel shows when a TURN relay
is actually selected. DeepCW is not affiliated with or endorsed by VDO.Ninja;
access to its hosted signaling and relay services is separate from the SDK license
and remains subject to the operator's terms, policies, and availability.

SDK 1.5.5 does not expose viewer codec or stereo preferences in its public API.
DeepCW therefore installs a small application-side answer adapter on the pinned
SDK instance: it prefers PCM/L16 when both browsers offer it, otherwise it requests
stereo Opus at 48 kHz with DTX disabled and a 256 kbit/s target. The SDK package
itself is not modified. DeepCW displays **PCM/L16** only if WebRTC runtime
statistics prove that PCM was negotiated. PCM avoids lossy compression but has no
packet-loss protection and can click when packets are lost; high-bitrate Opus
provides better error resilience. Neither transport changes DeepCW's existing
9.6 kHz capture path or published model preprocessing.

### Verify left/right isolation before a contest

Perform this test with the same Windows device and network that will be used in
the contest:

1. Send a steady 600 Hz tone to Windows input channel 1 only. The DeepCW
   **LEFT / CHANNEL 0** meter and left scope must respond; the right meter and
   scope must remain quiet.
2. Remove that tone and send a 1000 Hz tone to Windows input channel 2 only. The
   right meter and scope must respond; the left side must remain quiet.
3. Send both tones simultaneously and confirm each remains confined to its own
   decoder.
4. Confirm **CHANNELS: 2**, note the reported codec and sample rate, and prefer
   **DIRECT P2P** for the contest LAN. A relay can work, but adds an external
   dependency.

Identical signals or silence on both channels are valid and are not treated as a
mono test. Verification is based on negotiated channel structure, not on the two
waveforms being different.

### Network stereo troubleshooting

- **Mono error:** Configure the Windows recording device for two channels, select
  the physical stereo interface in VDO.Ninja, and restart the sender. Check that
  another application has not opened the interface exclusively.
- **Waiting for Windows:** Confirm that the complete sender link and matching
  stream ID are in use, the sender page has started, and both computers can reach
  VDO.Ninja's signaling service.
- **Silence:** Check Windows microphone privacy permission, the selected VDO.Ninja
  input, sender mute state, interface levels, and the two DeepCW level meters.
- **TURN relay:** Allow Chrome or Edge through Windows Defender Firewall on
  private networks and permit peer-to-peer UDP on the LAN. A restrictive VPN or
  firewall can force relay use.
- **Interrupted connection or sender reload:** Leave the receiver connected while
  restarting the sender. DeepCW enters **RECONNECTING** or **WAITING FOR WINDOWS**
  and requests the same stream again. If it does not recover, disconnect both
  ends, reload the sender link, and connect again.
- **Changed stream ID:** Disconnect before editing or generating an ID, then copy
  the newly generated sender link. Only one active sender may publish a given ID.

## DeepCW Engine

DeepCW's CW decoding model and reference implementation are available as a separate repository:

https://github.com/e04/deepcw-engine

It includes the model, metadata, and Python/Node.js examples for decoding Morse code from WAV audio.

## Benchmark

- Results are from balanced mode.
- SNR is measured over a 2500 Hz bandwidth.
- Error rate is reported as CER (Character Error Rate), defined as the percentage of inserted, deleted, or substituted characters relative to the reference text.

It achieves 0.00% error from 0 to -4 dB SNR at all tested speeds, and remains nearly error-free at -6 dB.

Even under weak-signal conditions, performance degrades gracefully: errors stay below 1.5% at -8 dB and below 8% at -10 dB across the full speed range.

<img width="2000" height="1200" alt="cer_heatmap" src="https://github.com/user-attachments/assets/2c4d82e6-9c06-44e6-81e1-0f4c6a7b498a" />

Audio sample:

https://github.com/user-attachments/assets/4be72fa7-011a-4e06-a2dd-10ba4e60f8c4

### Comparison with Other Decoders

To provide context for DeepCW’s performance, we compared it with several established CW decoding tools: [CW Skimmer,](https://www.dxatlas.com/CwSkimmer/) [fldigi,](https://www.w1hkj.org/) and [ggmorse](https://github.com/ggerganov/ggmorse).

These projects have made valuable contributions to the amateur-radio and Morse-code software ecosystem. The comparison below is not intended as a general ranking of these applications; it reflects only the specific test clips, settings, and evaluation method used in this README.　

All tested software was the latest available version as of June 3, 2026.

To evaluate performance under real-world conditions, we compared DeepCW with other decoders using publicly available short CW QSO videos from YouTube.


#### Video 1

Source: https://www.youtube.com/shorts/UBlxpe5gvv0

| Decoder | Transcription |
| --- | --- |
| Reference | <code>AI5DD AI5DD 56N CO BK BK GA UR 55N 55N OK OK 73 AE0Q DE AI5DD 44 EE R 44 EE EE</code> |
| DeepCW | <code>AI5DD AI5DD 56N CO BK BK GA UR 55N55N OK OK 73AE0QDE AI5DD 44EE44EE E</code> |
| CW Skimmer | <code>UI5DDM EU AI5DD 56N CO BK BK GA UR 55N 55N TTTK MTKE 73 AE0Q DE AI5D D44EE JI44EE EE</code> |
| fldigi | <code>I 5DD EI5DD 56N CO HK GA &#42; 55N 55N OK OK 73 AE0Q DE A I 5DD 44EE N</code> |
| ggmorse | <code>AI5DD AI5DD 56N CO XM TEEE BKGA755N55N OK OK 73AE0E TTTTTTKDEAIEAI5DD44EE R 44EE EE</code> |

<details>
<summary>Screenshots</summary>

<img width="400" alt="Sample1 CW Skimmer result" src="https://github.com/user-attachments/assets/d0becb14-d600-4111-80c7-29edda87b2d6" />

<img width="400" alt="Sample1 fldigi result" src="https://github.com/user-attachments/assets/97e2bcec-4293-4c61-8a1a-1e954a2fe4da" />

<img width="200" alt="Sample1 ggmorse result" src="https://github.com/user-attachments/assets/dae24c85-0716-4fec-93e8-28deea06f499" />

<img width="400" alt="Sample1 DeepCW result" src="https://github.com/user-attachments/assets/eb56de97-138c-4f01-8ab5-55c290c73423" />

</details>

#### Video 2

Source: https://www.youtube.com/shorts/9AhkEDs2Sko

| Decoder | Transcription |
| --- | --- |
| Reference | <code>D DE JO2QOT JO2QOT 5NN CA 5NN 100 TU JO2QOT TU K6XX</code> |
| DeepCW | <code>D DE J02Q O T J02QOT 5NN CA 5 NN 100 TU J02QOT TU K6XX</code> |
| CW Skimmer | <code>5NN 100 TU EM</code><br><code>JO2Q0T 5NN CA EE JO2Q0T TU K6XX</code> |
| fldigi | <code>&#42;EEHSSNJF J02QOT 5NN CA E&#42;S ÅÅ O J02QOT T K6XX</code> |
| ggmorse | <code>U JO2QOT 5NN CA SEGE ?O2QOT TU K6XX</code> |

<details>
<summary>Screenshots</summary>

<img width="400" alt="Sample2_cwskimmer" src="https://github.com/user-attachments/assets/27d760f8-ca69-4b50-8180-437a41a102f9" />

<img width="400" alt="Sample2_fldigi" src="https://github.com/user-attachments/assets/97208186-83b2-4d5c-b97e-5ffb74b1edd3" />

<img width="200" alt="Sample2_ggmorse" src="https://github.com/user-attachments/assets/cb7af155-8b6c-4888-829e-2ed02f56da3a" />

<img width="400" alt="Sample2_deepcw" src="https://github.com/user-attachments/assets/8be2946b-893c-4725-8502-a14f05dc2faa" />

</details>

#### Video 3

Source: https://www.youtube.com/shorts/9jgZ94TzRys

| Decoder | Transcription |
| --- | --- |
| Reference | <code>? WD4DAN WD4DAN GE ES FB UR 57N 57N CO BK BK TU GE UR 56N 56N GA GA 73 BK BK TU GA 73 DE W0ABE TU EE /</code> |
| DeepCW | <code>? WD4DAN WD4DAN GE ESFB UR 57N 57N CO BK 4KTUG E UR 56N 56N GA GA 73BK BKTUGA 73DE W0ABE TUEE EE /1</code> |
| CW Skimmer | <code>? WD4DAN GE ES FB UR 57N 57N CO BKE BK TU GA 73 DE W0ABE TU EE N</code><br><code>WD4DANWR 54TUGEEUR 56NE 56NE GAEG AE73BKR EE</code> |
| fldigi | <code>&#42;O&#42; DANTD4DAN 9E T S FB TR &#42;7N E7N ;0 A TUGE &#42; N66N GA RA73TU GA :3DE W0ABE UUEE ET "</code> |
| ggmorse | <code>WD4DAN E WD4DAN GE E SFB EEUR E57N 57N CO ? E ?TUGE ?56NEEE TEEEE TE IEEEE TESN GA GA 73? E?TUGA 73DE W0ABE TUEE /E2S?TTTT</code> |

<details>
<summary>Screenshots</summary>

<img width="400" alt="Sample3_cwskimmer" src="https://github.com/user-attachments/assets/4a1b24c5-8225-4ff0-b489-ac65144a9fab" />

<img width="400" alt="Sample3_fldigi" src="https://github.com/user-attachments/assets/75a9fc82-cbd8-41fe-b24c-adb73f5248a7" />

<img width="200" alt="Sample3_ggmorse" src="https://github.com/user-attachments/assets/ee93b38d-0b1e-46e2-ab81-ccb6249c17fa" />

<img width="400" alt="Sample3_deepcw" src="https://github.com/user-attachments/assets/436fc8bb-6b8c-4590-8599-7cfb20f9384e" />

</details>

## Noise Reduction

DeepCW includes a real-time, deep-learning-based noise reduction feature designed specifically for CW signals.

In addition to decoding Morse code, DeepCW can pass the audio through a neural noise reduction model, making noisy CW signals easier to monitor by ear.

Also see: https://github.com/e04/HamNoise
