---
prd_contract: v1
---

# PRD-269 — motion vectors for skinned and instanced geometry, or the temporal filters lie

**Status:** PARTIAL — reopened for qualification on 2026-10-02 at `d7277838`; originally
filed 2026-08-29, measured at `7e5a9fe1`. Implementation landed in `3630847a`
(`squash: deliver PRD-269 motion history`), but the acceptance below is not fully qualified. Depends on
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

## Current implementation and bounded repair

The problem measurements above are historical, not a claim that the shipped engine has no
velocity implementation. Commit `3630847a` added `VelocityTracker`, RenderChain MRT provisioning,
the patched Three.js accessors, and CPU software-rasterization coverage. Reuse those mechanisms.
The engine-layer defect at `d7277838` is narrower: `SceneRenderProjection.reconcile()` and
`commit()` skip temporal bookkeeping when `renderer.projection: false`, so an authored
`BatchedMesh` has no previous-matrix texture even with temporal rendering active. Its patched
accessor consequently uses current sub-draw matrices as history. Projection opt-out must still
build no mirror and perform no eligibility scan; temporal-off must retain no history work.

### Phase 1 — qualify shipped motion history

- [x] Verify the existing per-object transform and MRT provisioning implementation. proof: `pnpm exec vitest run packages/core/__tests__/render-velocity.spec.ts`
- [x] Verify the shipped batched accessor and projection pipeline integration. proof: `pnpm exec vitest run packages/core/__tests__/batched-velocity.spec.ts packages/core/__tests__/render-projection-pipeline.spec.ts`

### Phase 2 — preserve temporal history through projection opt-out

- [x] Preserve explicit BatchedMesh sub-draw history across first and subsequent rendered frames with projection disabled. proof: `pnpm exec vitest run packages/core/__tests__/render-velocity.spec.ts`
- [x] Release/reset history on temporal toggles, removal and disposal without a projection scan or temporal-off traversal. proof: `pnpm exec vitest run packages/core/__tests__/render-velocity.spec.ts packages/core/__tests__/renderProjection.spec.ts`

### Phase 3 — close original image-space acceptance

- [ ] Add a playtest fixture for an authored moving BatchedMesh with projection disabled. proof: its scenario loads through `packages/playtest` and asserts the moving versus static sub-draw result
- [ ] Add the original animated-character ghosting playtest with a measured rejection-fraction assertion. proof: scenario drives the active temporal stage and fails if the velocity source is removed

The two Phase 3 fixtures remain implementation work; existing CPU software rasterization is not
GPU image-space or native proof. The original acceptance and mutation descriptions are preserved
below and remain unqualified wherever no real lane has run.

## Blocked on

Actual relevant runtime screenshots must be attached to the PR before merge (owner requirement,
2026-10-02). They remain unverified; software-rasterizer output and test-log screenshots do not
satisfy this gate.

Browser/native GPU execution requires a working WebGPU device or supported native host. This
cloud environment has no `/dev/dri`, Android device tooling or `/dev/kvm`; the batch's attempted
Xvfb launch failed with `EPERM`. Keep the PR draft until the original image-space and native
acceptance has real execution evidence. No GPU, frame-cost, ghosting or platform-parity result
is inferred from the CPU tests.

## Acceptance criteria

- [ ] **A moving skinned mesh produces non-zero velocity where it moved, and zero where it did not.** proof: PR #393 GPU fixture capture and velocity-buffer assertions (pending).
   A fixture animates one skinned mesh in front of a static wall; the velocity buffer is non-zero
   over the mesh's screen footprint and zero over the wall, within tolerance. *Mutation:* write the
   current world matrix into the previous-transform slot and the spec fails with a zero buffer over
   the mesh.

- [ ] **Per-instance motion is per-instance.** proof: PR #393 `InstancedMesh` and `BatchedMesh` per-instance GPU assertions (pending).
   With an `InstancedMesh` where one instance moves and the
   rest are still, velocity is non-zero only over the moving instance. *Mutation:* track one
   transform for the whole `InstancedMesh` and the spec fails by marking every instance as moving.
   The same case is asserted for `BatchedMesh` sub-draws.

