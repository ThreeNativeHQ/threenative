# PRD-350 mobile baseline

Date: 2026-09-05

This record captures the Android asset/build and real-device evidence for PRD-350. The final raw/
cooked Pixel 8 comparison, web/desktop byte identity and the missing-shared-image negative control
are recorded below. The sandbox projects are separate repositories. Quarry received the game-side
fixes required to expose the native frame; Wildwood was read-only during this proof because its
checkout already contained unrelated changes.

## Commands

The sandbox package manifests still point at PRD-349 tarballs, and the published runtime package is
not available in the registry. The current engine lane CLI and runtime source were used:

```sh
JAVA_HOME=/usr/lib/jvm/java-17-openjdk \
ANDROID_HOME=/home/joao/Android/Sdk \
ANDROID_SDK_ROOT=/home/joao/Android/Sdk \
THREENATIVE_RUNTIME_SOURCE=/home/joao/projects/threenative/threenative-engine/.worktrees/prd-350-proof-20260905-1328/packages/runtime-native \
node /home/joao/projects/threenative/threenative-engine/.worktrees/prd-350-proof-20260905-1328/packages/create-threenative/dist/threenative.js build --target android
```

Runtime Android dependencies were installed with:

```sh
node packages/runtime-native/scripts/download-deps.mjs --android
node packages/runtime-native/scripts/download-deps.mjs --only stb
```

The device playtest was run with the Android runner built from the closeout lane:

```sh
node /home/joao/projects/threenative/threenative-engine/.worktrees/prd-350-proof-20260905-1328/packages/playtest/dist/runner/cli.js \
  /tmp/prd350-quarry-proof.nGv0U1/playtests/quarry-android.playtest.json \
  --target android \
  --device 192.168.1.192:5555 \
  --package com.threenative.quarry \
  --activity com.threenative.runtime.MystralActivity \
  --project /tmp/prd350-quarry-proof.nGv0U1 \
  --artifacts /tmp/prd350-quarry-proof.nGv0U1/artifacts/cooked-runner-fixed
```

The runner now detects Android's current foreground user with `am get-current-user` and applies that
user to both `am force-stop` and `am start`; `--user <id>` is available for an explicit target.
Android 17 on this Pixel can resolve the activity in the package table but rejects `am start`
without a user selector. The red/green regression is in
`packages/playtest/__tests__/device-playtest.spec.ts` and the fix is in
`packages/playtest/src/runner/android.ts`.

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

The Pixel 8 reported Android 17/API 37 and the native adapter was Mali-G715. Both the raw control
(`assets.models: "none"`, `assets.textures: "none"`, 30,346,112 B) and the cooked build (7,807,727 B,
three shared PNGs) ran through the same Android scenario over Wi-Fi ADB and passed with the
post-fix runner:

```text
raw:    pass=true, props=6, texturedProps=6, normalMappedProps=6, visited=6,
        distance=25.47482793903439, diagnostics=[], thermalStatus=NONE
cooked: pass=true, props=6, texturedProps=6, normalMappedProps=6, visited=6,
        distance=25.48145842388785, diagnostics=[], thermalStatus=NONE
```

The runner captured both targets at 1280x720. The raw and cooked initial frames are byte-identical
(`bbce1afc108d45b826f326f115b17211a4af2c2c4a9f2db694b338f2e5ac5e8b`); their after frames are also
byte-identical (`c408eb316f913f773f1101ec9bd92ee87d775fad455f7d229d4bae5d09aaed4e`). Durable copies
of the comparison frames and the earlier selected captures are kept in this repository:

- [`initial-world.png`](artifacts/prd-350/quarry/initial-world.png)
- [`device-transparent-body.png`](artifacts/prd-350/quarry/device-transparent-body.png)
- [`android-raw-cooked-initial.png`](artifacts/prd-350/quarry/android-raw-cooked-initial.png)
- [`android-raw-cooked-after.png`](artifacts/prd-350/quarry/android-raw-cooked-after.png)
- [`android-result.txt`](artifacts/prd-350/quarry/android-result.txt)

The `device-transparent-body.png` capture is the manual before/after capture that caught the white
screen. The WebView HUD was
painting an opaque `body` background over the native WebGPU surface. Quarry now keeps `body`
transparent and scopes the web-only background to `#root`; the fix is in examples PR [#1](https://github.com/ThreeNativeHQ/examples/pull/1).

The original cooked Android scenario exited 0 with `pass: true`; the selected assertion and device
details are retained in [`android-result.txt`](artifacts/prd-350/quarry/android-result.txt). The
raw/cooked rerun also exited 0 for both targets with the same assertions and no diagnostics.

```text
props=6
texturedProps=6
normalMappedProps=6
visited=6
distance=25.48145842388785
groundGap=0.010098910331726052
diagnostics=[]
runtime=native
```

The raw run was at 66% battery and 29.2 °C; the cooked run was at 65% battery and 30.1 °C. Both
reported thermal status `NONE`, so this is functional and visual evidence only; no power, thermal
or performance claim is made.

## Cross-target identity

The current compiler was run for `web` and `desktop` from the same Quarry source. Both emitted six
model entries and 4,569,038 B of asset payload. The web and desktop manifests have the same
SHA-256, `85716d6520fb8f7d4673c7e85f22ff3f0b890b5f6151ac0d5396a1f17bb6ef63`, and every model output
hash matched. `cmp` also found the web manifest byte-identical to the PRD-349 Quarry baseline.

## Negative controls and regression gates

The required shared-image negative control was observed red, not inferred. Temporarily replacing
the mobile compiler wiring with `sharedImages: undefined` and `sharedImages: false`, then running:

```text
pnpm exec vitest run packages/assets/__tests__/compile.spec.ts -t "should share images on an android build"
```

failed at `compile.spec.ts:265` with `AssertionError: Target cannot be null or undefined` for the
missing `sharedImages` entry. Restoring the wiring made the same test pass (`1 passed, 39 skipped`).
The iOS shared-image test, cross-target cache-separation test, budget tests and the full workspace
test suite also pass; no iOS package or runtime was executed on Linux, so this record makes no iOS
runtime claim.

## Acceptance status

- Mobile shared PNG emission and Android packaging: PASS for Quarry.
- Wildwood Android build and runtime load-set: PASS; 92,044,733 B is below the 100 MB criterion.
- Real Pixel 8 rendering and textured shared-image proof: PASS for both raw and cooked Quarry runs;
  the two captured frames at each checkpoint are byte-identical.
- Web/desktop byte-for-byte comparison with PRD-349: PASS; web and desktop manifests and all six
  model output hashes match, and the web manifest matches the PRD-349 baseline.
- Missing-shared-image negative control: PASS as an observed red mutation followed by a green restore.
- Build report truth and removal of `decodesCompression`: PASS in the merged engine PR and its tests.

## Workspace gates

```text
pnpm typecheck  PASS
pnpm lint       PASS (596 pre-existing warnings)
pnpm test       PASS — 389 files, 4,268 passed; 2 skipped files, 7 skipped tests
pnpm build      PASS
pnpm test:playtest PASS — movement, camera, navigation and streaming scenarios
pnpm budgets    PASS — evidence budget, retention index, capability manifest and package checks
pnpm sync:agents PASS — 19 mirrors, 0 written
```

The browser rerun in this lane is not a gate: headless Chromium selected SwiftShader and then emitted
timestamp-query `GPUBuffer.mapAsync` teardown errors. The Android Pixel run is the authoritative native
render proof.
