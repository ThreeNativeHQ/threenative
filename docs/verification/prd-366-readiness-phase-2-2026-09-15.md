# PRD-366 phase 2 evidence — the same distributed game plays on desktop and Android

Date: 2026-09-15
PRD: [PRD-366](../PRDs/production-readiness/PRD-366-one-consumer-game-proves-supported-platforms.md)
Branch: `prd-366/consumer-gameplay-native` (base `origin/develop` @ `26bf28a66`)
Layer: engine (`packages/runtime-native/` verifier + `scripts/` consumer gate + the native workflow).

## What this phase added

Phase 1 proved the installed starter plays in a browser after a game-only edit. Phase 2 asks the
same question of each claimed native target, through the same installed consumer scenario
(`packages/create-threenative/templates/starter/playtests/production-readiness.playtest.json`),
and records a per-target row that names the real machine and artifact rather than a hardcoded pass.

1. `packages/runtime-native/scripts/verify-starter-desktop.mjs` — new, clearly named exports
   `validateConsumerTargetRow`, `qualifyConsumerTargetRow`, `assertConsumerTargetRows`,
   `parseConsumerPlaytestReport`, `describeConsumerSession` and `verifyStarterConsumerGameplay`,
   plus a `--consumer --target <desktop|android> [--project <dir>]` CLI branch appended before the
   existing desktop-smoke guard. A row carries `target`, `os`, `osVersion`, `architecture`,
   `session`, `scenario`, `applicationId`, `artifactHash`, `pass`, `assertions`, `failures`.
   `TN_STARTER_CONSUMER_*` failures name the actual cause: a foreign scenario
   (`SCENARIO_MISMATCH`), a stale/substituted artifact (`ARTIFACT_MISMATCH`), a different game
   (`APPLICATION_ID_MISMATCH`), a run that evaluated nothing (`NO_ASSERTIONS`), a false assertion
   (`ASSERTION_FAILED`), a missing target row (`ROW_MISSING`) and an unreadable row
   (`ROW_MALFORMED`).
2. `packages/runtime-native/tests/starter-desktop.test.mjs` — appended
   `describe('PRD-366 phase 2 — distributed consumer gameplay qualification')` with the two
   required rows and the PRD's negative controls.
3. `scripts/verify-registry-install.ts` — `readConsumerTargetRows` and an additive
   `consumerTargets` field on `IRegistryInstallReport`; the `native` step records each
   per-target row it finds. No step name or step order changed, so the existing clean-room
   contract is untouched.
4. `.github/workflows/native-platforms.yml` — the `starter-linux` job and the `desktop` macOS /
   Windows matrix job run the consumer qualifier against the scaffolded starter they already
   build; the run writes `artifacts/native/consumer-targets.json`, which the existing evidence
   uploads already collect. This workflow is a reusable workflow called by `ci.yml` and is **not
   a required check / not part of the merge verdict**, so it cannot gate the claim.

## Required test (green)

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs
# Test Files  1 passed (1)
# Tests      31 passed (31)
```

The two rows the PRD names are present verbatim:

- `should reject target qualification when the artifact hash / application ID differs from the built consumer`
- `should reject a missing required gameplay row`

## Observed red, then green

Red (before the functions existed — written first):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs
# Test Files  1 failed (1)
# Tests      10 failed | 19 passed (29)
# TypeError: qualifyConsumerTargetRow is not a function
# TypeError: assertConsumerTargetRows is not a function
# TypeError: parseConsumerPlaytestReport is not a function
# TypeError: verifyStarterConsumerGameplay is not a function
```

Green (after implementing): 31/31 passed.

The PRD's negative controls are modelled at the row-contract level (the fixture lane needs no
display, device or native build); each fails for its own named cause rather than a generic one:

