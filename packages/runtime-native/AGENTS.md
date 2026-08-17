# AGENTS.md — @threenative/runtime-native

Read `/AGENTS.md` first. This file covers only what is different here. This package is the
native half of the "web and native are one codebase" rule stated there.

## Product contract

A native-first Three.js games runtime with no Chromium, WebView, Electron or Tauri WebView.
It is **a host, not a renderer**: upstream Three.js `WebGPURenderer` stays the primary
renderer, at exactly the workspace catalog version. Runtime internals may keep Mystral names
recognizable during the fork, but public contracts expose ThreeNative names.

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

Native bundles enter through the project's declared `threenative.nativeEntry` (default
`src/game.ts`), which must default-export the game. `TN_NATIVE_ENTRY_MISSING` and
`TN_NATIVE_ENTRY_NO_DEFAULT` are entry-contract failures; `TN_NATIVE_WEB_ONLY_UI` means the
portable graph reached browser UI; `TN_NATIVE_WASM_ON_MOBILE` means Android or iOS reached
WASM. Do not weaken these guards. Every packager stages `public/` beside the game bundle,
and a missing runtime asset must reject game startup rather than fall back to the network.

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

Report what ran. Desktop and the **iOS simulator** are green — the simulator lane runs on the
hosted `macos-15` runner and `verify-ios-simulator.mjs` pins it to a `SimRuntime.iOS-*` device,
because before 2026-08-11 it silently selected an Apple Vision Pro. Physical hardware and
performance parity are open. Never write mobile-ready while those rows are open.
