# G3 — mobile bring-up

**Milestones:** M5, M6
**State:** Android emulator `@threenative/core` catalog-parity proof PASS; iOS has no
execution evidence.

## Android arrival evidence — 2026-08-08

- QuickJS + wgpu-native launched on the x86_64 emulator and packaged both required ABIs.
- Launch, exact marker, liveness, clean-log and screenshot gates passed for the upstream
  Three.js cube.
- That proof used runtime Three.js 0.182.0, while the workspace catalog is 0.185.1.
  Framework/catalog parity therefore remains OPEN.

## Android framework absorption evidence — 2026-08-08

Command:

```sh
node packages/runtime-native/scripts/verify-android-first-proof.mjs --device emulator-5554
```

- Built the unchanged public-API entry `examples/native-smoke/src/main.ts` through
  `@threenative/core`; catalog and installed Three.js were both exactly `0.185.1`.
- The x86_64 emulator logged, in order, `TN_NATIVE_SMOKE_THREE:0.185.1`,
  `TN_NATIVE_SMOKE_READY:webgpu`, `TN_NATIVE_SMOKE_FIRST_FRAME`, then
  `TN_NATIVE_SMOKE_300_FRAMES:300`. The fail-closed scan found no JS, WebGPU validation,
  shader or fatal-process errors, and PID 8016 stayed live for the 3,000 ms stability gate.
- Android bundle SHA-256:
  `9e1dc47d98f744d5c8a5f1dc70a9b16480b11f5683db0ff6176a196390e3f8bb` (1,488,327
  bytes). Its metadata records core source SHA-256
  `85c513e68ba434075d50c8da2337018bc65339caa2e5890ccd120fa634174e5b`.
- Nonblank 1080x2400 screenshot SHA-256:
  `f4787ba31c9dcf6f5521d3b4d5b71fd77dcda4c24fe5c29fbd7e4acc30ba00a5` (29,074
  bytes). The report, logcat and PNG are under ignored `artifacts/android/`.

This closes the Phase 2 Android catalog-version and 300-frame core-smoke row. It does not
close lifecycle/device playtest, native physics, iOS, or physical-device evidence.

## Open rows

- iOS simulator build, install, launch, unified logs and nonblank screenshot.
- Physical Metal/Vulkan driver behavior, arm64 physics and phone frame rate.

No row in this file permits a “mobile ready” claim while any open row remains.
