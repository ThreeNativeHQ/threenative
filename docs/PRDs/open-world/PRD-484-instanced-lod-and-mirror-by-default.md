---
prd_contract: v1
---

# PRD-484 — Instanced LOD and selective water mirrors work by default

**Status:** PARTIAL — started 2026-10-02.
**Progress:** 2/3 phases verified; game proof running.
**Complexity:** 3 → LOW; existing selection and reflector plumbing, state partitioning; risk override: none.
**Integration:** local branch `engine-defaults-484`, base `7b17fe081`; coordinator integrates into PR #390. No push or separate PR (owner instruction).

## Problem and outcome

Owner's RTX 2080 capture submitted 96 M scene triangles and another 96 M in the mirror.
Plain InstancedBatch ignores baked AutoLOD chains; an omitted reflection mask repeats the whole
scene. Engine mechanisms must select detail and limit the mirror without game-owned loops.
Shadow detail belongs to PRD-478 and is outside this lane.

Reuse `lodChainOf`, `selectLodLevel`, the engine's render-cadence LOD tracker and Three's reflector.
Keep geometry/material/placement supplied by the game. Preserve instance indices and explicit
authored level/mask overrides. Report missing levels once with a named `TN_*` batch marker.
Every proof below is local, executed by this agent. No FPS claim from private Xvfb.

### Phase 1 — Instanced detail follows projected error

- [x] Near/far placements partition into baked-chain draws automatically at the WorldCells 4 px budget. proof: `pnpm exec vitest run packages/core/__tests__/instanced-batch.spec.ts` red→green through `updateModelLods`. Result: green (109 tests across 11 affected specs); original batch cases red 3/3 and water cases red 2/2.
- [x] Authored levels win, failed levels report once naming the batch, and opt-out preserves the full mesh. proof: the same focused spec asserts these outcomes. Result: green (109 tests across 11 affected specs); original batch cases red 3/3 and water cases red 2/2.
- [x] Matrix animation, scaled parents, camera movement and teardown retain correct placement ownership. proof: the same focused spec checks matrices, counts and detached children. Result: green (109 tests across 11 affected specs); original batch cases red 3/3 and water cases red 2/2.

### Phase 2 — Water mirrors select their own affordable set

- [x] Omitted reflection masks draw terrain-sized static meshes and large static casters without instanced small props. proof: `pnpm exec vitest run packages/core/__tests__/water-surface.spec.ts` red→green through the actual reflector pass. Result: green (109 tests across 11 affected specs); original batch cases red 3/3 and water cases red 2/2.
- [x] Explicit reflection masks still win and temporary filtering restores scene state even after a render error. proof: the same focused spec asserts override and restoration. Result: green (109 tests across 11 affected specs); original batch cases red 3/3 and water cases red 2/2.

### Phase 3 — Shipped contract and game proof

- [x] Capability entries describe automatic defaults and named overrides. proof: `pnpm build` regenerates manifest and reference successfully. Result: exit 0, both capability manifests and generated reference updated; template AGENTS/CLAUDE conventions synced.
- [x] Required gates pass. proof: `pnpm typecheck`, `pnpm lint`, touched core specs, `pnpm budgets`. Result: exit 0 for all; 109 tests in 11 specs. Lint warnings and existing LOC review triggers are non-fatal.
- [ ] Strata with the local stopgap reverted submits low scene/mirror triangle counts under the engine defaults; restore all local game edits. proof: Strata playtest console `TN_FRAME_BUDGET` scene/mirror triangles and draw counts, paired baseline/candidate.

## Decisions

- 2026-10-02, owner: retain this integration checkout for coordinator review; do not push.
- An explicit `layers: 1` is a deliberate whole-layer override. Exact stopgap reversion restores it;
  testing the omitted-mask default requires locally omitting it as well (owner question pending).
- Strata clones and transforms loader geometry before batching; the chain must survive that path
  for a game proof to establish the requested default rather than a different fixture.

- Existing LOC triggers: no new reducer, dependency, renderer or traversal; the added partition
  controller reuses the existing selector/tracker and keeps public matrix/picking slots. The clone
  bridge keeps the baked index ladder over copied attributes. Native/shadow source is unchanged.
- The deterministic runner freezes physics while awaiting startup. The paired Strata capture uses
  the existing `__THREENATIVE_PLAYTEST_CLOCK__ = "wall-clock"` measurement switch before bootstrap;
  that temporary HTML instrumentation is restored together with the stopgap files and core dist.

## Acceptance criteria

The batch's ordinary build and engine frame loop use reduced geometry for far placements;
the water's ordinary reflected pass excludes repeated small props. Overrides remain effective,
failed rungs are visible diagnostics, and game proof reports measured triangles/draws.
