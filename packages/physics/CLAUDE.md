<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — @threenative/physics

Read `/AGENTS.md` first. This file only covers what is different here.

## Why this package exists

One reason: the Rapier and Recast WASM dependencies must not be inherited by games that do
not use physics or navigation. That is the whole justification, and it is the only kind of
justification that creates a package here. Navigation is a `./navigation` subpath so the
public APIs stay separate. Native Rapier is compiled into `@threenative/runtime-native`;
it does not create another package.

## The names are Godot's

`RigidBody3D`, `Area3D`, `CharacterBody3D`, `CollisionShape3D`. Every model already knows
them, which is the point — zero discovery cost. Do not rename, do not add a fifth node type
without a PRD, and do not invent a name Godot does not use.

## These are bindings, not a simulation

`RigidBody3D` owns a backend handle and syncs its transform onto the `THREE.Object3D` you
handed it. The node classes are shared by web and native; only `PhysicsSimulation` names
the backend. They are not entities, components, or systems.

The web backend's underlying objects stay reachable through an explicitly backend-specific
`raw` escape hatch. On native, `raw` is opaque. Do not extend the portable API with concrete
Rapier types:

```ts
ctx.physics.world.raw   // Rapier World on web
crate.body.raw          // Rapier RigidBody on web
crate.object            // THREE.Object3D
```

If a wrapper starts growing convenience methods that Rapier already provides, delete them.
Code reaching through `raw` is backend-specific by contract and is not portable to native.

## Contracts to keep

- Every node exposes `dispose()`, and disposing must remove its backend handle and detach
  from the scene. The framework calls the plugin's scene-exit hook for nodes that remain
  registered with Rapier; callers still dispose a node explicitly when removing it during
  play.
- The fixed step is repeatable only within the pinned runtime that proves it. `__tests__/
  determinism.spec.ts` compares contact-rich `World.takeSnapshot()` bytes on the same
  machine and in a fresh worker; do not claim cross-browser, cross-OS, or cross-version
  replay portability.
- `Area3D.on('bodyEntered', ...)` returns an unsubscribe function. Callers store it.

## Navigation

`NavigationRegion3D` bakes a solo Recast navmesh from the user's world-space meshes,
`NavigationAgent3D` computes a path and exposes the next position, and
`NavigationObstacle3D` supplies local crowd avoidance. The agent never moves its object;
gameplay writes the steering velocity and calls `CharacterBody3D.moveAndSlide()`.

Solo navmeshes are static. Obstacles affect local avoidance only; geometry that changes
shape requires an explicit re-bake and is outside this binding.

## Native path

Native Rapier compiled into `@threenative/runtime-native` is the mobile answer; WASM Rapier
is not viable on the Android QuickJS host. There is one source file per public node, and the
`threenative-native` export condition swaps only the `PhysicsSimulation` host adapter. Do not
import `@threenative/physics-native` or add per-object native calls. A native shape or
character option the ABI cannot honor must throw during construction; it must never be
silently ignored.

Both backends exercise the contract through `PhysicsSimulation.step()` and
`readVisibleTransforms()`. Kinematic input and visible transforms use reusable typed-array
records; keep the fixed-step crossing bulk-shaped. See `CHARTER.md` §7,
`docs/architecture/NATIVE-RUNTIME.md`, and PRD-046.
