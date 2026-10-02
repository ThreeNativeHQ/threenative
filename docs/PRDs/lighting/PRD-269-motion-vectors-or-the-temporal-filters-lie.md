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

- [x] Upload current and scheduled previous instance attributes in the same draw while retaining static upload elision. proof: `pnpm exec vitest run packages/core/__tests__/instance-velocity-upload.spec.ts packages/core/__tests__/three-static-settled.spec.ts` (3 red before the repair; 5 uploader and 10 settled-static regressions green)

### Phase 3 — close original image-space acceptance

- [x] Add a playtest fixture for an authored moving BatchedMesh with projection disabled. proof: hosted run `36992451504` passed at `095eca85`; `pnpm exec tsx scripts/verify-velocity-history.ts` runs the actual WebGPU fixture and missing-history control
- [ ] Add the original animated-character ghosting playtest with a measured rejection-fraction assertion. proof: scenario drives the active temporal stage and fails if the velocity source is removed

The authored BatchedMesh fixture has actual browser GPU readback and screenshot proof. The
animated-character ghosting fixture remains implementation work; CPU software rasterization is not
a substitute for that image-space or native proof. The original acceptance and mutation descriptions are preserved
below and remain unqualified wherever no real lane has run.

## Blocked on

Actual relevant runtime screenshots must be attached to the PR before merge (owner requirement,
2026-10-02). The authored-batch browser pair below now satisfies the relevant screenshot-progress
requirement; full skinned/instanced, ghosting, frame-cost and native acceptance remain open.

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

- [ ] **Per-instance motion is per-instance.** proof: hosted `37003076606` at `47e188e4` passes the browser `InstancedMesh` and `BatchedMesh` moving/static cases (0.015625-pixel maximum error); shared-transform mutation and native qualification remain open.
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

