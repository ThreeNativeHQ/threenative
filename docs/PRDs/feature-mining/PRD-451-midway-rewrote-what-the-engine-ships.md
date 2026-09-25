# PRD-451 — Midway rewrote what the engine ships, and six games rewrote the same merge

**Status:** PROPOSED
**Complexity:** 4 (MEDIUM): 6–10 implementation files, +2 for the crossing to the sandbox game, which installs from a tarball
**Owner:** unassigned
**Depends on:** None. Related: PRD-354/355 (reinvention gate), PRD-325 (three seams, not repeated here)

## Context

This was mined read-only from `../sandbox` on 2026-09-25. Three agents did the mining: one each for
Midway's `src/render/` and for Midway's `src/sim/`, `ui/` and `audio`, and a third across 18 of the
other games. All paths are relative to `../sandbox/`, and every candidate was checked against
`packages/create-threenative/capabilities.json` (343 entries) and `packages/*/src` at `bbc49c781`.

`midway-open-pacific` is 27k lines of game source on `@threenative/core@0.3.3`. The largest single
class of waste in it is **not a missing engine feature: the game hand-wrote what the engine already
ships**. It also carries one mechanism that six games wrote.

**Shipped, rewritten anyway (discoverability):**

| Game code | Engine already has | Why it was missed (best evidence) |
| --- | --- | --- |
| midway `render/world.ts:61-89,1191-1242`, the visible-only matrix walk | `MatrixWorldPass` / `renderer.matrixWorld: "visible"` | Landed after the game wrote its own. It is also **dead code**: the engine sets `scene.matrixWorldAutoUpdate = false`, so the game's guard never registers it. |
| midway `render/world.ts:1154-1189` `freezeStatic` (12 call sites) | `markStatic` / `invalidateStatic` | No search was made |
| midway `sim/math.ts:143`, `render/rear-station.ts:68`, crate-vault `scenes/Play.ts:33` (mulberry32) | `createRandom` | The pure sim runs in Node checks without `ctx` |
| midway `scenes/Midway.ts:455-492` (12 `keys.has` axes), lumen `first-person.ts:88-99` (raw `requestPointerLock`, broken on native), fps `scenes/Play.ts:974-980` | `InputMap.axis`/`vector`, `captureMouse` | **`capabilities.json` has no `InputMap` or `captureMouse` entry**, so a search for "pointer lock" returns `[]` |
| midway `render/airframe-lod.ts` `focalPx` (1315, 1806) | `lodPixelScale` / `selectLodLevel` | No manifest entry for `lodPixelScale` |
| midway `ui/frame-meter.ts` (72), fps `perf.ts` (190) | `FrameBudget` p50/p95/p99 via `defineGame({frameBudget})` | Its situations do not say "frame time percentile" |
| 6 games call raw `mergeGeometries` (below) | `mergeParts` | It takes parts, not a root, so every caller still writes the grouping |

**The mechanism six games wrote: merge a static subtree by material.** It appears as midway
`render/assets.ts:120-183` `consolidate`, `rear-station.ts:349-395` `mergeStatic` and `:1294-1329`
`gbake`, `cockpit-detail.ts:~1027-1075` `optimize`, and `devastator.ts:166-192` `batch` (five copies,
about 225 LOC). The other games' copies are caravel `render/props.ts:355-390`, fps
`render/facade.ts:197-230`, lumen `render/cathedral.ts:188-215`, warden `render/crateShape.ts:37-64`,
and crate-vault `render/crateGeometry.ts:53`. Each one walks a root, groups meshes by material, bakes
world transforms, merges, guards against the `null` merge and swaps the result in. `mergeParts`
already handles the hard part, the mismatch trap. The manifest even promises "one mesh per
material", but no caller gets that without writing the grouping.

