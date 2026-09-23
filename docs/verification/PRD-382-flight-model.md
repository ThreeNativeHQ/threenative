# PRD-382 verification — the FlightModel extraction and the Midway port

Status: verified 2026-09-13. This record maps the objective to the artifacts and the commands that
were run; the PRD is [`../PRDs/done/PRD-382-flight-model-is-mechanism.md`](../PRDs/done/PRD-382-flight-model-is-mechanism.md).

## Objective

Refactor `Midway-Open-Pacific-v3.html` to `../sandbox` as a ThreeNative game, extract airplane
abstractions into the engine, and reuse them in that game.

## 1 — The engine abstraction

- `packages/core/src/flight.ts` exports `FlightModel` and its helpers (`airDensity`,
  `aircraftMass`, `aerodynamicCoefficients`, `setAttitude`, `attitudeAxes`, `gearClearance`,
  `initFlight`, `flightForces`, `updateActuators`, `stepFlight`, `stepDeck`).
- `packages/core/src/index.ts` re-exports it.
- `packages/core/__tests__/flight.spec.ts` — 5 tests.

Commands:

```text
$ pnpm exec vitest run packages/core/__tests__/flight.spec.ts
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ pnpm --filter @threenative/core exec tsc --noEmit -p tsconfig.json
exit 0

$ pnpm ci:fast
lint pass / docs pass / agents pass / drift pass
```

Admission: `docs/architecture/CHARTER.md` ("Mechanism is not appearance") and
`packages/core/AGENTS.md`. Capability manifest and reference regenerated
(`pnpm capabilities:check` — "capability manifest fresh").

## 2 — The sandbox game

`../sandbox/midway-open-pacific` is a ThreeNative project:

- `src/game.ts` calls `defineGame({ scenes: { midway: Midway }, start: "midway", step: 1 / 60 })`.
- `src/scenes/Midway.ts` extends `Scene` and drives the battle on the fixed step.
- `src/sim/` holds the ported, renderer-free simulation; `src/render/` holds the ported GLSL
  world; `src/hud.ts` and the extracted `index.html`/`src/style.css` hold the HUD.

The reuse is `src/sim/flight.ts`, which imports the engine model:

```ts
import { FlightModel, airDensity, aircraftMass, attitudeAxes, gearClearance, setAttitude } from "@threenative/core";
…
this.#model = new FlightModel({ airframe: airframeFor(airframeId), state, wind: this.wind });
```

Command and result (from `../sandbox/midway-open-pacific`, WebGPU recipe):

```text
$ node node_modules/@threenative/playtest/dist/runner/cli.js \
    --scenario playtests/launch.playtest.json --url http://127.0.0.1:5199 \
    --browser-recipe webgpu --headed
"rendererKind": "webgpu",
"adapter": { "architecture": "turing", "vendor": "nvidia" },
"pass": true,
"runtime": "web"
```

`playtests/flight.playtest.json` also passes on WebGPU and writes `takeoff.png` and `flight.png`.

Artifacts: `../sandbox/midway-open-pacific/artifacts/playtest/` (capture.json, console.json),
`../sandbox/midway-open-pacific/screenshot-takeoff.png`,
`../sandbox/midway-open-pacific/screenshot-flight.png`.

Pushed to `ThreeNativeHQ/examples` as commit `c59aafc` ("feat(sandbox): run Midway on WebGPU with
TSL ocean, sky and particles"), on top of `ffdb5d6`.

## Rendering

The ocean, sky and combat particles are TSL node materials, so the game runs on the default
WebGPU backend: the sea is the engine's `SpectralOcean` under a `MeshStandardNodeMaterial`
(`src/render/ocean.ts`), the sky and particles are node materials in `world.ts`/`particles.ts`, and
the linear sky/sea constants are copied from the standalone build. Shadow maps are off because
three r185's WebGPU shadow pass raised a `bindingBuffer ... used in submit while destroyed`
validation error for this scene.

## Not claimed

Desktop, Android and iOS builds of the sandbox game are not claimed; no `--target` playtest has
run for it.
