# AGENTS.md — __PROJECT_NAME__ defense

Instructions for the AI agent in this game. `CLAUDE.md` mirrors this file; edit `AGENTS.md`.

## Ownership

ThreeNative owns bootstrap, renderer, fixed-step loop, input, loading, physics bindings, and the
state bridge. This repository owns the route, attackers, towers, economy, waves, HUD, and look;
`src/game.ts` is portable and React mounts only from `src/main.ts`.

## Start every change

1. Before planning a mechanic, search `engine_search_capabilities` for the full request and each
   concrete mechanic; record a capability or no-match before writing a replacement.
2. Treat returned constraints as binding. `@threenative/physics/navigation` is browser-only WASM;
   this kit deliberately uses an authored `PathFollow3D` route instead of a navmesh.
3. If a build, import, device, or blank frame fails, run `npx threenative doctor` and
   `npx @threenative/playtest doctor`; missing observations are not zero.

## When the framework blocks you, write plain Three.js

When an `@threenative/*` API is broken, missing, or does not do what you need, replace only that
piece with portable Three.js/plain code. Keep the loop, scenes, input, registry, and playtest
bridge; avoid DOM globals, dynamic `import()`, and raw physics handles. **Report what blocked you**
(API, expectation, result, replacement); never stall the game.

## Workflow skills

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

`src/placement/Buildable.ts` validates with `directSpaceState.intersectShape` before spending;
`src/towers/Tower.ts` scans with a jittered shape query and reload clock. Change route points in
`src/board/Route.ts`, tower rules in `src/towers/`, and waves in `src/waves.ts`. Register gameplay
entities with `ctx.entities`; the single React HUD reads `GameState`, never an entity. Keep
`playtests/survives.playtest.json` as smoke proof and update other scenarios with each rule.

## Portable authoring contracts

Scenes use `load`, `enter`, `update`, `exit`, `render`; physics nodes are Godot-named and disposable.
`input.vector("move").y` is +up, so forward uses one explicit `-move.y` conversion. Rigged assets:
put a `.glb` in `assets/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then drive
`AnimationPlayer` beside its entity. `ctx.goto(name)` rebuilds without resetting game state; from
a frame function `goto` and then `return`; `ctx.state.set({ /* copy this game's initial-state shape */ })`
is a partial patch. `game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's
state. Seeded randomness is deterministic only when `defineGame({ seed })` is configured.

When an animation looks wrong, measure it before rewriting it. `clipPoseError` scores a
retargeted clip against its source per bone in degrees — whole quaternions relative to each rig's
own bind pose, so the two rigs' bind conventions cancel and a limb rolled about its own axis is
caught where a bone-direction check reads zero. `clipTrackBindings` names tracks that bind nothing
(the `<bone>.undefined` failure that plays the bind pose instead of the animation),
`clipBoneCoverage` names bones the clip does not drive and which therefore keep the previous
clip's pose, and `boneContact` reports in metres whether a named bone reaches the prop it is
supposed to be touching.

## Look and evidence

## Budget real time for the look

Edit `src/render/` directly; `postprocessing.ts` reports stages but decides no game colour. Quality
tiers live in `src/render/quality.ts`: `low`, `medium`, `high`; `isMobile()` chooses `low`, otherwise
`high`; override with `setupPost(..., { tier: "low" })`. Unknown tiers throw and `TN_QUALITY_TIER`
reports the source. A scenario with no assertions or missing observations fails; open a real capture.

Recipes shipped in the project: `agent-docs/assertion-reference.md`, `agent-docs/capability-reference.md`, `agent-docs/capture-the-frame.md`, `agent-docs/ctx-cookbook.md`, `agent-docs/debug-surface.md`, `agent-docs/finding-assets.md`, `agent-docs/gameplay-recipes.md`, `agent-docs/menu-screens.md`, `agent-docs/mobile-memory-budget.md`, `agent-docs/sculpt-from-a-reference.md`, `agent-docs/visual-baseline.md`, and `agent-docs/webview-ui.md`.
