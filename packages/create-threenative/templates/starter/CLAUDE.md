<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ starter

Instructions for the AI agent in this game. `CLAUDE.md` mirrors this file; edit `AGENTS.md`.

## Ownership

ThreeNative owns bootstrap, renderer, fixed-step loop, input, loading, physics bindings, and the
state bridge. This repository owns gameplay and every visible choice in `src/render/`, `src/entities/`,
`src/scenes/`, and `src/ui/`; `src/game.ts` is portable and React mounts from `src/main.ts`.

## Start every change

1. **Critical planning gate:** invoke `threenative-capabilities` before `prd-creator`. Search
   `engine_search_capabilities` for the full request and each concrete mechanic, inspect relevant
   matches with `engine_capability_detail`, and record a capability or no-match for the plan.
2. Then invoke `prd-creator`. Draft the plan around those capabilities and binding constraints,
   direct the user to review it, and wait for explicit approval plus an instruction to implement it.
3. Treat returned constraints as binding. `@threenative/physics/navigation` is browser-only WASM;
   use returned subpaths and `attachToBone` rather than rebuilding installed systems.
4. If a build, import, device, or blank frame fails, run `npx threenative doctor` and `npx @threenative/playtest doctor`; missing observations are not zero. For *"a bullet passes through a wall"*, `RigidBody3D` enables continuous collision by default; `continuousCollision` is the named per-body override, and `body.continuousCollision` reports the effective setting on web and native.

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
pnpm studio
pnpm build
pnpm build --target desktop
pnpm test
node tools/look.mjs
```

The game boots straight into `Play`: a ledge, pickup, crate, chasm, and flag produce `won` or
`lost`; `R` and the React restart intent rebuild from `initialState`. Keep the packaged
`assets/native-proof.glb` load and its console marker for the desktop asset gate. `Play.ts` owns
gameplay, `src/render/` owns the look, `src/ui/Hud.tsx`/`Menu.tsx` own UI, and `state.ts` publishes
JSON-safe values. Keep `playtests/survives.playtest.json` as smoke proof and update outcome tests.

On a touch-primary device (`isMobile() && isTouchscreenAvailable()`), local `src/render/touch-controls.ts` adds a left movement stick and right jump button; the scene passes its input to `Player`, with keyboard mapping as the desktop fallback.

## Portable authoring contracts

Scenes use `load`, `enter`, `update`, `exit`, `render`; physics nodes are Godot-named and disposable; generated conventions call `GroundSnap` for floor contact and `normaliseToMetres` for authored model scale.
React never touches the scene graph. Native UI reads published state and sends intents; mark every
touch target `data-tn-interactive`. Rigged assets: put a `.glb` in `assets/`, await
`ctx.assets.model("hero.glb")` in `Scene.load()`, then drive `AnimationPlayer` beside its entity.
`ctx.goto(name)` rebuilds without resetting game state; from a frame function `goto` and then
`return`; `ctx.state.set({ /* copy this game's initial-state shape */ })` is a partial patch.
`game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's state. Seeded
randomness is deterministic only when `defineGame({ seed })` is configured.

When an animation looks wrong, measure it before rewriting it. `clipPoseError` scores a retargeted clip against its source per bone in degrees — whole quaternions relative to each
rig's own bind pose, so the two rigs' bind conventions cancel and a limb rolled about its own axis is caught where a bone-direction check reads zero. `clipTrackBindings` names
tracks that bind nothing (the `<bone>.undefined` failure that plays the bind pose instead of the animation), `clipBoneCoverage` names bones the clip does not drive and which
therefore keep the previous clip's pose, and `boneContact` reports in metres whether a named bone reaches the prop it is supposed to be touching.

## Fused rock authoring
`src/render/rockRidge.ts` owns the granite field, seed, bounds, ridge material handoff, and quality choice; `src/render/implicitSurface.ts` is the local renderer-independent extractor and final-array topology audit. A fused mass is one implicit field; separate debris may be instanced.
After changing bounds, field, or resolution, run three fixed seeds and require the audit to report zero boundary edges, degenerate triangles, and winding conflicts with positive signed volume. Never hide holes with `DoubleSide` or a normal map.
`Play.enter` attaches Preview immediately, then the classic Worker refinement swaps atomically; do not add a main-thread showcase fallback.

## Quality and proof

`src/render/quality.ts` owns `low`, `medium`, `high`; `isMobile()` chooses `low`, otherwise `high`;
override with `setupPost(..., { tier: "low" })`. Unknown tiers throw and `TN_QUALITY_TIER` reports
the source. The bridge flushes about 100 ms; keep state human-readable and frame feedback in Three.js.
`input.vector("move").y` is +up, so forward uses one explicit `-move.y` conversion. A scenario
with no assertions or missing observations fails; open a real capture after visual changes.

## One shadow for a big outdoor level
When one directional light must shadow a whole valley and a 2048² map smudges, set `sun.shadow.shadowNode = new VirtualShadowNode(sun, { clipExtents: [12, 40, 120] })` from `@threenative/core`: camera-centred, texel-snapped clip levels, cached until the window moves and shared through Three's shadow slot. Bias, normal bias, intensity, radius, blur samples, map type and filter stay on `sun.shadow`; map sizes come from the options. For movers call `trackCaster(object)` — tracking or untracking refreshes the cached levels once, then movement draws a per-level mover map every frame without invalidating them; call `invalidateAll()` when static geometry changes. `TN_VIRTUAL_SHADOW` reports rendered, mover-map and cached-level work.

## Budget real time for the look

The performance skill carries `TN_FRAME_BUDGET`, platform targets, and the `display.maxFps` rule.
Long recipes shipped in the project: `agent-docs/assertion-reference.md`, `agent-docs/capability-reference.md`, `agent-docs/capture-the-frame.md`, `agent-docs/ctx-cookbook.md`, `agent-docs/debug-surface.md`, `agent-docs/finding-assets.md`, `agent-docs/gameplay-recipes.md`, `agent-docs/menu-screens.md`, `agent-docs/mobile-memory-budget.md`, `agent-docs/sculpt-from-a-reference.md`, `agent-docs/trace-a-slow-frame.md`, `agent-docs/visual-baseline.md`, and `agent-docs/webview-ui.md`.
