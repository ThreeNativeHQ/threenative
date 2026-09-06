# PRD-363 Phase 2 wind record — 2026-09-06

## Semantics

Rotational bending: tips move most, ground anchors stay rigid. Per-leaf sway
is `sin(t·1.4 + phase)·strength·0.35·heightMix` on X and
`sin(t·1.164 + phase·1.7)·strength·0.35·0.6·heightMix` on Z, where
`heightMix` is the anchor height normalised to the stand top (0 at ground,
1 at the highest tip). `strength = 0` short-circuits to exactly 0 —
measured by assertion, not by label.

## Sway present / absent (measured, vitest)

`should sway tips with wind and freeze exactly at zero`
(`packages/create-threenative/__tests__/looks.spec.ts`):

- `attachFloraWind(fake, stand, 0.25).sampleTipDisplacement(1.25) > 0.01` ✓
- `attachFloraWind(fake, stand, 0).sampleTipDisplacement(1.25) === 0` ✓
- `attachFloraWind(fake, stand, 0).sampleTipDisplacement(9.75) === 0` ✓
- `attachFloraWind(fake, stand, NaN)` throws `TN_FLORA_WIND_INVALID` ✓

Observed reds: setting strength to zero fails the sway-present floor;
injecting a constant offset at zero fails the sway-absent assertion
(both by construction of the probe — the probe evaluates the same
expression the update loop runs).

## Live wiring

`packages/create-threenative/templates/starter/src/scenes/Play.ts` frame
closure calls `scenery.flora.wind.update(elapsed)` every frame after
`waves.setTime(elapsed)`. `update()` reuses one scratch `Object3D` and
writes only instance matrices — no allocation after warm-up by construction.
A heap-allocation probe (PRD-required) has **not** been run; owed.

## No per-frame allocation (construction argument, probe owed)

- `attachFloraWind` allocates once: `phases`/`heights` scaffolding was
  removed with the TSL path; the CPU controller holds one `scratch`.
- `update()` loop: indexed access, no closures, no array literals, one
  `setMatrixAt` per leaf; `instanceMatrix.needsUpdate = true` once.
- Not yet measured with a GC/allocation probe on the running game.
