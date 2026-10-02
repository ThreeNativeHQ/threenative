# PRD-479 — Fluid particle motion and sampling regressions

**Status:** PARTIAL — source regressions repaired; runtime qualification pending.
**Owner:** Core / particle-fluid regression follow-up.
**Depends on:** Merged [PR #389](https://github.com/ThreeNativeHQ/threenative/pull/389).

## Problem and scope

The fluid solver shipped by [PRD-476](../done/PRD-476-fluid-lab-particle-water-at-60-fps.md)
still contains three reproducible correctness defects at develop `569fdb267538c5eae9472760fd71be59745b9a24`:

- An 18 m/s particle starting at x=-1.05 crosses the default 0.1 m dam gate in a single
  1/60 s endpoint-only prediction. Its endpoint x=-0.75 lies beyond the gate's expanded
  interval [-1.0468, -0.7532], so endpoint projection misses it.
- Component-wise velocity clipping permits vector speed sqrt(3) times `maxSpeed`, and
  collider projection can produce an over-limit final velocity.
- `sample` extends boundary water outside the tank, while a valid one-column volume can
  never satisfy the fixed four-column minimum and incorrectly reports the floor.

The actual merged source matches blob `44159cd07db98a88bc5d0e3b4d46bd542d574dba`.
The new generated-WGSL/sampler regressions fail three tests against those exact bytes;
the repaired source passes all 15 fluid tests. The numeric collision still requires a
real GPU readback before it is qualified.

This is a focused regression follow-up with its own PR. It does not rewrite the merged
PRD, redesign the solver, change its neighbor passes, add public API, or qualify new
frame-rate claims. The original PRD's recorded 16.8 ms presented p95 is not a passing
measurement for a literal 16.7 ms limit; no limit is relaxed here.

## Implementation

Use vector-magnitude clamping before prediction and after confinement. Subdivide the
predicted displacement into radius-sized segments and project each one using the
existing collider routine; the default worst case is four projections in the same
compute dispatch. This repairs the reproduced stationary gate case, not exact swept
collision detection for arbitrary grazing contacts or teleported colliders.

Keep the sampler's existing averaging policy, return the floor outside its authored
bounds, and admit fewer than four samples only when the whole volume has fewer columns.
The look remains game-owned. Reuse the public playtest bridge and the existing native
host for rendered evidence, with actual particle-buffer readbacks and no CPU solver copy.

## Execution phases

### Phase 1 — Repair the source contracts

- [x] Generated prediction and confinement shaders apply vector speed limits and radius-sized prediction segments. proof: `pnpm exec vitest run packages/core/__tests__/fluid-particles.spec.ts` — all 15 pass after the original merged source fails the new shader contract.
- [x] Surface sampling returns the floor outside bounds and the observed height for valid small volumes, excluding covered columns. proof: the same fluid suite — both new sampler regressions fail on merged source and pass after repair; `gpu-readback.spec.ts` also passes 11/11.

### Phase 2 — Qualify actual GPU behavior

- [ ] Browser WebGPU keeps the default-speed particle on the correct side of the gate and preserves unobstructed motion and both speed limits. proof: `sh scripts/xvfb.sh pnpm exec tsx scripts/verify-fluid-collision.ts` with current-source readbacks and before/after captures.
- [ ] Linux native executes the same authored four-arm probe with the same numeric bounds. proof: `node --import tsx scripts/verify-fluid-collision-native.ts` in the maintained `Linux native fluid correctness` hosted job, with the current-source fixture and runtime hash.

### Phase 3 — Preserve the existing consumer

- [ ] The existing browser dam-break and coupling scenarios pass their unchanged state and nonblank-image criteria on this source. proof: `sh scripts/xvfb.sh pnpm exec tsx scripts/verify-fluid-consumers.ts`, which runs `fluid-particles.playtest.json` and `fluid-particles-coupling.playtest.json` unchanged through the public runner.

## Acceptance criteria

- [ ] The four-arm GPU fixture verifies the regression repair on both qualified runtimes with finite actual buffer values and the specified speed bounds. proof: completed Phase 2 browser/native results above, with exact source and image hashes.
- [ ] The public fluid API and existing dam-break/coupling behavior remain compatible. proof: completed Phase 3 results plus full core tests, typecheck and unchanged API-surface validation.

## Verification notes

The missing-gate fixture is an assertion check, not another feature or acceptance box:
it must fail only `resource.FluidCollision.collisionPassed`. Every unexpected diagnostic,
including software device loss, invalidates the capture. Software adapters may establish
correctness but cannot establish hardware performance. Root CI must be green for the
exact final source before this PR is eligible to merge.

Initial `256059b2` local checkpoint: core 2,223 passed / 2 skipped; focused fluid/readback/proof tests 39/39 and CI structure/needs 141/141 pass. Package builds, full root/workspace typecheck, API/capability validation and lint pass (warnings remain). The ordinary root `pnpm test` launcher is blocked before execution by the local `tsx` Unix-socket restriction; this is not a full-suite pass. Independent review cleared the source and fail-closed proof routes. All runtime boxes remain open until hosted execution produces exact-source images and measurements.

First hosted diagnostic: [run37047774012](https://github.com/ThreeNativeHQ/threenative/actions/runs/37047774012) at `256059b2` reached actual GPU readbacks. Gate x=-1.046800017, free x=-0.75, diagonal travel0.300000029m and final speeds18.000000916/18m/s satisfy the fixed numeric checks. Qualification nevertheless failed `TN_CAPTURE_BLANK`: the original flat marker/gate image has only three colors. The unchanged [before](../../verification/prd479/256059b2-diagnostic/before.png), [after](../../verification/prd479/256059b2-diagnostic/after.png) and [minimal provenance](../../verification/prd479/256059b2-diagnostic/provenance.json) preserve this failure. The marker now draws the actual GPU position as a shaded sphere at `spacing * 0.44`, the solver collision radius; the gate geometry, numeric assertions and capture guard remain unchanged. A geometry/material regression passes. New positive/control and native/consumer execution remain pending; no runtime box is ticked from the diagnostic alone.

The next qualification source also reconciles develop `42fa306c0c46417afb4cafda23f55d09a557f860`, preserving its WorldCells/TerrainTiles/VirtualShadowNode changes. The fluid solver and numeric predicates remain byte-identical to the first diagnostic; only the physically sized particle visualization changes. Combined-source core build/declarations, full root/workspace typecheck and lint pass (1,014 warnings, no errors). The affected world/fluid/proof suite passes 203 tests with two skips. The real documentation/evidence budgets pass. Actual browser/native/consumer qualification still needs the new head; these local gates are distinct from the earlier runtime diagnostic.