**Texture setup after load, in five games:** midway `render/cockpit-detail.ts:55-64` (which also
bypasses `ctx.assets` with its own loader), `rear-station.ts:58-63`; lumen `render/surfaces.ts:527-532`;
wildwood `scenes/Valley.ts:1075-1083`; soul-cave `scenes/Cave.ts:96-99`; fps `render/sky.ts:57`.
Colour space by role is a correctness trap, not a look decision: wildwood's `FRICTION.md` #3 calls
this the strongest candidate. `IAssetLoader.texture(path)` (`packages/core/src/assets.ts:76`) takes
no options.

## Solution

1. **The games' own phrasings become recall rows.** `scripts/fixtures/capability-recall/corpus.json`
   gains one row per miss above, each quoting a real game's comment or friction note. Any row that
   fails gets `@situation` tags on the shipped symbol. This fixes the manifest, not the games.
2. **`mergeByMaterial(root, { label, skip?, preserve? })`** goes in `packages/core/src/merge-parts.ts`,
   built on `mergeParts`. It groups the subtree's meshes by material, merges each group with world
   transforms baked, and returns `{ meshes, removed }` so the caller decides whether to swap. Materials
   pass through by reference, so it owns none of the look. `skip` is the game's mover predicate:
   Midway's `MOVING_NODE` regex stays game data.
3. **`ctx.assets.texture(path, { data?, wrap?, repeat?, anisotropy? })`**: `data: true` means
   `NoColorSpace`, and the default stays sRGB. `anisotropy: "max"` reads the renderer.
   Every field is optional, and `texture(path)` is unchanged.
4. **Proof by deletion in Midway.** The game installs a locally packed core, deletes its copies
   and keeps its own playtests and frame diffs green.

Kill switch: `pnpm tsx scripts/count-loc.ts` must score each new API below the plain Three.js
copies it replaces, counted across all sites.

## Acceptance Criteria

