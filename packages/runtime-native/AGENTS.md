# AGENTS.md — @threenative/runtime-native

Read `/AGENTS.md` first. This file only covers what is different here.

## Product contract

ThreeNative is a native-first Three.js games runtime with no Chromium/WebView/Electron/Tauri
WebView. Upstream Three.js `WebGPURenderer` remains the primary renderer; this program must
not introduce a custom C++ renderer or deep Three.js fork. Runtime/native may keep Mystral
internals recognizable during the fork, but public contracts should expose ThreeNative
names and concepts.

Official targets: browser/upstream Three.js, Windows/macOS/Linux V8+Dawn, Android
QuickJS+wgpu-native bootstrap, and iOS JSC+wgpu-native bootstrap. Heavy systems must use
native/GPU/thread architectures and batched transfer surfaces. The JavaScript runtime that
owns `THREE.Scene` also owns the renderer; do not mirror the `Object3D` tree across threads.

Ordering: correctness → compatibility → platform stability → threading → native systems →
DX → profiling → optimization.

## Non-goals before evidence

No custom renderer, no deep Three.js fork, no native GLTF replacement for JavaScript
`GLTFLoader`, no mandatory ECS/React/editor/multiplayer, no optimization fast paths before
profiling evidence, and no claims for unexecuted platforms.

## Package boundaries

- `third_party/`, `build/`, `.runtime/`, and `artifacts/` stay untracked.
- `scripts/download-deps.mjs` is the only supported dependency reconstruction path.
- Native compilation is opt-in through `pnpm native:build`; the default repository gate
  must not require CMake, an NDK, or Xcode.
- Deprecated native GLTF files are retained only as upstream history and must remain
  disabled. Use upstream JavaScript `GLTFLoader`.
- Update the five files in `docs/` when a native evidence run changes a gate.
