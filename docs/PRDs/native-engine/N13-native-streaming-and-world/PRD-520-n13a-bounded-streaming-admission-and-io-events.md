# PRD-520 — Bounded streaming admission and IO events (N13a)

**Status:** IN PROGRESS
**Complexity:** 3 — an engine event queue plus a frame-budgeted admission scheduler, both with existing TS references
**Owner:** João
**Work package:** N13 — [native-engine batch](../README.md) · [N13 umbrella](README.md)
**Depends on:** [PRD-515 (N10)](../PRD-515-n10-native-gltf-cooked-assets-and-decoders.md); starts only after [PRD-534 (CP1)](../PRD-534-cp1-the-native-engine-earns-the-port.md) passes

## Context

§11.1 asks for native IO completions to enter an engine event queue and reach the game thread at specified boundaries. §12's frame admits bounded streaming work before building the render snapshot. §12 also requires cancellation without freeing in-use resources, and no completion callback after its world is destroyed. Today: `packages/core/src/streaming.ts` (`loadAll`, `addInSlices`, `DEFAULT_CONCURRENCY = 6`) and the per-frame admission allowance in `packages/core/src/world-tiles.ts`. Frame attribution comes from `packages/core/src/frame-budget.ts`. Specs: `packages/core/__tests__/streaming.spec.ts`, `world-cells-admission.spec.ts`.

## Solution

1. **Engine event queue.** Proposed `packages/runtime-native/src/engine/world/events/`. IO, decode and GPU-upload completions are posted from worker threads. They are drained on the game thread at the frame boundary §12 defines, in posting order per source. The core has no Promise. The language adapter maps completions to its async form (§11.1).
2. **Admission scheduler.** Proposed `packages/runtime-native/src/engine/world/admission/`. Each frame gets a millisecond and byte allowance. Each unit of admission work (decode, upload, instantiate) is charged against it. Work that would overrun waits for the next frame. Concurrency defaults to today's `DEFAULT_CONCURRENCY`. The allowance is measured and reported through frame-budget telemetry (auto by default, with a named override).
3. **Cancellation and teardown.** A cancelled request releases its lease only after any GPU use completes (§7.1). Destroying a world drops its pending completions, and no callback runs afterwards (§12).
4. **Failure.** A failed load produces an error with code, subsystem, resource identity and recovery class (§12). It is never a silent hole.

## Out of scope

- Cell and tile residency policy: [PRD-521 (N13b)](PRD-521-n13b-worldcells-and-worldtiles-run-native.md)
- The end-to-end world fixture: [PRD-522 (N13c)](PRD-522-n13c-a-world-loads-walks-and-unloads-without-growth.md)

## Execution Phases

#### Phase 1: The event queue
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/world/events/`, `packages/runtime-native/tests/native-engine/world/`
- [x] Completions posted from worker threads are delivered on the game thread at the frame boundary, in per-source order. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_event_queue` (also under TSan) — 2026-10-05: green on Dawn, ASan, wgpu and under TSan (`build/tn-linux-engine-tsan`, `TN_ENGINE_TSAN=ON`, 3 of 3 runs clean). `CompletionQueue` (`src/engine/world/events/completion_queue.{h,cpp}`): 4 worker threads post 24,000 completions over 12 interleaved sources while the game thread drains once per frame; every one runs on the game thread, inside a drain, in its source's posting order. Red control: `post` without its lock is a TSan data race
- [x] After a world is destroyed, none of its pending completion callbacks run. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_event_queue_teardown` — 2026-10-05: green on the same lanes. Destroying the queue drops what is pending (and releases what it captured), refuses later posts, also through a poster that outlives the world, and stops a drain already under way when a completion destroys the world: tens of thousands ran before the destroy, 0 after. Red control: a drain that ignores a destroy mid-batch fails

#### Phase 2: Budgeted admission and cancellation
**Status:** IN PROGRESS
**Files:** proposed `packages/runtime-native/src/engine/world/admission/`
- [ ] Admission work per frame stays within the allowance, and overflow is deferred, matching `world-cells-admission.spec.ts` fixtures. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_admission_budget`
- [x] Cancelling an in-flight load frees nothing the GPU still uses, as ASan and the lease audit both show. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_admission_cancel` — 2026-10-05: green on Dawn, ASan and wgpu. `PackageLoads` (`src/engine/world/admission/package_loads.{h,cpp}`) reads and verifies a cooked package on a worker and admits its entries on the game thread within a byte allowance (a 1.5 MiB frame takes two of three 1 MiB entries). The GPU then reads the first buffer and the load is cancelled: the live handles drop to 0 at once, both GPU objects stay pending until that read completes (pending 2, then 0), the read returns the uploaded bytes (ASan clean) and the load's callback never runs. Red control: a cancel that keeps the handles fails the lease audit
- [x] A failed load reports a stable code, the resource identity and a recovery class. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_admission_failure` — 2026-10-05: green on the same lanes. A missing file is `TN_WORLD_IO_UNAVAILABLE` (io, Retry), a tampered entry `TN_PACKAGE_HASH` (assets, Skip), a package of another format `TN_PACKAGE_VERSION` (assets, Fatal), an entry needing KTX2 `TN_NATIVE_KTX2_UNSUPPORTED` (assets, Skip), each naming the package path and holding no GPU resource; an upload refusal is `TN_WORLD_UPLOAD_REFUSED` (gpu, Skip) naming `path#entry`. Red control: a version failure classed Skip fails
