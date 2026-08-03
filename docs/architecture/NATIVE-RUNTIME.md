# Native runtime

**Status:** research resolved, implementation unstarted. **Charter authority:**
`CHARTER.md` §6b, §7.

## The path

```
Shared TypeScript game code
        ├── browser WebGPU ──────────────► web
        └── react-native-webgpu / Dawn ──► Metal (iOS) / Vulkan (Android)
```

One codebase. The renderer bootstrap in `packages/core/src/renderer.ts` already isolates
this: `createRenderer()` takes `webgpuFactory` and `webgl2Factory` overrides and returns a
`RendererLike` with `domElement`, `kind`, `raw`, `render`, `setSize`, `dispose`. The RN
adapter is a factory, not a fork.

## Why physics needs a native binding

Rapier ships as WebAssembly. WASM is not viable across React Native's JS engines:

| Engine | WebAssembly | Evidence |
|---|---|---|
| **Hermes** (RN default) | **No, and never** | `facebook/hermes#429`, open since 2020-12-04. Maintainer, 2023-10-04: adding a Wasm interpreter or JIT "does not fit with the goals of the project" |
| **JSC, iOS 18.4+** | **Yes**, unverified in RN | WebKit removed the JIT gate in `b01e7b6920` (2025-02-17); wasm runs on the IPInt interpreter. RN's `React-jsc.podspec` uses `weak_framework "JavaScriptCore"`, so RN inherits it free. Nobody has empirically confirmed it in an RN app |
| **JSC, iOS ≤18.3** | No | `safari-7620-branch`: `if (!useWasm() \|\| !useJIT()) disableAllWasmOptions();` |
| **JSC, Android** | **No, deliberately** | `jsc-android-buildscripts/scripts/compile/jsc.sh:62` passes `--no-webassembly`. Pinned to WebKitGTK 2.26.4 (2019). Issue #113 still open |

Three further findings: `WebAssembly.instantiateStreaming` does not exist in bare JSC
(ArrayBuffer path only); where wasm does run it is **interpreter-tier throughput**, wrong
for a 60 Hz step; and every workaround library is dead — `react-native-webassembly`
(abandoned 2023-11), `polygen` (stalled, iOS-only), `react-native-wasm` (archived).

Best case is "maybe on iOS 18.4+, definitely not on Android, at interpreter speed." That
is not a foundation.

> **`@threenative/physics-native`: a JSI binding to Rapier's Rust.** Not a fallback — the
> only path. Nobody else ships it, which makes it the single strongest reason ThreeNative
> exists.

## Thread and process split

```
┌────────────────────────────────────────────┐
│ React Native / web UI runtime              │
│ HUD, menus, navigation, accessibility      │
└──────────────────┬─────────────────────────┘
                   │ bounded semantic events
                   ▼
┌────────────────────────────────────────────┐
│ Game runtime                               │
│ scenes, entities, Three.js, fixed loop     │
└────────────┬───────────────────┬───────────┘
             ▼                   ▼
┌─────────────────────┐  ┌─────────────────────┐
│ Native simulation   │  │ WebGPU compute      │
│ physics, nav, casts │  │ particles, culling  │
└─────────────────────┘  └─────────────────────┘
```

## Both boundaries must be coarse

**UI boundary — already built this way.** `createGameStore` coalesces writes and flushes
on an interval (default 100 ms), so `ctx.state.set()` may run at 60 Hz while React
re-renders at ~10 Hz through `useSyncExternalStore`. React receives small semantic events:

```ts
type GameUIEvent =
  | { type: "health-changed"; health: number }
  | { type: "coins-changed"; coins: number }
  | { type: "pause-requested" }
  | { type: "game-over"; score: number };
```

Never thousands of transforms per frame. React renders the HUD; it never touches
`THREE.Scene`.

**Native boundary — design it the same way.** Bulk in, bulk out:

```ts
simulation.step(deltaTime, inputSnapshot);
simulation.readVisibleTransforms(renderBuffer);
```

Not:

```ts
for (const entity of entities) nativePhysics.setPosition(entity.id, entity.position);
```

Otherwise the JS↔native crossing becomes the next bottleneck, and the binding that was
supposed to buy performance spends it back per call.

## Spikes, in order

**0a — rendering (~1 day).** Spinning cube via `three/webgpu` under `react-native-webgpu`
on a physical phone. Ugly, unstyled, no template, no CLI, no docs. It answers whether
Three.js's WebGPU path survives outside a browser at all.

**0b — physics (~1–2 weeks).** `@threenative/physics-native` via JSI, enough to drop a
cube onto a plane in the same scene.

If 0a fails, ThreeNative is a web framework and §7's mobile promise is deleted. If 0b
fails, mobile ships without physics, or not at all. Either way it is learned in three
weeks rather than 790k lines.

## Explicitly not doing

A second full rendering backend maintained in parallel. Dual-renderer parity is a
permanent ~2x tax on every feature — in v1, 32% of 1,707 commits went to a runtime no
benchmark ever measured. Prove the react-native-webgpu path first; add native modules
only where profiling shows a genuine need.
