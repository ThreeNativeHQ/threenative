# PRD-093 starter-kit repair gates

Date: 2026-08-12
Worktree: `/home/joao/projects/threejs-webgpu/.worktrees/starter-kit-093-r4-20260812`
Branch: `linchpin/starter-kit-093-r4-20260812`
Base: `a3f91c85a777b6d92ef3d85a6e3e4fc46bb7a4ff`

## Repair scope

The action-RPG template retains rejected `ItemStack` values, renders each retained stack through
`src/render/shapes.ts:createLootVisual()`, exposes the derived `pendingLootItem` and
`pendingLootQuantity` observations, and atomically swaps retained loot into a full inventory while
retaining the displaced stack on the floor. `src/items/Inventory.ts:restore()` now validates into
temporary slots before committing the exact serialized bag plus a separately equipped weapon.
`src/loot/drops.ts:rollDrops()` is the pure LCG under the seeded-drop proof. The
`src/scenes/Play.ts:onEnemyDeath()` callback calls it; `KeyT` defeats `enemy.visible` through that
callback and checks its captured seed and resulting drop.

## Gate results

| Gate | Exit | Result |
|---|---:|---|
| `pnpm install --frozen-lockfile` | RECORDED PRIOR | The preceding narrowed repair run recorded exit `0`; it was not rerun for repair round 1. |
| Action-RPG typecheck | 0 | PASS. `pnpm typecheck` from `/tmp/prd093-action-rpg.2uMzO2/game/action-rpg`. |
| Scoped Biome | 0 | PASS. `pnpm exec biome check packages/create-threenative/templates/action-rpg`; two complexity diagnostics remained warnings only. |
| Inventory WebGPU playtest | 0 | PASS with `--browser-recipe webgpu`; final report contained `"pass": true` for `Q → U → Q → P → L → L`. |
| `git diff --check` | 0 | PASS. |

The final inventory command was:

```sh
xvfb-run -a -s '-screen 0 1600x900x24' node node_modules/@threenative/playtest/dist/runner/cli.js \
  playtests/inventory.playtest.json \
  --url http://127.0.0.1:4173 \
  --server-command 'pnpm dev --host 127.0.0.1 --port 4173 --strictPort' \
  --browser-recipe webgpu --headed
```

It observed `pendingLootItem = "ember-blade"` and `pendingLootQuantity = 1` at
`full-refusal`; after `swap-retrieve`, `inventorySlots[0]` was `ember-blade x1`, the displaced
`rusted-blade x1` remained as retained floor loot, the equipped item remained `ember-blade`, and
one `loot-collected` signal was observed.

## Observed-red control

The isolated mutant replaced only `inventory.swapFirst({ itemId: stack.itemId, quantity: remainder })`
with `undefined` in `src/scenes/Play.ts`. The same WebGPU command exited `1` and reached
assertions. These results were red:

- `resource.GameState.pendingLootItem.atSteps`
- `resource.GameState.inventorySlots.atSteps`
- `signal.loot-collected`

The mutant was discarded; the normal source was rerun and exited `0`.

## Repair-round-2 evidence

The focused unit/control was added at
`packages/create-threenative/__tests__/action-rpg.spec.ts`. Against the repair base, the exact
command `pnpm exec vitest run packages/create-threenative/__tests__/action-rpg.spec.ts` exited
`1`: `Inventory.restore()` left `inventory.equipped` as `undefined` for six serialized full
potion slots plus a separately serialized `ember-blade`. After the atomic restore change, the
same command exited `0` with `1 passed`; it observed the exact six-slot payload, the equipped
weapon, and derived `12 + ITEMS.emberBlade.attackBonus = 18` damage.

