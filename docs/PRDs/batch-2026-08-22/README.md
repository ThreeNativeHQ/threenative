# Batch — performance night: stop paying for what nothing asked for, 2026-08-22

**Status: ACTIVE, filed 2026-08-22 evening. Eight new PRDs, PRD-168 through PRD-175, all
`NOT STARTED`.** Every item in this batch is an unconditional per-frame cost paid by games
that never asked for it: a framebuffer copied nobody requested, a scene re-judged whose verdict
was already no, arrays thrown away per body per step, a navmesh path computed twice, render
metrics collected for a reader that is usually absent. None reopens a settled question: the
PRD-069 knee is closed (no threshold under V8), BundleGroup-for-moving-geometry is dead, and
the worker idle poll is fixed.

## Why this batch, today

A four-lane performance audit (packages/core, packages/physics + ui + templates,
packages/runtime-native, open-PRD state) produced 27 evidenced findings; eight survived
vetting against the code well enough to schedule tonight, and the rest are recorded at the
bottom so they are decisions rather than oversights. Two facts set the priorities:

1. **Every native benchmark number currently carries a hidden tax.** The host copies the whole
   framebuffer into a MAP_READ staging buffer and spins up to 100 device-tick iterations
   before *every* present, whether or not anything wants a screenshot
   (`bindings.cpp:6107 → :6020-6088`). PRD-168 gates it behind a request. Until it lands,
   every load-test baseline and js-engine comparison is measured through this tax.
2. **The linear JS term is now ordinary optimisation.** PRD-069 Phase 0 answered the knee
   question (flat ~4.0 ms to 1,000 objects, ≈0.70 µs/object beyond, Pixel 8, V8 — see
   `docs/verification/prd-069-phase-0-v8-draw-ladder-2026-08-21.md`). What remains is
   per-frame CPU and GC churn, which is exactly what PRD-169 through PRD-174 remove.

## The PRDs

| PRD | What it closes | Complexity | Lane |
| --- | --- | --- | --- |
| [168](./PRD-168-present-capture-gated-on-request.md) | Per-frame framebuffer readback + 100-iteration spin in every presented native frame | 6 | local (native build + desktop gates) |
| [169](./PRD-169-projection-declines-without-rescanning.md) | The render projection forces a full-scene matrix pass and classification walk every frame even while permanently declined | 5 | local |
| [170](./PRD-170-physics-hot-paths-allocate-nothing.md) | Per-body-per-step allocations on the physics transform/input paths | 4 | local |
| [171](./PRD-171-navigation-one-path-per-retarget.md) | Double `computePath` per retarget; crowd sync teleporting stationary agents every frame | 4 | local |
| [172](./PRD-172-diagnostics-cost-nothing-until-asked.md) | `renderer.info` unexposed (PRD-069 crit. 7); render metrics sampled every frame for a reader that is usually absent | 3 | local |
| [173](./PRD-173-framework-hot-path-churn-sweep.md) | Six small per-step allocation/scans in core (queueFree, scheduler, input.tick, replay rect, GroundSnap, ScenePicker) | 5 | local |
| [174](./PRD-174-templates-model-zero-allocation.md) | Template-generated source rebuilding HUD glyphs / cloning vectors per frame | 3 | local |
| [175](./PRD-175-present-instrument-truth-and-missing-rungs.md) | Present counted ~4.3x per frame in the js-engine measurement report; ladder rungs 500/4000 unmeasured | code 3, device 7 | code local; rungs need the cooled phone |

## Order

1. **PRD-168 first** — biggest win and the only one needing `pnpm native:build`; starting it
   first puts the long compile behind the rest of the night.
2. **PRD-172 second** — its `renderer.info` exposure and on-demand sampling are the
   observability later evidence stories quote; nothing else depends on it, but several get
   easier with it landed.
3. **169 → 170 → 171** in that order: core, then physics, then navigation (navigation sits on
   top of physics' plugin loop).
4. **173 → 174** — the churn sweep, then the templates that model behaviour to agents.
5. **PRD-175's code half anytime; its device rungs are the HIGH lane** and run only when the
   phone passes its ≤31.5 °C battery-temp preflight (`docs/verification/` thermal discipline
   from the 2026-08-21 ladder applies verbatim).

No PRD in this batch depends on another for correctness — the order above is value and
compile-time scheduling, not a dependency graph.

## Concurrency

Another lane is editing shooter-input proof files right now
(`packages/create-threenative/__tests__/playtest.spec.ts`,
`packages/create-threenative/templates/shooter/**`,
`packages/runtime-native/tests/generated-shooter-input.test.mjs`). No PRD here touches those
files; if a gate fails inside them, it belongs to that lane — record it and move on.

## Deliberately left out

Recorded so the next round does not rediscover them; none blocks this batch.

1. **Bloom threshold 0.2 default in all seven templates**
   (e.g. `templates/starter/src/render/postprocessing.ts:17`). A fullscreen multi-mip pass in
   every scaffolded game including mobile — but it is the shipped look default, so changing it
   is a look decision with visual-baseline re-derivation, not an overnight mechanical fix.
   Owner call.
2. **`useGameState` has no unstable-selector guard** (`packages/ui/src/useGameState.ts` —
   selector identity changes re-render 10 Hz forever). Latent API hardening, not a live
   regression; templates' selectors are clean today. Next batch.
3. **Native `getCurrentTexture` rebuilds its JS wrapper + closures per frame**
   (`bindings.cpp:1155-1219`). Real GC churn; caching must respect frame-boundary resets.
   Worth its own PRD with load-test evidence, not a row here.
4. **Android sRGB presentation bridge creates a texture + bind group per frame**
   (`bindings.cpp:932-934`, `:853-865`). Mechanism certain, magnitude unprofiled — measure
   first, per the house rule.
5. **V8 persistent-handle churn per bridge crossing** (`v8_engine.cpp:391-496`). L-sized
   architectural work (per-frame arena); needs its own PRD and a profile justifying it.
6. **Web `readVisibleTransforms` pays 2N Rapier-compat wrapper allocations per frame**
   (`simulation.ts:933-947`). No bulk float reader in the compat API; reaching into `.raw` is
   fragile. Measure at 500+ bodies before committing to anything.
7. **Playtest bridge rebuilds registry snapshots per contact event**
   (`playtest.ts:330-338`). Harness-time only; folded into PRD-173 as its seventh row.

## What this batch does not claim

Nothing here claims mobile-ready, a device win, or a platform it did not execute. Desktop
browser + desktop native are the executable lanes tonight; the Pixel 8 is attached but every
device criterion is gated on its own thermal preflight and lives in the HIGH lane. Frame-time
deltas quoted by executed PRDs are desktop numbers unless a device record says otherwise.