| Control | Row state | Named failure |
| --- | --- | --- |
| Substituted native-smoke artifact | `scenario = playtests/native-smoke.playtest.json` | `TN_STARTER_CONSUMER_SCENARIO_MISMATCH` |
| Stale starter build | `artifactHash` differs from the built consumer | `TN_STARTER_CONSUMER_ARTIFACT_MISMATCH` |
| Deleted asset/UI folder | the derived observable: reached the app, `assertions = 0` | `TN_STARTER_CONSUMER_NO_ASSERTIONS` |
| Injected false state assertion | `pass = false`, failing `state.score` row | `TN_STARTER_CONSUMER_ASSERTION_FAILED` |
| Missing required target row | no `android` row | `TN_STARTER_CONSUMER_ROW_MISSING` |
| Scenario the target cannot evaluate | `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` diagnostic | `TN_STARTER_CONSUMER_SCENARIO_NOT_CROSS_TARGET` |

`verifyStarterConsumerGameplay` accepts an independent `expected` identity from the caller; without
one the run qualifies against the artifact it just hashed, so a caller that knows the built
consumer's identity is what turns a stale/substituted row into `ARTIFACT_MISMATCH` instead of a
pass. The `--qualify-existing` CLI mode re-qualifies the persisted row against the consumer as it
is built now, which is the production caller that catches a row recorded against a previous build.

## Registry clean-room gate (green, unchanged contract)

```sh
pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts
# Test Files  1 passed (1)
# Tests      25 passed (25)
```

`readConsumerTargetRows` returns `[]` when the target lane has not run and throws
`TN_REGISTRY_INSTALL_CONSUMER_ROW_MALFORMED` on a present-but-unreadable file, so absence and
corruption never read the same. The additive `consumerTargets` report field changes no step name,
step order or existing assertion.

## CLI contract (green)

```sh
node packages/runtime-native/scripts/verify-starter-desktop.mjs --consumer --target desktop --project /tmp/empty
# TN_STARTER_CONSUMER_APPLICATION_ID_MISSING: /tmp/empty/threenative.config.ts is absent, so the built consumer's application id cannot be read.
# exit 1
```

The `--consumer` branch exits before the existing desktop-smoke guard, so the smoke lane is
unchanged for a normal invocation.

## Typecheck / lint / test

```sh
pnpm typecheck
# pass once the workspace packages are built (`pnpm build`); a fresh worktree with no dist fails
# on unrelated unbuilt package exports (`@threenative/playtest/protocol`, `@threenative/assets`).

pnpm lint
# exit 0; 723 warnings, 0 errors. Biome format diffs are errors and none were produced.

pnpm test
# exit 1 — NOT my change. The runtime-native package test aborts on 18 failures that require
# unbuilt native C++ test binaries (`build/tn-linux/threenative-*-test is not built`:
# crash-handler-policy, timestamp-query, …), which masks the root unit phase.
# Run the root unit phase directly instead:
pnpm exec vitest run
# Test Files  1 failed | 439 passed | 1 skipped (441)
# Tests      1 failed | 5256 passed | 5 skipped (5262)
# The single failure is packages/playtest/__tests__/e2e-runner.spec.ts
# "transport-only browser errors reach runtime diagnostics without a bridge", an unrelated
# browser e2e test; the new fixtures and the registry spec (both inside the 5256) pass.
```

