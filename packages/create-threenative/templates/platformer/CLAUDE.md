<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — __PROJECT_NAME__ platformer

This project is an editable Three.js platformer starter. The framework owns the loop,
input, renderer, physics bindings, and playtest bridge; this repository owns the feel,
level, entities, and look.

## Commands

```sh
pnpm dev
pnpm build
pnpm test
pnpm typecheck
```

## Where to work

- `src/entities/Character.ts` contains every movement and feel constant.
- `src/entities/Patrol.ts` and `src/entities/Pickup.ts` are ordinary gameplay classes.
- `src/level/` contains plain level helpers and checkpoint state.
- `src/render/` is ordinary Three.js source. It has no framework imports. The six baseline
  files are `palette.ts`, `camera.ts`, `sky.ts`, `lighting.ts`, `materials.ts`, and
  `postprocessing.ts`.
- `src/scenes/Level.ts` is the live caller that wires the pieces together.
- `playtests/` proves movement, collection, stomping, respawn, and one-way platforms.

`AnimationPlayer` is exported by `@threenative/core` for clips from a rigged asset. Put a
`.glb` in `public/`, await `ctx.assets.model("hero.glb")` in `Scene.load()`, then construct
and update the player beside the entity that owns the loaded model.

Use Godot names for physics nodes: `CharacterBody3D`, `Area3D`, `RigidBody3D`, and
`CollisionShape3D`. Register persistent entities with `ctx.entities`; the framework clears
registered entities, scene objects, and physics nodes when a scene exits. Dispose a node
explicitly only when removing it during play. Feel belongs in the character, not in
`defineGame` options.

`input.vector("move").y` is +up; map it to world-space -z for forward with one explicit
`-move.y` conversion in the character movement code.

`Level.static initialState` is the single initial-state value. `defineGame` discovers it from
the start scene, and gameplay updates use partial patches such as `ctx.state.set({ coins })`.

Keep the palette to six named colours with exactly one `accent`, and import it from materials
and sky. Set camera framing, tonemapping and exposure deliberately; keep the rim light,
soft shadows with `normalBias`, sky-derived fog, and bloom through
`renderer.setOutputNode()`. These visual decisions belong in this generated project, not in
the framework packages. Run `pnpm visuals` when changing the render layer.

## Budget real time for the look

The automated gates are blind to how the game looks. **Budget real time for the look:** boot
the game, capture a headed screenshot under `xvfb-run`, and inspect the silhouette, contact
shadows, motion, and HUD before calling a visual change done. headless Chromium usually cannot render WebGPU; use a real browser or browser tool, or headed Playwright with
`--enable-unsafe-webgpu --disable-gpu-sandbox --ignore-gpu-blocklist`.
