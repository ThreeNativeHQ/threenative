---
prd_contract: v1
---

# PRD-269 — motion vectors for skinned and instanced geometry, or the temporal filters lie

**Status:** PROPOSED — filed 2026-08-29, measured at `7e5a9fe1`. Depends on
[PRD-266](../useful-defaults/PRD-266-the-render-chain-names-the-tier-it-actually-ran.md); lands before
[PRD-268](./PRD-268-light-that-comes-from-off-screen.md) is judged. Batch:
[docs/PRDs/lighting](./README.md).

**Goal: a character that moves does not smear.** This is the one thing `0beqz/realism-effects`
gives you that upstream's nodes do not — re-implemented in TSL rather than vendored, because that
library is GLSL against `WebGLRenderer` and cannot reach this stack's native targets.

**Complexity:** a velocity pass plus per-object previous-transform tracking for skinned and
instanced meshes = **MEDIUM**. The maths is well-trodden; the bookkeeping is where it goes wrong.

## The problem, measured at `7e5a9fe1`

### 1. Every effect worth having in this batch is temporal, and temporal means reprojection

SSGI, SSR and GTAO are all sample-starved per frame. Every practical use of them accumulates across
frames — `TRAANode`, `TemporalReprojectNode` and `RecurrentDenoiseNode` all exist in
`three/addons/tsl/display/` for that reason. Reprojection needs to know where each pixel *was* last
frame. Derived from depth and the camera matrices alone, that answer is only correct for geometry
that did not move relative to the world.

So on a static scene the filters are correct, and on the first animated character they are not: the
history sample comes from wherever that pixel used to be in world space, which is a different
surface. The artefact is a smear trailing the character and a halo of stale GI around it — worst on
exactly the content a game ships.

### 2. This is what `realism-effects` actually contributes, and it is why absorbing it fails

The batch evaluation rejects vendoring `0beqz/realism-effects` on hard grounds: it targets
`WebGLRenderer`, requires the pmndrs `postprocessing` package, and ships `.glsl` — none of which
executes on the `WebGPURenderer`-only native runtime. But its SSGI/TRAA quality does not come from
its GI maths alone; it comes from feeding those filters correct velocity for skinned and instanced
geometry, which is the part upstream's nodes assume you already have.

Take the idea, write it in TSL. That is the whole PRD.

### 3. Nothing in this repository produces velocity today

No velocity or motion-vector pass exists in `packages/core/src/`. `packages/core/src/skeleton.ts`
owns skinning and `packages/core/src/particles.ts` and the instanced paths own their own transforms;
none of them retains a previous-frame transform, and there is no buffer for a temporal node to read.

## What ships

`packages/core/src/render/velocity.ts`, exported from `@threenative/core`, and wired into the
PRD-266 chain as a provisioning stage rather than a user-facing effect:

- A velocity render target in the chain's canonical order, produced before any temporal stage
  consumes it, and skipped entirely when no temporal stage is requested — a game paying for a
  buffer nothing reads is the kill switch firing.
- **Previous-frame transform tracking** per drawn object: world matrix for rigid meshes,
  per-instance matrices for `InstancedMesh`/`BatchedMesh`, and bone matrices for skinned meshes.
  Double-buffered and updated once per frame at a defined point in the schedule, so a mid-frame
  transform write cannot produce a velocity that disagrees with the colour pass.
- A TSL velocity node computing the screen-space delta from current and previous clip positions,
  handed to `TemporalReprojectNode`/`TRAANode` through the chain rather than by the game.
- **Disocclusion reporting** — the fraction of pixels whose history was rejected this frame, under
  the chain's marker. A number that stays high means reprojection is not working, and today there is
  no way to know that other than by looking.

`BatchedMesh` deserves its own note: on WebGPU it is one render object issuing N `drawIndexed`
commands, so per-sub-draw previous transforms are what the velocity pass needs — the aggregate
object transform is not enough and will read as correct in every static test.

## Acceptance criteria

1. **A moving skinned mesh produces non-zero velocity where it moved, and zero where it did not.**
   A fixture animates one skinned mesh in front of a static wall; the velocity buffer is non-zero
   over the mesh's screen footprint and zero over the wall, within tolerance. *Mutation:* write the
   current world matrix into the previous-transform slot and the spec fails with a zero buffer over
   the mesh.

2. **Per-instance motion is per-instance.** With an `InstancedMesh` where one instance moves and the
   rest are still, velocity is non-zero only over the moving instance. *Mutation:* track one
   transform for the whole `InstancedMesh` and the spec fails by marking every instance as moving.
   The same case is asserted for `BatchedMesh` sub-draws.

3. **Ghosting is measured, not judged by eye.** A playtest drives a character across a
   GI-lit background and asserts the disocclusion-rejection fraction stays below a pinned threshold
   while the temporal stage remains active. *Mutation:* feed the temporal node a zero velocity
   buffer and the assertion fails on the rejection fraction — the failing number is pasted in the
   PRD's red before the fix lands.

4. **No temporal stage requested, no velocity cost.** With every temporal stage off, no velocity
   target is allocated and the `render` phase is unchanged within noise. *Mutation:* allocate it
   unconditionally and the allocation spec fails naming the target.

5. **Bookkeeping is frame-ordered, not incidental.** Moving an object after the velocity update
   point within the same frame produces a velocity consistent with the colour pass — the two agree
   or the frame is wrong. *Mutation:* update previous transforms at draw time instead of at the
   scheduled point and the ordering spec fails.

## Out of scope

Motion blur — it consumes the same buffer and is a look decision, so if a template wants it, it
ships in `templates/*/src/render/` on top of this. Velocity for the atmosphere and ocean compute
paths, which have their own lifetimes.

## Verification

`pnpm typecheck && pnpm lint && pnpm test`; the ghosting playtest with the before/after rejection
fraction pasted; `pnpm visuals:ab` on a template with an animated character. Native parity follows
PRD-270. `pnpm tsx scripts/count-loc.ts` runs against this one specifically — a velocity pass a
game could write portably in fewer lines than the framework's version is the kill switch, and the
defence is the per-instance and per-bone bookkeeping, counted across every call site rather than
one.
