<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ racing

This project is an editable Three.js circuit-racing starter. The framework owns the loop,
input, renderer, physics bindings, and playtest bridge; this repository owns the car feel,
track, race rules, rescue, HUD, and look.

## Commands

```sh
pnpm dev
pnpm build
pnpm build --target desktop
pnpm test
pnpm typecheck
```

The portable entry is `src/game.ts`; React mounting stays in `src/main.ts`. The car uses
`CharacterBody3D`, not a package-level vehicle node. `src/track/` is ordinary user-owned
source: `Lap.ts` orders Area3D gate crossings, `TrackSector.ts` records the last ray-probed
road transform, and `Ranking.ts` ranks by route progress rather than world distance.

`src/render/` owns the palette, lighting, camera, materials, sky, postprocessing and HUD.
There is no track format, racing-line solver, or `VehicleBody3D` abstraction. `Track.ts` uses
the generic `PathFollow3D` route follower directly. Change the circuit in `src/track/Track.ts`
and tune car constants in `src/entities/RacingCar.ts`.

`input.vector("move").y` is +up; the racing car treats it as throttle. Register entities with
`ctx.entities` so playtests can observe them. The HUD is a web convenience; the portable game
does not import React or the UI package.

The normal physics API selects the native backend on desktop and Android. The optional
`intersectRay` query is used when the host provides PRD-088's coarse ray probe; the track has
an ordinary Three.js fallback so the starter remains runnable before that backend is present.
No claim of physical mobile or performance parity is made by this template.

The asset MCP loop is:

1. `asset_search_sources`
2. `ambientcg_search_assets` / `polyhaven_search_assets` / `audio_search_assets`
3. `ambientcg_list_files` / `polyhaven_list_files`
4. `asset_download_file` / `audio_download_asset`
5. Check returned license and attribution fields before committing an asset.
