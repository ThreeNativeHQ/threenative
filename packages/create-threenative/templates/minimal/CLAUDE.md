<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ minimal

Instructions for the AI agent in this game. This template has no React or Tailwind.
`CLAUDE.md` mirrors this file; edit `AGENTS.md`.

## Ownership

ThreeNative owns bootstrap, renderer, fixed-step loop, input, loading, physics bindings, and the
state store. This repository owns `src/render/`, `src/entities/`, and `src/scenes/`; all are
ordinary user code, and nothing in `@threenative/*` reads or chooses their appearance.

## Start every change

1. **Critical planning gate:** invoke `threenative-capabilities` before `prd-creator`. Search
   `engine_search_capabilities` for the full request and each concrete mechanic, inspect relevant
   matches with `engine_capability_detail`, and record a capability or no-match for the plan.
2. Then invoke `prd-creator`. Draft the plan around those capabilities and binding constraints,
   direct the user to review it, and wait for explicit approval plus an instruction to implement it.
3. Treat returned constraints as binding. `@threenative/physics/navigation` is browser-only WASM;
   use portable `ctx`/Three.js for this cross-target template.
4. If a build, import, device, or blank frame fails, run `npx threenative doctor` and
   `npx @threenative/playtest doctor`; missing observations are not zero.
For *"a bullet passes through a wall"*, `RigidBody3D` defaults to continuous collision; set `continuousCollision: false` to opt out, and read `body.continuousCollision` for the effective setting on web and native.

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

`src/main.ts` boots the canvas; `src/scenes/Play.ts` owns the lifecycle; `src/entities/Player.ts`
is a plain class; `src/render/hud.ts` is the one camera-parented, instanced-geometry HUD that works
on every target. Register it with `ctx.entities`; rewrite its glyphs and colours freely, but do not
add a second DOM readout. `playtests/survives.playtest.json` is the durable smoke proof.

## Portable authoring contracts

Scenes use `load`, `enter`, `update`, `exit`, `render`; physics nodes are Godot-named and disposable.
Generated conventions call `GroundSnap` for floor contact and `normaliseToMetres` for authored model scale.
`input.vector("move").y` is +up, so forward uses one explicit `-move.y` conversion. Rigged assets:
put a `.glb` in `assets/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then drive
`AnimationPlayer` beside its entity. `ctx.goto(name)` rebuilds without resetting game state; from
a frame function `goto` and then `return`; `ctx.state.set({ /* copy this game's initial-state shape */ })`
is a partial patch. `game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's
state. Seeded randomness is deterministic only when `defineGame({ seed })` is configured.

`src/render/sky.ts` owns the atmosphere fallback; WebGPU `Atmosphere` supplies sky, sun, and haze,
while WebGL uses the flat fallback. `src/render/quality.ts` owns `low`, `medium`, `high`; `isMobile()`
chooses `low`, otherwise `high`; override with `setupPost(..., { tier: "low" })`. Unknown tiers
throw and `TN_QUALITY_TIER` reports the source. `pnpm test` proves behavior, never the look.

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

Recipes shipped in the project: `agent-docs/assertion-reference.md`, `agent-docs/capability-reference.md`, `agent-docs/capture-the-frame.md`, `agent-docs/ctx-cookbook.md`, `agent-docs/debug-surface.md`, `agent-docs/finding-assets.md`, `agent-docs/gameplay-recipes.md`, `agent-docs/menu-screens.md`, `agent-docs/mobile-memory-budget.md`, `agent-docs/sculpt-from-a-reference.md`, `agent-docs/visual-baseline.md`, and `agent-docs/webview-ui.md`.

On a touch-primary device (`isMobile() && isTouchscreenAvailable()`), the local
`src/render/touch-controls.ts` adds a left movement stick and a right jump button. The scene
passes its returned input to `Player`; keep the keyboard mapping as the desktop fallback.
