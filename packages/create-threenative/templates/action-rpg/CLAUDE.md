<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ action RPG

Instructions for the AI agent in this game. `CLAUDE.md` mirrors this file; edit `AGENTS.md`.

## Ownership

ThreeNative owns bootstrap, renderer, fixed-step loop, input, loading, physics bindings, and the
state bridge. This repository owns the dungeon, combat, stats, inventory, persistence, and every
visual decision; `src/game.ts` stays portable and `src/main.ts` is the web-only React mount.

## Start every change

1. **Critical planning gate:** invoke `threenative-capabilities` before `prd-creator`. Search
   `engine_search_capabilities` for the full request and each concrete mechanic, inspect relevant
   matches with `engine_capability_detail`, and record a capability or no-match for the plan.
2. Then invoke `prd-creator`. Draft the plan around those capabilities and binding constraints,
   direct the user to review it, and wait for explicit approval plus an instruction to implement it.
3. Treat returned constraints as binding. `@threenative/physics/navigation` is a browser-only
   WASM boundary here; use returned subpaths and `attachToBone` for held weapons.
4. If a build, import, device, or blank frame fails, run `npx threenative doctor` and
   `npx @threenative/playtest doctor`; missing observations are not zero.

## When the framework blocks you, write plain Three.js

When an `@threenative/*` API is broken, missing, or does not do what you need, replace only that
piece with portable Three.js/plain code. Keep the loop, scenes, input, registry, and playtest
bridge; avoid DOM globals, dynamic `import()`, and raw physics handles. **Report what blocked you**
(API, expectation, result, replacement); never stall the game.

## Workflow skills

- `.agents/skills/prd-creator/SKILL.md` / `.claude/skills/prd-creator/SKILL.md` — game plan and approval gate.
- `.agents/skills/threenative-capabilities/SKILL.md` / `.claude/skills/threenative-capabilities/SKILL.md` — capability search.
- `.agents/skills/threenative-playtest/SKILL.md` / `.claude/skills/threenative-playtest/SKILL.md` — diagnosis and proof.
- `.agents/skills/threenative-assets/SKILL.md` / `.claude/skills/threenative-assets/SKILL.md` — assets and sculpting.
- `.agents/skills/threenative-visuals/SKILL.md` / `.claude/skills/threenative-visuals/SKILL.md` — captures and look.
- `.agents/skills/threenative-performance/SKILL.md` / `.claude/skills/threenative-performance/SKILL.md` — measured budgets.
- `.agents/skills/threenative-ui/SKILL.md` / `.claude/skills/threenative-ui/SKILL.md` — native-safe UI.
- `.agents/skills/threenative-context/SKILL.md` / `.claude/skills/threenative-context/SKILL.md` — portable ctx APIs.
- Confirmed framework bugs: use `file-engine-bug` in `.agents/skills/` or `.claude/skills/` after a minimal repro.

## Commands and map

```sh
pnpm dev
pnpm build
pnpm build --target desktop
pnpm test
```

Controls: WASD/arrows move; Space/F attacks; E casts Arcane Surge; Q/U equips or unequips; P/L
tests inventory; T defeats the visible enemy; C/R checkpoints; H/X damage or defeat. Three rooms
lead to a boss win or zero-health loss. `StatBlock.ts` and `Inventory.ts` are game-owned; use
`intersectShape` for range and `intersectRay` for line of sight, not distance scans or navmesh.

`src/scenes/Play.ts` wires the loop; `src/entities/` owns gameplay; `src/render/` owns the look;
`src/ui/` owns React; `state.ts` publishes JSON-safe health, room, and inventory. Keep
`playtests/survives.playtest.json` as the smoke proof and update the other scenarios with gameplay.
The state bridge flushes about 100 ms, so per-frame feedback stays in scene-owned Three.js.

## Portable authoring contracts

Scenes use `load`, `enter`, `update`, `exit`, `render`; physics nodes are Godot-named and disposable.
Register testable entities with `ctx.entities`; `input.vector("move").y` is +up, so forward uses one
explicit `-move.y` conversion. Rigged assets: put a `.glb` in `assets/`, await
`ctx.assets.model("hero.glb")` in `Scene.load()`, then drive `AnimationPlayer` beside its entity.
`ctx.goto(name)` rebuilds without resetting game state; from a frame function `goto` and then
`return`; `ctx.state.set({ /* copy this game's initial-state shape */ })` is a partial patch.
`game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's state. Seeded
randomness is deterministic only when `defineGame({ seed })` is configured.

When an animation looks wrong, measure it before rewriting it. `clipPoseError` scores a
retargeted clip against its source per bone in degrees — whole quaternions relative to each rig's
own bind pose, so the two rigs' bind conventions cancel and a limb rolled about its own axis is
caught where a bone-direction check reads zero. `clipTrackBindings` names tracks that bind nothing
(the `<bone>.undefined` failure that plays the bind pose instead of the animation),
`clipBoneCoverage` names bones the clip does not drive and which therefore keep the previous
clip's pose, and `boneContact` reports in metres whether a named bone reaches the prop it is
supposed to be touching.

## Look and evidence

VFX appearance belongs in `src/render/vfx.ts`: keep its TSL material, geometry, colour, blend,
curves, timing and capacity there. Gameplay creates `GPUParticles3D` or an `IComputeDriven`
object once, adds it with `ctx.add`, and calls `restart()` from the real attack or Arcane Surge
path; do not move appearance into core or replace the existing event with a demo-only caller.

## Budget real time for the look

Edit game-owned `src/render/` directly. `src/render/quality.ts` defines `low`, `medium`, and
`high`; `isMobile()` selects `low`, otherwise `high`, and `setupPost(..., { tier: "low" })` is the
named override. Unknown tiers throw and `TN_QUALITY_TIER` reports the chosen source. A scenario
with no assertions or missing observations fails; keep the durable smoke proof and open a capture.

Recipes shipped in the project: `agent-docs/assertion-reference.md`, `agent-docs/capability-reference.md`, `agent-docs/capture-the-frame.md`, `agent-docs/ctx-cookbook.md`, `agent-docs/debug-surface.md`, `agent-docs/finding-assets.md`, `agent-docs/gameplay-recipes.md`, `agent-docs/menu-screens.md`, `agent-docs/mobile-memory-budget.md`, `agent-docs/sculpt-from-a-reference.md`, `agent-docs/visual-baseline.md`, and `agent-docs/webview-ui.md`.

On a touch-primary device, the local `src/render/touch-controls.ts` adds a left movement stick,
an attack button and an Arcane Surge button. Keyboard controls remain available on desktop.