The focused lanes stay green on their own commands, which is the smallest falsifying run for this
change:

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs
# 31 passed
pnpm exec vitest run scripts/__tests__/verify-registry-install.spec.ts
# 25 passed
```

## Discovered blocker — the shared scenario is browser-only (C1)

An independent review of this diff found that the phase-1 consumer scenario cannot run on a native
target as authored. `playtests/production-readiness.playtest.json` sets
`diagnostics.noNetworkErrors: true`; the device/desktop runner refuses exactly that with
`TN_PLAYTEST_UNSUPPORTED_ON_TARGET` ("device transport has no CDP network observer",
`packages/playtest/src/runner/androidRunner.ts:746`), and desktop routes through the same
`runDevicePlaytestInternal` (`desktopRunner.ts:5,108`). So the two workflow steps at
`native-platforms.yml` cannot yield a qualifying row until the scenario becomes cross-target.

The harness's documented fix is the scenario-owned waiver
`"diagnostics": { "noNetworkErrors": false, "networkErrorsOptOutReason": "..." }`, or omitting the
key entirely (a network-blind target then defaults it off with the reason recorded;
`assertion-report.ts:141,148`). Both are changes to the shipped starter scenario, which is outside
this phase's five-file budget and would also move the frozen scaffold hash in
`packages/create-threenative/__tests__/scaffold.spec.ts`. The qualifier now names this case
`TN_STARTER_CONSUMER_SCENARIO_NOT_CROSS_TARGET` rather than reporting it as zero assertions or a
gameplay failure. No workaround was applied silently; the scenario fix is the next change this
phase needs.

## Repair — the restart step and soundless-host noise (2026-09-15)

The wired desktop rows still failed in CI (run `35032010996`,
`artifacts/native/consumer-targets.json` on the `starter-linux` job) with two independent causes,
both visible in the uploaded report:

1. **The restart never happened on native.** The scenario restarted through the WebView menu
   (`Tab`, `Tab`, `Enter`); native injects synthetic keyboard events into the JS
   document/window/canvas, but the WebView overlay exposes pointer injection only, and on the Linux
   lane the overlay refuses to attach (`TN_UI_OVERLAY:{"attached":false,...}`). The report confirms
   no reset: at `restarted` the samples read `score = 1` and `entityCount = 3`, not `0` and `4`.
   The scenario now presses the game's own portable `restart: { keys: ["KeyR"] }` binding
   (`templates/starter/src/game.ts:24`, consumed at `src/scenes/Play.ts:281`) and samples
   `restarted` after a 120-tick wait, so the assertion reads after `Play.enter` has restored
   `entityCount` to 4. `restart.playtest.json`/`pause.playtest.json` keep the web-only UI-focus
   restart proof unchanged.
2. **Ten platform-library lines were counted as console errors.** The report's console held 1
   `dbind-WARNING … AT-SPI`, 8 `ALSA lib …` and 1 `[Audio] Failed to open audio device: ALSA: …`
   entry, all typed `error`. `desktopConsoleType` (`packages/playtest/src/runner/desktop.ts:180`)
   now classifies the ALSA/`[Audio] … ALSA` library chatter and the `dbind-WARNING` AT-SPI line as
   non-error, mirroring Android's `isPlatformWebViewNoise`: every line is kept, only its severity
   is decided. `noConsoleErrors`/`runtimeDiagnostics`/`runtimeReady` are unchanged.

Verification actually executed here:

```sh
pnpm exec vitest run packages/playtest/__tests__/desktop-playtest.spec.ts
# red before the classifier change: 3 failed | 25 passed (the three new ALSA/dbind rows)
# green: 28 passed (28)

pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/starter-desktop.test.mjs tests/starter-consumer-qualification.test.mjs
# Test Files 2 passed (2); Tests 73 passed (73)

pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts
# Test Files 1 passed (1); Tests 61 passed (61)
# starter hash recomputed for the moved scenario bytes:
#   aa783e68daddcb7b54a830056511db80e19ff6faa69d7c641d0b5b947d8b72c2

pnpm --filter @threenative/playtest run typecheck   # pass
pnpm --filter create-threenative run typecheck      # pass
pnpm exec biome check packages/playtest/src/runner/desktop.ts \
  packages/playtest/__tests__/desktop-playtest.spec.ts
