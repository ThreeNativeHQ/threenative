# PRD-366 phase 1 evidence — the installed starter proves browser gameplay after a normal edit

Date: 2026-09-12/13
PRD: [PRD-366](../PRDs/production-readiness/PRD-366-one-consumer-game-proves-supported-platforms.md)
Branch: `prd366/browser-consumer-phase1` (base `origin/develop` @ `051b5de03`)
Layer: engine (`packages/create-threenative/` template + `scripts/` consumer gate).

## What this phase added

1. `packages/create-threenative/templates/starter/playtests/production-readiness.playtest.json` —
   a composite real-game scenario: it loads Play, moves the player forward (`ArrowUp`, min -Z delta
   0.5), collects a pickup (`ArrowRight`, `score` 1), then restarts through the React UI (`Tab`,
   `Tab`, `Enter`, `score` back to 0, `entityCount` 3 -> 4), with diagnostics, movement, resource
   `atSteps` and a visibility row. Every assertion family is non-empty.
2. `scripts/verify-registry-install.ts` — three helpers and two clean-room steps:
   - `applyGameOnlyEdit` appends `TN_REGISTRY_GAME_ONLY_EDIT` to the scaffolded game's portable
     entry, then the `edit` step records it before the build.
   - `assertGameplayScenario` requires the scenario to exist and to declare at least one non-empty
     assertion family.
   - `assertEditedGameplayInBuild` requires the marker to appear in the built `dist/`, so an edit
     that never reached the artifact is a failure.
   - The `gameplay` step runs the scenario through the project's installed `threenative-playtest`;
     a non-zero (false-assertion) run fails the step.
3. `scripts/__tests__/verify-registry-install.spec.ts` — four rejection cases plus the updated
   step-order expectations.
4. `packages/create-threenative/__tests__/scaffold.spec.ts` — new scenario in `STARTER_PATHS` and
   the recomputed starter scaffold hash.

## Required test (green)

```sh
node_modules/.bin/vitest run scripts/__tests__/verify-registry-install.spec.ts \
  packages/create-threenative/__tests__/scaffold.spec.ts
# Test Files  2 passed (2)
# Tests      85 passed (85)   (24 registry + 61 scaffold)
```

The registry spec's new cases prove the step fails closed on each of: a scenario with no
assertions (`TN_REGISTRY_INSTALL_GAMEPLAY_NO_ASSERTIONS`), a removed scenario
(`…_SCENARIO_MISSING`), false gameplay assertions (the playtest command throws), and a game-only
edit absent from the build (`…_EDIT_NOT_BUILT`). Those are the observed-red controls for this
phase; before the step existed none of these could fail.

## Browser proof — BLOCKED in this environment

A fresh starter was scaffolded from this worktree's own packages (`packageLocalFramework` +
`createProject`, installed into `/tmp/opencode/prd366-fresh/starter`) and the new scenario was
driven against it. It reaches the game page but the engine fails during startup under WebGPU:

```
TN_PLAYTEST_RUNNER_FAILED
RangeError: Failed to execute 'createBuffer' on 'GPUDevice': createBuffer failed,
  size (360) is too large for the implementation when mappedAtCreation == true
  at WebGPUAttributeUtils.createAttribute … WebGPURenderer.compute … SoftBody3D.process
```

This reproduces with the runner's private Xvfb and, with `TN_PLAYTEST_HOST_DISPLAY=1`, on the
session's real NVIDIA adapter (`captureDisplay {display: ":0", strategy: "existing"}`), and with the
default recipe (`TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING`). It is a real WebGPU/`SoftBody3D` startup
failure in this Chromium/Dawn/NVIDIA environment, not a defect in the scenario or the harness
change, and it is **not** claimed as a pass. The browser lane therefore remains unverified here.
The scenario is classified non-visual (`scripts/non-visual-scenarios.mjs`), so the golden-path
lane runs it on a GPU-less runner; that hosted result is not observed in this worktree either.

The scenario ships *with* the template, so it is only ever executed against a scaffold generated
from the same template version — the `entityCount`/`score` field names are that version's.

## Not claimed

- The on-device/browser gameplay result (blocked above).
- A public-registry cohort install: that is PRD-196 (PARTIAL), and the phase's registry acceptance
  waits on it. The mechanics here are proved against a local-tarball scaffold.
- Phase 2/3 (distributed desktop + Android, physical device) — later phases of PRD-366.

## Files changed

- NEW `packages/create-threenative/templates/starter/playtests/production-readiness.playtest.json`
- EDIT `scripts/verify-registry-install.ts`
- EDIT `scripts/__tests__/verify-registry-install.spec.ts`
- EDIT `packages/create-threenative/__tests__/scaffold.spec.ts`
