# PRD-382 — FlightModel is mechanism, not a game's private physics

Status: DONE, 2026-09-13. Owner instruction: port `Midway-Open-Pacific-v3.html` to
`sandbox/midway-open-pacific` and lift the airplane abstractions into the engine. Evidence in this
PRD and in `sandbox/midway-open-pacific` (commit `ffdb5d6`).

## The problem

`threenative-engine/Midway-Open-Pacific-v3.html` is a complete, standalone WebGL flight game whose
`modules['flight']` block is a 140-line force-integrated aerodynamic model: quaternion attitude,
lift/drag/stall coefficients, control moments, a carrier-deck run. Every airplane game an agent
writes will need that same mechanism, and the standalone build is the third copy in the
repository after the HTML and its own inline experiments. It is mechanism by
`CHARTER.md`'s definition — it decides motion, not look — and the game supplies every parameter
that decides what the aircraft is or looks like.

## What ships

| Where | What |
| --- | --- |
| `packages/core/src/flight.ts` | `FlightModel` and its pure helpers: `airDensity`, `aircraftMass`, `aerodynamicCoefficients`, `setAttitude`, `attitudeAxes`, `gearClearance`, `initFlight`, `flightForces`, `updateActuators`, `stepFlight`, `stepDeck`. |
| `packages/core/src/index.ts` | The public exports and the capability doc comment. |
| `packages/core/__tests__/flight.spec.ts` | Five unit tests: trim, lift vs airspeed, stall, power-zero thrust, deck liftoff. |
| `docs/architecture/CHARTER.md` | `FlightModel` named in "Mechanism is not appearance". |
| `sandbox/midway-open-pacific` | The game, refactored onto `FlightModel`; its airframes live in `src/sim/flight.ts`. |

The two questions: **(1)** a game *can* write a flight model portably, so the abstraction is
admitted by the repetition rule and the convention, not by unportability; **(2)** it decides no
appearance — geometry, material, colour and every airframe constant come from the game. The kill
switch is satisfied by deletion: the standalone build's `flight` module and the game's duplicate
constants are gone, replaced by one tested implementation.

## Phases

### Phase 1 — Extract the model

- [x] `packages/core/src/flight.ts` added: `FlightModel` over a game-owned state object, every
      airframe value and damage multiplier supplied by the caller.
- [x] Exported from `packages/core/src/index.ts` with a capability doc comment.
- [x] `pnpm --filter @threenative/core typecheck` green; `pnpm --filter @threenative/core build`
      green (publint passes).

### Phase 2 — Prove it

- [x] `packages/core/__tests__/flight.spec.ts` added; `vitest run packages/core/__tests__/flight.spec.ts`
      passes 5/5.
- [x] The tests caught a real inversion in the aerodynamic damping terms; the reference formula
      was restored and the test then passed.

### Phase 3 — Reuse it

- [x] `sandbox/midway-open-pacific` scaffolded from the `sailing` template, WebGL2 backend
      selected so the ported GLSL shaders compile.
- [x] The game's `src/sim/flight.ts` imports `FlightModel` from `@threenative/core` and supplies
      only the SBD/TBD airframes.
- [x] `pnpm typecheck` and `vite build` green.
- [x] `playtests/launch.playtest.json` passes: `{"pass": true}`, diagnostics clean.
- [x] Committed and pushed to `ThreeNativeHQ/examples` (`ffdb5d6`), with two screenshots.

## Acceptance criteria

- [x] `FlightModel` is exported from `@threenative/core` and discoverable in the capability
      manifest.
- [x] A unit test fails if lift, stall, thrust-kill or deck liftoff break.
- [x] The sandbox game runs the standalone build's mission with the engine model and no console
      errors.
- [x] Native (desktop/Android/iOS) build of the sandbox game is **out of scope and not
      claimed**: the game selects the WebGL2 backend for its GLSL shaders and the port is
      explicitly a web lane, stated in its `AGENTS.md`.
