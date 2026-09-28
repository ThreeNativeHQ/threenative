# PRD-471 — an RTS template, ported from AstraCraft

**Status: all phases landed 2026-09-28** · only the native desktop run in `## Blocked on` is left ·
filed 2026-09-28 against `73fe6245d` · owner: "we have this for a RTS template (should be refactored
for our engine)".

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

- [x] `src/sim/` holds types, nav (A*), economy, construction, production, combat, vision and the AI, with no three.js import. proof: `pnpm exec vitest run packages/create-threenative/__tests__/rts-sim.spec.ts` — 8/8 green, `pnpm exec biome check packages/create-threenative` — 0 errors (68 pre-existing complexity warnings)
- [x] A seeded 5-minute AI-vs-AI match replays to the same final state twice. proof: the same spec's determinism case — 6000 fixed 0.05 s steps, seed 18 byte-identical at step 2000 and at 6000, seed 19 diverges, green in 25.7 s. The seeded start leaves team 0 to the player and it falls at 222 s, so the tail is frozen and the mid-match comparison is what carries the claim

### Phase 2 — it plays in the engine

- [x] Terrain, instanced units/buildings, selection rings and health bars render through the engine on WebGPU with the default sky and sun. proof: `docs/verification/visuals/rts.png` — the terrain, ore crystals, a Command Core, workers, tanks, cyan selection rings and instanced health bars over the base plateau, with the `sky.jpg` background and one sun; captured by a 1280×720 `threenative-playtest --browser-recipe webgpu` run whose `visual.region` reported 0.2 non-blank and whose `rts-real-frame-boot` gate passed. Measuring it cut the boot: the terrain plane's 176 segments were 31 000 triangles and 5.3 s of compile, 112 segments are 12 600 and 2.8 s for the same 2 m resolution the navigation grid uses
- [x] Box select, gather, move, the RTS camera, the fog of war and the React HUD + minimap work from `ctx.input`. proof: `playtests/rts-orders.playtest.json` — an Alt+drag box sweeps the selection from 10 to 20, the right-click on the ore field puts the Surveyors on `gather,idle` and `state.gathered` goes 0 → 90, the next right-click puts all 20 on `move` and the selection travels 18.5 m; `playtests/survives.playtest.json` holds `ArrowUp` for 60 ticks and the camera moves. Both green in `TN_TEMPLATE_ONLY=rts pnpm test:templates`, 0 triviality opt-outs
- [x] Attack and build placement orders reach the simulation from a right-click. Split out of the box above because `rts-orders` proves the select/gather/move path only. proof: `playtests/rts-build.playtest.json` clicks the build menu's `Barracks` button at the pixel the 1280x720 panel puts it, `state.mode` reads `build:barracks`, the right-click clears it, and a click on the site 10 s later reports `primaryType: barracks` with `primaryBuilt: false` and a progress that changed from 1 — green in `TN_TEMPLATE_ONLY=rts pnpm test:templates`. `playtests/rts-attack.playtest.json` boxes the strike group, `KeyA` opens `state.mode: attack`, the right-click puts the selection on `attackMove` and travels 24.7 m, and the box's original "`order` becomes `attack`" is proved in `packages/create-threenative/__tests__/rts-sim.spec.ts` instead: only a *visible* contact is pickable and a visible one is walking, so no fixed pixel in a scenario lands on it (see `## Decisions`)
- [x] Per-frame sim + render stay allocation-free at 60 units. proof: `packages/create-threenative/__tests__/rts-runtime-cost.spec.ts`, 4/4 green — 600 steps of a sixty-own-unit match, 600 render syncs at the same size and 600 scene frames over the seeded battlefield each allocate 0 `Vector2`/`Vector3` constructions and 0 `clone()` calls, the scene reuses one state-patch object for the whole run, and no step mints an entity record. The first case asserts `src/sim/` imports no renderer, which is *why* its half is structurally zero

### Phase 3 — it ships as a kit

- [x] `templates/rts` with `kit.json`, AGENTS.md (< 100 lines) and playtests for select, gather, build, train, fight and an AI attack. proof: `TN_TEMPLATE_ONLY=rts pnpm test:templates` — 6 of 7 scenarios green and the `rts-real-frame-boot` gate green: `survives` (150 ticks), `rts-orders` (642), `rts-build` (280), `rts-train` (296), `rts-attack` (3660), `rts-ai-attack` (2520), 0 triviality opt-outs across all six. `battlefield-performance` is the one red and the reason is in `## Decisions`. The AGENTS.md is 97 lines (99 in its generated mirror) and 1524/3574 words
- [x] Scaffold specs and hashes include the kit. proof: `pnpm exec vitest run packages/create-threenative` — 789/790, the one red being this kit's byte-stable scaffold hash in `scaffold.spec.ts`, which the owner recomputes. Every other gate that names templates derives its list from the directories on disk (`test-support/templates.ts`), and `.github/workflows/ci.yml` already runs the kit in the per-template matrix
## Decisions