The phase boxes below are the criteria. The PRD closes when all seven are ticked.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Manifest recall for shipped symbols | `engine_search_capabilities` → `packages/engine-mcp` over `capabilities.json` | The Midway copies are deleted in Phase 3 | P1 boxes |
| `mergeByMaterial` | Midway `render/assets.ts` and the four other sites import it from `@threenative/core` | 5 Midway copies deleted; the other games are untouched (not this PRD's repos) | P2, P3 |
| `texture(path, options)` | Midway `cockpit-detail.ts` and `rear-station.ts` through `ctx.assets` | The game's own `TextureLoader` is deleted | P2, P3 |

## Execution Phases

#### Phase 1: a search in the games' own words finds what they rewrote
**Status:** NOT STARTED
**Files:** `scripts/fixtures/capability-recall/corpus.json`; JSDoc `@situation` tags on `InputMap`/`captureMouse` (`packages/core/src/input.ts`), `lodPixelScale`, `FrameBudget` and `mergeParts`, wherever a row fails
- [ ] Recall rows added for all seven misses above and observed red before any tag lands; `InputMap`, `captureMouse` and `lodPixelScale` have zero manifest entries today. proof: `pnpm caps:recall`, red run recorded
- [ ] Every new row resolves to its shipped symbol, with no rejects hit. proof: `pnpm build && pnpm caps:recall` exit 0

#### Phase 2: the merge and the texture options are one call each
**Status:** NOT STARTED
**Files:** `packages/core/src/merge-parts.ts`, `packages/core/src/assets.ts`, `packages/core/src/index.ts`, `packages/core/__tests__/merge-parts.spec.ts`, `packages/core/__tests__/assets*.spec.ts`
- [ ] `mergeByMaterial` behaviour. proof: `pnpm exec vitest run packages/core/__tests__/merge-parts.spec.ts`. It must show: 3 materials × N meshes → 3 meshes; world transforms baked; `skip` honoured; a group that `mergeParts` rejects throws naming the label and the material
- [ ] `texture(path, options)` applies colour space, wrap, repeat and `anisotropy: "max"`, and `texture(path)` is byte-identical to today. proof: core assets spec; `pnpm typecheck && pnpm lint`
- [ ] Kill switch holds: `count-loc` scores both APIs below the replaced copies. proof: `pnpm tsx scripts/count-loc.ts`; numbers written here

#### Phase 3: Midway deletes its copies and plays the same
**Status:** NOT STARTED
**Files (in `../sandbox/midway-open-pacific`, its own repo and PR):** `package.json` (local core tarball, packed to a private staging dir, never `.packages`), `render/{assets,rear-station,cockpit-detail,devastator,world}.ts`, `sim/math.ts`, `scenes/Midway.ts`
- [ ] The five merge copies, `freezeStatic`, the dead matrix walk, both mulberry32s, the `keys.has` axes and the private texture loader are replaced by engine calls, and the net diff is negative. proof: `pnpm typecheck && pnpm test` (4 playtests) green; `git diff --numstat` total recorded
- [ ] Same picture and no more submissions. proof: `node tools/compare-frames.mjs` on the three frozen views against stock, and `node tools/capture-deck-perf.mjs` against `docs/perf/deck-baseline-20260922.json`; judged by a fresh subagent, per the visual-change rule

## Mined, not in this PRD

Each row has a named disposition. A row that is not filed waits for the evidence named beside it.

| Candidate | Where | Disposition |
| --- | --- | --- |
| Debug flags and handles via URL, globalThis or localStorage, hand-guarded for native (5 games, ~20 sites); headless check boilerplate (midway 39 `scripts/check-*.mjs`, plus state digests in crate-vault and warden); capture scripts that re-import `game.ts` to reach the scene | midway `render/world.ts:141`, wildwood `scenes/Valley.ts:244…`, fps, lumen, soul-cave; midway `sim/seeded-battle.ts:174-186`; midway `tools/capture-*.mjs` (~30) | **Filed: PRD-452** |
| Static shadow-caster proxy (351 → 5 shadow submissions) and the `ShadowNode` `0xFFFFFFFE` layer-mask trap | midway `render/world.ts:56,285-396,1889-2012` | Midway only. Its own FRICTION entry defers the lift until a second game needs it, and the mask trap is the argument to lift it early. |
| Per-cue audio cooldown and no-repeat variant pick (3 games); voice-line priority queue; speed-of-sound delay; looping-emitter reconcile; a fake bus for Node tests | midway `audio.ts:205-247,519-716`, `speech.ts:62-194`; fps `audio/GameAudio.ts:140-149`; wildwood `audio/Soundscape.ts:342` | Next candidate PRD: `AudioBus` options |
| Fit a model to a size and anchor it at its base or centre (4 games) | midway `render/imported-fleet.ts:104`, quarry, lumen, soul-cave | Extend `normaliseToMetres` (`axis`, `anchor`) |
| Canvas textures that work on native: the two games believe opposite things | midway `render/assets.ts:84-117`, fps `render/glyphs.ts` | Fix the native 2D shim (`createRadialGradient`, `setLineDash`) rather than wrap it |
| Aim kit: intercept, closest approach, ballistic time, `withinArc` | midway `sim/submarine.ts:159-190`, `armament.ts:103-125`, `naval.ts:102-122`, `gunnery.ts:120-142` | Needs a second caller: the shooter or defense template's turret |
| One-shot UI events over coalesced state; world→screen projection in the UI realm | midway `ui/bridge.ts:64-160`, `ui/state.ts:279-411` | Needs a second HUD on native |
| `RippleField` GPU nodes; pooled clones with a per-frame build budget; runtime joined LOD rung for procedural models; `SpatialGrid2D`; pose from 4 wave probes (midway plus caravel); camera-following water grid (midway plus caravel) | midway `render/ripples.ts`, `world.ts:748-759,2127-2164`, `airframe-lod.ts`, `sim/tactics.ts:385-425`, `render/ship-motion.ts:39-58` | Single-game, or under the kill-switch size |

The rejected candidates stay game code, because each one decides the look or is gameplay: the
whitewater sim, the ocean shader, deck-crew staging, the cockpit builders, damage scars, carrier
ops, contact aging and the audio RPM crossfade. Also rejected: `clamp`/`lerp` (`MathUtils` has
them) and the battle outbox (a plain array).
