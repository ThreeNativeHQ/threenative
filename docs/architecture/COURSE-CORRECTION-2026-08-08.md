# Course correction — the physics backend fork

**Status: IMPLEMENTED 2026-08-08.** Amends `CHARTER.md` §7 and §11. The audit below is
the historical failure record; the implementation now has one shared node source per
Godot-shaped class and a backend-only `PhysicsSimulation` seam.

## The mantra

**Write once, run everywhere.**

The developer never has to know native exists. They write their game against the framework
abstractions and plain Three.js, never think about the target, and it behaves the same on all
of them. That is the bar. "The same source compiles on both" is not the bar.

So: one `CharacterBody3D`. One `Area3D`. One `RigidBody3D`. One `CollisionShape3D`. The same
source file executes on web and on native, and the platform difference lives *below* it,
behind a seam narrow enough that no gameplay behaviour can drift across it.

A second implementation of a node class is not a backend. It is a fork, and a fork of
gameplay logic breaks the mantra even when the type signatures match.

## What the audit found

`packages/physics` shipped two sets of node classes before this correction:

```
src/CharacterBody3D.ts          231 LOC   imports * as RAPIER
src/Area3D.ts                   149 LOC
src/CollisionShape3D.ts         128 LOC
src/RigidBody3D.ts              116 LOC
src/plugin.ts                   271 LOC

src/native/CharacterBody3D.ts   114 LOC   imports nativeSimulation
src/native/Area3D.ts            124 LOC
src/native/CollisionShape3D.ts   91 LOC
src/native/RigidBody3D.ts        68 LOC
src/native/plugin.ts            141 LOC
```

The `threenative-native` export condition in `package.json` swaps the whole module. Both
`index.ts` files export the same names and re-export the same *types* from `../`, so user
source is genuinely portable — `import { CharacterBody3D } from "@threenative/physics"`
is written once. That part of the mantra holds.

**The behaviour is not portable.** The two `CharacterBody3D` files do different things.

### Divergences, verified by reading both files

| Feature | `src/CharacterBody3D.ts` | `src/native/CharacterBody3D.ts` |
|---|---|---|
| `autostep`, `snapToGround`, `maxSlopeClimbAngle`, `offset` | passed to the Rapier character controller (100–112) | **silently ignored** — `createBody` (43–52) takes no such fields |
| `oneWayLayers` | drives `filterGroups` + `filterPredicate` in `step()` (173–181) | assigned at line 41, **never read again** |
| moving-platform carry | `#physics.kinematicMotion(#groundCollider)` added to desired motion (164–172) | **absent** — no `#groundCollider`, no carry |
| `grounded` | `controller.computedGrounded()` (196) | heuristic (84): `#desiredY < 0 && y - #beforeY > #desiredY + 0.0001` |
| rotation → sim | `syncToPhysics()` sets next kinematic rotation (134–144) | `syncToPhysics()` is `{}` (73) |
| lifecycle | `step()` / `syncFromPhysics()` | `prepareStep()` / `applyTransform()`; `step()` and `syncFromPhysics()` are `{}` |

The `grounded` row is the worst of these. On native, when `#desiredY >= 0` the expression
short-circuits and `grounded` is **always false**. A player standing still, walking on level
ground, or rising through a jump reads as airborne. Every coyote-time and jump-buffer
implementation in the templates is built on that flag, and the templates are the same source
on both platforms. Silent stairs and silent one-way platforms are the same class of failure,
one notch less severe.

None of these are bugs in the ordinary sense. They are the predictable result of maintaining
two copies of the same class: a feature added to one is simply absent from the other, and
nothing reports it.

### The type system had already flagged this

`native/CharacterBody3D.ts:57` and `:111`:

```ts
this.#physics?.add(this as never);
this.#physics?.remove(this as never);
```

`PhysicsContext.add` takes `PhysicsBody3D`, which is `RigidBody3D | CharacterBody3D` — the
*web* classes, from `../plugin.js`. The native class does not satisfy that union, so the cast
is load-bearing. `native/plugin.ts` needs the same escape at lines 59, 65, 70, 120, 122, and
closes with `return plugin as PhysicsPlugin` (140).

Every one of those casts is the compiler correctly reporting "these are not the same type"
and being overruled. That is the drift, made visible and then suppressed.

### And it was untested

