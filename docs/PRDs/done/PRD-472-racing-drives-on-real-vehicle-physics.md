# PRD-472 — racing drives on real vehicle physics

**Status: done 2026-09-30 — every phase and box landed; the browser suite and the native gates are
green** · filed 2026-09-28 · owner:
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

- [x] Rust `DynamicRayCastVehicleController` behind new `tn_physics_*` entry points, `INativeSimulation` members, parity rows in `native-contract.spec.ts`, one conformance case. proof: `cargo test` in `packages/runtime-native/native/physics` → 34 tests green; `pnpm exec vitest run packages/physics` → 26 files, 195 tests green; `run-conformance.mjs --target web|desktop --only-tests vehicle-raycast-suspension` → pass on both, `pixelMismatchRatio 0`, `perceptualDeltaE 0`, 0 GPU validation errors. The desktop host reports the same numbers the web spec pins: four wheels in contact at a 0.27689 m strut of the 0.30 m rest, 4000 N per rear wheel reaching 26.58 m/s in 3 s, `brake = 60` to rest in 1.95 s, a respawn landing exactly on its requested `(10, 40)` and driving the other way at 17.72 m/s, chassis carried at y 0.7669 rather than resting on its own collider. The desktop run also caught a real defect: the `resetVehicle` binding read `yaw` as a property of a number, so every native respawn was refused (2026-09-28)
- [x] The racing `survives` scenario passes on desktop. proof: `pnpm test:native` in a scaffold of the racing template under `sh scripts/xvfb.sh` → exit 0, scenario `native-racing-instanced-batch` `runtime: native`, `pass: true`, `movement.distance` 5.33 m (min 0.5), 2026-09-28.

### Phase 3 — the racing template drives

- [x] The player car and the rival are `VehicleBody3D`s; the kerbs and tyre walls collide; the rival spawns on its own grid slot; the camera leads with the measured velocity. proof: `TN_TEMPLATE_ONLY=racing pnpm test:templates` → 9 of 9 scenarios and the boot gate green (exit 0), 2026-09-30: `boost-expires`, `finish-behind-rival-is-dnf` (3 laps, 10622 ticks), `production-performance`, `route-ranking`, `rescue-transform`, `reverse-finish-rejected`, `shortcut-rejected`, `survives`, `touch-controls`; capture `docs/verification/visuals/racing.png`; native `pnpm native:verify:desktop` exit 0. The hoardings were deleted — they read as slab walls and never collided — so they are no longer part of this claim.
- [x] Every racing scenario re-measured on real physics; changed assertions carry the new measured truth. proof: `TN_TEMPLATE_ONLY=racing pnpm test:templates` → all 9 scenarios `pass: true` (boost-expires, finish-behind-rival-is-dnf 3 laps in 10600 ticks, production-performance, route-ranking, rescue-transform, reverse-finish-rejected, shortcut-rejected, survives, touch-controls), 2026-09-28. An earlier run had route-ranking and rescue-transform close the browser at `frames: 0`; both pass alone and in the rerun (flake, unexplained).

## Decisions

- **2026-09-28, phase 2: a wheel ray excludes its own chassis on native.** Rapier `0.19.3` (web)
  does not report the chassis collider when a wheel ray starts inside it, and the car settles on a
  0.2769 m strut. Rapier `0.30` reports that same ray as a hit at zero distance, which reads as a
  fully compressed strut and launches the car off the ground. The native controller therefore
  excludes its own chassis rigid body from the ray filter as well as passing the chassis'
  collision groups; without it the two backends disagree by 0.28 m of strut.
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

- **2026-09-28, phase 3: a vehicle's wheel rays exclude sensors on both backends.** An `Area3D`
  gate or boost pad is a sensor, and a wheel ray that hits one reads as a fully compressed strut, so
  the lap gates threw the car into the air on the straight it was supposed to measure. `simulation.ts`
  and `native/physics/src/lib.rs` both pass `EXCLUDE_SENSORS` on the vehicle ray filter. Proven
  natively by `pnpm native:build` + `pnpm native:verify:desktop` (9/9, non-blank frame), and on web
  by a racing scene that now completes three laps with zero rescues under the recorder harness.
- **2026-09-28, phase 3: a lap gate counts once, whichever way it is crossed.** `Area3D`'s
  `bodyEntered` and the per-frame sweep between a car's transforms both see the same crossing, so
  the second one read as a shortcut. `Lap` arms a gate on the near side of its plane and disarms it
  on the crossing, so the sweep can only catch a crossing the sensor missed. The car's **measured**
  travel direction still decides: backwards is a `reverseReject`, out of order is a `shortcutReject`.
- **2026-09-28, phase 3: the rival projects, it does not extrapolate.** Advancing a target by the
  clock let the target run away from a car that was off the line, and a `cos(error)` throttle floor
  left the rival stationary against a barrier for the rest of the race. It now projects its own
  position onto the route, unwraps that distance for laps, aims a speed-scaled look-ahead ahead, and
  holds a 0.3 throttle floor. Measured: 6 laps in 70 s at 10.6–11.3 m/s, no rescues, on the line.

### Acceptance criteria

- [x] A1 — every racing scenario passes on the real vehicle physics, web and native. proof: `TN_TEMPLATE_ONLY=racing pnpm test:templates` → 9/9 scenarios and the boot gate green, exit 0, 2026-09-30; `pnpm native:verify:desktop` exit 0 (desktop core, physics, stability, contracts, loading and UI-frame gates all passed).
- [x] A2 — the player and the rival are the same `VehicleBody3D` chassis, and the circuit's barriers stop them. proof: `src/entities/CarBody.ts` (both cars) and `packages/physics/__tests__/vehicle-body.spec.ts` (a wall stops the car at z −28.25); the conformance case `vehicle-raycast-suspension` is green on web and desktop with `pixelMismatchRatio 0` (phase 2, unchanged since); `pnpm native:verify:desktop` exits 0, 2026-09-30.
- [x] A3 — a lap is won only by driving it: the closed-loop `LineDriver` completes laps with no rescues, and out-of-order or reversed crossings are rejected. proof: the `finish-behind-rival-is-dnf`, `route-ranking`, `reverse-finish-rejected` and `shortcut-rejected` scenarios in the suite above, 2026-09-30.
