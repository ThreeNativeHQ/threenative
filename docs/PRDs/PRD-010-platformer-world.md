# PRD-010 — The platformer world: levels from data, collectibles, enemies, HUD

**Complexity: 7 → HIGH mode** (10+ files +3, new system +2, multi-package +2)

**Depends on:** PRD-007, PRD-008, PRD-009. **Blocks:** nothing — this closes the slice.
**Design authority:** `DESIGN.md` §2 (no scene format, no preset system), §6b; `AGENTS.md`
rules 1, 3, 5.

## 1. Context

**Problem:** `examples/REFERENCE.png` is mostly *world*: coins on arcs, patrolling
mushrooms and a snail, a `?` block, hearts, a coin counter, a timer, a gem count. PRD-009
gives it a character; nothing gives it a level.

**Files analyzed:** `packages/physics/src/Area3D.ts`, `packages/ui/src/{index.ts,
useGameState.ts}`, `packages/core/src/{entities.ts,state.ts}`,
`examples/abyss-framework/src/scenes/Abyss.ts`, `DESIGN.md` §2, §6b.

**Current behavior:**

| Need | Today | Evidence |
|---|---|---|
| Level authoring | every mesh hand-constructed | `Play.ts` writes `new Mesh(new BoxGeometry(…))` per object |
| Collectibles | primitive works, pattern absent | `Area3D.on('bodyEntered')` exists; no counter, respawn, or event path |
| Enemy behavior | none | the only AI in the repo is a 6-line homing loop in `Abyss.ts` |
| HUD components | bridge works, components absent | `useGameState` is correct; no hearts, counter, or timer |
| Contact observation | not supplied | `runtime.contacts` is in the capability union, unsupplied by the three bridge |

**§2 constraint:** ThreeNative has explicitly decided against a **scene format** and a
**preset system**. This PRD must not smuggle one in.

## 2. Solution

- **No level format in the framework.** The level is a plain TypeScript array in
  `examples/platformer/src/levels/level-1.ts`, consumed by a `spawn()` function in the
  example. That is user-space code and stays there — rule 1 and §2 both point the same way.
- Framework side ships only what the example cannot write in 20 lines:
  - `runtime.contacts` channel — `Area3D` enter/exit drained into the playtest bridge.
  - `runtime.tags` channel — `Registry` entries gain an optional `tags` field so
    `assert.tags {tag:'coin', count: 0}` can prove a level was cleared.
- Enemies are example code: a `Patrol` behavior over waypoints and a `Chase` behavior with
  a line-of-sight radius. **No navmesh, no A\*** — the reference image needs neither, and
  `DESIGN.md`'s "not on the roadmap" list exists to stop exactly that.
- HUD stays in `examples/platformer/src/ui/` as Tailwind components reading `useGameState`.
  Rule 3: anything a screenshot shows never enters a package.

**Data changes:** `EntitySnapshot` entries gain optional `tags: string[]`.

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `runtime.contacts` channel | `core/src/playtest.ts`, fed by `physics/src/Area3D.ts` | — | n/a | stop draining → `assert.contacts.minCount` fails |
| 2 | `runtime.tags` channel | `core/src/playtest.ts`, from `Registry` | — | n/a | advertise without supplying → PRD-007 parity test fails |
| 3 | `Registry` `tags` field | `examples/platformer/src/entities/Coin.ts` | — | n/a | untag coins → `assert.tags {tag:'coin'}` counts 0 at start, fails |
| 4 | `spawn(level)` (example) | `examples/platformer/src/scenes/Level.ts` enter | hand-built meshes in `Play.ts` | `Play.ts` deleted | empty level array → no platforms, fox falls, scenario fails |
| 5 | `Patrol` / `Chase` (example) | `examples/platformer/src/entities/Mushroom.ts` | — | n/a | freeze behavior → `assert.movement.pathLength` fails |
| 6 | HUD components (example) | `examples/platformer/src/ui/App.tsx` | — | n/a | detach store → `assert.hud` on coin count fails |

**Reachability:** frame loop → `Level.update` → enemy behaviors + `Area3D` callbacks →
`ctx.state.set` → React HUD. User-facing: a playable level with coins, enemies and a HUD.

