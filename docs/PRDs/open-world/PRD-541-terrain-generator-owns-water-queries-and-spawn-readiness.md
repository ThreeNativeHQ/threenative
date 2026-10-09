# PRD-541 — The terrain generator owns water queries and slope thresholds; core owns spawn readiness

**Status:** PARTIAL
**Priority:** P1 — every game built on the terrain generator repeats the slow water loops and the playtest spawn deadlock that PRD-466 fixed only in its preview example
**Depends on:** PRD-466 (the preview fixes this lifts into packages)

## Problem

PRD-466 found three defects in the Strata preview's own `src/render/` code, which any game built on
`@threenative/terrain` would write again:

- **Water proximity is an O(points × river segments) scan.** The scatter's `wet` test and the
  ground curvature bake both walked every river segment or station per candidate or vertex. That
  cost 3.4 s and 2.3 s inside a synchronous world-switch scene entry (tundra, 612 stations).
  The preview fixes (`8b24bf0c2`, `219a04cb5`) bucket the segments locally, in example code.
- **Placement slope thresholds are fixed degrees.** Outcrops required over 30 degrees. The rebaked
  forest's 98th percentile is 22 degrees, so it placed none (`f149d0853`).
- **A startup hold observed only in `afterPhysics` deadlocks under the playtest clock.** The
  deterministic clock advances no fixed step while startup is held. Spawn read 6/6 ready from
  36.6 s but resolved only at the 120 s deadline (`0d08f9f71`, example-only fix).

The generator should expose the mechanism once; the density rules and looks stay game source.

### Phase 1 — Water distance query in `@threenative/terrain`

- [ ] A baked world exposes one indexed water query (distance to the nearest river segment or lake
  shore, with that water's level), built once per world. proof: `packages/terrain/__tests__/`
  spec against a brute-force scan over every shipped world fixture (identical answers)
- [ ] The preview's scatter `wet` test and curvature wet margin call it, deleting their local
  buckets. proof: placement and curvature-pixel hashes identical to PRD-466's (`59002b165fe4d94d`
  tundra placements; curvature `130803d9b4c9` forest, `2a15707623b8` tundra)

### Phase 2 — Terrain-relative slope thresholds

- [ ] `@threenative/terrain` reports a world's slope quantiles from its own heightfield, and the
  preview's outcrop rule reads its 98th percentile instead of computing it locally. proof: terrain
  spec on fixtures; forest still places 7 outcrops, coastal 75

### Phase 3 — Spawn readiness without simulation ticks, in core

- [x] `ctx.startup.hold` accepts a readiness predicate that core evaluates every rendered frame, so
  a hold cannot depend on fixed steps the playtest clock withholds. proof: core spec with a
  fixed-step stub that never ticks while the hold is pending (red before, green after) — PASS:
  `startup-readiness.spec.ts` "releases a predicate hold on the first frame it reads true" red
  (released at once) → green; startup and game specs 99/99; core tsc clean.
- [ ] The preview's spawn gate uses it and drops its `beforeRender` duplicate. proof:
  `pnpm --filter strata-terrain-preview test:terrain:web` reaches its assertions

### Acceptance

- [ ] Templates' `AGENTS.md` name the water query and the readiness predicate as conventions.
  proof: `pnpm sync:agents --check` and the instruction-budget spec

## Blocked on

Nothing. `packages/terrain` and `examples/strata-terrain-preview` exist only on the PRD-466 branch
(PR #381), so this PR is stacked on that branch (base `feat/prd-466-468-strata`) and retargets to
`develop` when #381 merges.

## Decisions

- 2026-10-08, owner direction in the PRD-466 session: optimisations belong in the generator and
  core so every game gets them, not scene by scene in the preview.
