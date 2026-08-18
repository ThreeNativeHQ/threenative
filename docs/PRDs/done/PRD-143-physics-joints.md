---
prd_contract: v1
---

# PRD-143 — `@threenative/physics` has no joints, so nothing can be hinged, pinned or chained

**Status:** COMPLETE, 2026-08-18. The shared web/native joint seam and the required desktop
hinged-door scenario passed.

**Outcome:** two bodies can be constrained to each other — pin, hinge, fixed — through one class
that works on both backends, and a game that needs a door, a rope, a chain, a vehicle axle or a
ragdoll is no longer told to write its own solver.

**Depends on:** nothing.

**Blocks:** [PRD-144](./PRD-144-ragdoll.md) was unbuildable without this and was withdrawn
after the dependency landed.

**Complexity: 7 → HIGH mode.** It crosses the JS→C++ ABI, which is the seam this repository is
most careful about.

**Blast radius: 8 files.** `packages/physics/src/Joint3D.ts` (new),
`packages/physics/src/simulation.ts`, `packages/physics/src/web.ts`,
`packages/physics/src/native.ts`, `packages/physics/src/native/host.ts`,
`packages/physics/src/index.ts`, the C++ physics binding under
`packages/runtime-native/src/physics/`, and one new `__tests__` spec.

---

## 1. The gap

`packages/physics/src/index.ts` exports `Area3D`, `CharacterBody3D`, `CollisionShape3D`,
`PhysicsDirectSpaceState3D`, `RigidBody3D` and the plugin. **There is no joint of any kind.**
`grep -rn "joint\|Joint\|revolute\|spherical" packages/physics/src/` returns only the word
"hemispherical" in a capsule comment.

`IPhysicsSimulation` (`simulation.ts:144-184`) has `createBody`, `removeBody`,
`setBodyTransform`, `applyBodyImpulse`, `applyBodyForce`, `setBodyLinearVelocity`, `step`,
`readVisibleTransforms`, three query methods and `drainCollisionEvents`. Nothing constrains one
body to another.

Rapier — the web backend — has `RevoluteJoint`, `SphericalJoint`, `FixedJoint`, `PrismaticJoint`
and a generic joint. **The capability is there and the seam does not carry it.**

**Name the layer. This is an engine bug**, and unambiguous under the two questions. A game cannot
write a joint portably: the constraint has to be solved inside the backend, and the backend is
swapped by the `threenative-native` export condition specifically so games never see which one
they got. It decides nothing about how anything looks.

This is not a niche gap. Without joints there is no hinged door, no rope bridge, no chain, no
swinging sign, no vehicle suspension, no ragdoll, and no articulated anything. Every one of those
is table stakes in the engines this project borrows vocabulary from.

## 2. Scope: three joints, not five

Godot's names, since Godot is the node vocabulary:

| Ship | Godot | Rapier | Why |
| --- | --- | --- | --- |
| `PinJoint3D` | `PinJoint3D` | spherical | the ragdoll primitive; shoulders, hips, necks |
| `HingeJoint3D` | `HingeJoint3D` | revolute | doors, lids, elbows, knees, wheels |
| `Joint3D` (fixed) | — | fixed | welding two bodies; the trivial case worth having to prove the ABI |

**Deliberately not shipped: `SliderJoint3D` and `Generic6DOFJoint3D`.** No game in this repository
needs them, and a generic 6-DOF joint is a configuration surface rather than a constraint — twelve
limit fields nobody has a use for. They are added when a second game asks. Recorded so their
absence is a decision, not an oversight.

## 3. The seam

Two additions to `IPhysicsSimulation`, and they must be **cold-path** — created once, destroyed
once, never touched per frame:

```ts
createJoint(options: IPhysicsJointCreateOptions): number;   // returns a joint id
removeJoint(id: number): void;
```

The per-frame cost stays zero on the JS side: the solver runs inside `step()` and the results
arrive through the existing `readVisibleTransforms` bulk read. **No per-joint frame call may be
added.** That rule is why `readVisibleTransforms` takes a `Float32Array` instead of returning
objects, and a joint API that reads a constraint's state every frame would reintroduce exactly
the cost the ABI was shaped to avoid.

