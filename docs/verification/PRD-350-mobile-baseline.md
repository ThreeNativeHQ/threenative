# PRD-350 mobile baseline

Date: 2026-09-05

This record covers the Android asset/build proof for PRD-350. The sandbox projects are separate
repositories and were already dirty; this run did not intentionally edit their source files.

## Command

The sandbox package manifests still point at PRD-349 tarballs, and the published runtime package
is not available in the registry. The current lane CLI and runtime source were therefore used to
exercise the engine change:

```sh
JAVA_HOME=/usr/lib/jvm/java-17-openjdk ANDROID_HOME=/home/joao/Android/Sdk THREENATIVE_RUNTIME_SOURCE=/home/joao/projects/threenative/threenative-engine/.worktrees/assets-prd-350-20260904/packages/runtime-native node /home/joao/projects/threenative/threenative-engine/.worktrees/assets-prd-350-20260904/packages/create-threenative/dist/threenative.js build --target android
```

The runtime Android dependencies were installed with the supported command:

```sh
node packages/runtime-native/scripts/download-deps.mjs --android
node packages/runtime-native/scripts/download-deps.mjs --only stb
```

## Observed results

| Project | Build result | Manifest entries | Unique referenced files | Referenced bytes | APK |
|---|---:|---:|---:|---:|---:|
| `sandbox/quarry` | PASS | 6 | 9 | 7,807,727 | 114,547,709 bytes |
| `sandbox/wildwood` | PASS | 163 | 218 | 1,070,488,471 | 3,594,068,526 bytes |

Both builds passed native asset preflight after mobile model output switched to separate vertex
buffers. Quarry's manifest references these decoder-free shared PNGs:

```text
shared/images/0c9519f097b26686.none.png
shared/images/8c36d1cbe6e17127.none.png
shared/images/ed8ed0abd29dcde7.none.png
```

The build reports name the decoder-backed work that remains authored on mobile:

```text
TN_ASSETS_COMPRESSION_SKIPPED model: 6 file(s), 0.8 MB retained without decoder-backed compression while decoder-free model passes still ran because this target has no WebAssembly and cannot run its meshopt and KTX2 decoder.
TN_ASSETS_COMPRESSION_SKIPPED texture: 88 file(s), 976.5 MB shipped as authored because this target has no WebAssembly and cannot run its KTX2 decoder.
```

Before the separate-buffer fix, the same native preflight rejected generated GLBs with interleaved
vertex buffer views. That was the engine-level defect found by the Android proof; the regression
test now reads the generated Quarry GLBs and fails if vertex attributes share a buffer view.

## Device proof

```text
$ ANDROID_HOME=/home/joao/Android/Sdk adb devices -l
List of devices attached
```

No Android device was attached, so the required real Pixel 8 playtest and screenshot comparison
could not run. `sandbox/quarry/playtests/quarry-android.playtest.json` was not added without a
device run to validate its assertions.

## Acceptance status

- Mobile shared PNG emission and Android packaging: PASS for Quarry.
- Wildwood Android build: PASS, but the current manifest is 1,070,488,471 bytes, so the PRD's
  `<= 100 MB` criterion is not met.
- Real Pixel 8 rendering and identical-frame proof: UNVERIFIED; no device was available.
- Web/desktop byte-for-byte comparison: UNVERIFIED. The code only supplies `vertexLayout: "separate"`
  when the target lacks the meshopt decoder; existing web/desktop output tests remain green.
- The old `decodesCompression` symbol is absent, and the mobile report names meshopt/KTX2 rather
  than claiming that shared-image deduplication was skipped.

The source PRD remains `READY FOR EXECUTION` until the device proof and the Wildwood size result
are resolved.
