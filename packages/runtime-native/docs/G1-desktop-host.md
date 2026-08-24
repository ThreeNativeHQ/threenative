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

## Ogg Vorbis decode — 2026-08-23

`decodeAudioFile` was one call to `SDL_LoadWAV_IO`, so RIFF/WAVE was the only container any
native target could read. That is the "pre-existing unsupported-decode path" the starter row
above records, and it is not Android-specific — desktop simply never noticed, because every
audio proof here fed a WAV built inline. PRD-211 Phase 1 vendors `stb_vorbis.c` through
`scripts/download-deps.mjs`, compiles it once in `src/audio/vorbis_impl.c`, and sniffs `OggS`
ahead of SDL.

```sh
pnpm native:build
node scripts/verify-desktop-audio.mjs           # V8, the shipping desktop preset
node scripts/verify-desktop-audio.mjs --dual    # V8 + QuickJS, the Android rollback engine
```

- `threenative-audio-decode-ogg-test` decodes `tests/fixtures/pickup.ogg` — a genuine Ogg
  Vorbis file from this repository, 8,820 frames of mono at 44,100 Hz — through the installed
  `AudioContext.decodeAudioData`, and asserts audible PCM rather than a buffer of silence.
- **Passed on V8 and on QuickJS.** JavaScriptCore is reported skipped, not passed: this build
  carries no JSC, and a build carrying no engine at all fails rather than reporting a pass.
- Negative controls in the same executable: a truncated Ogg and an `OggS` header over corrupt
  bytes both reject with an `Error`, the same loud class an `SDL_LoadWAV_IO` failure produces.
  An Ogg carrying Opus fails the same way — the container is not the codec, and this runtime
  implements Vorbis only.
- `targetSampleRate` was accepted by `decodeAudioFile` and never read, and
  `AudioBufferSourceNode::process` does no rate conversion, so a buffer kept at its own rate
  played at `bufferRate / contextRate` speed. It is now honoured for every container: a
  22,050 Hz asset decoded on a 44,100 Hz context comes back 44,100 frames long instead of
  22,050, proved in the same executable.
- Not claimed: any device. The Android and iOS halves of this decoder are the same source file
  and are compiled by the same lists, but no phone ran it.
  `docs/verification/prd-211-phase1-2026-08-23.md` names what is still open.

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
  own send path. Since 2026-08-23 it also covers the **surface revalidation** resume queues in both
  modes, and the `debug.threenative.skip_surface_revalidate` control that reinstates the pre-fix
  resume. It was failing at `c3ae3b26` — the retreat to `backgroundMode: "continue"` left the
  default asserted by section 2 disagreeing with the default the reset installs — and passes again
  now that the default is `"pause"`.

All three passed on Linux x64, V8 13.1.201.22, Dawn, preset `tn-linux`. The desktop preset carries
V8 alone, so QuickJS and JavaScriptCore report `SKIP … not compiled into this build` — a skip, not
a pass. Evidence and the open device rows:
[`../../../docs/verification/prd-210-2026-08-23.md`](../../../docs/verification/prd-210-2026-08-23.md).

**Surface revalidation on resume** (2026-08-23). `webgpu::Context::rebuildSurface()` swaps the
`WGPUSurface` against a new native window while keeping the adapter, device and queue, and
`webgpu::detachSurfaceForRebuild()` / `webgpu::republishSurface()` move `g_surface` with it. Both
are named here because the other half of the repository is entitled to rely on them: a present
after a resume reads the republished surface, and nothing else in the host may hold the old one.
Desktop is a deliberate no-op — a desktop window survives a minimize — so this changes nothing
about the desktop gate; it is proven on a physical Pixel 8 in
[`../../../docs/verification/resume-presents-2026-08-23.md`](../../../docs/verification/resume-presents-2026-08-23.md).
