# PRD-524 — Virtual shadows run native (N14b)

**Status:** IN PROGRESS
**Complexity:** 4 — port of a paged shadow system with GPU feedback
**Owner:** João
**Work package:** N14 — [native-engine batch](../../../native-engine/README.md)
**Depends on:** [PRD-523 (N14a)](../../../native-engine/N14-native-render-chain-and-advanced-visuals/PRD-523-n14a-the-render-graph-owns-passes-and-history.md), [PRD-519 (N12)](../../../native-engine/PRD-519-n12-native-batching-visibility-lod-gpu-scene.md)

## Context

§11.3 names virtual shadows among the systems that cannot stay a hidden TypeScript implementation in
a native-engine build. Today they live in `packages/core/src/render/virtual-shadow.ts` and
`packages/core/src/render/virtual-shadow-pages.ts`. Ordinary shadows are N09's; this is the paged
virtual shadow map path, which depends on native visibility (N12) to decide which casters render into
which pages.

## Solution

1. Port page allocation, page-request feedback, caching and invalidation into proposed
   `packages/runtime-native/src/engine/renderer/shadows/virtual/`, with the page table and physical
   atlas registered as render-graph resources (N14a).
2. Caster selection per page uses N12 visibility records; moving casters and TSL vertex deformation
   (N08c) invalidate the pages they touch.
3. The public configuration surface stays the one the TS system exposes today; any field the native
   port does not support is a named unsupported diagnostic, never silently ignored.
4. Rollback: the legacy backend keeps the TS implementation.

## Out of scope

- Ordinary shadow maps (N09). Probes ([PRD-525](../../../native-engine/N14-native-render-chain-and-advanced-visuals/PRD-525-n14c-probes-run-native.md)).

## Execution Phases

#### Phase 1: Page logic without a GPU
**Status:** DONE
**Files:** proposed `packages/runtime-native/src/engine/renderer/shadows/virtual/`, `packages/runtime-native/tests/native-engine/vsm_*.cpp`
- [x] Page requests from a recorded feedback buffer allocate the same page set as the TS reference. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_vsm_pages` against fixtures from `pnpm exec vitest run packages/core/__tests__/virtual-shadow*.spec.ts` — 2026-10-05: green on Dawn, ASan, wgpu and Wasm, exact. `src/engine/renderer/shadows/virtual/pages.{h,cpp}` ports virtual-shadow-pages.ts (page keys, `PhysicalPagePool` with its LRU-then-slot eviction, `DirectionalClipmap` windows, `ReceiverDemandPass`, `projectBounds`): a 6-frame camera walk over recorded feedback buffers requests, allocates, evicts and keeps the same pages as the real classes. Red controls: most- instead of least-recently-used eviction (4 frames differ), windows snapped with ceil (6 differ). Port by the save-tokens arm; reviewed
- [x] A moving caster invalidates only the pages its bounds cover. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_vsm_invalidation` — 2026-10-05: green on the same lanes: `ShadowInvalidationTracker` invalidates exactly the pages the old and new bounds of each of 6 caster moves cover, as the TS tracker does. Red control: ignoring the previous bounds (1 move differs)

#### Phase 2: Rendered parity
**Status:** NOT STARTED
**Files:** `packages/runtime-native/conformance/registry.json`
- [x] A VSM fixture scene renders shadows within tolerance of the legacy backend's output. proof: `pnpm parity` (new case `native-engine-vsm`) — 2026-10-06: green on Dawn (NVIDIA Turing): `pnpm parity -- --suite native-engine-vsm --driver packages/runtime-native/build/tn-linux/tn-native-engine-render-driver --renders`, fixture `vsm-basic` passes against the browser golden of the shipped VirtualShadowNode (cached fine and coarse pages on Standard and Lambert receivers; budget 1% pixels, 0.02 ΔE). The native page atlas, page table, caster passes and lit sampling live in src/engine/renderer/shadows/virtual/ and standard.cpp. Red control: the VSM shadow factor dropped from the lit program fails all three VSM fixtures.
- [x] A deformed caster casts its deformed shadow into virtual pages. proof: `pnpm parity` (new case `native-engine-vsm-deformation`) — 2026-10-06: green on Dawn: fixture `vsm-deformation` (a positionNode caster) passes in the same suite; the caster passes run the material's positionNode. Same red control.
- [x] A camera cut reseeds the page cache with no stale-page frame. proof: `pnpm parity` (new case `native-engine-vsm-cut`) — 2026-10-06: green on Dawn: `pnpm parity -- --suite native-engine-vsm --driver packages/runtime-native/build/tn-linux/tn-native-engine-render-driver --renders`, fixture `vsm-cut` passes against the browser golden. The fixture warms both levels, removes the wide caster's triangles without changing its bounds (so bounds tracking, position versions and page keys all stay the same), turns the camera without moving its eye, cuts, and captures the first frame: only the cut's invalidation can clear the stale shadow (about 11% of the frame). As VirtualShadowNode does, `invalidateAll` dirties every level, the finest re-renders first and deferred levels keep their maps. Red controls: removing the cut invalidation from `PageAtlas::update`, or making `invalidateAll` a no-op, fails vsm-cut while vsm-basic and vsm-deformation still pass. A first version that moved the camera 100 m passed even with no invalidation and was rejected on review.

## Blocked on

- Shadow-cost comparison on physical Android hardware: needs the owner's attached device (§15.3).
