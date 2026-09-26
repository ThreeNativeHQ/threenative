# Physics and movement

Add Rapier bodies, a controllable character and trigger areas that run the same on web and native
builds.

## Setup

Add the `rapier()` plugin and pass `IPhysicsContext` as the second type parameter. Scenes then get
the physics service as `ctx.physics`.

```ts
import { rapier, type IPhysicsContext } from "@threenative/physics";

const game = defineGame<GameState, IPhysicsContext>({
  plugins: [rapier()],
  // scenes, start, ...
});
```

`rapier()` accepts `gravity` and `deterministicRestart`. With `deterministicRestart: true`, each
scene gets a fresh simulation, so a restarted scene settles exactly like the first run. It frees
the backend world at scene exit, so any `raw` reference from the old scene becomes invalid.

## Nodes

The node names follow Godot.

| Class | Use it for |
| --- | --- |
| `RigidBody3D` | Crates, balls and platforms. `type` is `"dynamic"` (default), `"fixed"` or `"kinematic"`. |
| `CharacterBody3D` | Player or enemy movement with collision. Set `velocity`, then call `moveAndSlide(dt)`. |
| `Area3D` | Triggers such as pickups, checkpoints and doorways. |
| `CollisionShape3D` | The contact shape: `box`, `sphere`, `capsule` or `fromMesh`. |

This is how the minimal template builds its floor, player and pickup:

```ts
new RigidBody3D({
  object: floor,
  physics: ctx.physics,
  shape: CollisionShape3D.fromMesh(floor),
  type: "fixed",
});

const body = new CharacterBody3D({
  autostep: { maxHeight: 0.4, minWidth: 0.2 },
  object: mesh,
  physics: ctx.physics,
  shape: CollisionShape3D.capsule(0.2, 0.3),
});

const pickup = new Area3D({
  physics: ctx.physics,
  position: { x: 1.5, y: 0.5, z: 0 },
  shape: CollisionShape3D.box(1, 1, 1),
});
pickup.on("bodyEntered", (entered) => {
  if (entered === body) ctx.state.set((state) => ({ score: state.score + 1 }));
});
```

Each step, the player sets `body.velocity` from input and calls `body.moveAndSlide(dt)`. Read
`body.grounded` to allow a jump. Call `dispose()` on a body when its scene ends. `Area3D.on`
returns a function that removes the handler.

## Web and native

Browser builds run Rapier through WebAssembly. Desktop and Android builds use the native runtime's
Rapier. ThreeNative picks the backend for the target, so the node API stays the same. See
[Native runtime](native-runtime.md) for platform support.

## Raw access

`world.raw`, `body.raw`, `collider.raw` and `CollisionShape3D.raw` expose the backend object. On
the web this is a Rapier object. In a native build it is an opaque handle. Code that reads `raw` is
not portable. Keep it apart from shared gameplay and check which backend it expects.

For a low-level integration, `ctx.physics.simulation` batches per-frame work. `step()` takes body
input in reusable typed arrays and `readVisibleTransforms()` returns visible transforms in bulk.
This moves many bodies per call instead of one platform call per body.

## Tests and replays

Use playtests to check interactions: the character reaches a platform, a crate comes to rest, a
trigger adds a point. Run them on every release target.

Physics replays and snapshots repeat only on the exact runtime that recorded them. They do not
carry across web and native, Rapier versions, operating systems or CPU architectures. Use gameplay
scenarios for checks that must pass on every platform.

## Source

- [physics README](../../packages/physics/README.md)
- [plugin.ts](../../packages/physics/src/plugin.ts)
- [minimal template Play.ts](../../packages/create-threenative/templates/minimal/src/scenes/Play.ts)
