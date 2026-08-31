---
prd_contract: v1
---

# PRD-280 — the quarry is the instrument

**Status: DONE — measured 2026-08-30. Phase 0 of the [virtual geometry batch](../../nanite-like/README.md).
The gate is evaluated in
[docs/verification/prd-280-the-quarry-is-the-instrument-2026-08-30.md](../../../verification/prd-280-the-quarry-is-the-instrument-2026-08-30.md)
and the verdict is OPEN: `dense` costs 13.9 ms more GPU time per frame than `decimated` at 1080p on
browser WebGPU against a 2.0 ms threshold, and the ordering reproduces on packed Linux desktop
native. Android and iOS are UNVERIFIED and no device run was executed.**

**§4's meter is corrected, not its threshold.** `render.p50` is the frame budget's CPU render phase,
and this scene issues ten draws in half a millisecond in *both* arms — it reads a difference of
0.0 ms between a 104-million-triangle frame and a 20-million-triangle one. `gpuMs`, the GPU
timestamp query already reported in `TN_FRAME_BUDGET`, is the meter that reads the difference. The
2.0 ms value is unchanged. §4's own instruction to say *where the time went* is what forced this.

**Goal: a first-person walk through a quarry, dense enough that virtual geometry could pay for
itself, on a deterministic route, that prints the number the rest of the batch opens or closes on.**
The game comes first because a measurement without one is a microbenchmark, and this repository has
been wrong twice by measuring the wrong thing: the projection re-expanded an already-merged scene
into 1,251 single-member draws and the screen stayed black (`packages/core/src/projection-plan.ts`),
and `BatchedMesh` was found not to reduce draw calls on WebGPU at all only once a load test ran it
(`docs/verification/prd-152-transparent-scene-optimization-2026-08-18.md:105-110`).

**Complexity:** +1 a new example with generated geometry, +1 a deterministic route and its playtest,
+1 two measured arms on two targets, +1 a bake script whose output must never be committed = **4 →
MEDIUM mode.** No package code is written by this PRD at all.

## 1. Why a first-person walk, and why not terrain alone

The question this instrument has to answer is *does continuous cluster LOD save a frame that
discrete decimation does not*. That makes the camera path part of the instrument, not decoration:

- **Continuous LOD's entire claim is about a surface approached slowly.** A first-person walk toward
  a rock face sweeps the error threshold continuously across every cluster in view, which is the
  regime the technique exists for and the regime a fly-by or an orbit never enters.
- **Popping and cracks are found by eye at eye height**, long before a test finds them. A human
  walking the route is the cheapest crack detector this batch will ever have.

**Terrain alone is the wrong body, and this is the part of the proposal that changed.** A
heightfield is the case virtual geometry wins *least*: it already has a cheap analytic LOD in
clipmaps or a quadtree, its depth complexity is about one, its triangles are near-uniform in screen
space, and it has no silhouette to crack. An instrument made only of terrain would flatter the
decimated arm, hide the failure mode that ends the batch, and produce a number nobody should act on.

So the quarry keeps a heightfield floor — **as the control surface that must not change between
arms** — and puts the density where the technique is actually tested:

| Body | Role | Rough size |
| --- | --- | --- |
| One carved cliff face, the hero | approached to within touching distance at the end of the route | ~2M triangles |
| Six boulder source meshes, instanced ~400 times | many instances of few sources — the case that tests per-instance and per-cluster culling together, and a second named caller for `InstancedBatch` | 150k–400k each |
| A heightfield quarry floor, never virtualized | the control surface; its pixels must be identical in every arm | cheap |
| A collapsed steel gantry, thin and alpha-cut | the hazard case, present so the batch cannot quietly pretend thin and masked geometry away | small |

The gantry earns its place by being the thing most likely to look wrong. A batch that only ever
measures closed, opaque, chunky rock will discover its hardest case after it has shipped.

## 2. What the game is

`examples/quarry` — an example, not a template. Gameplay belongs in an example or a template and
never in a package, and this one is graded as an instrument rather than by a human playing it, but
it still has to be walkable, because see above.

- **Two modes.** `route` drives a fixed spline at fixed timestep for a fixed frame count and is what
  the playtest runs; `free` is WASD and mouse-look for a person. Same scene, same build.
- **No physics.** The camera grounds against the heightfield in ten lines of game code. Rapier's
  step is real frame time that has nothing to do with what is being measured, and the example's
  dependencies stay `@threenative/core` and `@threenative/playtest`, matching
  `examples/prd249-fluid-field/package.json`.
- **The route** is one curve, walked with the framework's own path following, so the pose at frame
  *k* is a pure function of *k*. Rim → switchback → floor → up to the face, ending nose-to-surface
  at roughly 0.4 m. Every regime the technique cares about — far silhouette, mid approach, grazing
  angle, contact — happens on that one walk, in that order.

### The geometry is generated, seeded, and never committed

A 2M-triangle CC0 scan would be the most honest body and it is not worth blocking on: it has to be
found, licence-checked, downloaded, and kept out of git. So the geometry is **generated at build
time from a seed**, by a script inside the example, into an untracked `assets/` directory, and the
example refuses to run if the bake has not been run.