- [ ] **Ghosting is measured, not judged by eye.** proof: PR #393 ghosting playtest with a pinned threshold and zero-velocity control (pending).
   A playtest drives a character across a
   GI-lit background and asserts the disocclusion-rejection fraction stays below a pinned threshold
   while the temporal stage remains active. *Mutation:* feed the temporal node a zero velocity
   buffer and the assertion fails on the rejection fraction — the failing number is pasted in the
   PRD's red before the fix lands.

- [ ] **No temporal stage requested, no velocity cost.** proof: `pnpm exec vitest run packages/core/__tests__/render-velocity.spec.ts` plus PR #393 temporal-off/on frame-cost measurement (pending).
   With every temporal stage off, no velocity
   target is allocated and the `render` phase is unchanged within noise. *Mutation:* allocate it
   unconditionally and the allocation spec fails naming the target.

- [ ] **Bookkeeping is frame-ordered, not incidental.** proof: `pnpm exec vitest run packages/core/__tests__/render-velocity.spec.ts` plus PR #393 live colour/velocity ordering assertions (pending).
   Moving an object after the velocity update
   point within the same frame produces a velocity consistent with the colour pass — the two agree
   or the frame is wrong. *Mutation:* update previous transforms at draw time instead of at the
   scheduled point and the ordering spec fails.

## Out of scope

Motion blur — it consumes the same buffer and is a look decision, so if a template wants it, it
ships in `templates/*/src/render/` on top of this. Velocity for the atmosphere and ocean compute
paths, which have their own lifetimes.

## Verification

2026-10-02 repair: before the fix, `render-velocity.spec.ts` reports 4 failed / 12 passed:
missing `_previousMatricesTexture` in authored batch/frame-footprint tests, plus undefined
history in toggle and removal tests. Moving temporal enablement/update ahead of the opt-out
return and allowing its post-render commit makes the focused lane green: 117/117 tests across
`render-velocity`, `batched-velocity`, `render-projection-pipeline`, and `renderProjection`.
A broader direct core-suite run was interrupted before results while the targeted lane was rerun.
The tests assert first-frame identity, non-aliased texture history, next-frame advancement,
static/moving CPU footprints, toggle resets, removal/disposal, no eligibility scan, and no
steady-frame history traversal while temporal rendering is off. This verifies phases 1 and 2;
the CPU footprint fixture builds the patched Three.js nodes but is not GPU readback.

`pnpm lint` passes with 1,000 repository warnings. `pnpm typecheck` is killed with exit 137
before completing. `pnpm test` exits 2 before assertions because tsx cannot open its IPC socket
(`listen EPERM`). A direct core typecheck/build additionally needs the playtest package's missing
built declarations; its normal build reaches the same tsx IPC restriction. Running the same
validator with `node --import tsx` followed by the package's tsup build succeeds, after which
`tsc --noEmit -p packages/core/tsconfig.json` passes. After that dependency was available,
`pnpm --filter @threenative/core build` was rerun serially and passes ESM, DTS and publint
(exit 0). The root typecheck and full test suite remain unverified. `node packages/playtest/dist/runner/cli.js doctor --text` exits 2:
`TN_PLAYTEST_RUNNER_FAILED`, adb not found.

2026-10-02 qualification start: existing `render-velocity.spec.ts` passes 11/11 CPU tests.
`node --import tsx scripts/check-doc-links.ts` resolves 2,395 links; agent mirrors are in sync.
The prose test lane passes 178/180 tests; two `evidence-budget.spec.ts` subprocess cases are
blocked by tsx IPC `listen EPERM` in this environment. No code was changed for those failures.

`pnpm typecheck && pnpm lint && pnpm test`; the ghosting playtest with the before/after rejection
fraction pasted; `pnpm visuals:ab` on a template with an animated character. Native parity follows
PRD-270. `pnpm tsx scripts/count-loc.ts` runs against this one specifically — a velocity pass a
game could write portably in fewer lines than the framework's version is the kill switch, and the
defence is the per-instance and per-bone bookkeeping, counted across every call site rather than
one.
