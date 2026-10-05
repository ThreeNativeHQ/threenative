# PRD-493 — Terrain layers past sixteen textures

**Status:** PROPOSED
**Priority:** P2 — Layer arrays, a 0.5 ms bound and the 16-layer fallback are all unbuilt.
**Complexity:** 3 (LOW) — 1–5 implementation files (`world-terrain-splat.ts`, the two identical `export_world.py` recipe copies) (+1); Machinefall re-exports its table and releases separately (+2); risk override: none
**Owner:** João
**Depends on:** None

## Context

`loadTerrainSplat` (`packages/core/src/world-terrain-splat.ts`) builds the splat material for `WorldCells`. Machinefall uses it (`apps/client/src/level/World.ts`) for a base plus 7 layers, 3 of them with normal maps. The audit's "capped at 16 textures" is only half true:

- **Already stacked:** the splat masks are one `DataArrayTexture` (`splatArray`). The albedo and normal sets each collapse into one `CompressedArrayTexture` (`stackLayers`), as long as every layer is compressed with the same format, size and mip count. That path costs one sampler per set, whatever the layer count.
- **Still capped:** uncompressed layers do not stack. `stackLayers` returns `undefined` for anything that is not a `CompressedTexture`, so each layer binds its own sampler and only a `TN_TERRAIN_SPLAT` warning is printed. That is the path for any game that skips the KTX2 cook, and for Android and iOS, which have no KTX2 transcoder (`packages/runtime-native/AGENTS.md`). On those hosts the cap is real.
- **Stale contract:** the `@constraint` still says "planes + diffuse maps + normal maps must fit" in 16. It also names an `export_terrain_layers.py` recipe that does not exist; the function `export_terrain_layers` lives in `export_world.py`. `capabilities.json` repeats both.
- **No per-layer roughness or AO.** The material hard-codes `MeshStandardNodeMaterial({ metalness: 0, roughness: 0.92 })`. That is a look constant in package code, and every layer gets it. Megascans-grade layers ship albedo + normal + ORM.
- **Cost grows with layer count.** Every pixel samples every layer through the `mix` chain, and triplanar layers sample three times.

Out of scope: virtual texturing (WORLD-STREAMING.md) and texture residency ([PRD-VQ-10](../performance/PRD-VQ-10-texture-mip-residency.md)).

## Solution

Mechanism in `packages/core`, values in the game's table:
1. **Uncompressed layers stack too.** Same-size uncompressed maps go into one array texture per set, through a GPU copy into each layer and not a CPU pixel read. Mixed sizes still fall back, now with a marker that names the sampler count.
2. **ORM is a third set.** A layer with `orm: true` in the table reads `<id>_orm.jpg` as linear data into `roughnessNode`, `aoNode` and `metalnessNode`. Layers without it use the table's own `roughness` and `metalness`. The 0.92 constant leaves the package. The export recipe writes `_orm` beside `_diff` and `_nrm`, in both copies of `export_world.py`.
3. **The marker reports cost.** `TN_TERRAIN_SPLAT layers=<n> samplers=<n> stacked=<sets>` prints once per material.

The blend curve keeps its current form (mask, `lo`/`hi`, breakup push, macro noise), and every value still comes from the game's table. A game that wants a different curve edits the returned material. No new curve vocabulary goes into the package. Top-K weight sampling is added only if AC-2 fails without it.

## Acceptance Criteria

- [ ] AC-1 [local]: Machinefall's map-walk with ORM layers is judged at or above develop on every pose, with no seam or tiling artefact named. proof: `pnpm visuals:world --before <develop> --after <candidate>` plus 3 verdicts.
- [ ] AC-2 [local]: the same walk's `gpuMain` p95 rises by no more than 0.5 ms over develop on the RTX 2080. proof: `TN_FRAME_BUDGET` from `node packages/playtest/dist/runner/cli.js perf`, 3 interleaved runs.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Stacked uncompressed sets and ORM set | `loadTerrainSplat` → `WorldCells.load({ surface })` (Machinefall `World.ts:125`) | Per-layer sampler fallback kept only for mixed sizes | Phase 1–2, AC-1 |

## Execution Phases

#### Phase 1: Every same-size set is one sampler
**Status:** NOT STARTED
**Files:** `packages/core/src/world-terrain-splat.ts`; `packages/core/__tests__/world-terrain-splat.spec.ts`
- [ ] Sixteen uncompressed same-size layers with normals build a material that references one array texture per set (3 sampled textures with the splat array). Mixed sizes still fall back and the marker names the count. proof: red-green `pnpm exec vitest run packages/core/__tests__/world-terrain-splat.spec.ts`.
- [ ] The `@constraint` and recipe name are corrected, and the regenerated manifest carries them. proof: `pnpm build` then `pnpm exec vitest run scripts/__tests__/capability-manifest.spec.ts scripts/__tests__/generate-capability-reference.spec.ts`, both exit 0.

#### Phase 2: ORM per layer
**Status:** NOT STARTED
**Files:** `packages/core/src/world-terrain-splat.ts`, `packages/blender-mcp/gpl/recipes/export_world.py`, `packages/core/gpl/recipes/export_world.py`
- [ ] A table layer with `orm: true` drives roughness, AO and metalness from its map. A layer without it uses the table's values, and no numeric look constant remains in `loadTerrainSplat`. proof: red-green `world-terrain-splat.spec.ts` case.
- [ ] The recipe writes `<id>_orm.jpg` for a layer whose material has a roughness input. proof: a red-green case in `pnpm exec vitest run packages/blender-mcp/__tests__/export-world.spec.ts`; Blender is installed here, so the case runs and does not skip.

#### Phase 3: Native and mobile sample the arrays
**Status:** NOT STARTED
**Files:** `packages/runtime-native/conformance/scenes/shared/terrain-splat-array.js` (new), `registry.json`
- [ ] A conformance row renders a 16-layer uncompressed splat package (albedo, normal and ORM per layer) on desktop within tolerance of the browser reference, with `samplers=4` in its marker. proof: `pnpm parity --target desktop --only-tests terrain-splat-array`.
- [ ] The same row on the Android emulator, which is the host without a KTX2 transcoder. proof: `pnpm parity --target android --only-tests terrain-splat-array`.
