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
  `a7c721841124ff570c1392cf5e3922acbd1cf3bca2efc7d781ccdd2a003185d6` (1,502,284
  bytes). Its metadata records core source SHA-256
  `6c2a4a440d553a395a9c5d23575eb482589781c9ad042b06a3e43fc005cb57b0`.
- Nonblank 1080x2400 screenshot SHA-256:
  `4c6102448e796f871261c394a73e0ebc3f07088bdaa751273be6f0e7d0a17c89` (30,977
  bytes). The report, logcat and PNG are under ignored `artifacts/android/`.

This closes the Phase 2 Android catalog-version and 300-frame core-smoke row. It does not
close native physics, iOS, or physical-device evidence.

## Android lifecycle and device proof — 2026-08-08

- One unchanged scenario passed in Chromium and on `emulator-5554` through the native adb
  mailbox transport.
- The wrong projected-pixel value failed with exit 1. A bridge-disabled APK failed
  `TN_PLAYTEST_BRIDGE_MISSING` with exit 2. The misspelled assertion failed schema validation
  with exit 2 before launch.
- A network assertion failed explicitly unsupported with exit 2; no assertion was skipped.
- The bridge-disabled bundle is selected by `THREENATIVE_PLAYTEST_BRIDGE=disabled`; the final
  installed APK and recorded 300-frame report use the normal bridge-enabled bundle.

This closes the PRD-047 Phase 3 Android emulator row. It does not prove physical-device
transport or any physics behavior.

## Open rows

- iOS simulator build, install, launch, unified logs and nonblank screenshot.
- Physical Metal/Vulkan driver behavior, arm64 physics and phone frame rate.

No row in this file permits a “mobile ready” claim while any open row remains.

## iOS scaffold and transport implementation — 2026-08-08

The repository now has a root-linked `threenative-ios.app` CMake target. Its game source is
the exact import-free `examples/native-smoke/dist/native-smoke.js` bundle used by desktop
and Android. The Objective-C++ entry configures the same native playtest mailbox; it adds no
WebView, custom renderer, or iOS-only scenario format.

`verify-ios-simulator.mjs --check` passes on Linux and validates the target, plist, shared
bundle link, Metal requirement, and mailbox wiring. Executable mode is macOS-only and fails
explicitly elsewhere. `xcrun` is unavailable here, so build, install, launch, unified-log
markers, nonblank screenshot, and simulator negative controls remain **UNEXECUTED**.

The executable verifier also builds the Rust physics archive for
`aarch64-apple-ios-sim`, enables the native CMake binding, and rebuilds the exact shared
bundle for normal, masked, and wrong-gravity controls. It runs the normal physics pass,
wrong-height failure, mask-against-normal failure, masked pass, and wrong-gravity failure
through the iOS device driver. Contract tests prove those steps stay wired; none is called a
pass until a macOS runner executes them.

## Prebuilt simulator consumer handoff — implementation only

The producer archives that unsigned, physics-enabled arm64 simulator `.app` only after the
verifier scenarios pass. `package-ios.mjs` consumes the `ios-simulator-arm64` checksum-lock
entry, replaces only the embedded `native-smoke.js`, and rejects corrupt archives,
non-`darwin-arm64` hosts, and device/signing requests. The CLI therefore needs no CMake,
Xcodebuild, or Rust in the consumer.

Both native workflows contain a packed-scaffold proof with those toolchain commands masked;
the release lane additionally launches core and native-physics pass/failure scenarios from
the repackaged `.app`. Those lanes remain **UNEXECUTED** until the workflow reaches GitHub.