# 3 pre-existing warnings, 0 errors (none from the changed lines)
```

The moved scenario parses through the real validator (`validatePlaytestScenario`), whose steps are
`play-scene-loads,collected,restart,restarted,moved-after-restart`. **No desktop consumer row was
produced locally:** `packages/runtime-native/build/tn-linux/mystral` does not exist in this worktree
and `pnpm native:build` would download and compile the whole native dependency tree, so the
end-to-end native row remains unverified on this machine and the CI lane is the first place it runs.
The restart binding is the same keyboard channel the passing `movement.axisDelta` already proved on
native, but that is a reasoned expectation, not an executed native run.

## User verification on the named platform — NOT VERIFIED

- **Desktop launch — NOT VERIFIED, environmentally blocked.** This machine's host errors on GBM
  buffer creation for every desktop run; no desktop desktop launch or consumer gameplay row was
  produced. No desktop host binary is built in this worktree and `pnpm native:build` needs the
  native toolchain and downloads, so the untouched native-smoke failure was not re-run here.
  The PRD's own machine reality states this, and it is recorded unverified rather than green.
- **Desktop containers — BLOCKED.** The final distributed containers are PRD-365 (open draft
  PR #224, not on `develop`). The workflow consumes the starter that each job builds today; it
  cannot consume a container that does not exist on this branch, and no container row was run.
- **Android — NOT VERIFIED.** The emulator lane is live (`emulator-5554` and `emulator-5556` are
  attached). A fresh local-tarball starter was scaffolded from this worktree and
  `pnpm build --target android` was run against it; the build bundles the game and then exits 1:

  ```sh
  pnpm build --target android
  # ✓ built in 416ms            (game bundle + UI)
  # fetch failed
  # node exited with code 1.
  ```

  The failure is the Android prebuilt install: this machine has no network, and the only local
  prebuilt manifest (`~/.cache/prebuilt-stage/prebuilt-lock.json`) points at a stopped
  `http://127.0.0.1:8791` file server. No starter APK was produced, so there was no artifact to
  install on the emulator and no Android gameplay row to record. This is missing-artifact, not a
  device or harness failure; it is recorded unverified.

## Independent reviewer — NEEDS CORRECTION

A fresh-eyes read-only reviewer examined the diff, the fixtures, the registry threading and the
workflow, and re-ran both focused lanes. Verdict: **NEEDS CORRECTION.** The blocking finding is the
scenario/target mismatch above (C1); the consumer workflow steps as wired cannot produce a
qualifying row until it is fixed. Secondary findings addressed in this revision: the production
path now accepts an independent expected identity and exposes `--qualify-existing` so a stale row
can actually fail (previously the run qualified only against itself); a runner that prints a pass
but exits non-zero is rejected as malformed; a present-but-unreadable `consumer-targets.json` is no
longer silently overwritten; and the Android row now records the device's own OS/ABI (`getprop`)
instead of the host's. Remaining, not fixed here: the registry clean-room does not itself require a
target row (absence is legitimate until the target lane runs), and the negative controls are
row-level fixtures rather than real native runs. The reviewer box therefore stays open.

## Independently verified quantities

- Red→green fixture lane: exact command above, 10 failed → 31 passed.
- Registry contract: 25/25 after the additive field.
- The workflow YAML parses (`python3 -c "import yaml; yaml.safe_load(...)"` → OK); the workflow
  itself was not executed and is not part of the merge verdict.

## Files changed

- EDIT `packages/runtime-native/scripts/verify-starter-desktop.mjs`
- EDIT `packages/runtime-native/tests/starter-desktop.test.mjs`
- EDIT `scripts/verify-registry-install.ts`
- EDIT `.github/workflows/native-platforms.yml`
- NEW `docs/verification/prd-366-readiness-phase-2-2026-09-15.md`

Repair (the section above):

- EDIT `packages/create-threenative/templates/starter/playtests/production-readiness.playtest.json` — portable `KeyR` restart, sampled after re-entry.
- EDIT `packages/playtest/src/runner/desktop.ts` — ALSA/`[Audio]`/`dbind` platform-library noise is non-error.
- EDIT `packages/playtest/__tests__/desktop-playtest.spec.ts` — three red→green severity rows.
- EDIT `packages/create-threenative/__tests__/scaffold.spec.ts` — starter scaffold hash for the moved scenario bytes.
