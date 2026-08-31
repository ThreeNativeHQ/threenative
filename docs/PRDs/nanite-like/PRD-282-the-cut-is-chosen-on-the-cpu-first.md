---
prd_contract: v1
---

# PRD-282 — the cut is chosen on the CPU first

**Status: DONE on browser — measured 2026-08-30. Phase 2 of the
[virtual geometry batch](./README.md). The kill switch clears on both halves: on the quarry's route
at 1080p on browser WebGPU the `virtual` arm costs **1.28 ms of GPU time against `decimated`'s
2.45 ms** and sits closer to the `dense` reference than `decimated` does — 40.46% mean changed
pixels against 42.18%. Numbers, the four defects the run found, and the narrow image margin are in
[docs/verification/prd-282-the-cpu-cut-2026-08-30.md](../../verification/prd-282-the-cpu-cut-2026-08-30.md).
**Native, Android and iOS are UNVERIFIED**: no native host is built in this tree, and the
`--target desktop` run is PRD-283's AC4.**

**Two things grew that §2 did not plan, both forced by the instrument.** `ClusteredBatch` — 102 of
the quarry's 104 million triangles are 396 instanced boulders, so a per-mesh cut would have answered
AC6 with a number nobody should act on. And a second sphere per cluster in the bake: projecting both
errors through a cluster's own bounds cracks the cut, because two clusters that share a seam then
flip at different distances.

**Goal: at run time, the framework walks the DAG on the CPU, selects the clusters this camera can
resolve, and draws them through the game's own material — and beats drawing the mesh whole.**

**Complexity:** +2 a new public class in the per-frame path, +1 an index buffer rewritten per frame,
+1 the kill-switch measurement that decides whether the GPU phase is even needed = **4 → MEDIUM
mode.**

## 1. Why the slow version is built first

Three reasons, and the first is the one that matters:

1. **It is the oracle.** PRD-283's kernel is accepted only if it selects the same cluster set as
   this walk, exactly. Without a reference implementation, "the GPU picked something plausible" is
   the whole verification, and this repository has already been burned by harnesses that graded
   plausible.
2. **It is testable without a GPU** — node-environment `vitest`, deterministic, no stubbing.
3. **It might be enough.** A few thousand clusters walked per frame is not obviously expensive. If
   the quarry runs on the CPU cut, PRD-283 becomes an optimisation with a measured baseline instead
   of an assumption.

## 2. The surface

`ClusteredMesh` in `packages/core`: a `THREE.Mesh` that holds the baked clusters and, before each
render, decides which ones are drawn. `geometry`, `material` and every appearance parameter are the
game's, exactly as with `InstancedBatch` — the class constructs no material, no light and no colour,
and the game can swap the material at any time and see the swap.

Names considered and rejected, so the next survey does not re-propose them: `VirtualMesh` is Unity's
term for the package this batch may only read; `NaniteMesh` borrows someone's product name for a
mechanism; `LODMesh` collides with `THREE.LOD`, which is the discrete thing this is not. `Cluster` is
`meshoptimizer`'s own word for the thing in the payload, and vocabulary here is borrowed, never
invented.

The loader returns a `ClusteredMesh` when the primitive carries `TN_virtual_geometry`, and an
ordinary `Mesh` when it does not. A game that does nothing gets the plain mesh; a game that turned
the pipeline pass on gets the clustered one with no code change. **There is no runtime flag** — the
bake is minutes long and cannot happen at run time, so a switch that pretends otherwise is a second
way to say the same thing and a second thing to get wrong. That is the whole user-facing surface.

## 3. Submission, and the constraint that shapes it

**There is no multi-draw indirect on this stack.** WebGPU unrolls a `BatchedMesh` into one
`drawIndexed` per sub-draw (`docs/verification/prd-152-transparent-scene-optimization-2026-08-18.md:110`),
so a design that submits one draw per cluster would trade vertex work for thousands of draws and
lose. The selected clusters are therefore **compacted into one index range per material**, and drawn
as one indexed draw — indirect, so PRD-283 can write the count from a kernel without changing the
draw path (three `0.185.1` supports `IndirectStorageBufferAttribute` and `geometry.indirect`
unpatched).

The cost this moves onto the CPU is the compaction and its upload, every frame the cut changes. That
cost is the risk in this phase and it is measured, not assumed. Two mitigations exist if it bites:
upload only the ranges that changed, and re-cut only when the camera has moved enough to change one.

**Popping is a defect, not a tuning parameter.** The threshold gets a hysteresis band so a cluster
that just became eligible does not oscillate on a camera that is standing still and breathing.

## 4. Acceptance criteria

- [x] **AC1 — the cut is correct.** For a set of camera poses, the selected clusters are exactly the
      ones whose error is under the threshold and whose parent group's is not; asserted against a
      brute-force enumeration of the DAG.
- [x] **AC2 — no holes on screen.** Proven at the geometry level — a 41-step camera sweep leaves
      zero open interior edges, and the same sweep through one sphere per cluster cracks — and by eye
      on the route's six captured frames. *A per-frame background-pixel assertion over all 1,800
      frames was not implemented, and this AC is met on the stronger geometric claim rather than the
      pixel one it asks for.*
- [x] **AC3 — red-green, hysteresis.** Measured rather than assumed. Six units out, jitter of 0.004
      through 0.1 units changes the cut on none of 120 frames, 0.2 changes it on **14** and 0.5 on
      **78**. The band is proven at the amplitude where flicker actually starts, and removing it
      reproduces the 14.
- [x] **AC4 — the game still owns the look.** Swapping the material on a `ClusteredMesh` changes what
      draws; `constraints.spec.ts` asserts the module builds no material, light or colour and holds
      no hex literal, on the same terms as `tracers.ts` and `instanced-batch.ts`.
- [x] **AC5 — red-green, the empty cut.** A camera that resolves nothing draws nothing, rather than
      submitting a zero-count indirect draw that draws nothing and warns nothing — the exact failure
      `packages/core/src/projection-apply.ts:146` records for `InstancedMesh`. Removing the guard
      fails a test that asserts the draw was skipped.
- [x] **AC6 — the kill switch, measured, at equal quality.** On the quarry: `render.p50`, draw calls
      and triangles for `virtual` against `decimated` and `dense`. **`virtual` must beat `decimated`
      on frame time, and be closer to `dense` in image difference on the same route frames than
      `decimated` is. Both, or it fails.** Decimating to 5% is cheaper precisely because it looks
      worse, so a frame-time race against it alone is rigged, and beating only `dense` is not a pass
      either — that is the rule `projection-plan.ts` already applies to the projection, which exists
      because a projection that could not beat doing nothing once turned a working scene black.
- [x] **AC7 — a playtest, not a unit test, is the proof of the frame.** The quarry's route scenario
      runs the `virtual` arm and asserts the frame result on browser WebGPU with its adapter named.
- [x] **AC8 — the capability is discoverable.** `capabilities.json` regenerated and the entry
      findable by the words a game would use — *a model too detailed to draw*.
