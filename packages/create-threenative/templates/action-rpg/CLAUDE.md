<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ action RPG

This is a playable ThreeNative action-RPG starter. The framework owns the loop, renderer,
input, physics binding, and React bridge. This generated project owns the dungeon, combat,
stats, inventory, persistence, and every visual decision.

The portable entry is src/game.ts. The web-only React mount is src/main.ts. Keep all
gameplay and render source portable: native never imports src/ui or the DOM.

## When the framework blocks you, write plain Three.js

An API in `@threenative/*` that is broken, missing, or does not do what you need is **not
something to wait for or to work around from inside its shape.** Drop to vanilla Three.js —
or to the plain code that does the job — for that one thing and keep building. Your `src/`
is ordinary source; nothing in `@threenative/*` reads it, so a hand-written `THREE.*`
implementation sitting beside a framework API is a supported outcome, not a hack.

1. **Scope the fallback to what actually blocked you.** Keep the loop, scenes, input, entity
   registry and playtest bridge; replacing all of them because one node misbehaved costs far
   more than it saves.
2. **Keep the fallback portable.** Plain Three.js and plain math run on native. `document`,
   `window`, `localStorage`, dynamic `import()`, and a raw physics handle do not — reach for
   one of those and this part of the game is web-only from then on.
3. **Report what blocked you**: the API, what you expected, what happened, and what you
   wrote instead. That is how the gap gets fixed for the next game; a silent workaround
   leaves it in place.

Never contort the game to flatter the framework, and never stall on a framework bug. A
finished game carrying a plain Three.js patch beats a blocked one every time.

Controls:

- WASD / arrows move.
- Space or F attacks; E casts Arcane Surge.
- Q equips the found blade; U unequips it.
- P fills the bag; L tests a full-bag loot refusal; T defeats the visible enemy through the real
  drop callback and proves seeded drops.
- C checkpoints; R restores the last checkpoint; H damages the player; X forces defeat.

The dungeon has three rooms. Defeat the room-three boss to win; reach zero health to fail.
Enemy acquisition uses intersectShape for range and intersectRay for line of sight. Do not
replace those queries with a distance scan or @threenative/physics/navigation.

`playtests/survives.playtest.json` is the durable smoke proof. Keep it when replacing the
action-RPG gameplay; the other `playtests/` scenarios are examples for combat, inventory,
progress, win, and fail behavior.

StatBlock.ts and Inventory.ts are deliberately game-owned source. Delete or reshape them
when changing this game's design; they are not framework APIs. React reads the JSON-safe
projection in state.ts and never imports entities.

Interior lighting is intentional: sky.ts provides a dark ambient/fog envelope while the
key, rim, and fill lights illuminate the dungeon. It is not a visible skybox.

The asset MCP loop is:

1. `asset_search_sources`
2. `ambientcg_search_assets` / `polyhaven_search_assets` / `audio_search_assets`
3. `ambientcg_list_files` / `polyhaven_list_files`
4. `asset_download_file` / `audio_download_asset`
5. Check returned license and attribution fields before committing an asset.
