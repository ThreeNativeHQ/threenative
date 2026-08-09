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
SDL_VIDEODRIVER=x11 xvfb-run -a -s '-screen 0 1600x900x24' \
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
