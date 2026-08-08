<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — @threenative/physics

Read `/AGENTS.md` first. This file only covers what is different here.

## Why this package exists

One reason: the Rapier and Recast WASM dependencies must not be inherited by games that do
not use physics or navigation. That is the whole justification, and it is the only kind of
justification that creates a package here. Navigation is a `./navigation` subpath so the
last workspace slot stays reserved for `@threenative/physics-native`.

## The names are Godot's

`RigidBody3D`, `Area3D`, `CharacterBody3D`, `CollisionShape3D`. Every model already knows
them, which is the point — zero discovery cost. Do not rename, do not add a fifth node type
without a PRD, and do not invent a name Godot does not use.

## These are bindings, not a simulation

`RigidBody3D` owns a Rapier handle and syncs its transform onto the `THREE.Object3D` you
handed it. Roughly 80 lines. It is not an entity, not a component, not a system.

The underlying objects stay reachable and must never be hidden:

```ts
ctx.physics.world   // Rapier World
crate.body          // Rapier RigidBody
crate.object          // THREE.Object3D
```

If a wrapper starts growing convenience methods that Rapier already provides, delete them —
the user reaches `body` directly.

## Contracts to keep

- Every node exposes `dispose()`, and disposing must remove the Rapier handle and detach
  from the scene. The framework calls the plugin's scene-exit hook for nodes that remain
  registered with Rapier; callers still dispose a node explicitly when removing it during
  play.
- The fixed step is deterministic. `__tests__/determinism.spec.ts` asserts identical inputs
  produce identical transforms — a change that makes it flaky is a broken change, not a
  flaky test.
- `Area3D.on('bodyEntered', ...)` returns an unsubscribe function. Callers store it.

## Navigation

`NavigationRegion3D` bakes a solo Recast navmesh from the user's world-space meshes,
`NavigationAgent3D` computes a path and exposes the next position, and
`NavigationObstacle3D` supplies local crowd avoidance. The agent never moves its object;
gameplay writes the steering velocity and calls `CharacterBody3D.moveAndSlide()`.

Solo navmeshes are static. Obstacles affect local avoidance only; geometry that changes
shape requires an explicit re-bake and is outside this binding.

## Native path

`@threenative/physics-native` (JSI binding to Rapier's Rust) is the planned mobile answer;
WASM Rapier is not viable on Hermes or Android JSC. See `CHARTER.md` §7 and
`docs/architecture/NATIVE-RUNTIME.md`. It does not exist yet — do not import it or write
code that assumes it.
