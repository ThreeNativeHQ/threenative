# PRD-471 — an RTS template, ported from AstraCraft

**Status: NOT STARTED** · filed 2026-09-28 against `73fe6245d` · owner: "we have this for a RTS template
(should be refactored for our engine)".

## Why

There is no strategy kit. The owner supplied `AstraCraft-v3.html`: a complete single-file RTS (808 KB,
of which 623 KB is an inlined three.js r140 and 185 KB is game code; zero embedded assets). It already
has what a kit needs: 18 unit and building types in one data table, box selection, contextual orders,
A* on a 112×112 grid with line-of-sight smoothing, ore/gas economy with refineries, construction with
refunds, per-producer queues and a supply cap, combat with air/ground tables and splash, per-player fog
of war, a four-state AI that sees only what the player sees, a minimap, RTS camera, and a fixed 0.05 s
simulation step. Worldgen is seeded (mulberry32) with exactly one `Math.random` in game code.

## What changes in the port

- The simulation becomes plain TypeScript modules in `src/sim/`, deterministic, driven by the engine's
  fixed step and `ctx.random`, and unit-tested headless.
- Rendering moves to the engine's WebGPU path: units and buildings stay procedural and instanced, the
  terrain is a displaced plane with a generated material, the look follows the templates' default
  (`template-assets/assets/sky.jpg` as background and environment light, one sun, `worldEnvironment.ts`).
- Everything the original drew with canvas 2D moves to where it can run on every target: health bars
  and labels to instanced geometry, fog of war to a data texture sampled by the terrain material, the
  minimap and HUD to `src/ui/` (React + Tailwind).
- Input goes through `ctx.input` bindings (select, command, edge scroll, zoom) instead of 44 raw DOM
  listeners; the `globalThis.astracraft` debug handle becomes the playtest bridge.

## Phases

### Phase 1 — the simulation runs headless

- [ ] `src/sim/` holds types, nav (A*), economy, construction, production, combat, vision and the AI, with no three.js import. proof: `pnpm exec vitest run` on the kit's sim specs
- [ ] A seeded 5-minute AI-vs-AI match replays to the same final state twice. proof: determinism spec

### Phase 2 — it plays in the engine

- [ ] Terrain, instanced units/buildings, selection rings and health bars render through the engine on WebGPU with the default sky and sun. proof: capture
- [ ] Box select, move/attack/gather/build orders, RTS camera, fog of war and the React HUD + minimap work from `ctx.input`. proof: playtest `rts-orders`
- [ ] Per-frame sim + render stay allocation-free at 60 units. proof: template runtime-cost spec

### Phase 3 — it ships as a kit

- [ ] `templates/rts` with `kit.json`, AGENTS.md (< 100 lines) and playtests for select, gather, build, train, fight and an AI attack. proof: `TN_TEMPLATE_ONLY=rts pnpm test:templates`
- [ ] Scaffold specs and hashes include the kit. proof: `pnpm exec vitest run packages/create-threenative`

## Blocked on

- Native desktop run of the kit — `pnpm native:build` lane, before merge.
