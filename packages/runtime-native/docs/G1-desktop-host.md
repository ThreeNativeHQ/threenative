# G1 — desktop host

**Milestones:** M0, M1, M2, M4
**State:** Linux PASS from the migrated evidence; Windows and macOS UNEXECUTED.

## Recorded evidence on arrival — 2026-08-08

- Provenance baseline: `841fe379ca1ab23c87c99fac3b901e37487ce8f2` (v0.1.5).
- Linux x64 V8 13.1 + Dawn/Vulkan rendered the upstream Three.js cube and GLTF/GLB
  scenes on an NVIDIA RTX 2080.
- The unchanged `@threenative/core` import-free bundle ran 300 frames and emitted ready
  and first-frame markers on the desktop runtime.
- `tn-linux`, `tn-windows`, and `tn-macos` presets exist. Windows and macOS have not run on
  real runners and do not claim a pass.

Imported screenshots and generated artifacts are deliberately not tracked. A new in-repo
evidence run must record its dated command, log checks, screenshot path, host and GPU here.

## Absorbed-source desktop proof — 2026-08-08

Command:

```sh
SDL_VIDEODRIVER=x11 sh scripts/xvfb.sh \
  packages/runtime-native/build/tn-linux/mystral run \
  examples/native-smoke/dist/native-smoke.js \
  --screenshot packages/runtime-native/artifacts/desktop-core-2026-08-08.png \
  --frames 300
```

- `pnpm native:build`: PASS, 379/379 build steps completed from the absorbed source.
- Runtime: V8 13.1.201.22, Dawn/Vulkan, NVIDIA GeForce RTX 2080.
- Markers: exact `TN_NATIVE_SMOKE_READY:webgpu` and `TN_NATIVE_SMOKE_FIRST_FRAME` present.
- Liveness: 300 frames rendered in 8,986 ms; no WebGPU or JavaScript error was reported.
- Screenshot: 1280×720 RGBA, visually inspected as a nonblank rotating blue cube;
  SHA-256 `d07780b0b89207ed646f25eba3b0268240b49ef9a9f5d4cb227401b72c9bfcfa`.

## Remaining desktop lane wiring — 2026-08-08

`.github/workflows/native-platforms.yml` now contains opt-in macOS 14 and Windows 2025
real-runner jobs. The build and verifier select the matching host preset and retain the
exact 300-frame/log/screenshot gate. Neither job has executed: this checkout is on Linux,
there are no self-hosted runners, and no remote workflow was dispatched. Windows and macOS
remain **UNEXECUTED**, not configured-pass.

## Evidence retention hardening — 2026-08-08

`verify-desktop-core.mjs` now writes the complete runtime log and a JSON report containing
the host architecture, selected preset, exact marker/frame requirements, screenshot
dimensions and screenshot SHA-256. The platform workflow uploads that directory with
`if-no-files-found: error`. The verifier also limits `SDL_VIDEODRIVER=x11` to Linux; carrying
it into the Apple or Windows process environment would invalidate those real-runner lanes.

A fresh Linux x64 run passed 300 frames in 8,779 ms and produced a nonblank 1280×720 PNG with
SHA-256 `52700257102d3105715ce4dfb20e95806c3990b69ad7a9e72d7653f550554335`.
Windows and macOS remain **UNEXECUTED** until the opt-in workflow is present on the remote
default branch and dispatched.

## Scaffolded starter artifact proof — 2026-08-09

The proof subject is a freshly scaffolded `starter`, not `examples/native-smoke`. Its
declared `src/game.ts` entry was bundled with its texture, GLB and existing public assets,
then packaged with the rebuilt Linux host.

```sh
THREENATIVE_RUNTIME_BINARY=$PWD/packages/runtime-native/build/tn-linux/mystral \
  pnpm build:desktop
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs
```

- Runtime: Linux x64, V8 13.1.201.22, Dawn/Vulkan, NVIDIA GeForce RTX 2080.
- Liveness: exact ready, first-frame, asset-loaded and 300-frame markers; 300 frames in
  9,203 ms with no `TN_NATIVE_START_FAILED`, validation error or `TypeError`.
- Asset reads: `native-proof.png` (150 bytes) and `native-proof.glb` (624 bytes) came from
  the embedded bundle with no network fallback.
- Screenshot: 1280×720, 49,979 colors and 963 cyan proof-asset pixels; SHA-256
  `9c00d1364e6789bbb5cb28c91a9751f9ef7441c21a8e4fa8600fbef14129d962`.
- Negative control: repackaging the same bundle without `--assets` emitted
  `TN_NATIVE_START_FAILED:...native-proof.png` and never emitted the asset-loaded marker.

The starter's OGG pickup playback was not exercised by this visual gate; the host logged
its pre-existing unsupported-decode path. This row does not claim audio parity. The new
`starter-linux` workflow job rebuilds this same scaffold and retains its log, screenshot and
JSON report.

## Stability contracts without a display — 2026-08-24 (PRD-210)

`native:verify:desktop` gained a third proof ahead of the display-dependent ones:

```sh
node scripts/verify-desktop-stability.mjs
```

It builds and runs three executables that link the real runtime and open no window, no GPU and
no audio device beyond SDL's dummy driver:

- `threenative-crash-handler-policy-test` — stands a `sigaction`/`SA_SIGINFO` handler in for
  debuggerd, applies each crash policy, and reads the disposition back. The Android policy must
  leave the stand-in in place; the desktop policy must replace it, which is the negative control
  and is exactly what every platform used to do.
- `threenative-wgpu-null-handle-test` — forks a child that hands a NULL encoder to the real
  `wgpuCommandEncoderBeginRenderPass`, reports the signal that killed it, then proves the checked
  path throws to JavaScript naming the operation. Ran on Linux x64 against Dawn: the child died
  with `Segmentation fault (signal 11)`; the checked path threw
  `TN_WGPU_NULL_HANDLE: device.createCommandEncoder returned no handle (label=frame)`.
- `threenative-lifecycle-policy-test` — drives the SDL lifecycle transition table, the paused
  flag, the `TN_LIFECYCLE` markers, the `display.backgroundMode` override and the host-side
  AudioContext registry, and pushes a real event through SDL so the watch is exercised on SDL's
  own send path.

All three passed on Linux x64, V8 13.1.201.22, Dawn, preset `tn-linux`. The desktop preset carries
V8 alone, so QuickJS and JavaScriptCore report `SKIP … not compiled into this build` — a skip, not
a pass. Evidence and the open device rows:
[`../../../docs/verification/prd-210-2026-08-23.md`](../../../docs/verification/prd-210-2026-08-23.md).

