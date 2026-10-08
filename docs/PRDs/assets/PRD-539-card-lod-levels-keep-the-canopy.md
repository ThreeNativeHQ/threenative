# PRD-539 — Card LOD levels keep the canopy

**Status:** IN PROGRESS
**Priority:** P1 — Open: PRD-478's walking GPU p95 on Machinefall needs these trees to have a chain, and today a chain thins their needles visibly.
**Complexity:** 5 (MEDIUM) — one cook stage (`packages/assets/src/lod/`), the model pass's self-check, a Machinefall re-cook with timing and blind raters
**Owner:** João
**Depends on:** none. [PRD-478](../open-world/PRD-478-open-world-frame-architecture.md)'s AC-2 and AC-3 depend on this PRD.

## Context

Measured on Machinefall `map-walk`, desktop RTX 2080, quiet desktop (load under 10), 2026-10-08:

| Fact | Value |
| --- | --- |
| Early-route GPU p95 (route windows 1–2) | 9.2–9.8 ms; `gpuMain` p50 8.6 ms, 8.2 M main-pass triangles at the adaptive bias cap 2.5 |
| Single-level trees in that window | 9.4 M of 9.8 M triangles; `map_tree_kite_scotspinetall_01_far_0_001` alone is 545 instances x 8.9 k |
| Why single-level | the GLB's only mesh is the Fab pack's `*_far_LOD2`, and the cook skips any level-named mesh as `authored-lod` |
| With a chain (re-cook, same JS bundle) | route GPU p95 max 7.73 ms; the pooled walking bound has 1.6 % of frames over 8.3 ms (pass is 5 %) |
| What the chain costs | blind look: mid-distance pines read as bare trunks. The needle part takes the `cards` strategy, which keeps 50 % then 25 % of the cards **unscaled**, so canopy area falls to the keep ratio (`cards.ts`, PRD-458 AC-4) |

Keeping the needles at full cards is not an option: with every card part at LOD0 the early route goes to 11–13 M triangles, more than today.

## Solution

1. **A lone level name is not an authored chain.** The cook counts an asset as authored LOD only when it holds two or more level-named nodes. A lone `_LOD2` has no sibling for anything to select, so it is that asset's LOD0. Already written and red-green on PRD-478's branch (`d65fa1eab`); it moves here so it never ships without step 2.
2. **Card levels keep their coverage.** A card level appends a copy of each kept card, scaled about its centroid by `sqrt(1 / keep)`, to the primitive's own vertex arrays. The level's indices point at those copies. LOD0's indices do not change, and no schema changes: `TN_discrete_lod` stays index-only, and both readers (core's `model-lod.ts` and the world's `chainLevelParts`) already copy the base attributes and swap only the index buffer.
3. **The self-check measures what LOD0 draws.** `reachableStats` counts the vertices and the bounds that LOD0's indices reference. Appended level vertices are then not drift, and a real drift in LOD0 still fails.

Layer: the cook (`packages/assets/`). The game sets nothing; the scale is the keep ratio, which the reducer already owns.

## Acceptance Criteria

- [ ] AC-1: every card level ships ≥ 0.95 of LOD0's card area, read back from the cooked bytes. proof: `foliage-lod.spec.ts`
- [ ] AC-2: Machinefall `map-walk` route GPU p95 passes the pooled walking bound (≤ 5 % of walking frames over 8.3 ms) on 3 quiet runs. proof: `TN_FRAME_BUDGET` windows, quiet desktop RTX 2080
- [ ] AC-3: no visual loss against PRD-478's tip. proof: 3 fresh blind raters at or above on the 4 `map-walk` and 4 `map-views` poses, and a pop series with no candidate-only late object

## Execution Phases

#### Phase 1: The cook
**Status:** IN PROGRESS
**Files:** `packages/assets/src/lod/{cards,generate,eligibility}.ts`, `packages/assets/src/passes/model.ts`, `packages/assets/__tests__/`

- [ ] A lone level-named mesh gets a generated chain; two or more level-named nodes stay `authored-lod`. proof: red-green `lod-generation.spec.ts`
- [ ] Card levels index scaled copies of their kept cards, LOD0 indices unchanged. proof: red-green `foliage-lod.spec.ts` (AC-1)
- [ ] The model pass's self-check counts what LOD0 draws, so a card chain cooks without `TN_ASSETS_MODEL_DRIFT` and a LOD0 drift still throws. proof: `model-pass` specs

#### Phase 2: Both runtimes draw it
**Status:** NOT STARTED
**Files:** `packages/core/__tests__/`

- [ ] Core builds a card level whose geometry draws the scaled copies. proof: a core spec that loads a cooked card GLB
- [ ] The native desktop host draws the same chain. proof: PRD-377's native consumer playtest on a cooked card asset

#### Phase 3: Machinefall
**Status:** NOT STARTED
**Files:** none in the engine

- [ ] Re-cook and time it. proof: AC-2's quiet runs
- [ ] Blind raters and the pop series. proof: AC-3's sheets on the PR
