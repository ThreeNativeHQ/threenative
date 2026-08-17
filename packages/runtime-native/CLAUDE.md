<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — @threenative/runtime-native

Read `/AGENTS.md` first. This file covers only what is different here. This package is the
native half of the "web and native are one codebase" rule stated there.

## Product contract

A native-first Three.js games runtime with no Chromium, WebView, Electron or Tauri WebView.
It is **a host, not a renderer**: upstream Three.js `WebGPURenderer` stays the primary
renderer, at exactly the workspace catalog version. Runtime internals may keep Mystral names
recognizable during the fork, but public contracts expose ThreeNative names.

Targets: browser/upstream Three.js, Windows/macOS/Linux V8+Dawn, Android QuickJS+wgpu-native,
iOS JSC+wgpu-native. The JavaScript runtime that owns `THREE.Scene` also owns the renderer —
never mirror the `Object3D` tree across threads. Heavy systems use native/GPU/thread
architectures and batched transfer surfaces.

**Android's engine is a choice, and it is the only platform on an interpreter without a JIT.**
The default is still QuickJS — smallest to integrate, no special runtime deps — and
`-PthreenativeJsEngine=v8` builds the same source against `third_party/v8-android` instead.
Do not read the default as a verdict: on a Pixel 8, 16 384 moving cubes, QuickJS spends
115.64 ms per frame in script and V8 spends 5.25 ms, and the frame goes from 119.19 ms to
8.32 ms — inside one 120 Hz interval, against Godot's 39.27 ms on the same scene and device
(`docs/PRDs/done/PRD-118-android-js-engine.md`). The V8 side of that was retaken charged on
2026-08-16 at both 4,096 and 16,384 and did not move;
`docs/verification/prd-118-charged-retake-2026-08-16.md` is the record. The **QuickJS** figures at
16,384 are still PRD-117's originals — the QuickJS archive on hand runs one rung, so only 4,096 was
retaken there. V8 costs +25.6 MB of arm64
payload, which is why the default has not moved; that is an owner decision, not a technical
blocker. Selecting V8 requires the shared STL (`libc++_shared.so`), the external startup
snapshot in `assets/v8/`, and pointer-compression defines that must match the prebuilt
library rather than the host's preference.

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
