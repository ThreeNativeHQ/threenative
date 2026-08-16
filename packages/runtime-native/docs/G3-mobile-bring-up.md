# G3 — mobile bring-up

**Milestones:** M5, M6
**State:** Android emulator and physical-orientation proof PASS; iOS has no execution
evidence.

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

- Built the unchanged public-API entry `examples/native-smoke/src/game.ts` through
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

## Android toon-material abort, and the wgpu-native bump that fixes it — 2026-08-09

Found by porting a real 1,950-line Three.js platformer (`fox-game`) into a scaffolded
`minimal` project and running it on the x86_64 emulator. The game reached
`TN_NATIVE_SMOKE_FIRST_FRAME` and then died with `signal 6 (Aborted)` roughly half a second
later, with **no logcat output at all**, no tombstone, and no `TN_NATIVE_START_FAILED`.

Bisected on the emulator, one variable per run. Alive and rendering: `MeshStandardMaterial`,
`MeshToonMaterial` with a `gradientMap`, the vertex-coloured sky dome, the full 40-mesh fox
rig, and an unlit `MeshBasicMaterial` with a `DirectionalLight` in the scene. Aborted:
`MeshToonMaterial` **with** a `gradientMap` **and** any punctual light (`DirectionalLight` or
`PointLight`). Dropping the `gradientMap` from that same material made it survive.

Reproduced off-device by building the Linux host against wgpu-native instead of Dawn
(`-DMYSTRAL_USE_WGPU=ON -DMYSTRAL_USE_DAWN=OFF`), which prints what Android swallowed:

```
Shader validation error: Entry point main at Fragment is invalid
120 │ nodeVar7 = textureLoad( nodeUniform10, vec2<u32>( ... ), u32( 0 ) );
    = Image sample or level-of-detail index's type of [153] is not an integer scalar
thread '<unnamed>' panicked at src/lib.rs:598:5:
Error in wgpuQueueSubmit: Validation Error
```

That is the toon ramp lookup Three.js 0.185.1 emits for `gradientMap`. The naga in
wgpu-native **v24.0.3.1** (March 2025) rejects it; `wgpuQueueSubmit` then calls
`handle_error_fatal`, which panics and aborts the process. Dawn accepts the same WGSL, which
is why desktop was green throughout.

Two fixes, both in this commit:

- **`scripts/download-deps.mjs` pins wgpu-native v25.0.2.2** for desktop, Android and iOS.
  It compiles with no source changes (the modern-header path was already in place). On the
  Linux wgpu host the failing scene goes from four validation errors plus an abort to 300
  clean frames. On the emulator the whole platformer now renders — sky, cliffs, waterfalls,
  bridge, coins, castle — stays alive, and moves the player in response to injected
  `KEYCODE_DPAD_RIGHT` events.
- **`src/webgpu/context.cpp` logs device errors through `__android_log_print`.** The
  Dawn/modern-wgpu `onDeviceError` only wrote to `std::cerr`, which goes nowhere on Android,
  so a validation error produced a completely silent abort. Adapter and device request
  failures were equally invisible and now log too. `tests/webgpu-error-visibility.test.mjs`
  fails if either backend callback shape loses its platform log again.

Still open, and not claimed here: iOS (no Apple hardware available), physical Metal/Vulkan
driver behavior, arm64 physics and phone frame rate. The portrait/landscape framing row is
closed by the physical-device proof below.

## Android generated-asset integrity evidence — 2026-08-09

Command, run twice against the same booted emulator:

```sh
THREENATIVE_ANDROID_SDK="${ANDROID_SDK_ROOT:?set ANDROID_SDK_ROOT}" \
  node packages/runtime-native/scripts/verify-android-first-proof.mjs \
  --device emulator-5556
```

- Android assets now live under Gradle's modeled `build/generated/threenative/assets`
  directory instead of the source tree. The source set consumes only that generated root.
- The gate extracts `assets/scripts/main.js` from the assembled APK and fails before install
  unless its SHA-256 matches the generated bundle metadata.
- The first run rebuilt and passed. The second run reported both the bundle task and
  `mergeDebugAssets` `UP-TO-DATE`, then passed the same extraction check, all four lifecycle
  markers, 300 frames, clean logs, a nonblank 1080x2400 screenshot, and the 3,000 ms
  liveness window.
- Generated and packaged bundle SHA-256 were both
  `d515e339730d1a8c46d2e9b96f111b07bac2a924053fadf76303b5d7bdf38856`.

This closes the stale Gradle asset-cache hole in the source-emulator proof. It does not
close the released-consumer or physical-device rows.

## Android game-declared orientation — PASS, 2026-08-10

The fox-native portable entry was bundled and packaged twice with the current Android
packager, once with `--orientation portrait` and once with `--orientation landscape`:

