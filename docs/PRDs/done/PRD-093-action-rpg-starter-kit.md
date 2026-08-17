---
prd_contract: v1
---

# PRD-093 — An `action-rpg` starter kit: the home for the two abstractions PRD-087 rejected, and the only kit that exercises `@threenative/ui`

**Status: IMPLEMENTED; generated browser evidence recorded 2026-08-12.** Desktop execution is
covered by the batch record; no mobile readiness is claimed.
**Parent:** [PRD-087](../starter-kits/PRD-087-genre-borrow-ledger.md).
**Depends on:** [PRD-088](../BLOCKED/requires-ray-measurement/PRD-088-physics-spatial-queries.md),
[PRD-091](./PRD-091-genre-kit-delivery-rail.md).
**Sequenced after:** [PRD-092](./PRD-092-strategy-starter-kit.md) — last of the four kits.

**Complexity: 6 → HIGH mode.** No package code. The scope is a game with persistence and a real
UI, which is where the framework's React story either holds or does not.

## 1. Why this is user value and not tidying

Two open threads close here.

**First, PRD-087's two hardest rejects need a home.** The stat modifier stack scored 54/100 and
inventory/crafting 58/100, and both were rejected as package code — the stack despite five of
seven surveyed codebases converging on it. A reject with no home is a reject that gets
re-proposed every six months by someone who noticed the same convergence. **This kit is the
answer to "then where does it go": generated user source, in one file each, scoped to this
game, deletable.** If that turns out to be miserable to use, the reject was wrong and this kit
is the evidence — which is the only way to find out short of shipping the wrong package.

**Second, no shipped template exercises `@threenative/ui` beyond a HUD.** `GameCanvas`,
`DebugOverlay` and `useGameState` are the whole surface, and the platformer uses them for a
score readout. An inventory screen, a character sheet and an ability bar are the first real
test of whether game state projects into React cleanly or whether every kit ends up reaching
into entities from a component. Flare's `GuiInterface`-style separation is borrowed precisely
because that is the mistake it prevents.

## 2. Solution

`packages/create-threenative/templates/action-rpg/` plus a `kit.json`.

### The game

A small dungeon of three rooms. You have a melee attack and one cooldown ability. Enemies aggro
on proximity and line of sight, drop loot, and the loot goes into an inventory you can equip
from. Equipment changes your numbers. **Win condition: kill the room-three boss. Fail
condition: die.** Progress saves, and reloading the page resumes it.

The save is the part that matters and the part usually skipped in a demo. A game that forgets
everything on refresh is a scene with combat in it.

### What is borrowed, and from where

Flare is the survey's action-RPG entry; these come from its `src/`.

| Kit file | Borrowed from | The idea |
|---|---|---|
| `src/stats/StatBlock.ts` | Flare `EffectManager.cpp`; SuperTuxKart `abstract_characteristic.cpp`, `combined_characteristic.cpp` | a base value plus ordered additive and multiplicative layers, each attributed to a source with a lifetime |
| `src/abilities/Ability.ts` | Flare `Hazard.cpp`, `HazardManager.cpp` | an ability spawns an effect with its own lifetime; the caster does not own its resolution |
| `src/loot/drops.ts` | Flare `LootManager.cpp`, `Loot.cpp` | drop tables are weighted, rolled once on death, and the roll is seeded |
| `src/items/Inventory.ts` | Flare `ItemStorage.cpp`, `ItemManager.cpp`; Luanti `inventory.h` | slots hold stacks; equipping moves a stack and republishes stats |
| `src/entities/Enemy.ts` | Flare `EntityBehavior.cpp` | a small explicit state machine — idle, aggro, attack, dead — not a behaviour tree |
| `src/progress.ts` | Flare `CampaignManager.cpp` | progress is a flat set of flags, saved and restored as one object |
| `src/ui/` | Flare `MenuInventory.cpp`, 0 A.D. `GuiInterface.js` | React reads a projection of game state; components never touch entities |

Aggro uses PRD-088's `intersectShape` for range and `intersectRay` for line of sight. **No
navmesh** — enemies move directly toward the player inside a room, for the same reason PRD-092
avoids pathfinding: `@threenative/physics/navigation` carries WASM and Android runs QuickJS, so
a kit built on it would be web-only.

### The stat stack ships as one file, and its size is recorded

`StatBlock.ts` is the concrete version of PRD-087's 54/100 reject. **Its line count is recorded
in `docs/verification/` alongside PRD-090's `PathFollow3D` number**, for the same reason: the
reject was argued on "a competent developer writes the useful 80% in under 20 lines", and that
claim should be checked against the thing actually built rather than left as an assertion.

If the useful version lands well over 20 lines **and** a second kit needs the same code, that
is new evidence and PRD-087's row reopens with a number attached. One kit needing it is not
evidence of anything — this kit is the RPG, and stats are what an RPG is.

### Save/load uses what exists

Persistence is `createGameStore` from `@threenative/core` serialised to storage — the host
shims `storage` on native, so the same code path runs on both targets. **No save-format
abstraction, no migration system, no versioned schema.** One JSON object, written on checkpoint.

### Looking good

