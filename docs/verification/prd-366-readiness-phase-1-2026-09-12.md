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

## Browser proof (green)

A fresh starter was scaffolded from this worktree's own packages (`packageLocalFramework` +
`createProject`, installed into `/tmp/opencode/prd366-fresh/starter`) and the new scenario was
driven against the real production build with the engine's own playtest CLI:

```sh
TN_PLAYTEST_HOST_DISPLAY=1 node <engine>/packages/playtest/dist/runner/cli.js \
  --scenario playtests/production-readiness.playtest.json \
  --browser-recipe webgpu --headed --no-screenshots --allow-software \
  --server-command "pnpm dev --host 127.0.0.1 --port $PORT --strictPort"
# exit 0; pass true; frames 943; distance 5.488
# adapter: vendor nvidia, architecture turing, rendererKind webgpu
# startup rule: sustained-frames
```

Sibling calibration on the same scaffold: `forward.playtest.json` pass (300 frames) and
`restart.playtest.json` pass (703 frames). The `movement` assertion measures the subject's end
displacement, so the restart — which resets the player — is followed by a fresh `ArrowUp`. An
earlier ordering that asserted movement across the restart read a net 0.002 units and correctly
failed; the assertion was recalibrated, not weakened.

The game-only edit marker was separately proven to survive a real `pnpm build`: the appended
`(globalThis …).__tnRegistryGameOnlyEdit` statement appears in `dist/assets/index-*.js`. A comment
marker would be stripped by Vite, which is why it is a side-effecting assignment.

The first attempts reproduced `TN_PLAYTEST_RUNNER_FAILED createBuffer size 360 … mappedAtCreation`
in `SoftBody3D.process`. That was the launch missing `--headed` (a headless/private-Xvfb run);
adding `--headed`, as golden-path and the template's own test script already do, runs on the real
adapter and passes.

## Not claimed

- A public-registry cohort install: that is PRD-196 (PARTIAL), and the phase's registry acceptance
  waits on it. The proof here is a local-tarball scaffold driven by the engine's own CLI.
- Phase 2/3 (distributed desktop + Android, physical device) — later phases of PRD-366.

## Files changed

- NEW `packages/create-threenative/templates/starter/playtests/production-readiness.playtest.json`
- EDIT `scripts/verify-registry-install.ts`
- EDIT `scripts/__tests__/verify-registry-install.spec.ts`
- EDIT `packages/create-threenative/__tests__/scaffold.spec.ts`
