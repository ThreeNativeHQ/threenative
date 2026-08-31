# AGENTS.md — __PROJECT_NAME__ arena shooter

Instructions for the AI agent in this game. `CLAUDE.md` mirrors this file; edit `AGENTS.md`.

## Ownership

ThreeNative owns bootstrap, renderer, fixed-step loop, input, loading, physics bindings, and the
state bridge. This repository owns the arena, weapons, waves, HUD, and look; `src/game.ts` is
portable and `src/main.ts` is the web-only React mount.

## Start every change

1. **Critical planning gate:** invoke `threenative-capabilities` before `prd-creator`. Search
   `engine_search_capabilities` for the full request and each concrete mechanic, inspect relevant
   matches with `engine_capability_detail`, and record a capability or no-match for the plan.
2. Then invoke `prd-creator`. Draft the plan around those capabilities and binding constraints,
   direct the user to review it, and wait for explicit approval plus an instruction to implement it.
3. Treat returned constraints as binding. `@threenative/physics/navigation` is browser-only WASM;
   use the direct physics queries already in this kit instead of a navmesh or distance scan.
4. If a build, import, device, or blank frame fails, run `npx threenative doctor` and
   `npx @threenative/playtest doctor`; missing observations are not zero.
For *"a bullet passes through a wall"*, `RigidBody3D` defaults to continuous collision; set `continuousCollision: false` to opt out, and read `body.continuousCollision` for the effective setting on web and native.

For the situation *"a bullet passes through a wall"*, `RigidBody3D` enables continuous collision
by default. Its `continuousCollision` option is the named per-body override, and
`body.continuousCollision` reports the effective setting on web and native.

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
pnpm typecheck
```

Contract: clear five waves to win; zero lives loses; F fires hitscan, G projectile, E radius blast,
C wall probe, H damage, X lethal hit, WASD/arrows move, R restarts. Use
`ctx.physics.directSpaceState` for hitscan/radius/target scans. `src/weapons/` owns combat,
`src/scenes/Play.ts` wires it, `src/ui/Hud.tsx` is the only HUD, and `state.ts` publishes lives/wave.
Keep `playtests/survives.playtest.json` as smoke proof; rewrite the other combat/outcome examples.


On a touch-primary device, the local `src/render/touch-controls.ts` adds a left movement stick,
a right aim stick and a fire button. Keyboard input remains the desktop fallback.

## Portable authoring contracts

Scenes use `load`, `enter`, `update`, `exit`, `render`; physics nodes are Godot-named and disposable.
Generated conventions call `GroundSnap` for floor contact, `normaliseToMetres` for authored model scale,
and `attachToBone` for held props.
`input.vector("move").y` is +up, so forward uses one explicit `-move.y` conversion. Rigged assets:
put a `.glb` in `assets/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then drive
`AnimationPlayer` beside its entity. `ctx.goto(name)` rebuilds without resetting game state; from
a frame function `goto` and then `return`; `ctx.state.set({ /* copy this game's initial-state shape */ })`
is a partial patch. `game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's
state. Seeded randomness is deterministic only when `defineGame({ seed })` is configured.

`src/render/quality.ts` owns `low`, `medium`, `high`; `isMobile()` chooses `low`, otherwise `high`;
override with `setupPost(..., { tier: "low" })`. Unknown tiers throw and `TN_QUALITY_TIER` reports
the source. The bridge flushes about 100 ms; keep lives/wave in state and frame feedback in Three.js.

When an animation looks wrong, measure it before rewriting it. `clipPoseError` scores a
retargeted clip against its source per bone in degrees — whole quaternions relative to each rig's
own bind pose, so the two rigs' bind conventions cancel and a limb rolled about its own axis is
caught where a bone-direction check reads zero. `clipTrackBindings` names tracks that bind nothing
(the `<bone>.undefined` failure that plays the bind pose instead of the animation),
`clipBoneCoverage` names bones the clip does not drive and which therefore keep the previous
clip's pose, and `boneContact` reports in metres whether a named bone reaches the prop it is
supposed to be touching.

## Budget real time for the look

Open a capture after visual changes. A scenario with no assertions or missing observations fails.

VFX appearance belongs in `src/render/vfx.ts`: keep its TSL material, geometry, colour, blend,
curves, timing and capacity there. Gameplay creates `GPUParticles3D` or an `IComputeDriven`
object once, adds it with `ctx.add`, and calls `restart()` from the real fire or hit path; do not
move appearance into core or replace the existing event with a demo-only caller.

Recipes shipped in the project: `agent-docs/assertion-reference.md`, `agent-docs/capability-reference.md`, `agent-docs/capture-the-frame.md`, `agent-docs/ctx-cookbook.md`, `agent-docs/debug-surface.md`, `agent-docs/finding-assets.md`, `agent-docs/gameplay-recipes.md`, `agent-docs/menu-screens.md`, `agent-docs/mobile-memory-budget.md`, `agent-docs/sculpt-from-a-reference.md`, `agent-docs/visual-baseline.md`, and `agent-docs/webview-ui.md`.

On a touch-primary device, the local `src/render/touch-controls.ts` adds a left movement stick,
a right aim stick and a fire button. Keyboard input remains the desktop fallback.