- 2026-09-28, phase 2: the kit dropped `@threenative/physics`. `src/sim/` does its own collision,
  A* and separation, and a Rapier world beside it bought nothing a strategy game's rules could not
  already do deterministically. The `AGENTS.md` row for `GroundSnap`/`normaliseToMetres` in
  `docs/verification/PRD-289-conventions-2026-08-31.md` became N/A for the same reason: every model
  is procedural and already in metres, and every unit is placed by the simulation at its own ground
  height, so there is no authored asset to normalise and no rendered body to keep on a floor.
- 2026-09-28, phase 2: `battlefield-performance` cannot pass on this host and the bounds were left
  at the fleet contract rather than moved. It measures 128 draw calls, 96 636 triangles and a 135 fps
  median at 1920×1080, all inside the scenario's ceilings, and reports the ceilings as failed
  anyway: `maxDrawCalls`, `maxTriangles` and `maxPhaseMsP95` fail closed when *any* sample in the
  series lacks the field, and 35 of 219 samples are the frames between the runner attaching and the
  world drawing its first frame. `maxFrameMsP95` is the same window — 2.8 s of boot compile spread
  over ~35 slow frames is more than 5% of a 660-tick run. `minimal` is clean on this host because
  its 1.9 s boot fits inside its 60-frame warm-up; the fix is boot cost, not the bound, and halving
  the terrain's triangles already took this kit from 8.7 s to 2.9 s. Re-measured on 2026-09-28
  after the look fix, four runs of the committed scenario read a p95 of 33.9, 51.4, 71.4 and 85.8 ms
  at the same 128 draw calls and 96 626 triangles, so the frame bound is this host's presentation
  rate rather than a scene verdict: 91% of the frame is `hostGap` under a virtual display. Raising
  the warm-up to 180 frames to take the boot out of the series moved the p95 to 33.9 ms, and
  `template.spec.ts` requires 60 of every template, so the warm-up went back.

- 2026-09-28, phase 3: the command panel could not be clicked. `Commands.tsx` is one
  `pointer-events-none` island, so every button inside it inherited `none` and the build menu, the
  train row and the order row were dead to a mouse on the web target; `data-tn-interactive` only
  routes touches on native. Each button now opts back in with `pointer-events-auto`, and the two
  scenarios that drive the panel are what found it — both failed until the class landed. One
  consequence is a behaviour change a player expects: a right-click over the panel no longer falls
  through to the battlefield, which is why `rts-orders` had to move its own move-order click.
- 2026-09-28, phase 3: the phase-2 box asked for `order` to become `attack` from a scenario. Only a
  *visible* contact is pickable, the two bases are 190 m apart, and the AI's wave that does come into
  sight is walking, so a fixed pixel cannot land on it — a 13 px pick radius is 0.5 m of ground at
  the tactical zoom, and the two scenarios that tried it either missed or, once aimed at the enemy
  Command Core, found the order refused because the core is still under fog. The rule is therefore
  proved where a contact can be placed (`rts-sim.spec.ts`: an explicit attack order becomes the
  unit's order and survives the shot), and the scenario proves the gesture half: `KeyA` opens the
  mode, the right-click turns it into `attackMove`, and the selection travels to the clicked ground.
  A tick is the engine's fixed step, so one tick is a third of a 0.05 s simulation step; that is
  what sized the waits (the AI's first contact with a passive player is 788 steps, ~2500 ticks).
- 2026-09-28, phase 2/3, look: the grid tile is 16 m (a 4 m line, a faint 1 m line inside each
  square) and the map now stands on a plain. The rig is wider than the 224 m map at its widest zoom
  and an orthographic camera's rays are parallel, so past the rim there was nothing to hit and the
  background — one direction, one flat colour — filled the corner of the frame with a pale grey
  wedge. The sky photograph is now the light and the environment, not a backdrop: at every zoom the
  frame is ground. `ZOOM_RANGE.far` and the apron's size are a pair; the kit's AGENTS.md says so.
## Blocked on

- Native desktop run of the kit — `pnpm native:build` lane, before merge.
