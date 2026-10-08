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
V8 checks passed 4/7; scene, raycaster/LOD and callback-cycle aborted during process teardown in
`Object3D::releaseTransform`. The lazy transform pool died before the older VM owner: a native
late-owner teardown regression reproduced the invalid free. Pool bookkeeping now has process
lifetime, while pages still release when the last object dies. Verification: 15/15 scene/V8
checks, 3/3 focused ASan checks, the rebuilt Wasm exact ordering/callback oracle and the desktop
core/V8 playtest pass (ArrowUp moves −0.8 m). No phase tick; the full template journey stays open.

The temp-directory guard now passes: JS-free inspection uses registered test cleanup, and the
standalone import probe removes its bundle directory on exit. Compiler/conformance CLIs retain
diagnostic outputs explicitly; the starter visual gate already cleans in `finally`. Inspection
unit checks pass (9 passed, 1 skipped).

Inspect compatibility repair (2026-10-07): the full imports probe exposed deferred
`Box3.setFromObject`, then `Vector3.project`, then four `getWorld*` methods returning the scene
object instead of the caller's output target. The shared native registry now exposes object/buffer
bounds and camera project/unproject; all four output methods return the target. Scene bounds keep
the reference's nonrecursive world update, cached versus precise behavior, instancing and skinned
double-precision vertex transforms. Geometry bounds now include morph targets in upstream order.
Skinned clones preserve an independent cached box; ordinary Mesh gains no data member.

Verification: four frozen reference fixtures repeat identically and all 132 observations match
bit-for-bit; 23 focused native checks and 5 ASan checks pass. The clone-cache and four return-identity
regressions failed before their fixes, then passed. The rebuilt Wasm/browser-backend smoke passes
object bounds, camera projection and output identity; 45 catalog/fixture/temp-directory unit checks
pass. Biome passes with 5 existing complexity warnings. The full imports/cooked-assets/Rapier/
inspect-bridge probe and desktop core playtest pass. The imports probe is now a CTest case: full
services when physics and glTF are built, imports-only otherwise (both modes verified locally).
Registry/catalog/declarations are regenerated with the actual bound track and bind-mode types.
This repair slice is complete; Windows CI and the unchanged full minimal-template journey remain
unverified, so no phase box is ticked.

CI audit (2026-10-07): the exposure failure's saved console shows 347 accepted samples and one
pending readback at timeout, with no console errors or rejected samples; the post-cut arm simply
did not reach 180 within 60 seconds. The unchanged failing case passes locally on both NVIDIA
Turing and explicitly observed SwiftShader, with CPU profiles captured. No timeout or assertion
change; the hosted run remains unverified. PR #438 is still draft, has no current remote check
rollup. The develop merge initially conflicted in `.gitignore` and Android key routing. The conflict preview
identified two content conflicts. Reconciliation preserves both ignore lists and combines the
upstream consumed-UI key guard with native-engine mailbox-only input. String and array Space presses
reproduced duplicate adb injection before the native guard; 79 focused Android/input/profile tests pass after reconciliation. Upstream KayKit license bytes are preserved, including their existing blank-line whitespace.
The system-Clang/V8 run
completed the legacy contracts but found a producer gap: its compile inventory includes
`tn_engine_foundation` while its build/execute list includes only legacy targets, so aggregation
fails on the unbuilt engine object. Integrate the native-engine suite before refreshing coverage;
do not drop inventory entries or restamp the digest. The producer now builds the existing engine
aggregate, runs each labelled CTest case with its own profile prefix and exports all compiled
object variants against fresh merged profiles. Static reference/inspection checks remain counted;
the instrumented registry `--check` invocation still requires a profile (regression red/green).
All 27 focused coverage/digest tests and 212 merged CI/mirror contract tests pass. Full refresh is
pending. Its first engine build exposed Clang/libstdc++ 16 recursively instantiating aggregate
`Value` through `pair<string, Value>`; a minimal red/green compile identified an explicit value
constructor as the fix. The formerly failing binding source compiles with Clang; full instrumented
execution remains pending. The merged checkout needs a frozen dependency install before root
TypeScript can resolve the newly introduced example and sourcemap packages.

Scatter-test timeout repair (2026-10-07): a focused CPU profile identified terrain mesh rebuilding
as the main unrelated cost in the timed-out scatter walk. Both comparison arms now use the existing
9-point terrain-resolution override, preserving all 400 updates and scatter assertions. The case
falls from 17.5 seconds to 0.66 seconds locally; the complete file passes 70/70 checks in 8.7 seconds
(previously 27.0 seconds). Biome passes. Terrain tessellation retains its dedicated world-tiles
coverage; no product defaults or timeout changes. These timings diagnose the local test cost,
not a controlled product benchmark or a fresh CI verdict.

Playwright orphan repair (2026-10-07): a real-process regression reproduced the one-shot cleanup
race: a still-exiting child was skipped permanently. Both runner/capture paths now reclaim after
owned display teardown and retry for at most ten seconds, preserving the before-launch ownership
fence and live-process guard. Remote browsers are excluded. Verification: 36 focused cleanup,
ownership, capture and Android attachment checks pass; playtest build/publint passes; the real
SIGTERM orphan gate reports `no orphans` with CI's Node 20. A separate Node 24 probe retained its
intentional `node-compile-cache` directory (not a browser profile); that version's gate remains red.

Quality-gate repair (2026-10-07): removed four new double casts from native-profile validation,
the browser class factory and numeric observation encoding. Existing runtime checks and native
class syntax preserve validation; numeric observations now reject DataView and nonnumeric entries
instead of silently encoding/coercing them. The regression failed before the fix. Verification:
27 focused profile/browser/protocol/quality checks, focused TypeScript and the real Wasm browser
smoke pass. Biome passes with 6 existing complexity warnings. No quality waiver or baseline change.

- This game runtime is the default until gate T ships, and it is never called a JS-free *application* (§2.1). The engine under it is JS-free (owner, 2026-10-04).

Exact-source coverage refresh completed (2026-10-07): `pnpm --filter @threenative/runtime-native native:coverage` exits 0 on the current sources and rewrites the generated record; `scripts/__tests__/check-native-coverage.spec.ts` passes 6/6. Total 51,484 lines at 83.28% (previous record 24,669 at 78.45%); the record now covers `src/engine/` (25,235 lines, 87.24%) and `src/adapters/` (88.96%). Repairs needed on the way: the Gate E driver joins the engine test aggregate; TS `--check` fixture scripts and the Perry corpus count as uninstrumented; the JS-free player is built so its objects exist; one `llvm-cov export` covers every product object (per-object exports timed out); llvm-cov's "functions have mismatched data" warning (header inline functions compiled into several test binaries) is tolerated and every other warning stays fatal; `update_scaling` runs at one size in this lane only, since instrumented timing cannot judge its 18× ratio, which still runs and fails in test-native. The run surfaced and fixed real reds: V8 writes to `morphAttributes`, `layers.mask` and `morphTargetInfluences[i]`, native inspect `input.wheel`/`input.media`, a Node-version-dependent JSON fixture and three batching-stale expectations. The timing-budget test `native_engine_world_cycles_cpu` failed once under CI host load and passed on rerun; the accepted run was pinned to CCD1.
