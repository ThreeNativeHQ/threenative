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
- `src/render/` is ordinary Three.js source. It has no framework imports.
- `src/scenes/Level.ts` is the live caller that wires the pieces together.
- `playtests/` proves movement, collection, stomping, respawn, and one-way platforms.

Use Godot names for physics nodes: `CharacterBody3D`, `Area3D`, `RigidBody3D`, and
`CollisionShape3D`. Dispose every node from `Level.exit()`. Feel belongs in the character,
not in `defineGame` options.
