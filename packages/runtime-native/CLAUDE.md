<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — @threenative/runtime-native

Read `/AGENTS.md` first. This file covers only what is different here. This package is the
native half of the "web and native are one codebase" rule stated there.

## Product contract

A native-first Three.js games runtime that ships no Chromium, and is not Electron or a Tauri app.
It is **a host, not a renderer**: upstream Three.js `WebGPURenderer` stays the primary
renderer, at exactly the workspace catalog version.

**The scene never enters a web view; the UI may.** As of PRD-217 a game can render `src/ui/`
through the platform's own browser-class renderer — a transparent `WebView` composited over the
game surface — so one `src/ui/` runs unchanged on web and native. That is the platform's browser,
attached at the composition layer, not a browser this package ships: measured free on a Pixel 8,
and about 6% of one game's memory in a process the OS can reclaim. `ui.renderer: "native"` is the
opt-out and ships no overlay and no extra process. `TnUiOverlay` owns the input hit test; the
contract is in `include/mystral/platform/ui_overlay.h` and `@threenative/core/ui-layer`.

Runtime internals may keep Mystral names recognizable during the fork, but public contracts expose
ThreeNative names.

Targets: browser/upstream Three.js, Windows/macOS/Linux V8+Dawn, Android V8+wgpu-native,
iOS JSC+wgpu-native. The JavaScript runtime that owns `THREE.Scene` also owns the renderer —
never mirror the `Object3D` tree across threads. Heavy systems use native/GPU/thread
architectures and batched transfer surfaces.

**Android runs V8 by default as of 2026-08-16 (PRD-130), and `-PthreenativeJsEngine=quickjs` is the
documented rollback.** It was QuickJS while nothing had measured that choice. Measured, on a Pixel 8
at 16 384 moving cubes: QuickJS 101.24 ms per frame against V8's 8.34 ms, and the V8 figure is the
120 Hz vsync interval rather than its real cost, so 12× is a lower bound
(`docs/verification/prd-130-phase-6-2026-08-16.md`). iOS is the one platform still on an engine
without a JIT, by construction.

Three files state that default — `CMakeLists.txt`'s Android platform block,
`android/app/build.gradle.kts`, and the `tn-android` CMake preset — and a test fails if they
disagree. Selecting V8 requires `third_party/v8-android`, which `scripts/download-deps.mjs --android`
provisions with a pinned checksum; the shared STL (`libc++_shared.so`); a startup snapshot staged
**per ABI**, since the blobs differ and an ABI without one fails the build; and pointer-compression
defines that match the prebuilt library rather than the host's preference.

**The prebuilt path carries both engines** as of PRD-130 Phase 4: `android-<abi>-runtime-v8`,
`android-<abi>-v8`, `android-<abi>-libcxx` and `android-<abi>-v8-snapshot` beside the unqualified
QuickJS keys, which still mean QuickJS. The runtime binary is engine-qualified because it genuinely
differs — QuickJS is compiled into it and V8 is not — so one runtime for both engines would report
the wrong engine at runtime. A prebuilt directory populated for one engine and built for the other
fails naming both. **The release lane that publishes these has not run**: no tag was pushed, and this
repository has zero surviving releases across ten tags (PRD-078).

Priority order: correctness → compatibility → platform stability → threading → native systems
→ DX → profiling → optimization.

## Non-goals until evidence says otherwise

No custom C++ renderer, no deep Three.js fork, no native GLTF replacement for the JavaScript
`GLTFLoader` (the deprecated native GLTF files stay disabled, retained only as upstream
history), no mandatory ECS/React/editor/multiplayer, no optimization fast path before
profiling evidence, and no claim for a platform that has not executed.

## The host surface is a contract with the TypeScript side

Every global this runtime installs is something framework code is allowed to use, and
everything else is a native break waiting to happen. `document` and `window` are **Three.js
compatibility stubs** — `body.appendChild` is a no-op, `createElement('canvas')` returns a
fake. Widening that stub to make a web-only feature work is the wrong fix; the fix is in the
TypeScript package.

When you add a shim, say so in the owning gate doc so the other half of the repo can rely on
it. When you remove or narrow one, grep `packages/*/src` first.

The machine-readable inventory is [`shim-manifest.json`](./shim-manifest.json). It records each
global installed by the native host and every deliberate allowlist exception with its reason;
`pnpm budgets` runs the checker against `packages/{core,ui,playtest}/src` so this manifest is the
enforced contract, not a second prose-only list.

