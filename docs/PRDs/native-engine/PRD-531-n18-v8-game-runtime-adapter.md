# PRD-531 — V8 game runtime adapter (N18)

**Status:** IN PROGRESS — the adapter drives the engine through the C ABI; the catalog's supported set is synced from the binding registry
**Complexity:** 4 — the first shipping game runtime over the C++ engine; lifetime and crossing cost are the hard parts
**Owner:** João
**Work package:** N18 — [native-engine batch](README.md)
**Depends on:** [PRD-500 (N03)](../done/native-engine/PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md), [N04 — lifetime and numerics](N04-lifetime-and-numerics/README.md), [PRD-508 (N06)](../done/native-engine/PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md); Phase 3 also needs [PRD-514 (N09)](../done/native-engine/PRD-514-n09-native-renderer-and-standard-materials.md)

## Context

Owner decision 2 ([PRD-497](../done/native-engine/PRD-497-n00-architecture-decision-and-compatibility-inventory.md)) makes this the first product: game TypeScript keeps running on the V8 that desktop and Android already ship (`packages/runtime-native/src/js/v8_engine.cpp`; Android defaults to V8 since PRD-130). The engine underneath it is C++. §2.1 still applies: the adapter brings no JavaScript implementation of animation, traversal, batching or materials, so the engine stays JS-free (decision 1) while the game is not yet (gate T is later). §8.2 forbids carrying 64-bit handles as plain JS numbers. §7.1 requires the adapter to take part in the lifetime protocol: callbacks that capture wrappers form cross-language cycles, and rooting them forever is not acceptable.

The CP1 checkpoint ([PRD-534](PRD-534-cp1-the-native-engine-earns-the-port.md)) measures through this adapter, because the speed claim has to hold with game code on V8.

## Solution

1. **One generator, several VMs** (decision 8). A catalog-driven generator (proposed: `packages/three-native/generator/`) emits per-VM binding code. This PRD ships the V8 back end into proposed `packages/runtime-native/src/adapters/v8/`. N19 adds the browser-JS-over-Wasm back end; JSC follows when iOS returns. Wrappers adapt names, overloads and lifetimes, and implement no engine algorithm (§8.3).
2. **Imports resolve to the bindings.** `three`, `three/webgpu` and `three/tsl` in a game resolve to generated stubs over the engine when the engine profile is `native`. Constructors keep one identity across entry points (§2.2).
3. Handles live in V8 internal fields, never in a JS number.
4. Wrappers and captured callbacks register as roots and edges with the N04c reachability layer, so a cycle through JS and native objects is reclaimed at a safe point.
5. **Crossing cost is measured, not guessed** (decision 9). A micro-benchmark counts the cost of a property write and a method call through the adapter. Bulk typed-array paths are added only where CP1 attributes frame time to crossings.
6. The adapter is its own build target; no engine target includes V8 headers (§13). Telemetry and crash reports name the game runtime (§17).
7. Rollback: the legacy engine profile stays selectable until [PRD-535 (N21)](PRD-535-n21-the-js-engine-is-deleted.md) deletes it.

## Out of scope

- The browser-JS back end ([PRD-532](../done/native-engine/PRD-532-n19-webassembly-native-core-browser-port.md)). The AOT game runtime ([N05](N05-native-typescript-qualification/README.md)).

## Execution Phases