```sh
JAVA_HOME="${JAVA_HOME:?set JAVA_HOME}" \
ANDROID_HOME="${ANDROID_SDK_ROOT:?set ANDROID_SDK_ROOT}" \
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:?set ANDROID_SDK_ROOT}" \
node scripts/package-android.mjs \
  --bundle /tmp/fox-orientation/probe.js \
  --assets "${FOX_NATIVE_PUBLIC:?set FOX_NATIVE_PUBLIC to the fox-native public directory}" \
  --orientation portrait --output /tmp/fox-orientation/probe-portrait.apk
```

The same command was repeated with `landscape` and a separate output path. `aapt2` read
`android:screenOrientation=1` from the portrait APK and `=0` from the landscape APK. The
source manifest had no hard-coded screen orientation after either package completed.

On physical Pixel 8 serial `37251FDJH0037Z`, the portrait run logged
`TN_PROBE_VIEWPORT 1080x2400` and the landscape run logged
`TN_PROBE_VIEWPORT 2400x1080`. The corresponding clean game screenshots are reviewer-visible
at these exact lane-relative paths and remain ignored/untracked:

- `packages/runtime-native/artifacts/android/prd-067-portrait.png`: 1080x2400, SHA-256
  `596ff5be94ade89455186431069e515c3cb6ca54f5bb1e226f58fed8f44bf682`.
- `packages/runtime-native/artifacts/android/prd-067-landscape.png`: 1080x2400 raw
  `adb screencap` capture, SHA-256
  `39227d18a6e12a857dede45a3f2ba163bb21aebfab71cc7e4738a0f8c98e2199`.

The raw capture remains 1080x2400 because the device display is physically portrait; the
landscape app surface and the viewport marker are 2400x1080. Android also showed its
existing 16 KB compatibility warning for the native libraries; it was dismissed for the
clean captures and is outside this orientation change.

The iOS packager accepts the same orientation field and rewrites
`UISupportedInterfaceOrientations`; its contract tests pass. No Apple host, simulator or
device was available, so iOS execution is **UNEXECUTED**.

## PRD-067 app config contract — implementation evidence, 2026-08-11

`threenative.config.ts` is now the single typed project surface for app identity, display,
desktop window, icon and the portable native entry. The loader applies the no-config defaults,
keeps the old `package.json.threenative.nativeEntry` fallback, and throws named errors for
invalid values or a dual entry declaration. `renderer.preferWebGPU` is wired through the
template game export into the core renderer.

The Android and iOS packager contract tests render the same declared id, name, version, build,
orientation, fullscreen, keep-screen-on, window and icon fields; the desktop staging test
embeds the window contract for the native host. The Android runtime sources no longer contain
the former framework application id or launcher label.

The config-driven identity/icon side-by-side install on physical serial `37251FDJH0037Z` is
**UNEXECUTED** in this lane. The existing orientation proof above used the packager's
orientation compatibility flag and does not substitute for the new config-driven identity
artifact proof. iOS execution remains **UNEXECUTED**; its staged contract is covered by tests.

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

## Android multi-touch proof — historical failed attempt, superseded 2026-08-09

`native:verify:android:multitouch --device emulator-5556` passed the existing 300-frame,
clean-log, screenshot, bundle-hash and process-liveness first proof, then failed closed on
the positive two-pointer scenario. The native-smoke state remained `maxPointers=0`, both
simultaneous move/jump latches stayed false, and X movement stayed zero. The one-pointer
negative control reached assertions and failed with exit code 1.

Rootless `adb emu event send` protocol-B frames were confirmed with `getevent -lt` on
`/dev/input/event2`, including slot, tracking ids, X/Y, touch-major, pressure and numeric
`EV_SYN:0:0`. Android did not promote them into SDL touch events on this API-35 AVD. After
three bounded attempts, the doubtful assumption is display-0 InputReader routing for the
emulator console's virtio touchscreen. PRD-053 therefore remains blocked and Android
multi-touch is not claimed. Full commands and hashes are in
`docs/verification/prd-053-multitouch-2026-08-09.md`.

## Android multi-touch proof — PASS, 2026-08-10

Command:

```sh
THREENATIVE_JAVA_HOME="${THREENATIVE_JAVA_HOME:?set THREENATIVE_JAVA_HOME}" \
PATH="${ANDROID_SDK_ROOT:?set ANDROID_SDK_ROOT}/platform-tools:$PATH" \
pnpm --filter @threenative/runtime-native native:verify:android:multitouch \
  --device emulator-5554
```

The exact command exited `0` after building the APK. The first proof reached 300 frames with
clean logs, captured a nonblank `1080x2400` screenshot, and kept the process alive. The
positive protocol-B scenario recorded `maxPointers=2`, `movedWithTwoPointers=true`,
`leftGroundWithTwoPointers=true`, `airborne=true`, and `currentPointers=0`. The one-pointer
negative control reached its assertions and failed with the expected exit-code-1 semantics;
positive and negative liveness both passed. The report is
`artifacts/android/multitouch/report.json`; screenshot SHA-256 is
`188bc163e12ef039448572dc66dd2d84d6fe040ab719d2fc96e2ad9a4d7d628e`.

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
