# Engine performance defaults

**2026-09-14 · Priority 1 shipped and adopted by the Midway game (Section 6); priorities 2-3
proposed; stable 60 FPS remains unproved.**

Status change. This report previously carried the title "Proposed engine work · Stable 60 FPS
remains unproved." and, for the transform-ownership item, the status "In progress per the handoff,
not integrated at this report's review". Both are superseded for Priority 1: the fix is shipped on
develop (`3c78a7e22`) and the game adopted it (Section 6). The stable 60 FPS target itself remains
unproved. The game is an external checkout; its real diff and raw evidence are copied into
`docs/midway-adoption-verify/` in this repository so they are inspectable here.

Build these improvements into the engine so a developer can create ordinary Three.js
objects, update gameplay, and receive correct, efficient rendering automatically. This
report gives the next developer an ordered implementation loop. The existing
[Midway performance handoff](https://github.com/ThreeNativeHQ/examples/blob/main/midway-open-pacific/docs/PRDs/PRD-midway-flak-hunt-20260914.md) holds the measurements
and reproduction commands. Engine paths below are relative to this repository; Midway
source paths refer to `sandbox/midway-open-pacific`.

## 1. Verdict, default contract, evidence, status

**Yes: engine defaults can prevent these recurring classes of problem.** They should
avoid rebuilding unchanged batch plans, submitting irrelevant geometry, and repeating
render preparation during simulation catch-up. They should prepare required pipelines
before interactive first use. Arbitrarily expensive content still cannot be guaranteed
60 FPS on every GPU; exceeding a measured budget must produce a useful engine diagnostic.

Default contract: **mechanism is engine, look is game.** Ordinary Three.js game code stays
ordinary; these mechanisms work with no option passed, with named overrides and honest
reporting. Midway supplies a **CPU-bound** workload, challenging the GPU-only priority in
[FUTURE-ARCHITECTURE-DIRECTION.md](FUTURE-ARCHITECTURE-DIRECTION.md)
under the rules of the
[Charter](CHARTER.md).
No renderer rewrite, no ECS, no IR, no manual `markDirty()`, no new framework, no second
profiler.

The user reports 40–50 FPS, below 40 when busy. Profiling evidence comes from
host-contended 300-frame windows **including startup**, not clean steady FPS or a
reproduction of the user's exact frame rate: NVIDIA RTX 2080,
real WebGPU, 1920×1080, DPR 1, resolution scale 1, MSAA 4, live 22 aircraft / 19 ships
close battle, profiler separate. GPU 3–10 ms; engine render mean 50–121 ms; update 8–17 ms;
GC 0.2% of samples. Projection reconcile/scan/walk/`hasRenderHook` plus source matrix
update measured 8.7% of the whole window (~24% of active CPU): 2189 source renderables →
1565 projected, 99 batches (40 instanced, 59 material), 624 exact proxies. JS is a venue,
not a measured ceiling; do not reach for C++/WASM/threads as a first fix.

Those measurements used the isolated `flak-hunt` build of the delivered fixes, with core
tarball content hash `27e4fce23867`. They do not certify subsequent gameplay changes on
sandbox `main`; capture a new baseline before implementing the next optimization.

Status:

- **Shipped** `b1cae880310c424b6f905a298a5c20aa62ad713a` on develop: `shallowProxy` in
  `packages/core/src/projection-apply.ts` preserves `LineSegments`/`LineLoop` before the
  generic `Line`. Inherited `isLine` was turning independent segments into a polyline — an
  engine correctness bug ([issue 248](https://github.com/ThreeNativeHQ/threenative/issues/248)). Unit and supported `LineSegments` web/Linux native
  conformance pass. `LineLoop` is unsupported by Three WebGPU; do not promise it.
- **Shipped**: `ctx.beforeRender` runs once per actual world draw, after the last fixed
  update and before projection, inside the render budget with scene-owned cleanup. Midway
  moved prep there: `src/scenes/Midway.ts:71` calls
  `ctx.beforeRender(() => this.world.particles.prepare(...))`, `CombatParticles.prepare` in
  `src/render/particles.ts:327`. Exact order/count win: current 29 draws / 29 prepare /
  58 `writeBatch` versus legacy 31 draws / 154 prepare / 308 `writeBatch`, both with 68 aircraft. Added hook alone
  is insufficient; built-ins and templates must schedule correctly by default.
- **Shipped and game-adopted** `f7c64c5fc`: `reconcile` honours Three's matrix update flags
  (`if (this.#source.matrixWorldAutoUpdate === true) this.#source.updateMatrixWorld();`)
  instead of forcing `updateMatrixWorld(true)`. Focused `renderProjection.spec.ts` 66/66
  (four new static-marking cases). The sandbox Midway game adopted the content-hashed build
  and moved its own once-per-world-draw walk to `ctx.beforeRender`, because a scene
  `onBeforeRender` walk never fires while the projection mirror renders; the transform
  regression went red (stale matrices) to green (one walk per presented frame). Section 6.
  This is a transform-ownership fix, not structural-plan caching.

**Hypotheses, not confirmed fixes:** the FPS gain from `beforeRender` (noisy timing), the
original multi-second-freeze cause, and first-use pipelines as that freeze's cause. Do not
mark them confirmed.

## 2. Priority 1 — frame preparation and structural planning

Default: split the stable structural plan (existence, geometry/material identity,
visibility, layers, `renderOrder`, hooks) from moving transforms and buffer sync. Rebuild
structure when a relevant compatibility change requires it: add/remove/reparent, geometry
or material swap, visibility/layer/`renderOrder`/hook change, LOD or deformation-mode change.
Moving transforms, bone/morph values, environment and light state still synchronize each draw. A
cheap per-frame compatibility check for direct Three mutations is allowed. No global skip of
`reconcile`, no stale motion. Respect `matrixAutoUpdate`/`matrixWorldAutoUpdate`; never infer
static-forever from 120 still frames (6527/6636 nodes kept their local matrix, but moving
parents still move descendants). Exactly one correct transform preparation before projection
reads, including descendants of moving parents, skinned bones and hooks. Removing `true`
from `updateMatrixWorld(true)` alone is disproven; blanket freezing and per-game static lists
are banned. Reduce repeated computation and allocations in the existing scan workspace before
unprovable caching.

Engine-owned particle and instance systems must arrange draw-only packing through the
existing preparation phase automatically; generated rendering code must demonstrate that
default. Fixed updates keep simulation and aging. The counter contract is one preparation
per actual world draw, including after several fixed updates; Midway's two particle pools
therefore produce two `writeBatch` calls per draw. No mesh hook that disables unrelated
batching, and no new Scene lifecycle method. A genuinely global render hook still needs
conservative handling; deleting its safety guard is not an optimization.

Files: `packages/core/src/renderProjection.ts` (`reconcile`),
`packages/core/src/projection-plan.ts` (`scanProjection`, `walkProjection`,
`hasRenderHook`), `packages/core/src/game.ts` calls `reconcile` before world draw.

First bounded action/test: extend `packages/core/__tests__/renderProjection.spec.ts` with
a stable scene and one material swap. Count full plan construction separately from cheap
compatibility checks; unchanged frames must reuse the plan, and the swap must take effect
on the next draw. Keep only if
semantic cases pass and counts drop; otherwise revert. Semantic gate: add/remove/reparent,
swap, visibility/layer/order/hook, LOD/morph/skinned, environment/light, moving parents,
skinned bones, main/reflection/shadow/frustum-edge. If safety cannot be established, fall
back locally and conservatively instead of caching.

Game code eventually deleted: Midway's scene-root transform hook and manual matrix flags,
once engine preparation demonstrably replaces them. Do not require new per-game static lists.

## 3. Priority 2 — per-pass batching and culling

Default: compaction and culling are **per camera and per pass**. Reflections and shadows
need their own eligibility; shadows must keep correct casters. The instanced lane in
`packages/core/src/projection-apply.ts` currently sets `frustumCulled = false`, draws all
used slots, and sends authored-invisible slots as `ZERO_MATRIX`; offscreen slots stay.
`projection-plan.ts` admission predicts draw reduction, not total work — geometry previously
rose 2.39M → 5.26M triangles while draws fell. Main-camera-only compaction breaks shadows and
reflections, and a union sphere restores little. `BatchedMesh` per-object culling differs
from `InstancedMesh`; use each correctly. The engine owns conservative per-pass culling. A
game distance filter is tactical only, never a magic 80 m threshold, and does not decide
shadow distance or look.

Files: `packages/core/src/projection-apply.ts`, `packages/core/src/projection-plan.ts`.

First bounded action/test: build a scene with one instance visible only in the main camera,
one only in a reflection, and one casting a visible shadow while outside the main view.
Assert each pass retains the correct instances and omits irrelevant ones. Use conservative
bounds for movement and deformation. Compare per-pass submissions with the handoff's
316 shadow draws / 1.814M triangles. Keep only if total frame cost improves with equivalent
images; fewer draws alone is not success. Validate on the full 68 crowd and deck crew.

Game code eventually deleted: any tactical shadow distance filter once engine culling
replaces it. Preserve authored reflection exclusions and visual choices.

## 4. Priority 3 — cold pipelines and first-use spikes

Default: extend the existing warmup lifecycle to the projected geometry/material/shadow/
reflection variants that actually appear, as bounded incremental work. No all-possible-
variant precompile. A required dynamic variant must not silently disappear; define a
transparent readiness policy. New pipelines during projection activation have been observed,
but causality for the original freeze is unproved. Treat cold first-use and steady state as
separate measurements.

Files: `packages/core/src/warmup.ts`, startup orchestration in `packages/core/src/game.ts`,
and the projection modules above. Reuse existing readiness and timeout handling.

First bounded action/test: add stage markers (first flak, first shadow, activation) and
measure a cold scene transition against a warm one. Acceptance: the tested interactive
first use adds no stall above 100 ms and loses no required variant; startup readiness stays
within its existing timeout. Keep only when markers prove the identified stall is removed
from interactive play without merely hiding dropped frames; otherwise re-plan.

Game code eventually deleted: any per-game pre-touch/pre-warm hack.

## 5. Measurement and regression enforcement

Default: reuse `packages/core/src/frame-budget.ts`, `TN_FRAME_BUDGET`, `TN_FRAME_HITCH`, `TN_RENDER_PROJECTION` and the existing
playtest performance infrastructure. The complete frame is update + draw prep + projection +
submission + overlay; GPU timestamps are separate and unavailable is not 0. Host gap outside
the callback is not pure GPU wait; never subtract p95 values, and do not add CPU/GPU budgets
blindly because they overlap. The resolution scaler must not lower resolution on CPU
overrun. Record adapter/hardware/browser build hashes, viewport/DPR/internal resolution/MSAA
and live simulation advancement; profiler off for timing, on separately.

Target is 60 (16.67 ms). Report p50/p95/p99/max and the >16.7/33/100 ms fractions plus actual
sim-tick advancement. **Stable 60 is currently unmet, and the 33 ms charter p99 tolerance
must not be upgraded into a stable-60 claim.** Fixed comparable seed and view, A/B/B/A,
5 minutes live per representative mission phase, never an invulnerable or static preview as
sole proof. Desktop native same content before any claim; physical mobile before any mobile
claim. A shipped change is documented separately from a proposal, and docs/capability
manifest/template `AGENTS.md` plus native proof land in the same implementation commit. Add
no new knob when the engine can measure it. Limit code growth; delete displaced game
workarounds only after equivalence, with the visual author still owning every look decision.

**Execution order — one bounded change at a time:**

1. Capture the existing handoff baseline on an isolated, current build. Separate startup
   from the steady sample and reject runs with host contention or a stalled simulation.
2. Finish the matrix-ownership regression first. Then implement and measure structural-plan
   reuse. Run the relevant projection and lifecycle tests after each separate change.
3. Implement the three-camera culling fixture before changing batch admission. Compare
   CPU submission, GPU time and visible geometry; retain conservative behavior when uncertain.
4. Instrument the cold transition, identify its actual longest stage, and fix that stage.
   Pipeline work is conditional on this evidence, not on the screenshot alone.
5. Run A/B/B/A and five-minute live coverage for briefing/deck/launch, cruise, sustained
   battle, full crowd, and recovery. Install a content-hashed engine tarball in the game.
   Reject a candidate that changes appearance, simulation pace, or another phase's budget.

Proposed Midway release gate on the declared 60 Hz reference setup: average at least
59.5 presented FPS, p95 frame interval ≤17 ms, p99 ≤20 ms, at most 0.1% above 33 ms, and
no steady-play frame above 100 ms in every live run. These are proposed stricter gates,
not existing passing results. Also retain the 16.7 ms miss rate and worst frame. Keep the
primitive-topology, preparation-count, moving-parent, transparency/order/hook and multipass
cases in the existing regression suite. A fresh template must get the optimization with
zero tuning; a game author must not become the maintenance mechanism for these fixes.

## 6. Sandbox Midway adoption (2026-09-14)

This is the engine-side record of the game adoption that the verifier's workspace cannot read
directly: the game lives at `sandbox/midway-open-pacific`, an external checkout, and reading it is
blocked by the external-directory permission rules. The source change and the raw evidence are
reproduced here so the claim is inspectable from this repository.

**Engine side.** `f7c64c5fc` on branch `perf/projection-dirty` (base `b1cae8803`) changes
`packages/core/src/renderProjection.ts` to the non-forcing call above, with four new cases in
`packages/core/__tests__/renderProjection.spec.ts` (moving object, frozen-subtree sentinel, a
scene that marks its world static, a static subtree whose parent moved). Focused run 66/66 pass;
the whole `packages/core` suite run on develop passes 113 files / 1276 tests, and `pnpm typecheck`
exits 0 after building core (2026-09-14). The content-hashed package built from it is
`threenative-core-0.3.2-projdirty-12c96c25114f.tgz`
(sha256 `12c96c25114f91335895102fc7f50c58719782c7a445d97a777dd01618bdd858`).

**Game side.** Sandbox repository `ThreeNativeHQ/examples` (`/home/joao/projects/threenative/sandbox`),
commits `8cacb94` (adoption + refactor), `7b7ef21` (evidence), `da28308` (trace). The game's
`package.json` dependency and `pnpm.overrides` and `pnpm-lock.yaml` point `@threenative/core` at the
tarball above (`pnpm install` exit 0). `midway-open-pacific/src/scenes/Midway.ts` keeps
`scene.matrixWorldAutoUpdate = false` (restored on exit) and moves the world walk off the scene
`onBeforeRender` hook onto the engine seam:

```ts
this.cleanups.push(
  ctx.beforeRender(() => {
    scene.updateMatrixWorld();
    this.world.particles.prepare(this.world.camera.position);
  }),
);
```

The refactor is mandatory, not cosmetic: with the new engine the old `onBeforeRender` hook never
fires while the projection mirror is what renders, so the authored scene's world matrices go stale.

**Stability evidence.** Real hardware WebGPU NVIDIA Turing, private virtual display:

| check | command (game root) | result |
| --- | --- | --- |
| transform regression, red | old hook + new engine, `bash tools/capture-lock.sh node tools/check-frame-transforms.mjs` | FAIL `airborne-cockpit max diff 0.66794` (stale matrices) |
| transform regression, green | refactor + new engine, same command | PASS: ratio `1.0` in all five phases (briefing 45/45, deck 46/46, airborne-cockpit 13/13, chase 45/45, wide 42/42), `maxWorldDiff 0`, finite, transforms change, no console errors |
| typecheck / build | `pnpm typecheck` / `pnpm exec vite build` | exit 0 / exit 0 |
| playtests | `bash tools/capture-lock.sh node node_modules/@threenative/playtest/dist/runner/cli.js --scenario "playtests/*.playtest.json" --url http://127.0.0.1:5399 --browser-recipe webgpu --headed --timeout 60000` | `midway-audio-realism`, `midway-briefing`, `midway-flight`, `midway-launches` all pass; top-level pass, exit 0 |
| live combat ×2 | `bash tools/capture-lock.sh node tools/capture-battle-profile.mjs` (350 m / 1500 m, CPU sampler off) | exit 0, `qualified: true`, 0 console errors, player alive (174-177 AA / 96-100 flak / 13-14 damage), `projecting: true` with the unchanged 99 batches (40 instanced, 59 material, 624 exact) |

Absolute FPS on this host is not evidence (other lanes contended the machine; the runs reported
9.7-10.0 fps). The game stayed functionally stable: no errors, live simulation advanced, the
projection verdict and batch census unchanged. The adopted fix is correctness and transform
ownership, not a frame-rate win; a per-frame saving needs a game that marks measured-static
subtrees. Stable 60 FPS remains unproved, and priorities 2-3 remain proposals.