#### Phase 1: Generated bindings
**Status:** NOT STARTED
**Files:** proposed `packages/three-native/generator/`, `packages/runtime-native/src/adapters/v8/`, `packages/runtime-native/tests/native-engine/v8_*.cpp`
- [x] The V8 back end covers every catalog entry marked supported, and nothing else. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_catalog_coverage` — 2026-10-05: green. The catalog's supported set is now synced from the binding registry: `tn-native-engine-registry-dump` prints it, `pnpm --filter @threenative/three-native sync-native-status -- --dump <json>` applies it (an untyped bound member fails the sync), and `native_engine_registry_snapshot` fails on drift. 38 classes are supported (was 0). `native_engine_v8_catalog_coverage` installs the adapter and compares its globals and every prototype with the registry and the count with `TN_CAPABILITY_COUNT`; `catalog-registry.spec.ts` compares the catalog's supported members per class with the snapshot. Red: one extra supported class fails the ctest and two spec cases. Each material class binds only the fields three declares on it (`MeshBasicMaterial` has no `roughness`)
- [x] A handle round-trips through JS without losing bits. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_handles` — 2026-10-04: green (`build/tn-linux`, V8 13.1): 2,000 handles, a third with reused slots and bumped generations, cross into JS through the wrapper's internal field and come back with type, context, index and generation intact; one wrapper per handle, so `m.makeTranslation(...) === m`; collected wrappers release their native objects. Red without the wrapper cache and without the release. `src/adapters/v8/adapter.{h,cpp}`, `tests/native-engine/v8_adapter_test.cpp`
- [x] Every engine target below the adapter has no V8 include or link. proof: `node packages/runtime-native/scripts/inspect-js-free.mjs --binary <each engine target>` — 2026-10-04: `inspect-js-free.mjs` passes every engine library in the V8 build (`libtn_engine_{abi,assets,bindings,foundation,graph,renderer,shader}.a`, `libtn_host_services.a`) and fails only `libtn_adapter_v8.a`; `native_engine_target_graph` stays green with the adapter linked, which is defined in `cmake/NativeEngineAdapters.cmake` after the JS engines

#### Phase 2: Same engine, same lifetime
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/adapters/v8/lifetime.cpp`
- [x] A JS-to-native cycle through a captured callback is reclaimed at a safe point. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_callback_cycle` — 2026-10-05: green on Dawn and ASan. Callbacks cross the ABI as `tn_set_callback(self, "onBeforeRender", invoke, context, release)`: the engine runs `onBeforeRender` before the object is drawn with three's arguments as handles (`native_engine_renderer_callback`: once per drawn frame, a colour it sets reaches that frame, a throw is a `TN_CALLBACK_FAILED` diagnostic), and releases the context exactly once (`native_engine_abi_callbacks`). The V8 adapter keeps the function on the wrapper (a JS edge) and its safe point, `Adapter::collect()`, run by the host once a frame, holds a callback-bearing wrapper while its object is attached and lets it go once detached. The test registers a closure that captures its own mesh, drops every JS reference: across a safe point and forced GCs the attached mesh's callback still runs (arguments and `this` correct, a throw comes back as a status); after `scene.clear()`, a safe point and GCs, the wrapper, the closure and the native mesh are reclaimed (its handle no longer resolves). The browser back end follows the same rule (`IBrowserEngine.collect`)
- [x] Repeated whole-runtime create and destroy shows no native object or GPU resource growth. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_runtime_churn` — 2026-10-04: green (`native_engine_v8_runtime_churn`): 50 cycles of isolate + engine context + adapter + 20,000 objects, each torn down; every object dies with its context (its handles resolve to nothing) and resident growth over the last 40 cycles is ~1 MiB, against 60 MiB when destroy leaks the context. GPU resources are not exercised until the renderer is bound
- [x] The N06 scene-semantics fixtures pass through the V8 adapter with the same results as the C++ driver. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_scene_fixtures` — 2026-10-04: green: `tn-native-engine-v8-fixture-driver` speaks the fixture protocol but runs every op as JS against the adapter's classes (`mesh.position.z = v` goes through the member alias and Vector3's setter); all 7 `scene-*` fixtures match the same goldens bit-exact (abs 0), red when the adapter's setters do nothing. Bonus `native_engine_v8_math_fixtures`: 23/26 math fixtures pass through JS; exactly three stay blocked for named C ABI reasons (Ray is not catalogued; Frustum.planes is an array of member objects), and the test fails on any new blocked or failed row