## 4. Phases

#### Phase 1: coins can be collected and the count is provable

**Files:** `physics/src/Area3D.ts` EDIT (contact log) · `core/src/playtest.ts` EDIT ·
`core/src/entities.ts` EDIT (`tags`) · `examples/platformer/src/entities/Coin.ts` NEW ·
`examples/platformer/playtest/collect.json` NEW.

| Test | Assertion | Negative control (observe red) |
|---|---|---|
| `should drain area enter events into the contacts channel` | `contacts` holds `{entity:'fox', with:'coin.3'}` | stop draining → empty, fails |
| `should expose registry tags in the tags channel` | `tags.coin === 12` before the run | untag → 0, fails |
| `collect.json` | `assert.contacts {entity:'fox', with:'coin.3', minCount: 1}` | move the coin out of the path → fails |
| `collect.json` | `assert.tags [{tag:'coin', count: 11}]` after collection | never despawn → 12, fails |
| `collect.json` | `assert.hud [{id:'coins', equals: 1}]` | detach the store → fails |

#### Phase 2: the level comes from data, and `Play.ts` dies

**Files:** `examples/platformer/src/levels/level-1.ts` NEW · `src/spawn.ts` NEW ·
`src/scenes/Level.ts` EDIT · `examples/abyss-framework/src/scenes/Play.ts` **DELETE** ·
`examples/platformer/playtest/traverse.json` NEW.

`Play.ts` is orphaned dead code today — registered in no `scenes` map. It is deleted here,
not left beside the new path.

| Test | Assertion | Negative control |
|---|---|---|
| `traverse.json` | `assert.movement.reachesPositionWithin` the level's exit | empty the level array → fox falls, fails |
| `should throw on an unknown prefab kind in level data` | throws (fail closed) | skip silently → a typo'd platform vanishes and the suite stays green |
| `should register every spawned entity with a stable id` | ids match the level data | — |

#### Phase 3: enemies patrol, and the HUD reads like the reference

**Files:** `examples/platformer/src/entities/Mushroom.ts` NEW · `src/entities/Snail.ts` NEW ·
`src/ui/Hud.tsx` NEW · `src/ui/App.tsx` EDIT · `examples/platformer/playtest/enemy.json` NEW.

| Test | Assertion | Negative control |
|---|---|---|
| `enemy.json` | `assert.movement {entity:'mushroom.1', pathLength: 6, maxDistance: 4}` — it patrols and returns | freeze it → pathLength 0, fails |
| `enemy.json` | `assert.contacts {entity:'fox', with:'mushroom.1'}` on collision | disable the sensor → fails |
| `enemy.json` | `assert.hud [{id:'hearts', equals: 2}]` after the hit | detach damage → 3, fails |
| `should not chase past the line-of-sight radius` | enemy holds its patrol | drop the radius check → chases across the level |

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets && pnpm test:playtest
pnpm tsx scripts/count-loc.ts

# §2 guard — no scene format, no preset system entered a package
grep -rln "level\|prefab\|preset" packages/*/src      # expected: no new hits

# Caller census
grep -rn "runtime.contacts\|runtime.tags" packages/core/src | grep -v __tests__

# Revert check — return an empty array from spawn()
# Expected: traverse.json fails on movement, not "0 assertions, pass"

# Dead-path check
test ! -f examples/abyss-framework/src/scenes/Play.ts
```

## 6. Acceptance (consumer-scoped)

- [ ] `examples/platformer` is playable: the fox runs a level built from data, collects
      coins, takes a hit from a patrolling enemy, and the HUD shows hearts, coins and a timer.
- [ ] A scenario fails when a coin stops despawning, when an enemy stops patrolling, or
      when the HUD stops tracking state — each proved red once.
- [ ] No level format, prefab registry, or preset system exists in `packages/*` (§2 holds).
- [ ] `examples/abyss-framework/src/scenes/Play.ts` no longer exists.
- [ ] `docs/PRDs/` is now at its cap of 10 files. The next PRD requires retiring one.
- [ ] Every gate observed red once, recorded in `docs/verification/PRD-010.md`.
