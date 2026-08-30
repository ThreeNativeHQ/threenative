# PRD-257 — Character ground-contact observations

## Scope completed in this checkpoint

`examples/native-smoke/src/physics.ts:285-313` is the Phase 0 consumer. Its portable parity game
needs `groundBody` to identify the moving platform and `groundNormal` plus `slopeAngle` to report
flat-versus-sloped contact without reaching through a backend. The framework owns the observation
because the web and native Rapier seams already produce the contact during character movement.

The public `CharacterBody3D` object now exposes one stable `groundNormal` vector, `groundBody`, and
`slopeAngle`. Web reads the completed controller collision. Native expands the existing bulk row
from three to six floats; it adds no per-character call.

## Initial red

Command:

```sh
pnpm vitest run packages/physics/__tests__/character.spec.ts packages/physics/__tests__/native-contract.spec.ts
```

Result: exit 1, 5 failed / 30 passed. Representative failures:

```text
expected undefined to be { id: 0, ... }                    # flat-floor groundBody
expected undefined to be { id: 0, ... }                    # moving-platform groundBody
Cannot read properties of undefined (reading 'toArray')    # groundNormal reset
expected { grounded: true, groundCollider: 1 } to deeply equal
  { groundBody: ..., groundNormal: ..., grounded: true }   # native bulk row
```

## Removal-sensitive controls

Each mutation was applied alone, observed red, and reverted before the green run.

| Claim | Mutation | Command | Observed red |
| --- | --- | --- | --- |
| web contact normal is measured | force `state.groundNormal.y = 1` | `pnpm vitest run packages/physics/__tests__/character.spec.ts -t 'expose the normal and angle of a walkable slope'` | exit 1: `expected 1 to be less than 0.99` |
| old native ABI fails closed | set `NATIVE_CHARACTER_STATE_STRIDE = 3` | `pnpm vitest run packages/physics/__tests__/native-contract.spec.ts -t 'rejects the old three-float native character-state row'` | exit 1: `expected [Function] to throw an error` |
| native body id maps to the portable handle | drop the `bodyHandles.get(groundCollider)` mapping | `pnpm vitest run packages/physics/__tests__/native-contract.spec.ts -t 'reads ground body and normal through the existing bulk character-state call'` | exit 1: received `groundBody: undefined` |

## Green evidence

```text
pnpm vitest run packages/physics/__tests__
Test Files 20 passed (20)
Tests 162 passed (162)

pnpm --filter @threenative/runtime-native native:physics:parity
web 28 passed; Rust 13 unit + 2 parity passed
groundedMismatch: 0
groundColliderMismatch: 0
groundNormalMaxAxisDelta: 0.0

pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/physics-parity-verifier.test.mjs
Test Files 1 passed (1)
Tests 11 passed (11)

pnpm --filter @threenative/playtest build
pnpm --filter @threenative/core build
pnpm --filter @threenative/physics build
pnpm --filter threenative-native-smoke typecheck
All exited 0; publint reported `All good!` for the three packages.
```

## Clean-install sandbox proof

The `feature-mining-sandbox-validation` loop generated an external minimal-template game at:

```text
/home/joao/projects/threenative/sandboxes/feature-mining-high-20260829/prd257-ground-contact
```

It installed content-hashed local tarballs, exposed zero framework source lines, and resolved
`CharacterBody3D` plus the three observations from the installed capability manifest and declarations.
The game makes the observations decide a real rule: walking from a flat floor onto an amber 30° ramp
increments monotonic body/normal observation counters and changes `outcome` from `playing` to `won`
after five matched slope contacts. Missing the ramp before any observation produces `caught`.

Final shared scenario results:

```text
web / Chromium WebGPU / NVIDIA RTX 2080: exit 0
  movement: 6.499 m
  outcome: playing -> won
  groundBodyMatches: 0 -> 5
  slopeObservations: 0 -> 5
  diagnostics: 0

linux-x64 packed desktop / V8 13.1 / native WebGPU / NVIDIA RTX 2080: exit 0
  movement: 6.498 m
  outcome: playing -> won
  groundBodyMatches: 0 -> 5
  slopeObservations: 0 -> 5
  diagnostics: 0
```

The desktop artifact was produced by `pnpm build:desktop` from the sandbox's installed packages and a
SHA-256-verified `linux-x64` host compiled from this worktree. The desktop runner used the machine's
working X display (`DISPLAY=:97`); invoking it without a display exited before SDL initialized and was
not counted as feature evidence.

The web capture at `artifacts/playtest/after.png` was inspected at 1280×720 before the cross-target
scenario disabled automatic screenshots. It visibly showed the player standing on the amber ramp;
the frame was neither blank nor washed out (`nonblankPixelRatio: 1`, `darkPixelRatio: 0.052`).

Sandbox mutation control: forcing `slopeMeasured = false` left movement at 6.500 m but exited 1;
`outcome` stayed `playing`, `groundBodyMatches` stayed 0, and `slopeObservations` stayed 0. Restoring
the public `groundBody`/`groundNormal`/`slopeAngle` predicate returned exit 0.

## Platform status

- Web Rapier `0.19.3`: PASS in the shared parity arm.
- Native Rust Rapier `0.30.0`: PASS in the shipping Rust simulation parity arm.
- Clean external tarball sandbox, web WebGPU: PASS.
- Packed Linux x64 desktop host, native V8/WebGPU: PASS.
- Android emulator/device and iOS simulator/device: UNVERIFIED.
