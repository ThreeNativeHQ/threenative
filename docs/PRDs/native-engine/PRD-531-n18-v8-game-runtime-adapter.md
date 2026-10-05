# PRD-531 — V8 game runtime adapter (N18)

**Status:** IN PROGRESS — the adapter drives the engine through the C ABI; catalog-coverage (box 1) needs the supported statuses synced from the binding registry
**Complexity:** 4 — the first shipping game runtime over the C++ engine; lifetime and crossing cost are the hard parts
**Owner:** João
**Work package:** N18 — [native-engine batch](README.md)
**Depends on:** [PRD-500 (N03)](PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md), [N04 — lifetime and numerics](N04-lifetime-and-numerics/README.md), [PRD-508 (N06)](PRD-508-n06-native-scene-graph-transforms-cameras-geometry.md); Phase 3 also needs [PRD-514 (N09)](PRD-514-n09-native-renderer-and-standard-materials.md)

## Context

Owner decision 2 ([PRD-497](PRD-497-n00-architecture-decision-and-compatibility-inventory.md)) makes this the first product: game TypeScript keeps running on the V8 that desktop and Android already ship (`packages/runtime-native/src/js/v8_engine.cpp`; Android defaults to V8 since PRD-130). The engine underneath it is C++. §2.1 still applies: the adapter brings no JavaScript implementation of animation, traversal, batching or materials, so the engine stays JS-free (decision 1) while the game is not yet (gate T is later). §8.2 forbids carrying 64-bit handles as plain JS numbers. §7.1 requires the adapter to take part in the lifetime protocol: callbacks that capture wrappers form cross-language cycles, and rooting them forever is not acceptable.

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

- The browser-JS back end ([PRD-532](PRD-532-n19-webassembly-native-core-browser-port.md)). The AOT game runtime ([N05](N05-native-typescript-qualification/README.md)).

## Execution Phases

#### Phase 1: Generated bindings
**Status:** NOT STARTED
**Files:** proposed `packages/three-native/generator/`, `packages/runtime-native/src/adapters/v8/`, `packages/runtime-native/tests/native-engine/v8_*.cpp`
- [ ] The V8 back end covers every catalog entry marked supported, and nothing else. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_catalog_coverage`
- [x] A handle round-trips through JS without losing bits. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_handles` — 2026-10-04: green (`build/tn-linux`, V8 13.1): 2,000 handles, a third with reused slots and bumped generations, cross into JS through the wrapper's internal field and come back with type, context, index and generation intact; one wrapper per handle, so `m.makeTranslation(...) === m`; collected wrappers release their native objects. Red without the wrapper cache and without the release. `src/adapters/v8/adapter.{h,cpp}`, `tests/native-engine/v8_adapter_test.cpp`
- [x] Every engine target below the adapter has no V8 include or link. proof: `node packages/runtime-native/scripts/inspect-js-free.mjs --binary <each engine target>` — 2026-10-04: `inspect-js-free.mjs` passes every engine library in the V8 build (`libtn_engine_{abi,assets,bindings,foundation,graph,renderer,shader}.a`, `libtn_host_services.a`) and fails only `libtn_adapter_v8.a`; `native_engine_target_graph` stays green with the adapter linked, which is defined in `cmake/NativeEngineAdapters.cmake` after the JS engines

#### Phase 2: Same engine, same lifetime
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/adapters/v8/lifetime.cpp`
- [ ] A JS-to-native cycle through a captured callback is reclaimed at a safe point. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_cycle_reclaim`
- [x] Repeated whole-runtime create and destroy shows no native object or GPU resource growth. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_runtime_churn` — 2026-10-04: green (`native_engine_v8_runtime_churn`): 50 cycles of isolate + engine context + adapter + 20,000 objects, each torn down; every object dies with its context (its handles resolve to nothing) and resident growth over the last 40 cycles is ~1 MiB, against 60 MiB when destroy leaks the context. GPU resources are not exercised until the renderer is bound
- [x] The N06 scene-semantics fixtures pass through the V8 adapter with the same results as the C++ driver. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_scene_fixtures` — 2026-10-04: green: `tn-native-engine-v8-fixture-driver` speaks the fixture protocol but runs every op as JS against the adapter's classes (`mesh.position.z = v` goes through the member alias and Vector3's setter); all 7 `scene-*` fixtures match the same goldens bit-exact (abs 0), red when the adapter's setters do nothing. Bonus `native_engine_v8_math_fixtures`: 23/26 math fixtures pass through JS; exactly three stay blocked for named C ABI reasons (Ray is not catalogued; Frustum.planes is an array of member objects), and the test fails on any new blocked or failed row

#### Phase 3: A game runs on it
**Status:** NOT STARTED
**Files:** `packages/create-threenative/` (engine profile resolution)
- [x] Per-call cost of a property write and a method call through the adapter is reported. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_v8_crossing_bench` — 2026-10-04: `native_engine_v8_crossing_bench` prints `TN_V8_CROSSING`; first reading on this host (RTX 2080 desktop, V8 13.1, Release): property write 108 ns, method call with an object argument 365 ns, property read 81 ns. The cost is string-keyed member lookup and string-encoded object refs per call; CP1 decides between member ids and bulk paths (decision 9)
- [ ] The minimal template, unchanged, runs its playtest journey on the native engine profile on desktop. proof: `node packages/playtest/dist/runner/cli.js <minimal journey>.playtest.json --target desktop`

## Decisions

- This game runtime is the default until gate T ships, and it is never called a JS-free *application* (§2.1). The engine under it is JS-free (owner, 2026-10-04).