The public class is one file, `Joint3D.ts`, holding all three kinds — a joint is a joint, and
three near-identical files would be the fork the repository's own rule warns about:

```ts
export class Joint3D {
  static pin(options: IPinJoint3DOptions): Joint3D;
  static hinge(options: IHingeJoint3DOptions): Joint3D;
  static fixed(options: IFixedJoint3DOptions): Joint3D;
  dispose(): void;
}
```

`CollisionShape3D` is the precedent for the static-factory shape and it is followed rather than
re-invented.

**A backend that cannot honour an option throws at construction.** If the native backend has no
hinge limits when this lands, `Joint3D.hinge({ limit })` throws there rather than silently
ignoring the limit — that is the standing rule, and a joint that quietly drops its limits is a
gameplay bug on one platform only.

### 3.1 Shape constraints

Read the batch README's shape rules first. The specific risks here:

- **SRP.** `Joint3D` constrains two bodies. It does not own the bodies, does not create them, does
  not know about skeletons — [PRD-144](./PRD-144-ragdoll.md) would have composed joints, it is
  not a mode of
  this class.
- **DRY.** One `Joint3D.ts`, one ABI call pair, one validation path. The NaN rejection at the seam
  (`simulation.ts:186-189`) already exists and joint anchors go through it rather than growing a
  second guard.
- **KISS.** Three factories, one `dispose`. No joint motors, no breakable joints, no spring
  parameters in v1 — each is a real feature with a real owner, and none has a game asking.
- **Vocabulary.** Godot names for the classes, Rapier names never leak into the public surface.
  `RigidBody3D` already establishes that the backend is invisible.

## 4. Acceptance

| # | Command | Required result |
| --- | --- | --- |
| 1 | `pnpm vitest run packages/physics/__tests__/joint.spec.ts` | pass — a pin joint holds two bodies at a fixed separation across 120 steps; a hinge constrains rotation to one axis; a fixed joint keeps relative transform constant |
| 2 | same spec, lifetime rows | `dispose()` removes the constraint and the bodies separate; disposing twice is safe; disposing a body first does not crash the next `step` |
| 3 | same spec, seam row | a NaN anchor **throws** rather than reaching the backend |
| 4 | `pnpm typecheck && pnpm lint && pnpm test` | exit `0` |
| 5 | a playtest scenario: a hinged door swings when pushed and stops at its limit | pass on web |
| 6 | **the same scenario with `--target desktop`** | pass |
| 7 | `pnpm budgets` | native runtime LOC trigger reported, and if crossed, justified in this PRD |

**Row 6 is not optional and this PRD is `BLOCKED` without it.** A physics capability admitted
because the game cannot write it portably, then shipped web-only, is the silent one-platform fork
with the rules' blessing — and it is the exact regression the framework-owns-it rule is most likely
to cause.

## 5. What this does not claim

Not that joints are stable at any mass ratio — Rapier's solver has known limits with heavy bodies
pinned to light ones, and no tuning guidance ships here. Not that they are performant at scale;
nobody has measured 200 joints on a Pixel 8. Not that the native backend's solver matches Rapier's
numerically: the two are different implementations and a scenario asserting an exact position on
both will be flaky. Assert behaviour — "the door opened", "the bodies stayed together" — not
coordinates.

## 6. Completion record

The public `Joint3D` surface, web backend, native Rust backend and C++ bulk ABI are implemented;
the class is shared across targets and no game-facing node fork was added. The seven focused joint
tests pass, including lifetime, disposal, fixed-frame, hinge-axis and malformed-input rows.

The web hinged-door scenario passed at the hinge limit. The same packaged scenario passed through
the desktop target after 120 fixed ticks with final angle `0.1594762887` radians, off-axis rotation
`0`, zero diagnostics and `pass: true`. The integrated command was:

`sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js examples/native-smoke/.tmp-prd143-hinged-door.playtest.json --project . --target desktop --executable /tmp/tn-prd143-desktop.moGy0d/joint-game --artifacts /tmp/tn-prd143-desktop.moGy0d/artifacts-r7`

Repository proof is recorded in
[`docs/verification/prd-143-physics-joints-2026-08-18.md`](../../verification/prd-143-physics-joints-2026-08-18.md).
