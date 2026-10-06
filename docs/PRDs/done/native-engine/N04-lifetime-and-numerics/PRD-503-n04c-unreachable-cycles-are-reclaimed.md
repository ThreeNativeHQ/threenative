# PRD-503 — Unreachable cycles are reclaimed (N04c)

**Status:** DONE 2026-10-04
**Complexity:** 5 — a tracing reachability layer over the engine schema, with safe points and deferred GPU destruction
**Owner:** João
**Work package:** N04 — [lifetime and numerics](../../../native-engine/N04-lifetime-and-numerics/README.md), [native-engine batch](../../../native-engine/README.md)
**Depends on:** [PRD-502](PRD-502-n04b-handles-keep-identity-and-aliases.md)

## Context

§7.1 separates three things: `scene.remove(mesh)` detaches and does not destroy; disposing a GPU resource is not destroying its public object; shared materials and geometry stay shared. Strong reference counting on both parent and child edges leaks cycles, so the graph needs a reachability layer. Its roots are active scenes, native owners, language wrappers and pending callbacks; its edges are parent/child and the other observable links. Unreachable cycles are reclaimed at defined safe points, and GPU destruction waits until the device has finished using the resource. Adapters must take part in the protocol: rooting every callback forever is not acceptable (§7.1). The work is benchmarked, not claimed GC-free.

## Solution

1. **Schema-driven tracer** (proposed: `packages/runtime-native/src/engine/foundation/reachability.{h,cpp}`). Each engine type declares its observable edges from the catalog annotations. A mark phase from the roots runs at safe points (between frames, or on explicit `collect()` in tests) under a work budget.
2. **Root API** in the ABI: `tn_root_acquire` and `tn_root_release` for wrappers and callbacks. A weak-wrapper hook lets an adapter report wrapper reachability, so cross-language cycles can be collected (consumed by [PRD-506](../N05-native-typescript-qualification/PRD-506-n05b-three-imports-bind-natively-and-callbacks-are-reclaimed.md) and [PRD-531](../../../native-engine/PRD-531-n18-v8-game-runtime-adapter.md)).
3. **Deferred GPU destruction**: a reclaimed object's GPU resources go to a per-device-generation queue that is drained only after the submission that last used them completes. `dispose()` releases GPU resources and leaves the public object alive.
4. **Accounting**: live-object counts per type, reclaimed counts and pause time per safe point, published through telemetry.

## Out of scope

- Buffer views and leases: [PRD-504](PRD-504-n04d-buffers-cross-the-abi-with-an-owner.md).
- Device-loss rebuild of destroyed resources: [PRD-509](../../../native-engine/PRD-509-n07-gpu-resources-presentation-and-device-loss.md).

## Execution Phases

#### Phase 1: Detach, dispose and destroy are distinct
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/foundation/reachability.{h,cpp}`, `packages/runtime-native/tests/native-engine/lifetime_test.cpp`
- [x] A removed mesh still held by a root survives a collection; once unrooted it is reclaimed at the next safe point. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_lifetime_detach` — 2026-10-04: green; red when marking ignores roots. `src/engine/foundation/reachability.{h,cpp}` (`ObjectGraph`: counted roots, explicit edges, iterative mark, sweep with reclaim hooks)
- [x] Disposing a shared material leaves every mesh using it alive and keeps it shared. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_lifetime_shared` — 2026-10-04: green; dispose is the owner freeing GPU data and never touches the graph; dropping one of three meshes keeps the material for the others. Red when edges are not traversed

#### Phase 2: Cycles and callbacks
**Status:** DONE
**Files:** same, plus proposed `packages/runtime-native/src/engine/abi/roots.cpp`
- [x] A parent/child cycle and a userData cycle with no root are both reclaimed. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_lifetime_cycles` — 2026-10-04: green; red under a refcount-like sweep that keeps anything with edges
- [x] A callback whose captured wrapper is the only path back to its owner is reclaimed once the adapter reports the wrapper unreachable. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_lifetime_callback_cycle` — 2026-10-04: green; mesh→callback→wrapper→mesh lives while the adapter roots the wrapper and is reclaimed whole once it unroots it — no callback is rooted for ever

#### Phase 3: GPU destruction is deferred and budgeted
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/foundation/deferred_destroy.cpp`
- [x] A reclaimed buffer is not released before the submission that used it completes, and is released after. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_lifetime_deferred_gpu` — 2026-10-04: green on Dawn, wgpu-native and ASan (`native_engine_lifetime_deferred_gpu` in the GPU test): the reclaim hook hands the buffer to `GpuResources::destroy`, pending until `OnSubmittedWorkDone`
- [x] 1,000 create/attach/detach/unroot cycles of a 10,000-object scene end with zero leaked objects under ASan, and per-safe-point pause time is reported. proof: `pnpm --filter @threenative/runtime-native native:test:asan -- -R native_engine_lifetime_soak` — 2026-10-04: run as `ctest -R native_engine_lifetime_soak` in the ASan/UBSan engine build (`-DTN_ENGINE_SANITIZE=ON`, leak checking on): clean, liveCount back to the scene alone. Safe-point pause for 10,001 objects: release mean 0.31 ms, worst 1.04 ms; ASan mean 3.5 ms, worst 8.6 ms (RTX 2080 host, Release vs RelWithDebInfo+ASan)
- [x] Reclamation and deferred destruction run to completion on one thread with no worker, the Wasm single-thread fallback (owner decision 4). proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_reclaim_single_thread` — 2026-10-04: green; reclaim hooks run on the collecting thread, no worker exists, and `native_engine_no_blocking_waits` covers `src/engine`
