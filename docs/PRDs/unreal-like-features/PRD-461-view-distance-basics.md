# PRD-461 — View distance basics: terrain radius, near-only colliders, and fog that hides the stream edge

**Status:** NOT STARTED
**Complexity:** 1 (LOW); risk override: none. Three implementation files (`core` twice, the example's render source), and the rest is a recipe, guidance and its proof. It cannot start before the in-flight change below.
**Owner:** unassigned (drafted by Claude, 2026-09-26)
**Depends on:** the in-flight scatter/terrain change, which is **prerequisite, not this PRD's scope**: `terrain.streamRadius` and `terrain.colliderRadius` options, multi-primitive scatter assets, and transparent scatter drawn as cutout. PRD-459 and PRD-460 are independent of it and neither waits for it.

## Context

Machinefall's 2 km map streams 25 cells of 128 m at ring 2 — a 640 m resident square, corners at
452 m — and three things about that are decided by accident rather than by a choice:

- **Terrain radius is the prop ring.** `WorldCells` sizes the composed `TerrainTiles` from the ring:
  `residentTileBudget: (2·ring+1)²` and `streamRadius: this.#ring`
  (`packages/core/src/world-cells.ts:493`, `:506`, `:512`). A game cannot give terrain a longer view
  than it gives props, and cannot give props a shorter one, because they are one number.
- **Every resident tile gets a collider.** `TerrainTiles` calls the game's `createCollider` for each
  admitted tile (`packages/core/src/world-tiles.ts:1724`) and disposes it only when the tile is
  evicted, so physics follows the render radius instead of the player.
- **Nothing hides the boundary.** The engine sets `scene.fog = null` (`packages/core/src/game.ts:540`)
  and fog is game-owned render source — `scene.fog = new Fog(…)` in
  `packages/create-threenative/templates/*/src/render/sky.ts`. So the stream edge is simply visible:
  props appear at the ring edge, which is 452 m away at the corners and 640 m at the edge midpoints.

## Solution

A default recipe for a 2 km map, enforced where it can be measured, with the rest documented.

1. **Terrain radius and collider radius become the game's own numbers** — prerequisite options
   forwarded through `IWorldCellsTerrainOptions`, which today carries only tile size, resolution,
   LOD factors, LOD distances and skirt depth (`packages/core/src/world-cells.ts:47`).
2. **Colliders live near the player, not near the render radius.** A tile outside `colliderRadius`
   draws but has no collider, and a collider whose tile leaves the radius as the player moves is
   disposed then, not when the tile is evicted. That is the behaviour this PRD owns; the option
   itself is the prerequisite.
3. **The recipe**, for a 2 km map on 128 m cells (256 cells, as exported in PRD-448's AC-8):

   | Setting | Value | Why that number |
   | --- | --- | --- |
   | `ring` (props) | 2 | 5 × 5 = 25 cells resident, 640 m across, 452 m to the corner |
   | `terrain.streamRadius` | 3 | 7 × 7 = 49 tiles, 896 m across, 634 m to the corner — terrain outlives the props so the prop edge is the only edge |
   | `terrain.colliderRadius` | 1 | 3 × 3 tiles, 384 m across, 272 m to the corner; a game that walks rather than flies may use 0–1 |
   | `terrain.lodDistances` | 256, 512 (the defaults, `packages/core/src/world-tiles.ts:1382`) | both switches land inside the fog far, so a terrain pop is behind haze |
   | fog | `near` 180 m, `far` 420 m, in game render source | `far` must stay under the prop ring's *corner* (452 m), or the corner edge is visible; the terrain corner (634 m) stays comfortably beyond it |
   | `budgets` | 25 cells, 20 000 instances, 8 MB placements | at ~500 placements per cell the placement budget is not the binding constraint; resident cells and draw calls are |

   The engine ships no constant for any of it. Fog is a look and the engine cannot measure it, so
   the recipe is documented numbers, a test that keeps them self-consistent, and a game that
   overrides them freely.
4. **Guidance, not engine fog:** the recipe lands in `docs/guides/world-streaming.md` with the
   arithmetic above, and the flythrough example's render source carries the fog it proves against.

**Non-goals:** HLOD, impostor forests, GPU-driven scatter, virtual texturing, occlusion culling,
simulation LOD, and any engine-owned fog or atmosphere default.

**Risks:**
- Colliders are a physics feature and Rapier WASM does not run on Android or iOS
  (`packages/runtime-native/conformance/registry.json`, `rapier-wasm-mobile`), so the collider claim
  is browser and desktop only until a mobile physics lane exists.
- A `colliderRadius` smaller than a fast fall speed lets a body leave the collidered ground; the
  recipe's 272 m corner is far above any fall, and the number is the game's to change.
- The recipe is derived for 128 m cells. A different cell size moves every number, so it is
  documented as arithmetic over `cellSize`, not as fixed values.

## Acceptance Criteria

- [ ] AC-1 [local; actor: agent]: with `ring: 2` and `terrain.streamRadius: 3`, residency reports 25 resident cells and 49 resident tiles, and the ring-derived terrain radius fails this — proof: `pnpm --filter @threenative/core test world-cells-view-distance` — Evidence: pending.
- [ ] AC-2 [local; actor: agent]: no tile outside `terrain.colliderRadius` has a collider, a collider is disposed when its tile leaves the radius while the tile keeps drawing, and a red control at radius 0 shows the pre-change behaviour — proof: `pnpm --filter @threenative/core test world-tiles` — Evidence: pending.
- [ ] AC-3 [local; actor: agent]: the documented recipe cannot drift: the guide's numbers are asserted against the code's own clamps (fog far < prop ring corner ≤ terrain corner, collider radius ≤ ring, LOD distances increasing) — proof: `pnpm --filter @threenative/core test world-streaming-recipe` and `pnpm check:docs` — Evidence: pending.
- [ ] AC-4 [local; actor: agent]: a capture at the prop ring edge under the recipe's fog shows no visible geometry boundary; the capture paths and the review are recorded — proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/world-flythrough.playtest.json --url … --browser-recipe webgpu` — Evidence: pending.
- [ ] AC-5 [local; actor: agent]: the `world-flythrough` scenario run with the recipe's numbers keeps its residency assertions, reports 0 failed loads, and asserts colliders exist only inside the radius — proof: the playtest run above — Evidence: pending.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Independent terrain radius | `WorldCells.load({ ring, terrain: { streamRadius, colliderRadius } })` | `streamRadius: this.#ring` and the ring-derived tile budget (`world-cells.ts:493`, `:506`, `:512`) | AC-1 |
| Near-only colliders | The same `update`, through the game's own `createCollider` callback | A collider per resident tile (`world-tiles.ts:1724`) | AC-2 |
| 2 km recipe + fog guidance | `docs/guides/world-streaming.md`; the example's `src/render/` for the fog it proves against | Nothing; a documented recipe, kept consistent by a test | AC-3, AC-4 |

## Execution Phases

#### Phase 1: Radius and collider lifetime

**Status:** NOT STARTED (waiting on the prerequisite options)
**Files:** `packages/core/src/world-cells.ts` (forward `streamRadius` / `colliderRadius`, derive the tile budget from the terrain radius), `packages/core/src/world-tiles.ts` (collider lifetime as the player moves), `packages/core/__tests__/world-cells-view-distance.spec.ts`.
**Implementation:** the terrain budget follows the terrain radius rather than the ring; a tile outside the collider radius draws with an `EmptyCollider`, and a collider whose tile leaves the radius is disposed on that step.
**Verification:** `pnpm --filter @threenative/core test world-cells-view-distance world-tiles` — AC-1, AC-2; the existing world and world-tiles suites stay green.
- [ ] terrain radius independent of the ring, red against the ring-derived value. proof: `pnpm --filter @threenative/core test world-cells-view-distance`
- [ ] collider created and disposed by radius, not by residency. proof: `pnpm --filter @threenative/core test world-tiles`
- [ ] existing residency, cancellation and budget suites unchanged. proof: `pnpm --filter @threenative/core test world`

**Checkpoint:** pending

#### Phase 2: The recipe and the fog guidance

**Status:** NOT STARTED
**Files:** `docs/guides/world-streaming.md` (the recipe table and its arithmetic), `examples/abyss-framework/src/render/` (the fog the example proves against), `packages/core/__tests__/world-streaming-recipe.spec.ts`.
**Implementation:** the recipe as arithmetic over `cellSize`, so another map size follows by changing one number; the consistency test reads the documented values and asserts the ordering and the code's clamps.
**Verification:** `pnpm --filter @threenative/core test world-streaming-recipe` + `pnpm check:docs` — AC-3, AC-4.
- [ ] recipe documented as arithmetic over cell size, with the ordering constraints spelled out. proof: `pnpm check:docs`
- [ ] consistency test fails when the documented numbers break the ordering. proof: `pnpm --filter @threenative/core test world-streaming-recipe`
- [ ] example render source carries the fog and the capture is reviewed. proof: `pnpm --filter abyss-framework build`

**Checkpoint:** pending

#### Phase 3: The measured gate

**Status:** NOT STARTED
**Files:** `examples/abyss-framework/playtests/world-flythrough.playtest.json`, `examples/abyss-framework/src/scenes/WorldProbe.ts`.
**Implementation:** the scenario runs with the recipe's numbers and asserts residency, tiles, colliders and failures.
**Verification:** the playtest run — AC-5, AC-4.
- [ ] probe reports resident tiles and collider count. proof: `pnpm --filter abyss-framework build`
- [ ] scenario asserts 25 cells, 49 tiles, colliders inside the radius, 0 failures. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/world-flythrough.playtest.json --url 'http://127.0.0.1:5181/?world' --browser-recipe webgpu`
- [ ] edge capture taken at the ring corner and reviewed. proof: the same run's screenshot artifacts

**Checkpoint:** pending
