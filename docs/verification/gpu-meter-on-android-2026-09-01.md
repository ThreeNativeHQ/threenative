<!-- schemaVersion: 1 -->

# The GPU meter reports on Android — PRD-305, 2026-09-01

**`gpuMs` arrives from a physical Pixel 8.** Every GPU number this repository held for a phone came
from ablation arithmetic; this is the first one read from the instrument built to replace that
arithmetic.

Base: `origin/main` at `4b87f49a`. Device: Pixel 8 (`shiba`), serial `37251FDJH0037Z`, reached over
Wi-Fi adb at `192.168.1.192:5555`. Adapter: **Mali-G715**. Subject: the Android first proof
(`examples/native-smoke`), 300 frames, 1080×2400 at `resolutionScale 1`, `sampleCount 4`.

## The reading

```
TN_FRAME_BUDGET:{"fps":41.29,…,"gpuMs":0.19,"surface":{"atFloor":false,
  "drawingBufferHeight":2400,"drawingBufferWidth":1080,"resolutionScale":1,
  "sampleCount":4,"scaleSource":"pinned"},"window":1}
```

Both windows of the run carry it: `gpuMs 0.19` at 41.29 fps (window 1) and 41.89 fps (window 2),
with `render.p50` 2.72 and 2.95 ms. The meter reports, and it reports a *finite* number rather than
the `undefined` it emits when it cannot measure.

**0.19 ms is the right order for this subject and says nothing about a real game.** The first proof
is a near-empty scene — its frame is dominated by `residual` (60.2 % of the window), not by the GPU.
What is proven here is that the instrument works on Android hardware, which is what PRD-305 asked;
attributing a real game's GPU time is PRD-308.

**The phone was on the charger** (`AC powered: true`, `status: 2`, level 65 → 72 %, battery 30.1 °C,
thermal status 0 at launch). The runner flags a charging run and withdraws its comparability claim,
correctly: nothing here is compared to the unplugged 59.99–60.02 fps baseline, and no fps number
from this run should be.

## What the run also exposed

The adapter granted `timestamp-query`, but **the host never said so on the path a game takes.**
Before this change the logcat carried only the compression probes:

```
[WebGPU] Adapter: Mali-G715
[WebGPU] adapter feature probe 4: no      # texture-compression-bc
[WebGPU] adapter feature probe 6: yes     # texture-compression-etc2
[WebGPU] adapter feature probe 7: yes     # texture-compression-astc
```

`context.cpp` builds the required-feature list in **six hand-written arrays across three backends
and two entry points**, and only the headless branch printed a `timestamp-query` probe. The windowed
branch — the one a real game takes, and the one that ran here — printed nothing about it. So "does
the meter work on Android" was unanswerable from a log, which is why it stayed unanswered.

Worse, the bounds were literals that did not track their arrays:

```c
WGPUFeatureName requiredFeaturesAndroid[6];
…
if (hasTimestampQuery_ && featureCount < 4) requiredFeaturesAndroid[featureCount++] = …TimestampQuery;
```

On this device only two compression formats are advertised, so `featureCount` is 2 and the cap never
bit. **On a device advertising all three it would**: `featureCount` reaches 3, `timestamp-query`
takes slot 4, and `core-features-and-limits` — which three.js reads to decide whether the whole
renderer is on a reduced-capability device — is dropped by `featureCount < 4`, silently, with two
array slots still free.

## The two edits

1. **Every bound now derives from its own array**: `featureCount < std::size(requiredFeaturesAndroid)`
   and the same for the Dawn and wgpu arrays, at all fourteen sites. Adding a feature to an array
   can no longer push `timestamp-query` off the end.
2. **`TN_WEBGPU_FEATURES` is printed once per device creation, on every backend branch**, from a
   single helper called at all three `device_ = …` join points — so a branch cannot forget it the
   way branches forgot the probe. It asks the *device* (not the adapter) per feature, because the
   enumeration call differs across the header versions this host builds against while
   `wgpuDeviceHasFeature` does not.

The line the Pixel 8 now prints:

```
TN_WEBGPU_FEATURES:{"timestamp-query":true,"texture-compression-bc":false,
  "texture-compression-etc2":true,"texture-compression-astc":true,
  "indirect-first-instance":false,"rg11b10ufloat-renderable":false}
```

That is the answer to PRD-305 in one line: **the device granted `timestamp-query`**, and it says so
without a debugger, on the branch a game actually runs.

## Green

```
4/4 PASS: 300 frames, clean logs, screenshot captured, and process remained alive for 3000 ms.
```

`node scripts/verify-android-first-proof.mjs --device 192.168.1.192:5555`, run twice — once before
the edits to take the reading, once after to prove the report. Screenshot 1080×2400, 26,051 bytes,
4,096 overlay pixels. Artifacts:
`packages/runtime-native/artifacts/android/first-proof-{logcat.txt,report.json,.png}`.

## Not executed

- No iOS, macOS or Windows run.
- No emulator run: `--target android` in the conformance runner is the emulator lane and refuses a
  physical serial, and an emulator's software adapter would answer a different question.
- **No per-pass attribution.** This run says the meter works; which pass costs what on the phone is
  PRD-308, and it is now unblocked.
- No claim is made about a real game's GPU time, and no fps number here is comparable to the
  unplugged baselines.
