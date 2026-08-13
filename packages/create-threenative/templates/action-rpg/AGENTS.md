# AGENTS.md — __PROJECT_NAME__ action RPG

This is a playable ThreeNative action-RPG starter. The framework owns the loop, renderer,
input, physics binding, and React bridge. This generated project owns the dungeon, combat,
stats, inventory, persistence, and every visual decision.

The portable entry is src/game.ts. The web-only React mount is src/main.ts. Keep all
gameplay and render source portable: native never imports src/ui or the DOM.

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
