# PRD-477 — WorldCells auto-on + measured budgets

**Status:** PROPOSED — filed 2026-10-01; nothing landed yet.
**Complexity:** 6 (MEDIUM) — a standing visual gate (one script plus a judge), a native conformance case, and budget derivation inside `packages/core/src/world-cells.ts`. Risk override: none.
**Owner:** João
**Depends on:** PRD-475 (Machinefall's open world at 120 fps, no visual loss, #384), PRD-473 (GPU-driven world, #375).

## Context

The repo's standing rule: **auto by default** — if the engine can measure a value where it is used, it decides; a constant the author must revisit later is a bug. WorldCells still asks the game to supply constants the engine already knows at load time.

Machinefall hands the world its numbers in `apps/client/src/level/World.ts`:

```ts
export const WORLD_RING = 2;
export const WORLD_BUDGETS = { residentCells: 25, instances: 220_000, bytes: 8_000_000 } as const;
```

Those three budgets are arithmetic the game derived by hand from its own cooked package (218 assets, 256 cells of 128 m: peak 7 816 instances and 250 112 bytes in cell 8,8, times the 5×5 that `ring: 2` keeps resident). `cellSize` comes from the cooked manifest, and the per-asset `maxDistance` that culls ground cover is authored into the package — so the engine holds every input the numbers are derived from and asks the game to do the derivation anyway.

Alongside them sit per-feature switches an agent must know exist: `impostors`, `gpuScene`, `bundles`, `adaptiveLod`, and terrain tile merging (`mergeTiles`, or `TN_TERRAIN_MERGE` / `?tnTerrainMerge=1`). Agents write the games. Every knob is cold-build friction, and a knob nobody finds is a knob that never gets set.

**Cautionary evidence — two default-on changes broke the look while every unit test passed:**

- **Impostors default-on (#375).** The two-triangle card replaced the coarsest level the wide shadow levels draw, leaving the road and forest floor almost unshaded. Unit tests were green; the frame was wrong. Impostors are opt-in again (`impostors?: boolean`, default false, `world-cells.ts`).
- **Terrain super-tile merge (PRD-475).** A merged block's mesh sat at the world origin while its vertices were block-local, so every block but (0,0) drew displaced — floating slabs over a hole where the ground should be (`890578e81`). Unit tests only ever merged an island at the origin, where block-local and world coordinates agree.

So the gap is not "we did not dare turn streaming on". It is that **nothing in the world path can prove a default-on change kept the picture**, so every such change is opt-in by default and stays that way.

## Solution

In this order, because each step is what makes the next one safe.

1. **A standing visual gate, before any default flips.** Same-pose screenshots plus a popping capture series on a reference world, in the shape of Machinefall's `?scene=map-walk` and `?scene=map-views`, judged blind. Same-pose scoring reuses the shipped harness: `scripts/visual-ab.ts` via `pnpm visuals:ab --before <dir> --after <dir> --raters 3`. The popping half needs a capture series along a fixed leg and a judge that names every element that appears, disappears or swaps LOD inside the near band — no script exists for that today, so it is built here. Runnable on the GPU lane (WebGPU recipe, adapter named in the output). **Nothing in world streaming flips default-on without passing it.**
2. **Native and mobile proof — web-only is unfinished.** The GPU scene's CPU fallback (PRD-473 AC-6) and the streaming path under it run on the owned native host via a `--target` playtest (`packages/playtest`, `packages/runtime-native/conformance/registry.json`). A budget derived on the browser is not a budget on a phone.
3. **The automatic trigger, and measured budgets.**
   - Streaming turns itself on when the content is cell-cooked, or when the world exceeds one ring. Small arena and puzzle games are unaffected — they load and stay loaded.
   - `budgets` (`residentCells`, `instances`, `bytes`) and `ring` move from hand-set constants to values the engine measures: device memory where the platform reports it, the frame budget where it does not. Machinefall's numbers survive as named overrides, so a tuned world keeps its tuning.
   - Each per-feature switch (`impostors`, `gpuScene`, `bundles`, `adaptiveLod`, `mergeTiles`) becomes an engine decision with a named override on the same object and honest reporting when overridden — the convention shape already used for shadows.

## Non-goals

- Always-on streaming for every scene. An arena is not an open world and pays nothing for pretending to be one.
- Changing any default before the gate in item 1 exists and has red-greened once.

## Acceptance Criteria

- [ ] AC-1 [local]: a cold-start agent builds a streamed game with no `WorldCells` budget, ring or per-feature switch, and the resulting frame is within the same-pose visual A/B and the same popping capture series as the hand-set build it replaces. proof: the map-walk and map-views capture series plus `pnpm visuals:ab --raters 3` on both arms.

## Blocked on

- Android and iOS hardware runs of the native streaming case. The emulator lane covers the mechanism; real thermals and real memory need a device, which only João can attach.
- A 120 Hz+ display for reading presented 120 fps. Xvfb's swap floor cannot show it (inherited from PRD-475).

## Decisions

- 2026-10-01 (João): yes for world streaming auto-on, not unconditional; only after a visual gate exists.

## Execution Phases

### Phase 1 — The standing visual gate

- [ ] The gate runs on a reference world and judges blind: same-pose captures scored by `pnpm visuals:ab --raters 3`, plus a popping capture series along a fixed walk leg. proof: `pnpm visuals:ab --before <ref> --after <candidate> --raters 3` and the series' judge output naming every element that appears or swaps LOD inside the near band.
- [ ] The gate **reds on a known-bad build** — impostors default-on as in #375, which removed the forest's shadow — and greens on develop. A gate that has never gone red is not a gate. proof: the same command on both builds, with the impostor-on run below the reference floor.

### Phase 2 — Native and mobile proof

- [ ] The GPU scene's CPU fallback (PRD-473 AC-6) reports why it fell back in `TN_WORLD_GPU_SCENE` and holds its frame budget on the owned native host. proof: a `--target desktop` playtest scenario in `packages/runtime-native/conformance/registry.json`, green with the marker in the log.
- [ ] Streaming residency and the admission budget hold on Android with no game-side option. proof: a `--target android` playtest run on an emulator, residency and admission reported in `state.stats`.

### Phase 3 — Auto trigger and measured budgets

- [ ] Streaming turns on by itself when the content is cell-cooked or the world exceeds one ring, and a small arena scene that fits in one ring is unaffected — no streaming, no resident-cell churn. proof: a red-green spec in `packages/core/__tests__/` covering both a multi-cell world and an arena scene.
- [ ] `budgets` (`residentCells`, `instances`, `bytes`) and `ring` are derived from device memory and the frame budget where the platform reports them; Machinefall's numbers stay available as named overrides and still win when set. proof: a red-green spec asserting the derived values on a stubbed device, plus the override path.
- [ ] Every per-feature switch (`impostors`, `gpuScene`, `bundles`, `adaptiveLod`, `mergeTiles`) is an engine decision with a named override on the same object, and reports honestly when overridden. proof: a red-green spec per switch plus the marker line each one emits.