Native bundles enter through the project's declared `threenative.nativeEntry` (default
`src/game.ts`), which must default-export the game. `TN_NATIVE_ENTRY_MISSING` and
`TN_NATIVE_ENTRY_NO_DEFAULT` are entry-contract failures; `TN_NATIVE_WEB_ONLY_UI` means the
portable graph reached browser UI; `TN_NATIVE_WASM_ON_MOBILE` means Android or iOS reached
WASM. Do not weaken these guards. Every packager stages `public/` beside the game bundle,
and a missing runtime asset must reject game startup rather than fall back to the network.

**Mobile has no compressed-asset decoders.** Android QuickJS and iOS JSC have no WASM engine,
so three's Basis/zstd transcoder (`KTX2Loader`), its Meshopt decoder and Draco's wasm decoder
cannot run there. `scripts/bundle.mjs` replaces all three with refusing stubs on the mobile
targets only — desktop keeps the real ones — which is what keeps a game that ships no
compressed asset out of `TN_NATIVE_WASM_ON_MOBILE`; their specifiers are static strings inside
`await import(...)`, so a bundler inlines them whether the game uses them or not. A game whose
compiled assets do need one is refused by `threenative build` before any bundle exists, with
`TN_NATIVE_KTX2_UNSUPPORTED` or `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED`. Making mobile decode
either format is a native decoder question, not a bundler one.

## Package boundaries

- `third_party/`, `build/`, `.runtime/` and `artifacts/` stay untracked; a tracked file under
  `third_party/` fails `pnpm budgets`.
- `scripts/download-deps.mjs` is the only supported dependency reconstruction path.
- Native compilation is opt-in via `pnpm native:build`. The default repository gate must not
  require CMake, an NDK, or Xcode.
- A native runtime tree anywhere but this package is a hard budget failure.

## Gates and evidence

`docs/G1-desktop-host.md` … `G5-profiling.md` are the evidence record. Update the affected
file whenever a native run changes a gate — a gate result that lives only in a commit message
does not exist.

```sh
pnpm native:build                             # download deps + compile
pnpm native:verify:desktop                    # 300 frames, markers, non-blank screenshot
node conformance/run-conformance.mjs          # same scene, browser reference vs native
```

`conformance/registry.json` is the versioned public test registry: a row that was not
selected by `--only-tests` is reported **blocked**, never passed and never omitted. Keep it
that way.

Report what ran, per platform, and never write mobile-ready while a row below is open.

- **Desktop** — green.
- **iOS simulator** — green on the hosted `macos-15` runner; `verify-ios-simulator.mjs` pins a
  `SimRuntime.iOS-*` device because before 2026-08-11 it silently selected an Apple Vision Pro.
- **Android on a physical phone** — executed: PRD-130's engine comparison and later render work were
  measured on hardware, not only on an emulator.
- **Android emulator** — a separate result from the phone, and the two have disagreed. A green on
  one does not carry to the other; say which you ran.
- **iOS on physical hardware** — open. arm64 with real Metal, signing, touch input, thermal and
  battery still need a phone.
- **Android 16 KB pages** — open, and blocked upstream rather than here. Android 15+ can run with
  16 KB memory pages, where a 4 KB-aligned shared library cannot be loaded at all; the system warns
  on 4 KB devices with a modal dialog over the game that names each offending library. Everything
  this repository controls is aligned — `libmystral-runtime.so` by a link option, `libSDL3.so` by
  the 3.2.30 pin. `libv8android.so` is not: it is a prebuilt whose newest upstream release predates
  the requirement, so the V8 default cannot be 16 KB-clean until that changes or V8 is built here.
  `-PthreenativeJsEngine=quickjs` ships no V8 at all.

## Device lanes, before you record one as unavailable

**Confirm which package you are about to launch.** A game's applicationId comes from its
`threenative.config.ts` (`app.id`), not from its directory name, and a device that has been used for
this work usually carries several ThreeNative installs — conformance harnesses, first-proof builds
and real games, each under its own package. Launching the wrong one does not fail: it renders a
plausible scene at a plausible frame rate and answers a question you did not ask. Read `app.id`, or
`aapt dump badging` the APK you just built, before `am start`; and after installing, verify the APK
actually carries your change (`strings` the packaged `.so` for a native marker, grep the staged
bundle for a JS one) rather than trusting that the build recompiled.

`adb` and the Android SDK are frequently installed but off `PATH`; export `ANDROID_HOME` and call
the SDK's `platform-tools/adb` directly before concluding a device lane cannot run here. Wi-Fi ADB
(`adb tcpip 5555`) is how a device stays **discharging** while you drive it, which the benchmark
preflight requires — a cable makes the run fail its own gate. Gradle and Kotlin want **JDK 17**;
newer JDKs abort with an `IllegalArgumentException` naming the version, which reads like a code
error and is not one. And confirm the app is in the foreground before `adb shell screencap`: a blind
capture returns whatever the owner has on screen.
