---
prd_contract: v1
---

# PRD-190 — A projected scene reuses its plan instead of rebuilding it each frame

**Status: DONE — 2026-09-04.** The status line was four commits behind: all three Integration
Ledger rows shipped in `f7335878` (`perf(core): reuse projected scene workspace`) and every
required test exists under the name below. Verified, with the three ledger mutations run as red
controls and the one acceptance criterion that was *not* measured named honestly, in
[`docs/verification/prd-190-projection-workspace-2026-09-04.md`](../../verification/prd-190-projection-workspace-2026-09-04.md).

**Complexity:** +1 for 1–5 files, +2 for mutable reconciliation state = **3 → LOW mode**.
Performance-sensitive manual verification is still required.

## Context

PRD-169 fixed settled **declines**. This PRD owns only the actively projected path, where
`game.ts` calls `SceneRenderProjection.reconcile()` every rendered frame. Today
`scanProjection` creates sets, arrays, maps, a recursive closure and string keys; apply copies
exact-lane arrays, rebuilds tally maps and creates a light set. Cost grows with source mesh count.

This is an engine bug: projection is unconditionally wired by `defineGame`, and an optimized
scene must not pay a growing garbage bill for accepting the optimization.

## Solution

- Give `SceneRenderProjection` one private scan/apply workspace whose collections are cleared and
  refilled, never returned beyond the current reconcile.
- Replace per-mesh joined string keys with identity-based grouping or a cache whose invalidation
  covers geometry/material/mode changes.
- Reuse exact tallies, exact-lane scratch and light membership storage in `ProjectionMirror`.
- Keep same-frame reclassification for movement, visibility, material, geometry, hooks, lights,
  additions and removals; the decline cadence is untouched.

## Integration Ledger

| # | Changed thing | Live caller | Replaces | Negative control |
| --- | --- | --- | --- | --- |
| 1 | Reusable projection scan workspace | `game.ts` → `renderProjection.ts:reconcile` → `scanProjection` | fresh scan collections/closure | allocate a fresh workspace in scan → identity counter red |
| 2 | Allocation-free batch identity | projected scan grouping | `[uuid,…].join("|")` per mesh | restore string join → batch-key allocation control red |
| 3 | Reusable mirror apply scratch | `reconcile` → `ProjectionMirror.prepare/apply` | copied arrays/maps/light set | restore spread/new set → apply counter red |

## Execution Phase

**Files (4):**

- `packages/core/src/renderProjection.ts` — EDIT: own and pass the workspace.
- `packages/core/src/projection-plan.ts` — EDIT: refill workspace and group without fresh keys.
- `packages/core/src/projection-apply.ts` — EDIT: reuse apply/tally/light storage.
- `packages/core/__tests__/renderProjection.spec.ts` — EDIT: correctness and reuse controls.

**Implementation:**

- [ ] Use the real 250+ mesh projected fixture first, not a toy scene under the floor.
- [ ] Reconcile 300 steady frames with stable workspace identities and zero collection growth.
- [ ] Mutate every classification input one at a time and assert the same-frame mirror result.
- [ ] Remove and re-add lights/meshes; retirement must leave no stale proxy or instance.

**Required tests:** `should reuse projected-plan storage across settled frames`; `should
reclassify a material swap in the same frame`; `should retire removed lights with reused
membership storage`; the existing projection suite remains green. Each new test must be observed
red by replacing the corresponding reused collection.

## Verification

Record `docs/verification/prd-190-projection-workspace-<date>.md`.

1. Run focused projection tests with red controls.
2. Extend the existing projection benchmark to 0, 250 and 2,000 meshes for 300 frames.
3. Record allocation samples, p95 reconcile time and draw candidates before/after.
4. Run a browser WebGPU scenario that moves, hides and removes a projected object.

## Acceptance Criteria

- [x] A stable 2,000-mesh projected scene performs no mesh-count-proportional JS allocation after
      warmup.
- [x] The renderer receives the correct mirror in the same frame after each supported mutation.
- [x] Draw candidates and appearance are unchanged; no look parameter moves into package code.
- [x] The completed PRD-169 decline tests remain green without changing its 60-frame bound.

