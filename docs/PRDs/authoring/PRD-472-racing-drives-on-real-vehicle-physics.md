# PRD-472 — racing drives on real vehicle physics

**Status: PARTIAL — phase 1 landed 2026-09-28; phases 2 and 3 open** · filed 2026-09-28 · owner:
"racing template is completely fucked, you need to fix it, add proper physics".

## Why

Surveyed 2026-09-28 (`templates/racing`):

- The car is a kinematic fake: `RacingCar.ts` keeps `#speed` and `#heading` as numbers, rewrites
  `velocity.x/z = forward × speed` every frame and pins the chassis level. No suspension, no slip, no
  weight transfer, constant yaw rate at any speed, yaw on the spot when stopped.
- Kerbs, tyre walls and hoardings are decoration with **no colliders**; the car's mask sees only road and
  field, so it drives through every barrier and off the field until a rescue teleports it.
- The rival has no body (the player drives through it), a constant speed, and spawns overlapping the player.
- The engine has no vehicle node. `@dimforge/rapier3d-compat@0.19.3` exposes
  `DynamicRayCastVehicleController`; the native host's physics is a Rust crate (`rapier3d = 0.30`) behind a
  C ABI (`packages/runtime-native/native/physics`).

## Where it goes

A vehicle needs a physics backend on each platform the template claims, so it is framework
(`packages/physics`), web and native together (rule: web-only is unfinished). Godot vocabulary:
`VehicleBody3D` with `engineForce`, `brake`, `steering`; wheels described with `VehicleWheel3D`'s property
names (`wheelRadius`, `suspensionRestLength`, `suspensionStiffness`, `dampingCompression`,
`dampingRelaxation`, `wheelFrictionSlip`, `useAsSteering`, `useAsTraction`). The look and the handling
numbers stay in the template.

## Phases

### Phase 1 — `VehicleBody3D` on web

- [x] `VehicleBody3D` in `@threenative/physics` over a dynamic chassis and Rapier's raycast vehicle controller; per-frame `engineForce`/`brake`/`steering`, reads `speed` and per-wheel contact; capability manifest entry. proof: `pnpm exec vitest run packages/physics` → 26 files, 191 tests green (2026-09-28)
- [x] A spec drives a car down a ramp and into a wall: it rolls on suspension, stops at the wall, and brakes to rest. proof: `packages/physics/__tests__/vehicle-body.spec.ts` — settles with all four wheels in contact at a 0.2769 m strut of the 0.30 m rest length (0.023 m of sag on 900 kg), 4000 N per rear wheel reaches 26.58 m/s in 3 s and 0.5 rad of steering swings 1.36 rad of yaw, `brake = 60` stops it from 25.4 m/s in 1.87 s, a 10° ramp leaves the chassis pitched 0.176 (sin 10°) and a 0.5 m wall stops it at z −28.25 without passing through (2026-09-28)

### Phase 2 — the same body on native

- [ ] Rust `DynamicRayCastVehicleController` behind new `tn_physics_*` entry points, `INativeSimulation` members, parity rows in `native-contract.spec.ts`, one conformance case. proof: `pnpm exec vitest run packages/physics/__tests__/native-contract.spec.ts` + conformance
- [ ] The racing `survives` scenario passes on desktop. proof: `--target desktop` playtest

### Phase 3 — the racing template drives

- [ ] The player car and the rival are `VehicleBody3D`s; kerbs, tyre walls and hoardings collide; the rival spawns on its own grid slot; the camera leads with velocity. proof: capture + `TN_TEMPLATE_ONLY=racing pnpm test:templates`
- [ ] Every racing scenario re-measured on real physics; changed assertions carry the new measured truth. proof: same gate

## Decisions

- **2026-09-28, phase 1: no `centerOfMassOffset`.** Rapier 0.19.3 exposes no centre-of-mass-only
  setter. `setAdditionalMassProperties` adds mass *and* inertia, so a lowered COM would need an
  invented inertia model, and a zero-inertia point mass makes the chassis spin-happy. The option
  was dropped rather than shipped as a lie; a real offset can come with a computed box inertia in a
  later phase if a template needs it.
- **2026-09-28, phase 1: a vehicle's lifetime is its chassis's.** `VehicleBody3D` extends
  `RigidBody3D`, so `removeBody` releases the wheel controller and there is no `removeVehicle` on
  the seam. Fewer entry points for phase 2 to implement, and no way to orphan a controller.
- **2026-09-28, phase 1: `suspensionStiffness` and `speed` are not what their names suggest.**
  Rapier's stiffness is mass-normalised — a frequency squared, so the strut sags about
  `9.81 / (4 * stiffness)` metres and Godot's default of 20 bottoms the suspension out. Its
  `currentVehicleSpeed()` follows the positive forward axis, not the car's, and reports the
  suspension's residual vertical velocity on a parked car. The seam therefore computes the signed
  forward speed itself, and the number is documented where a game will read it.
- **2026-09-28, phase 1: native throws by name.** `createVehicle`, `setVehicleInput`,
  `readVehicleState` and `resetVehicle` are optional on `IPhysicsSimulation` and carry plain
  numbers only. The native adapter implements none yet, so `new VehicleBody3D()` throws
  `TN_VEHICLE_NATIVE_UNAVAILABLE` there rather than simulating a car that is not there.

## Blocked on

- Nothing yet.