Only `__tests__/proof.spec.ts` reaches into `src/native/`, and only for `native/proof.ts`
(23 LOC) plus an assertion on the export map. The 538 LOC of native node classes and plugin
have **zero unit tests**. `character.spec.ts`, `area.spec.ts`, `rigidbody.spec.ts`,
`collision.spec.ts` and `plugin.spec.ts` all exercise the web classes exclusively.

### The docs described the design, not the code

`packages/physics/AGENTS.md` says:

> The public Godot-shaped nodes stay in this package, while the first native proof selects
> its host adapter through the `threenative-native` export condition.

That was the correct design, but the old code swapped the nodes themselves. Any agent reading
the old file would have believed the seam was somewhere it was not.

## The correction

### Rule: one node class per node

`src/CharacterBody3D.ts` is the only `CharacterBody3D`. Same for `Area3D`, `RigidBody3D`,
`CollisionShape3D`. Deleting `src/native/{Area3D,CharacterBody3D,CollisionShape3D,RigidBody3D}.ts`
is now the implemented state; `src/native/index.ts` re-exports the shared classes.

### The seam is `PhysicsSimulation`, and it already exists

`src/simulation.ts` (116 LOC) already defines `PhysicsSimulation`, `PhysicsInputSnapshot` and
`PHYSICS_TRANSFORM_STRIDE` — a bulk typed-array crossing, exactly the shape `CHARTER.md` §7
mandates. The seam was built and then bypassed.

```
CharacterBody3D  ── one file, no RAPIER import ──┐
Area3D                                            │
RigidBody3D                                       ├──►  PhysicsSimulation
CollisionShape3D                                  │      ├── web:    Rapier WASM
                                                  ┘      └── native: runtime-native ABI
```

The `threenative-native` export condition swaps **only** the `PhysicsSimulation`
implementation and its host binding. `native/host.ts` survives; the node classes do not.

The former blocker was `src/CharacterBody3D.ts:1` — `import * as RAPIER`. The shared node
classes now name only `PhysicsSimulation`; controller configuration, filter behavior, visible
transforms, and collision events live behind that seam.

### Design decision

Rapier's `KinematicCharacterController` does the slope, autostep, snap-to-ground and
collision-filter work in Rust today. Unifying the class means deciding where that lives:

- **(a) In the ABI** — the native runtime exposes the same controller, and `PhysicsSimulation`
  carries controller config through the bulk crossing. Keeps behaviour in Rapier on both
  sides; costs ABI surface.
- **(b) Above the ABI** — the sweep-and-slide logic becomes shared TypeScript over a raw
  shape-cast primitive. Identical behaviour by construction; costs a reimplementation of
  logic Rapier already has, and likely fails the 20-line rule as a *framework* concern.

Decision: use (a) at the `PhysicsSimulation` seam. The web and native adapters carry
controller configuration, character state, and bulk transforms through that seam. The native
adapter throws for shapes or options it cannot honor, so no behavior is silently discarded.
PRD-046 records the same decision.

### Parity is fail-closed, never silent

For anything the seam cannot carry, an option a backend cannot honour **throws at construction**.
The old `native/CharacterBody3D.ts` accepting
`autostep` and discarding it is the exact failure mode `/AGENTS.md` names — a check that
reports green while asserting nothing — relocated from the harness into the runtime.

### Conformance evidence

`packages/physics/__tests__/native-contract.spec.ts` runs the shared kinematic transform
scenario through the web adapter and the native adapter contract, asserts identical output,
asserts native and web exports are the same class objects, and verifies unsupported native
character options fail closed.

## Completed order of work

1. Added the two-backend conformance spec.
2. Recorded decision (a) in PRD-046.
3. Widened `PhysicsSimulation` to carry shared-node needs.
4. Rewrote all shared nodes and the plugin without backend imports.
5. Deleted the native node and plugin forks and their casts.
6. Added native transform transport and fail-closed unsupported-option checks.
7. Corrected `packages/physics/AGENTS.md` and regenerated its mirror.

Each step keeps the conformance spec as the gate. A step that does not turn a red row green
is not done.

## What this does not change

The public API. `CharacterBody3D`, `moveAndSlide`, `Area3D.on('bodyEntered')` and the Godot
vocabulary are correct and stay exactly as they are. This correction is entirely below the
line the user's agent writes against — which is what makes it worth doing rather than
shipping around.
