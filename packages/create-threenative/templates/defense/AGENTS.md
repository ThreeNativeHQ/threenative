# AGENTS.md — __PROJECT_NAME__ defense

This project is an editable Three.js tower-defense starter. The framework owns the loop,
renderer, physics bindings and playtest bridge; this repository owns the route, attackers,
towers, economy, waves and look.

## Commands

```sh
pnpm dev
pnpm build
pnpm build --target desktop
pnpm test
pnpm typecheck
```

The portable entry is `src/game.ts`; React mounting stays in `src/main.ts`. Attackers follow
the authored route with `PathFollow3D`. This kit deliberately has no navmesh, fog of war,
marquee selection or tech tree: `@threenative/physics/navigation` carries WASM and would make
the strategy sample web-only on QuickJS native hosts.

`src/placement/Buildable.ts` validates a prospective tower with `directSpaceState.intersectShape`
before the economy spends anything. `src/towers/Tower.ts` acquires attackers through a jittered
shape scan and fires on its own reload clock. Change route points in `src/board/Route.ts`, tower
rules in `src/towers/`, and the wave schedule in `src/waves.ts`.

`src/render/` owns the camera, palette, sky, lighting, materials and postprocessing. The HUD is
`src/ui/Hud.tsx` and there is only one of it: this template used to draw a geometry HUD on top of
the React one, showing every number twice. A native build has no HUD until you add one. The React
HUD reads `GameState`; it never reaches into an attacker or tower. Register gameplay
entities with `ctx.entities` so playtests can observe them and the framework can dispose them.

`B` places a tower in the next safe build slot for deterministic playtesting; real games place
with the primary pointer on the board. `X` attempts the route test slot and `O` repeats the last
safe slot, making the two placement negative controls reproducible.
Arrow keys or WASD move the registered command beacon, which is the `player` subject used by the
durable movement proof.

`playtests/survives.playtest.json` is the durable smoke proof. Keep it when replacing the
defense gameplay; the other `playtests/` scenarios are examples for placement, scanning,
survival, and leaks.

The normal physics API selects the native backend on desktop and Android. Keep source portable:
do not import React from `src/game.ts`, do not use dynamic `import()`, and do not read a raw
physics handle. No physical mobile or performance parity claim is made by this template.

The asset MCP loop is:

1. `asset_search_sources`
2. `ambientcg_search_assets` / `polyhaven_search_assets` / `audio_search_assets`
3. `ambientcg_list_files` / `polyhaven_list_files`
4. `asset_download_file` / `audio_download_asset`
5. Check returned license and attribution fields before committing an asset.
