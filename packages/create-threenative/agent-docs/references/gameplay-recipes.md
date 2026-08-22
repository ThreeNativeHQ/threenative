# Gameplay recipes — movement, input, physics-step timing, and saves

Companion to the gameplay sections in this project's `AGENTS.md`.

## Forward is -z, and the mapping happens once

`input.vector("move").y` is +up; map it to world-space -z for forward with one explicit
`-move.y` conversion in the player movement code. One conversion site per entity — a second
one flips the controls.

## A gamepad already drives this game

`vector` adds the left stick to the action literally named `move`, and
`jump: { buttons: [0] }` in `src/game.ts` is that pad's south face button — `buttons` is the
gamepad, `mouseButtons` is the mouse. Two consequences worth knowing before you debug either:
the stick reaches **only** an action called `move`, so renaming that action or adding a second
stick-driven one (a `look` axis, say) gets you nothing, and there is no deadzone, so a worn
stick's resting drift is added every frame and the character creeps. Subtract your own deadzone
in the entity if that shows up.

## moveAndSlide queues motion for the shared physics step

`CharacterBody3D.moveAndSlide(dt)` owns gravity through `body.velocity` and queues motion for
the shared bulk physics step rather than moving its object immediately. Because
`THREE.Vector3` is mutable, use `const before = mesh.position.clone()` (or copy its `x`, `y`,
and `z` scalars) before the call, then compare `mesh.position.distanceTo(before)` on the next
update, after the step. Storing `mesh.position` itself aliases the live transform and reports
zero. Keep coyote-time and jump-buffer timers in the entity so jump feel stays game-owned.

## Save only declared state

The framework does not serialize entities, scene graphs, or physics handles, and it never
will; save those fields in your own object literal:

```ts
const save = JSON.stringify({ state: ctx.state.getState(), playerX: player.mesh.position.x });
const loaded = JSON.parse(save) as { state: GameState; playerX: number };
ctx.state.set(loaded.state);
player.body.teleport({ x: loaded.playerX, y: player.mesh.position.y, z: player.mesh.position.z });
```

## Hot reload carries JSON-shaped state only

`main.ts` calls `acceptHotUpdate(game, import.meta.hot)` for development reloads. The
framework preserves only store state; seed entities from the carried values such as
`playerX` in `enter()`, because the scene graph, physics world, audio voices, particles, and
renderer are rebuilt on every update.

## The state bridge throttles

The bridge flushes every 100 ms by default: write `ctx.state.set({...})` from `update()` at
loop rate — it coalesces — and read it from HUD components at ~10 Hz. Per-frame visual
feedback belongs in scene-owned Three.js objects. If an event must appear in the HUD, give
it a decay longer than one flush interval.