The seeded-drop proof now names the executable path:
`src/scenes/Play.ts:246` `onEnemyDeath` captures `DROP_SEED + enemyIndex++` before calling
`rollDrops`, and `src/scenes/Play.ts:364` `KeyT` calls
`visibleEnemy.takeDamage(visibleEnemy.health)`, which reaches that callback. The inventory
scenario observes `GameState.enemiesDefeated`, `lastDrop`, `dropProof`, and the
`enemy.defeated` signal at `seeded-drops`.

| Control | Mutation / command | Observed result |
|---|---|---|
| Restore | Original base `Inventory.restore()` plus the new focused Vitest control | `exit 1`; `inventory.equipped` was `undefined`. Restored source: `exit 0`, `1 passed`. |
| Enemy-death seed | In the isolated PRD-088 scaffold, changed `src/scenes/Play.ts:onEnemyDeath` from `const seed = DROP_SEED + enemyIndex++` to `const seed = Date.now()`. Reused the inventory WebGPU command with `--url http://127.0.0.1:4176`. | `exit 1`; the real `enemy.defeated` callback and `lastDrop` ran, but `GameState.dropProof` stayed `0`. Restored source on port `4177`: `exit 0`, report `"pass": true`. |
| Roll function seed | In an isolated source copy, changed `src/loot/drops.ts:rollDrops` from `let state = seed >>> 0` to the constant `let state = 1`; reran `pnpm exec vitest run packages/create-threenative/__tests__/action-rpg.spec.ts`. | Old-code mutant: `exit 1`, with `1 failed / 1 passed`; the second seed produced `potion x1, potion x1` instead of the exact expected `potion x1, ember-blade x1`. Restored source: the same command exited `0` with `2 passed`. |
| Save/restore | `playtests/progress.playtest.json` on the restored source, port `4178` | `exit 0`, report `"pass": true`; restored `ember-blade`, `damage: 18`, health `77`, and checkpoint position. |
| Frozen install | `pnpm install --frozen-lockfile` | `exit 0`. |
| Workspace tests | `pnpm test` | `exit 0`; root Vitest reported `100` files / `825` tests, runtime-native reported `240` passed / `37` skipped, and Rust physics parity passed. |
| Workspace typecheck | `pnpm typecheck` | `exit 0` after building the local `playtest`, `core`, `physics`, and `ui` package artifacts required by the clean install. |
| Scoped Biome | `pnpm exec biome check packages/create-threenative/templates/action-rpg packages/create-threenative/__tests__/action-rpg.spec.ts` | `exit 0`; only the existing `Enemy.update` and `Play` complexity warnings remain. |
| Diff and mirror gates | `git diff --check`; `pnpm sync:agents --check` | Both `exit 0`. |

The final positive inventory command was:

```sh
xvfb-run -a -s '-screen 0 1600x900x24' node node_modules/@threenative/playtest/dist/runner/cli.js \
  playtests/inventory.playtest.json \
  --url http://127.0.0.1:4177 \
  --server-command 'pnpm dev --host 127.0.0.1 --port 4177 --strictPort' \
  --browser-recipe webgpu --headed
```

The negative control used the same command shape with port `4176` after mutating
`src/scenes/Play.ts:onEnemyDeath` to `const seed = Date.now()`; it exited `1` with
`dropProof: 0`. The restored command above exited `0` with `"pass": true`.

The focused `rollDrops` control calls the named pure function with seeds `1` and `0x12345678`
and asserts the exact sequences `potion x1, potion x1` and `potion x1, ember-blade x1`, plus
sequence inequality. Its constant-initial-state mutant was deterministic and observed red; the
restored `seed >>> 0` implementation was observed green. This control is separate from, and does
not replace, the real enemy-death callback proof above.

## Dependency boundary

The base package build predates the PRD-088 spatial-query API required by this template. A
base-only browser attempt exited `1` with `TN_ACTION_RPG_SPACE_MISSING`. The positive and red
browser runs used the documented isolated PRD-088 physics overlay built from
`70088fe15bdf0cbc1759545703ce60380518843f`; that overlay is not part of this lane's diff.