Same gate: six `RENDER_LAYER_FILES` with live importers, ≤6-colour palette with exactly one
`accent`, `materials.ts` and `sky.ts` importing `palette.js`, key and rim `DirectionalLight`
plus fill, `PCFSoftShadowMap`, `normalBias`, `toneMapping` / `toneMappingExposure` /
`setOutputNode` / `bloom(` in post, then a blind score ≥ `VISUAL_SCORE_FLOOR = 4`.

Interior lighting is this kit's own problem to solve — an enclosed dungeon has no sky doing the
work — which makes it the strongest test of whether the six-file render convention generalises
past outdoor scenes. If `sky.ts` is meaningless indoors, **that is a finding about the
convention and it gets written down here**, not worked around with a fake skybox nobody sees.

### What this kit deliberately does not ship

- **No dialogue system, no quest engine, no crafting.** Progress is flags. Crafting is Luanti's
  design, not plumbing, and PRD-087 rejected it.
- **No item-definition data format.** Items are TypeScript objects.
- **No navmesh, no procedural generation.** Three authored rooms.
- **No stat stack in any package**, however well it turns out.

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `templates/action-rpg/` + `kit.json` | PRD-091's loader; `npx` and Studio picker | no RPG genre exists | n/a | scaffold; the playtest must reach assertions |
| 2 | `StatBlock.ts` as kit source | `src/stats/StatBlock.ts`, consumed by combat and equipment | PRD-087's homeless reject | n/a | equip an item; the published damage number must change, and unequipping must restore it exactly |
| 3 | `Inventory.ts` as kit source | `src/items/Inventory.ts` | PRD-087's other homeless reject | n/a | drop a full stack into a full inventory → refused, and nothing is lost |
| 4 | Aggro over `intersectShape` + `intersectRay` | `src/entities/Enemy.ts` | the hardcoded-reference pattern | n/a | remove the line-of-sight ray → enemies aggro through walls, and the wall test goes red |
| 5 | Save/restore over `createGameStore` | `src/progress.ts` | no shipped template persists anything | n/a | reload mid-run; asserted state must match what was saved |
| 6 | React inventory/character UI | `src/ui/`, over `@threenative/ui` | a HUD readout is the only UI proof we have | n/a | have a component read an entity directly → the projection boundary test fails |

## 4. Execution phases

### Phase 0 — Scaffold and boot, empty dungeon

**Gate:** `pnpm test:templates` green; native single-file assertion green; visual gate
structural pass — **including whatever `sky.ts` means indoors, decided in this phase and
written down.**

### Phase 1 — Combat, stats, abilities

**Outcome:** melee, one ability with a cooldown, enemies with the four-state machine, stats
driving damage. **Gate:** playtests asserting damage numbers before and after a modifier, and
asserting the modifier expires.

### Phase 2 — Loot, inventory, equipment

**Gate:** seeded drop-table playtest (same seed, same drop), inventory-full refusal, and an
equip that changes a published number and restores it on unequip.

### Phase 3 — Progress, save, boss

**Gate:** a playtest that plays partway, reloads, and asserts the restored state field by
field. A second asserts the win, a third the fail.

### Phase 4 — Looks, scored blind

**Gate:** blind score ≥ 4. Below the floor is a red phase.

### Phase 5 — Studio and device

**Gate:** `pnpm studio:probe --browser` green with the kit listed; `--target android` and
`--target ios` executed or explicitly recorded as not executed.

## 5. Verification strategy

A save system is the easiest thing here to fake green: serialise, deserialise, assert the object
round-tripped, and never notice the game does not use the restored value.

- **Restore is asserted through the game, not through the store.** Reload, then assert the
  player's *rendered* position, current health and equipped item, not the JSON.
- **The stat stack is asserted on removal, not just application.** Apply, assert, expire, assert
  the exact original. A stack that never unwinds passes every "the buff worked" test.
- **Drops are asserted as determinism.** Same seed, same sequence, twice. An unseeded roll passes
  any single run.
- **Line of sight gets its own assertion**: an enemy behind a wall, in range, must not aggro. A
  range-only implementation passes the aggro test and fails only this.
- **The UI boundary is asserted structurally**: no file under `src/ui/` imports from
  `src/entities/`. That is the mistake Flare's `GuiInterface` separation exists to prevent, and
  a lint-shaped assertion catches it before it becomes the kit's teaching example.
- **`--browser-recipe webgpu`, `sh scripts/xvfb.sh` for visuals.**

## 6. Acceptance criteria

- [ ] The kit ships as a directory plus a `kit.json` — no CLI file, no gate script edited.
- [ ] `npx` and the Studio picker produce byte-identical trees.
- [ ] It boots to a game with a win and a fail condition, and progress survives a reload,
      asserted through the game rather than through the store.
- [ ] `StatBlock.ts` and `Inventory.ts` ship as kit source. **Neither exists in any package**, and
      `StatBlock.ts`'s line count is recorded in `docs/verification/` against PRD-087's claim.
- [ ] Aggro uses range **and** line of sight, with the through-wall case asserted.
- [ ] No file under `src/ui/` imports from `src/entities/`, asserted.
- [ ] `src/` imports nothing from `@threenative/physics/navigation`, and the native bundle builds.
- [ ] Visual gate passes structurally; blind score **≥ 4**. What `sky.ts` means for an interior
      scene is answered in writing, not worked around.
- [ ] `src/game.ts` runs on desktop native; React stays in `src/main.ts`.
