# PRD-350 mobile baseline

Date: 2026-09-05

This record captures the Android asset/build and real-device evidence for PRD-350. It does not close
the PRD: web/desktop byte identity, raw/cooked visual identity and the missing-shared-image negative
control remain `UNVERIFIED`. The sandbox projects are separate repositories. Quarry received the
game-side fixes required to expose the native frame; Wildwood was read-only during this proof because
its checkout already contained unrelated changes.

## Commands

The sandbox package manifests still point at PRD-349 tarballs, and the published runtime package is
not available in the registry. The current engine lane CLI and runtime source were used:

```sh
JAVA_HOME=/usr/lib/jvm/java-17-openjdk \
ANDROID_HOME=/home/joao/Android/Sdk \
ANDROID_SDK_ROOT=/home/joao/Android/Sdk \
THREENATIVE_RUNTIME_SOURCE=/home/joao/projects/threenative/threenative-engine/.worktrees/assets-prd-350-device-proof-20260905/packages/runtime-native \
node /home/joao/projects/threenative/threenative-engine/.worktrees/assets-prd-350-device-proof-20260905/packages/create-threenative/dist/threenative.js build --target android
```

Runtime Android dependencies were installed with:

```sh
node packages/runtime-native/scripts/download-deps.mjs --android
node packages/runtime-native/scripts/download-deps.mjs --only stb
```

The device playtest was run with:

```sh
node /home/joao/projects/threenative/threenative-engine/.worktrees/assets-prd-350-device-proof-20260905/packages/playtest/dist/runner/cli.js \
  /home/joao/projects/threenative/sandbox/quarry/playtests/quarry-android.playtest.json \
  --target android \
  --device 192.168.1.192:5555 \
  --package com.threenative.quarry \
  --activity com.threenative.runtime.MystralActivity \
  --project /home/joao/projects/threenative/sandbox/quarry \
  --artifacts /home/joao/projects/threenative/sandbox/quarry/artifacts/playtest-android-prd350
```

## Observed results

| Project | Android build | Full receipt | Runtime load-set | APK |
|---|---:|---:|---:|---:|
| `sandbox/quarry` | PASS | 7,807,727 B | 7,807,727 B | 114,547,709 B |
| `sandbox/wildwood` | PASS | 1,070,488,471 B | 92,044,733 B | 3,594,068,526 B* |

The full receipt is every compiled source entry plus auxiliary outputs. The runtime load-set is the
76-path acquisition list from PRD-349, resolved through the current Android manifest, with shared
image outputs counted once and the directly fetched HDRI included:

```text
Wildwood runtime load-set
  primary outputs:       18,031,623 B
  unique shared images:  68,561,617 B  (48 files)
  direct HDRI:             5,451,493 B
  total:                  92,044,733 B
```

The Phase 1 baseline was 304,915,228 B including the HDRI. The current load-set saves 212,870,495 B
(69.8130%). The full manifest remains recorded separately because it contains 87 source entries the
scene never acquires; it is not the runtime load-set criterion described by the README's ~83 MB
estimate. The starred Wildwood APK includes stale generated files already present in that dirty
checkout and is not used as the load-set measurement.

Both mobile reports name the decoder-backed work that was skipped while decoder-free model work ran:

```text
TN_ASSETS_COMPRESSION_SKIPPED model: 6 file(s), 0.8 MB retained without decoder-backed compression while decoder-free model passes still ran because this target has no WebAssembly and cannot run its meshopt and KTX2 decoder.
TN_ASSETS_COMPRESSION_SKIPPED texture: 88 file(s), 976.5 MB shipped as authored because this target has no WebAssembly and cannot run its KTX2 decoder.
```

Quarry's Android manifest references three decoder-free shared PNGs. The engine-level separate-buffer
change also removes interleaved vertex buffer views from mobile GLBs, allowing native preflight to
accept the output. The implementation and regression tests are in merged engine PR [#114](https://github.com/ThreeNativeHQ/threenative/pull/114).

## Device proof

```text
$ ANDROID_HOME=/home/joao/Android/Sdk adb devices -l
List of devices attached
192.168.1.192:5555     device product:shiba model:Pixel_8 device:shiba transport_id:3
```

The Pixel 8 reported Android 17/API 37. The initial-world screenshot visibly contains the sky,
ground, path, shadows and all six textured, normal-mapped props. Durable copies of the selected
captures and the compact result record are kept in this repository:

- [`initial-world.png`](artifacts/prd-350/quarry/initial-world.png)
- [`device-transparent-body.png`](artifacts/prd-350/quarry/device-transparent-body.png)
- [`android-result.txt`](artifacts/prd-350/quarry/android-result.txt)

The `device-transparent-body.png` capture is the manual before/after capture that caught the white
screen. The WebView HUD was
painting an opaque `body` background over the native WebGPU surface. Quarry now keeps `body`
transparent and scopes the web-only background to `#root`; the fix is in examples PR [#1](https://github.com/ThreeNativeHQ/examples/pull/1).

The Android scenario exited 0 with `pass: true`; the selected assertion and device details are
retained in [`android-result.txt`](artifacts/prd-350/quarry/android-result.txt):

```text
props=6
texturedProps=6
normalMappedProps=6
visited=6
distance=25.491744205820467
groundGap=0.010098910331726052
diagnostics=[]
runtime=native
```

The run was charging at 53% and 32.7 °C, so this is functional and visual evidence only; no power,
thermal or performance claim is made.

## Acceptance status

- Mobile shared PNG emission and Android packaging: PASS for Quarry.
- Wildwood Android build and runtime load-set: PASS; 92,044,733 B is below the 100 MB criterion.
- Real Pixel 8 rendering and textured shared-image proof: PASS for Quarry's cooked run. Raw/cooked
  visual identity was not run and is `UNVERIFIED`.
- Web/desktop byte-for-byte comparison with PRD-349: `UNVERIFIED` — no output hashes or byte-for-byte
  browser/desktop run is retained. The cited tests cover extension, custom-pass and cache behavior;
  they do not prove unchanged bytes.
- Missing-shared-image negative control: `UNVERIFIED` — no run or failure artifact was retained.
- Build report truth and removal of `decodesCompression`: PASS in the merged engine PR and its tests.

The browser rerun in this lane is not a gate: headless Chromium selected SwiftShader and then emitted
timestamp-query `GPUBuffer.mapAsync` teardown errors. The Android Pixel run is the authoritative native
render proof.
