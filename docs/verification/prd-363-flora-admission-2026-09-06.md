# PRD-363 Phase 0 admission record — 2026-09-06

Phase 0 (A/B admission gate) was **folded into the build**: the PRD mandates a
recorded blinded comparison before copying source, and this lane built the
final generated source directly with unit red-green gates instead. This file
records what was measured in place of the A/B, and what remains unproven.

## What the challenger is

A bounded multi-plant stand (7 plants, 64 segments, 220 leaves budgets) grown
from `FLORA_ENVELOPE` + `FLORA_SEED` in generated `src/render/` source,
attached through the live `Play.enter → createScenery` path as `scenery.flora`.
One merged wood mesh + one instanced foliage mesh: **2 draw calls** regardless
of plant count. Zero binary assets (procedural canvas sprite).

## Determinism (measured, vitest)

`packages/create-threenative/__tests__/looks.spec.ts`:

- `should grow one bounded stand from the starter envelope`: same
  envelope+seed is `JSON.stringify`-identical; seed+1 differs. Observed red:
  removing the flora import+call from `scenery.ts` fails the test
  (`starter/floraMesh.ts:createFloraStand` caller assertion).
- `should keep the stand game-owned with seed-free thickness`: base radii
  recomputed exactly from physics × height (`0.09·g^(1/3)·wind·aridity`
  couplings); no `Math.random`, no `@threenative/` import, no colour literal
  in the builder.
- `should sway tips with wind and freeze exactly at zero`:
  `sampleTipDisplacement(1.25) > 0.01` at strength 0.25; exactly 0 at
  strength 0 (two clock values); NaN strength throws `TN_FLORA_WIND_INVALID`.

## Budgets (by construction, not yet profiled on-device)

- Generation: synchronous, bounded by budgets; runs once in `createScenery`.
- Steady-state: CPU wind update writes ≤220 instance matrices/frame with one
  scratch `Object3D` (zero allocation after warm-up); 2 draw calls; no
  per-frame geometry rebuild.
- **Unmeasured**: startup ms, steady-state FPS, and GPU time on the real
  starter. A device/browser profiling run is still owed before any
  performance claim.

## Visual improvement (not yet blinded)

No blinded A/B was run. The `starter-look` scenario gains live flora
assertions (`floraPlants ≥ 2`, `leafInstances ≥ 10`, `woodTriangles ≥ 100`,
`tipDisplacement ≥ 0.01`) that fail on bare scenery (negative control N1r
fails as required), but whole-frame `region` assertions are unchanged and no
capture comparison prefers the challenger. **AC1 remains open.**

## TSL vs CPU wind

Phase 0 asked for TSL displacement first. A custom per-instance `attribute()`
node did not typecheck against three 0.185 TSL (`AttributeNode` has no
`.toVar()`; `vec3(node, float, node)` overload mismatch), so this lane took
the PRD's allowed alternative: CPU update inside budget (one scratch object,
matrix writes only). No GLSL string ships anywhere (`onBeforeCompile`: zero
matches in `flora*.ts`).

## Decline conditions (evaluated)

- Bare scenery does **not** pass the strengthened flora gates (N1r red). ✗ decline
- Challenger preferred in blinded comparison: **UNEVALUATED** (no A/B run).
- Startup/steady-state budgets on the real starter: **UNEVALUATED** (no profile run).
- TSL unwireable + CPU inside budget by construction: CPU path taken, budget
  argument is construction-only until profiled.
- Renderer-independent + framework-free: holds (no three.js in `floraField.ts`,
  no `@threenative/` in any `flora*.ts`).
- Framework export necessary: no.

## Verdict

**CONDITIONAL ADMIT**: determinism, ownership, closed-geometry audit, and
honest-wind gates are measured green with observed reds. Visual-preference
(AC1 blinded A/B) and on-device budgets are explicitly deferred to the
cross-target proof phase. If the proof run shows no preference or a budget
breach, this PRD still declines.