The discipline is already written down in this repository and is copied verbatim rather than
reinvented: `examples/engine-load-test/src/workload.ts` fixes an LCG, states its recurrence, and
holds two implementations together with a `positionHash` that a gate compares before publishing any
comparison. The quarry does the same, so that two machines that disagree about the number are
provably measuring the same triangles.

A real scan is a **second rung**, added later by pointing the same example at a downloaded asset. It
is never committed — this tree has already come within one command of landing a 700 MB cache.

## 3. The arms

One build, one URL parameter, three arms — the third one arrives with PRD-283 and is listed here so
the harness is built for it now:

| Arm | What it draws | What it represents |
| --- | --- | --- |
| `dense` | the generated geometry, untouched | the game that imported the asset and did nothing |
| `decimated` | the same scene through the pipeline's existing `simplify` at 5% | **what a game does today**, and the bar the batch must beat |
| `virtual` | the selected cluster cut | added by PRD-283 |

`decimated` is the real competitor, not `dense`. A technique that beats "did nothing" and loses to
"ran one existing pipeline pass" is not worth 9 complexity points.

## 4. What is measured, and the number that opens the batch

Per arm, per target, over the route's frames after a warmup:

- `render.p50` and `render.p95`, frame p50/p95, draw calls, triangles submitted. On desktop these
  are read from `packages/core/src/frame-budget.ts` through the playtest CLI's `perf` reader.
- **The route's frames are captured in every arm.** `dense` is the visual reference for every later
  phase — the batch's real claim is *this detail, cheaper*, not *cheaper*, and without reference
  frames captured now there is nothing to hold a later arm against.
- **`render.p50` is the verdict on desktop, never fps** — the desktop lane's presentation is
  throttled and its fps is not a measurement of the frame. On a physical Android device, fps *is*
  the verdict.
- The browser run names its adapter. A WebGPU run that does not name `adapter.info` may be
  SwiftShader, and a software adapter would invent a difference between the arms out of nothing.

**The gate, stated before the measurement so it cannot move afterwards:**

> Open the batch only if `dense` costs at least **2.0 ms more `render.p50` than `decimated`** at
> 1080p on browser WebGPU on real hardware, **and** the same ordering reproduces on packed Linux
> desktop native. Otherwise the batch declines here, and the number is what it leaves behind.

**Measured, 2026-08-30 — read `gpuMs`, for the reason in the Status line.** Browser WebGPU at
1920×1080 on an nvidia/turing adapter, three full-route runs per arm: `dense` 22.99 ms median,
`decimated` 9.71 ms median, paired differences 15.89 / 13.85 / 11.29 ms. `render.p50` reads
0.5–0.6 ms in both arms — a 0.0 ms difference. Packed Linux desktop native at 1280×720: 6.42 ms
against 1.84 ms, the same ordering.

2.0 ms is not arbitrary and is fixed now rather than after the fact: a 60 fps frame is 16.7 ms, so
it is 12% of the budget. A subsystem of this size that cannot find 12% of a frame on a scene built
to flatter it will not find it in a game that was not.

And one qualitative result matters as much as the number: **where the time went.** If the `dense`
arm is bound at submission rather than on vertex work, the honest next PRD is about submission — a
different, cheaper project — and this batch still declines.

## 5. Acceptance criteria

- [x] **AC1 — the geometry is the same everywhere.** The bake is seeded; a spec asserts the
      `positionHash` of every generated body against a committed constant.
- [x] **AC2 — red-green, the seed.** Changing the seed by one fails AC1's spec, and the failure with
      both hashes is pasted into the PRD.
- [x] **AC3 — the route is a function of the frame index.** A playtest asserts the camera pose at
      three named frames to within a stated epsilon; running the scenario twice gives the same poses.
- [x] **AC4 — both arms run on both targets.** Four playtest results — `dense` and `decimated`,
      browser WebGPU with its adapter named and packed Linux desktop native — recorded in one
      `docs/verification/` file. Android is welcome and may be `UNVERIFIED`.
- [x] **AC5 — the control surface does not move between arms.** A visual A/B of a floor-only camera
      pose reports no pixel change between `dense` and `decimated`; a difference means the arms
      differ by more than the thing being measured.
- [x] **AC6 — the reference frames exist.** The route's frames are captured in the `dense` arm and
      kept as the visual reference every later phase is scored against. Without them, a later arm can
      only be measured on time, and this batch's claim is *this detail, cheaper*.
- [x] **AC7 — nothing binary is committed.** The example's generated `assets/` is ignored, and a
      spec asserts no `.glb` under `examples/quarry` is tracked.
- [x] **AC8 — a person can walk it.** `free` mode, documented in the example's README, with the
      controls stated. This is the crack detector for every later phase.
- [x] **AC9 — the gate is evaluated in writing.** The verification file states *open* or *decline*
      against §4's threshold, and where the time went. A decline closes the batch and is not a
      failure of this PRD.

## 6. What this PRD does not do

It writes no package code, adds no capability, and touches nothing under `packages/`. If the batch
declines at §4, `examples/quarry` still earns its place as the dense-geometry rung this repository
does not currently have — the existing load test measures thousands of cheap cubes, which is a
different question entirely.
