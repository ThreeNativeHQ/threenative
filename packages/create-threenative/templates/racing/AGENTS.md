# AGENTS.md — __PROJECT_NAME__ racing

This project is an editable Three.js circuit-racing starter. The framework owns the loop,
input, renderer, physics bindings, and playtest bridge; this repository owns the car feel,
track, race rules, rescue, HUD, and look.

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

`src/render/` owns the palette, lighting, camera, materials, sky and postprocessing. The HUD is
`src/ui/Hud.tsx` and there is only one of it: this template used to draw a geometry HUD on top of
the React one, showing every number twice. A native build has no HUD until you add one.
There is no track format, racing-line solver, or `VehicleBody3D` abstraction. `Track.ts` uses
the generic `PathFollow3D` route follower directly. Change the circuit in `src/track/Track.ts`
and tune car constants in `src/entities/RacingCar.ts`.

`input.vector("move").y` is +up; the racing car treats it as throttle. Register entities with
`ctx.entities` so playtests can observe them. The HUD is a web convenience; the portable game
does not import React or the UI package.

`playtests/survives.playtest.json` is the durable smoke proof. Keep it when replacing the racing
gameplay; the other `playtests/` scenarios are examples for shortcuts, reversing, boosts,
rescues, rankings, and race outcomes.

## Playtest resources

The playtest bridge registers exactly two resource ids for the JSON-safe game state: `state` is the
canonical id, and `GameState` is a compatibility alias for older scenarios. New scenarios,
including the ones shipped here, must use `state`; resource paths address fields from `ctx.state`.
Keep the alias until existing published scenarios have migrated, then remove it in a future
breaking release.

The state bridge flushes every 100 ms by default, so keep values a human reads — speed, lap, or
place — in `ctx.state`. Per-frame visual feedback belongs in scene-owned Three.js objects; anything
shorter than about 100 ms must not go through React. If an event must appear in the HUD, give it a
decay longer than one flush interval. `CharacterBody3D.moveAndSlide(dt)` queues motion for the
shared bulk physics step rather than moving its object immediately. Because `THREE.Vector3` is
mutable, use `const before = mesh.position.clone()` (or copy its `x`, `y`, and `z` scalars) before
the call, then compare `mesh.position.distanceTo(before)` on the next update, after the step.
Storing `mesh.position` itself aliases the live transform and reports zero.

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
