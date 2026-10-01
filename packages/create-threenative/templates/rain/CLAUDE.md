<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ rain

`CLAUDE.md` mirrors this file. Edit `AGENTS.md`, then regenerate the mirror.

## Ownership

ThreeNative owns bootstrap, renderer, frame loop, input, loading, asset/audio lifetimes and the UI state bridge. This game owns the procedural coastal storm, weather presets, camera movement, shaders, sound design and interface. Appearance stays in `src/render/`; those files use ordinary Three.js and receive engine resources from the scene.

## Before authoring

1. Search `engine_search_capabilities` for the complete request and each concrete mechanic. Inspect every hit with `engine_capability_detail`; reuse installed mechanisms and respect their constraints.
2. Apply the ponytail ladder: existing system, standard library, installed Three.js, then the smallest portable game code. A no-match permits game-owned maths; it does not justify a package abstraction.
3. Plan cross-file changes with the installed `prd-creator` skill. Existing authorization to implement remains authorization.
4. Name a fault's layer before fixing it. A platform or engine fault belongs in the engine, with a reproducer; keep game code portable.
5. Diagnose missing browsers, devices or blank captures with `npx threenative doctor --text` or the playtest doctor before blaming the scene.

## Commands and map

```sh
pnpm dev
pnpm typecheck
pnpm build:web
pnpm build:desktop
pnpm test
```

`src/game.ts` defines named input and validates UI intents. `src/state.ts` owns weather validation, preset targets, easing and the flash envelope. `src/scenes/Boot.ts` runs the coast simulation. `src/render/` owns every visual choice; `src/ui/` reads mirrored state and sends intents through `UiLayer`. Browser APIs belong in the UI realm, never in portable game code.

## Conventions and overrides

One world unit is one metre. The free-fly camera starts at `(1.8, 2.85, 18)` and clamps altitude to `1.65…110` metres; `src/render/camera.ts` owns the home view, travel bounds and speeds. Manual movement cancels cinematic orbit. There is no walking actor, weapon attachment or navigation agent to ground or bind in this study.

Weather controls update targets; exponential easing updates the rendered weather. Unknown keys, nonfinite values, malformed payloads and unknown intents are rejected. Quality names are `performance`, `balanced`, `high`, `ultra`; an explicit UI choice overrides the viewport default. Report actual stage dimensions and observations, never a counter that merely repeats the requested tier.

Lightning is gated at the shared strike entry point by `safe`. Reduced-motion preferences initially enable safety and disable automatic lightning and cinematic motion; later explicit choices remain choices. Audio begins only after a gesture. Pause belongs to the engine loop, and sound must follow pause, mute and visibility.

## Verification

A passing unit test proves its logic; a passing playtest proves observed runtime behavior. Empty assertions, missing observations, console errors and software-adapter diagnostics do not become success. Rerun the relevant scenario after changing its behavior, then inspect its capture against the reference. Browser captures do not prove native behavior; state which target actually ran.

Installed recipes: `node_modules/create-threenative/agent-docs/references/capability-reference.md`, `ctx-cookbook.md`, `assertion-reference.md`, `capture-the-frame.md`, `build-profiles.md`, `webview-ui.md` and `dream-loop.md`, all in that same references directory. Installed skills live in `.agents/skills/` and `.claude/skills/`.