#### Phase 3: A game runs on it
**Status:** NOT STARTED
**Files:** `packages/create-threenative/` (engine profile resolution)
- [x] Per-call cost of a property write and a method call through the adapter is reported. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_crossing_bench` — 2026-10-04: `native_engine_v8_crossing_bench` prints `TN_V8_CROSSING`; first reading on this host (RTX 2080 desktop, V8 13.1, Release): property write 108 ns, method call with an object argument 365 ns, property read 81 ns. The cost is string-keyed member lookup and string-encoded object refs per call; CP1 decides between member ids and bulk paths (decision 9)
- [ ] The minimal template, unchanged, runs its playtest journey on the native engine profile on desktop. proof: `node packages/playtest/dist/runner/cli.js <minimal journey>.playtest.json --target desktop`

## Design: the minimal template's path (2026-10-06)

Inventory of the minimal template (`packages/create-threenative/templates/minimal`, 28 files): its
`src/render/` authors the look with `three/webgpu` NodeMaterials, 35 `three/tsl` functions and nine
post-processing addons; it also needs textures (done), `MathUtils` and its constants (done), the
skeletal path and the `@threenative/core` loop, input and conventions. A JS game already runs in the
native player through V8 (`tn-native-engine-player-v8`, slice 1). The remaining work is in slices,
each proven before the next:

1. **A native lazy shader graph.** `src/engine/shader/graph/`: one node per upstream TSL node kind
   (constant, uniform, attribute, operator, math, split, join, convert, conditional, texture,
   storage element, variable, assign, if, loop, function), built without a program and lowered to IR
   through the native TSL builder when a material's program is built. Proof: the 25 graphs of the
   TSL corpus built as graphs lower to the same typed IR dumps as the builder builds them.
2. **TSL from JS.** The V8 adapter binds the TSL authoring functions over that graph (a `Fn`
   callback runs once, at definition, inside a captured stack, as upstream does). Proof: the TSL
   corpus's JS source, run in V8 against the native module, gives the same IR dumps as upstream
   TSL (`differential.mjs --suite tsl-ir`). Perry later calls the same graph through the C ABI.
3. **NodeMaterials.** `MeshStandardNodeMaterial` and `MeshBasicNodeMaterial` with `colorNode`,
   `positionNode`, `normalNode`, `emissiveNode`, `roughnessNode`, `metalnessNode` and
   `opacityNode`, lowered into the standard programs. Proof: render fixtures against the browser.
4. **The render pipeline.** `RenderPipeline`, `pass()` and the template's post nodes, lowered into
   the post pass. Each addon the template uses is its own fixture.
5. **The framework.** The `@threenative/core` loop, input and conventions run in V8 over the
   native classes, and the template's renderer setup maps to the native renderer; then the
   template's own playtest journey, unchanged (box 49).

Progress (2026-10-06): slices 1-3 are in — the graph (`native_engine_tsl_graph`), TSL from JS
(`native_engine_tsl_js`, 25 graphs, 0 differ against upstream) and `MeshStandardNodeMaterial` /
`MeshBasicNodeMaterial` with `colorNode`, `positionNode`, `normalNode`, `emissiveNode`,
`roughnessNode`, `metalnessNode` and `opacityNode` (render fixtures `nodemat-color-uv`,
`nodemat-standard-nodes`, `nodemat-normal-opacity` pass against the browser). Slice 5's first part
runs the real `@threenative/core` loop in the V8 player. `Raycaster` and `LOD` are native.

The same graph serves Perry (decision 11): a later facade reaches it through the C ABI, and no
upstream TSL JavaScript runs inside a native artifact.

Slice 5, first part (2026-10-06): `tests/native-engine/playtests/game-core-demo/bundle.mjs`
bundles the real core `defineGame`, scene, loop, input, renderer and viewport with runtime-owned
import shims. The V8 player exposes native child enumeration/traversal and pumps boot microtasks;
core is unchanged. Projection is explicitly declined and world matrices use the native full walk.
A CPU-only probe over the bundle in V8 measured ArrowUp −0.8 m and ArrowRight +0.8 m in eight ticks
each, then no movement on release. The desktop scenario `native-engine-core-v8.playtest.json`
asserts movement and the native/V8 profile; verified 2026-10-06 on the desktop target: 3 of 3 runs pass
(box moved, profile native/V8), the earlier V8 and JS-free player scenarios still pass, and the
JS-free player still inspects JS-free. Red control: the demo's move speed zeroed, the scenario fails. The unchanged minimal-template journey box stays open.

## Decisions

CI repair (2026-10-07): run 37554436342 compiled the Windows adapter with C++20 but without
`/Zc:__cplusplus`, so V8 rejected its reported language level. The flag now belongs to the
`v8::v8` interface and reaches every consumer, including the separate player services target.
Linux adapter and player-services builds pass; Windows compilation awaits CI. Initial focused
V8 checks pass 4/7; scene, raycaster/LOD and callback-cycle abort during process teardown in
`Object3D::releaseTransform`. This newly exposed lifetime failure remains open; no phase tick.

- This game runtime is the default until gate T ships, and it is never called a JS-free *application* (§2.1). The engine under it is JS-free (owner, 2026-10-04).
