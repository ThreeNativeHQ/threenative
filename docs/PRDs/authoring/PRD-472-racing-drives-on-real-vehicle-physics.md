# PRD-472 — racing drives on real vehicle physics

**Status: NOT STARTED** · filed 2026-09-28 · owner: "racing template is completely fucked, you need to fix
it, add proper physics".

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

- [ ] `VehicleBody3D` in `@threenative/physics` over a dynamic chassis and Rapier's raycast vehicle controller; per-frame `engineForce`/`brake`/`steering`, reads `speed` and per-wheel contact; capability manifest entry. proof: `pnpm exec vitest run packages/physics`
- [ ] A spec drives a car down a ramp and into a wall: it rolls on suspension, stops at the wall, and brakes to rest. proof: vehicle spec

### Phase 2 — the same body on native

- [ ] Rust `DynamicRayCastVehicleController` behind new `tn_physics_*` entry points, `INativeSimulation` members, parity rows in `native-contract.spec.ts`, one conformance case. proof: `pnpm exec vitest run packages/physics/__tests__/native-contract.spec.ts` + conformance
- [ ] The racing `survives` scenario passes on desktop. proof: `--target desktop` playtest

### Phase 3 — the racing template drives

- [ ] The player car and the rival are `VehicleBody3D`s; kerbs, tyre walls and hoardings collide; the rival spawns on its own grid slot; the camera leads with velocity. proof: capture + `TN_TEMPLATE_ONLY=racing pnpm test:templates`
- [ ] Every racing scenario re-measured on real physics; changed assertions carry the new measured truth. proof: same gate

## Blocked on

- Nothing yet.