First actual hosted capture: [run 36991957955](https://github.com/ThreeNativeHQ/threenative/actions/runs/36991957955)
on `b1a8a9bef55b4dd1e05f7a4120d5d8122273fb81` produced the unchanged
[missing-history progress PNG](../../verification/prd269/without-history-progress.png) and
[artifact/adapter provenance](../../verification/prd269/progress-provenance.json). The actual
velocity MRT has zero moving pixels with bookkeeping removed; static and first-frame maxima
are also zero. The gate caught a fixture-count mistake: warmup waits do not call deterministic
steps, so the actual frame advanced 1 to 4, not 1 to 6. The scenario now requires `changed: true`
and at least four frames. The tracked variant was not reached in that run; it remains pending.
No device-loss warning was accepted. This is progress evidence, not completed acceptance.


2026-10-02 screenshot qualification in progress: the opt-in `velocity.html` fixture renders
an authored two-sub-draw `BatchedMesh` through the current source's `SceneRenderProjection`
with `projection: false`, then reads the actual velocity MRT. Its left panel is the colour
attachment and its right panel is absolute x/y velocity amplified 20 times. Each deterministic
step crosses a RAF boundary. The separate `without-history` run removes bookkeeping and must
fail only the moving-pixel bound, while static velocity and first-frame identity stay zero.
`integration-velocity-history.yml` retains runtime PNGs, measured resources, source SHA and
adapter provenance even on failure. Local build and 263 focused tests pass; local capture
cannot start because this reset environment has no usable X display or Xvfb. Hosted image-space
results and screenshots are still pending, so no acceptance box is newly ticked here.


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


2026-10-02 actual authored-batch GPU proof at `095eca855ea9f27260a761a72cba0d4d423087ec`:

- [Hosted run 36992451504](https://github.com/ThreeNativeHQ/threenative/actions/runs/36992451504) passed. Artifact `11219953627` SHA-256 `32d6cd4e60b6e244c397178b656126f073c47e1691870932ff80996ed7949083` verified after download. [Runtime provenance](../../verification/prd269/runtime-36992451504.json) records exact source, adapter, metrics and diagnostics.
- Actual 960 × 540 Google SwiftShader WebGPU screenshots: [tracked history](../../verification/prd269/tracked-36992451504.png), [missing-history control](../../verification/prd269/without-history-36992451504.png). Both were independently visually inspected: matching lit spheres occupy the beauty half; only tracked moving sub-draws produce the red velocity silhouette. Images are unchanged runtime PNG bytes.
- Four actual RAF-separated rendered frames per arm. Both start with zero velocity; tracked final moving footprint has 25,676 nonzero pixels and maximum 0.0999755859375, static footprint maximum 0. The missing-history control remains zero and fails exactly `resource.motion.movingPixels`; positive diagnostics are empty, with no device-loss warning in either arm. The control disables actual history production rather than rewriting observations.
- This closes only the bounded authored-BatchedMesh fixture item. InstancedMesh/skinned GPU cases, active temporal ghosting/rejection measurements, frame-cost/native proof and full acceptance remain open. Software-adapter correctness is not hardware performance proof; PR remains draft.

## Instance attribute upload repair (2026-10-02)

PR #398's actual WebGPU probe at `dd541a46` ([run 36997077219](https://github.com/ThreeNativeHQ/threenative/actions/runs/36997077219)) found a shipped defect independent of its new reconstruction helper: the default previous-instance attribute kept its initial GPU bytes, and `DynamicDrawUsage` exposed a one-frame upload delay. At frame 24 the instance velocity read `(0.0006814, 0.0727539)` versus expected `(-0.0005882, -0.0035371)`, a 13.74-pixel error. The dynamic arm's residual equals two frames of displacement within 0.002 pixel after removing the separately diagnosed helper jitter error. That helper repair remains in PR #398.

The real Three accessor plus `Attributes` uploader, invoked through `Renderer._renderObjectDirect`, reproduced three failures: current static instance bytes lagged, dynamic previous bytes lagged, and temporal-off current writes lagged too. The engine patch now restores upstream before-node/geometry ordering, synchronizes current matrix/color versions in the before-frame event, and writes scheduled previous matrices with explicit dirty signals before geometry upload. Unscheduled Three callers retain their draw-time history snapshot. No history is constructed without previous data, and unchanged temporal-off draws perform zero additional attribute uploads.

The ordering inversion came from `a602467d` / PR #375's settled-static repair. Its recorded requirement is that every structural draw step runs while unchanged object updates, uniforms and attribute scans are elided. Those steps and per-manager decisions remain intact; the existing static and late-bind-group tests are retained. The maintained browser fixture now also exercises default and dynamic `InstancedMesh` with signed current-minus-previous velocity, unequal steps, reversals, a stop and a restart. Its maximum-error threshold is 0.05 pixel including half-float quantization. Hosted evidence for this extension is pending; the earlier authored-batch screenshots above remain valid for their cited source.

Local verification for the instance-upload extension: **190/190** focused motion, settled-static, shader, shadow, patch-upgrade and interleaved-disposal tests passed. Root `tsc --noEmit -p tsconfig.json`, strict fixture types, the fixture Vite build, core ESM/DTS/publint build, and native-smoke single-file bundle plus 4/4 tests passed. This is native bundle compatibility, not native rendering proof. Quality JSON and the 72 MiB verification evidence budget pass; 2,400 documentation links checked. Independent review and the new hosted velocity arms are pending.

Packaging/scaffolding follow-up: 73/74 initially passed; the byte-stability pin failed because every generated project embeds the changed Three patch. For all 13 templates, restoring only the generated patch reproduces the exact prior hash. Measured pins updated; **74/74** now pass, including clean-consumer patch application/idempotency. Root lint passes with 1,000 existing warnings. No runtime acceptance was inferred from these packaging checks.

Independent review found and reproduced a consumer-upgrade refusal: the prior `dcbc5131` patch's changed hunks matched neither stock nor the candidate. The exact prior files (Git blobs from develop `416ffd7c`) now have a four-file migration with full old/output blob checks. Every file is still preflighted before any writes; unknown edits refuse. The real upgrade regressions were **2 failed / 5 passed** before this repair and now pass for LF and CRLF, idempotence, and one-byte tamper refusal without partial writes. Fresh-stock and packed-consumer coverage remains green (**15/15** upgrade/packaging tests). This migration does not accept arbitrary historical or custom patches.

Final local core lane after the upgrade repair: **2,221 passed, 2 skipped, 175 files** (`pnpm exec vitest run --maxWorkers=1 packages/core`, 114.77 s). Independent review cleared the renderer repair and verified actual packed prior-version LF/CRLF upgrades, byte equality, idempotence and tamper refusal; its final uploader/static sanity lane passed 30/30. The hosted MRT extension remains the next proof gate; original acceptance stays open pending actual execution.

## Repaired instance velocity: actual WebGPU proof

[Run 37003076606](https://github.com/ThreeNativeHQ/threenative/actions/runs/37003076606) passed at source `47e188e41601a64decb4fe0f580037546d63b543`. Artifact `11224711152` has verified ZIP SHA-256 `bca60e256985287d5eeeda1b7942d17ef5a3c5b5a056f35f7093520a7a1ae667`. On Google SwiftShader WebGPU, the authored `BatchedMesh`, default `InstancedMesh` and `DynamicDrawUsage` arms each rendered nine RAF-separated frames and matched the signed current-minus-previous oracle within **0.015625 pixel**, below the fixed **0.05-pixel** bound. First-frame, static-footprint and stopped-frame velocity were exactly **0**; the moving footprint contained **25,676** nonzero pixels. Positive diagnostics were empty. The actual missing-history batch control measured **64 pixels** of error and failed exactly the movement and oracle assertions.

All four runtime PNGs were visually inspected. The three positive PNGs are byte-identical, so one unchanged image is retained for them: [repaired instance velocity](../../verification/prd269/instanced-37003076606.png), [missing-history control](../../verification/prd269/without-history-37003076606.png), and [full adapter/readback/provenance](../../verification/prd269/velocity-37003076606.json). Left halves are actual colour; right halves visualize actual velocity. These captures qualify the explicit browser cases, not native rendering, skinned deformation, active temporal rejection or hardware cost. The original acceptance checkboxes remain open where their complete proof is still pending.
