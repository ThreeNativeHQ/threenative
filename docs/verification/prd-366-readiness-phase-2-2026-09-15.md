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

1. `packages/runtime-native/scripts/verify-starter-consumer.mjs` (NEW; corrected 2026-09-15 —
   this section used to describe a `--consumer` branch appended to `verify-starter-desktop.mjs`,
   but what shipped is a split: `verify-starter-desktop.mjs` is now a 31-line router that spawns
   either this file or `verify-starter-desktop-base.mjs`) — clearly named exports
   `validateConsumerTargetRow`, `qualifyConsumerTargetRow`, `assertConsumerTargetRows`,
   `parseConsumerPlaytestReport`, `describeConsumerSession` and `verifyStarterConsumerGameplay`,
   plus a `--consumer --target <desktop|android> [--project <dir>]` CLI branch appended before the
   existing desktop-smoke guard. A row carries `target`, `os`, `osVersion`, `architecture`,
   `session`, `scenario`, `applicationId`, `artifactHash`, `pass`, `assertions`, `assertionIds`
   and `failures`. (`assertionIds` was added by the B4 repair below; a row without it is
   `ROW_OUTDATED`.)
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
4. `packages/create-threenative/templates/starter/package.json` — the starter's own `test:native`
   script chains the consumer qualifier after the existing container verifier:
   `... verify-starter-desktop.mjs && ... verify-starter-desktop.mjs --consumer --target desktop
   --project .`. That is the wiring: `.github/workflows/native-platforms.yml` carries **no
   `--consumer` flag of its own**; the `starter-linux` job (line 1504) and the `desktop` macOS /
   Windows matrix job (line 1123) both run `pnpm --dir "$target" test:native`, so the qualifier
   runs there because the generated game's own script runs it. The run writes
   `artifacts/native/consumer-targets.json`, which the existing evidence uploads already collect.
   This workflow is a reusable workflow called by `ci.yml` and is **not a required check / not
   part of the merge verdict**, so it cannot gate the claim.

## Required test (green)

Corrected 2026-09-15 (review B1). This section previously cited `tests/starter-desktop.test.mjs` at
31/31. That file is **unchanged by this PR** and carries none of this work (`grep -c PRD-366` = 0);
the 31/31 figure does not reproduce. The PRD-named rows live in the new
`tests/starter-consumer-gameplay.test.mjs`. Re-measured at HEAD on this machine, per file:

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/<file>
# tests/starter-desktop.test.mjs                  Tests  25 passed (25)
# tests/starter-consumer-gameplay.test.mjs        Tests  12 passed (12)
# tests/starter-consumer-qualification.test.mjs   Tests  50 passed (50)
# all three together                              Tests  87 passed (87)
```

`starter-desktop.test.mjs` is 25 rather than its pre-existing 24 because this commit adds one
control to it, for the cross-PR merge hazard.

The two rows the PRD names are present verbatim, in `tests/starter-consumer-gameplay.test.mjs`:

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

Green (after implementing): 31/31 passed at the time. Superseded — the work moved into the two new consumer test files and the counts were re-measured at HEAD; see "Required test (green)" above.

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
# Test Files 2 passed (2); Tests 73 passed (73)   <- superseded; re-measured at HEAD as 87 across three files

pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts
# Test Files 1 passed (1); Tests 61 passed (61)
# starter hash recomputed for the moved scenario bytes:
#   aa783e68daddcb7b54a830056511db80e19ff6faa69d7c641d0b5b947d8b72c2
#   <- superseded by f9b0ac87d887240dadd19fe59c183801a584ba103968c17b560e95e446b9c14e
#      after the develop merge moved templates/starter/package.json

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

## B4 repair — the row stored a count, so it could be fooled (2026-09-15)

The second review found a real false pass, and it is the most important change in this commit.
`verify-starter-consumer.mjs` checked only that `assertionResults` was non-empty and not entirely
`diagnostics`. It never checked **which** assertions ran, and the row stored only a number. Two
consequences, both exploited against the real CLI:

1. A run could qualify on assertions the scenario never declared. A report of
   `[{"id":"totally-made-up","pass":true}]` against a project whose scenario declares the full
   assert block exited 0 with `1 assertions`.
2. A run that silently dropped whole declared families still qualified. Three of five families
   producing no result qualified with `assertions: 3` and nothing said so.

This directly undermined the phase's central claim. "Both rows carry 5 real assertions, one game,
two targets" was verified by `5 === 5` — not by comparing what was actually evaluated.

**Fix.** `parseConsumerPlaytestReport` now returns sorted, deduplicated `assertionIds`; the row
stores them; every assertion family the scenario declares must be covered by at least one result
(`ASSERTION_FAMILY_MISSING`); and `assertConsumerTargetRows` requires **identical id sets** across
targets (`ASSERTION_SET_MISMATCH`). A scenario declaring no recognised family is itself refused, so
the check cannot be satisfied vacuously. A row written by the previous verifier has no ids and is
named `ROW_OUTDATED` — superseded evidence to re-run, not corrupt input.

Family coverage is checked per declared family rather than per id because one `resources` block
yields one result per entry; extra ids are allowed, missing families are not.

**Red first, then green** (`packages/runtime-native`, its own config):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/starter-consumer-qualification.test.mjs
# red:   Tests  6 failed | 43 passed (49)
# green: Tests  50 passed (50)
```

**The reviewer's exact exploit, re-run through the real CLI after the fix.** The runner was
replaced with one emitting precisely the report the review used, against the real scaffolded
starter whose scenario declares the full assert block:

```sh
# runner stdout: {"target":"desktop","pass":true,"diagnostics":[],
#                 "assertionResults":[{"id":"totally-made-up","pass":true}]}
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs \
  --consumer --target desktop --project .
# BEFORE: exit 0 - "consumer gameplay qualified on desktop: 1 assertions, artifact be9526130868"
# AFTER:  exit 1
# TN_STARTER_CONSUMER_ASSERTION_FAMILY_MISSING: the 'desktop' run evaluated [totally-made-up]
#   but the scenario declares 'diagnostics'; a run cannot qualify on assertions the scenario
#   never declared.
```

**The cross-target check is now wired, because otherwise it never executed.** Every caller passed a
single target, so `ASSERTION_SET_MISMATCH` was unreachable in production and "one game, one
scenario, the same assertions on every target" rested on a human comparing rows by eye — a check
that never runs, which is the same false-pass family one level up. `--qualify-existing` now accepts
`--target desktop,android` and qualifies both in one call, building a per-target expected identity.
Run against the real two-row file:

```sh
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs \
  --qualify-existing --target desktop,android --project .
# exit 0
# existing consumer rows match the built consumer: desktop b0f7d4e28e11, android 3f24116fb41a (identical assertion sets)

# red control: replace one android id with visibility.q, re-run
# exit 1
# TN_STARTER_CONSUMER_ASSERTION_SET_MISMATCH: 'android' evaluated [... visibility.q] but
#   'desktop' evaluated [... visibility.player]; the same scenario must prove the same
#   assertions on every target.
```

**Precisely what is and is not automatic.** The gate is reachable and proved, and a CLI test covers
both directions. But **no shipped script invokes it with two targets**: the starter's `test:native`
runs `--consumer --target desktop`, and each Android run is a separate invocation. So cross-target
equality is verified by *a wired, tested command that was executed here*, not by a gate that fires
on its own in CI. Making it automatic needs a caller that knows when every required target has been
recorded, which is a phase-3 question, not a tonight one.

**Proved on the real rows, not only on fixtures.** After re-running desktop, the physical Pixel 8
and the emulator with the repaired verifier, all three rows carry the identical set
`diagnostics, movement.axisDelta, resource.state.entityCount.atSteps, resource.state.score.atSteps,
visibility.player`. Calling `assertConsumerTargetRows` on the real file qualifies 2 targets;
perturbing one id on the real android row raises:

```
TN_STARTER_CONSUMER_ASSERTION_SET_MISMATCH: 'android' evaluated [... something.else] but
'desktop' evaluated [... visibility.player]
```

The desktop artifact hash is unchanged across the re-run
(`b0f7d4e28e115b6a422eec851a2b4525c953c672088482e74d01d97e8b5fd1bf`), so the repair did not move
the artifact under the evidence.

## Cross-PR merge hazard — `--container ""` (checked, not copied)

`verify-starter-desktop-base.mjs` carried `if (flag === '--container' && value)`. An empty value is
falsy, so `--container ""` dropped the flag and the CLI ran the **non-container** desktop path and
exited 0 — a container verification that never happened, reported as success. PR #255 fixed this in
`verify-starter-desktop.mjs`; this branch moved that code into the base file, so #255's fix would
land on a file that no longer holds the code path.

Re-proved here against the file that actually ships it, rather than by copying #255's patch. Any
recognised flag passed with an empty value now exits 1 with a named cause, and `--frames` must be a
positive integer:

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/starter-desktop.test.mjs
# red:   Tests  1 failed | 24 passed (25)   (TN_DESKTOP_CONTAINER_FLAG_EMPTY absent, exit 0)
# green: Tests  25 passed (25)
```

If #255 lands first, this guard must be re-checked for survival across the split.

## User verification on the named platform — VERIFIED (Linux desktop, physical Pixel 8, Android emulator)

**The strongest single piece of evidence in this PR is that the desktop row reproduces on a second,
independent machine.** CI run `35054258943` (`native-platforms / Scaffolded starter desktop
artifact`, job `104662689257`, pass, 6m11s) produced it on a GitHub Ubuntu runner —
`consumer gameplay qualified on desktop: 5 assertions, artifact 648ca9ff2bef, app
com.threenative.threenativestarternative` — against the local row's `artifact b0f7d4e28e11, app
com.threenative.starternative`. Different hardware, different artifact hash, different application
id (each job scaffolds under its own project name), same scenario and same five assertions. A local
row alone could be a property of this machine; two agreeing rows are not. Details below under
"independently reproduced on a GitHub runner".

Executed on this machine on 2026-09-15 against branch commit `4edbf1dc528e946a1e5599379a90a2e749bfee7a`.
The earlier "environmentally blocked (host GBM buffer creation)" note above is **superseded**: no
GBM error occurred, and the run below is the first real distributed desktop consumer row.

### Desktop (Linux x64) — PASS

The Sep-9 host binary in the primary checkout was **stale** for this candidate (`runtime.cpp` and
`src/platform/ui_overlay.cpp` moved in `e36887a05`, 2026-09-13), so the candidate's own host was
built in this worktree rather than borrowed. `third_party/` was copied from the primary checkout
(never symlinked) to avoid re-downloading the dependency tree.

```sh
# 1. The candidate's own desktop host (worktree-local; third_party copied, not symlinked)
cp -a --reflink=auto <primary>/packages/runtime-native/third_party \
  <worktree>/packages/runtime-native/third_party
pnpm --filter @threenative/runtime-native native:build          # exit 0, 405/405 targets
sha256sum packages/runtime-native/build/tn-linux/mystral
#   3bd25e2dabe163fbc18fd1bb396c2228bed10bf777f106abb14f243dc5e1ef1c

# 2. Pack the exact candidate as tarballs and scaffold like a consumer (no workspace protocol)
pnpm tsx scripts/workspace-packages.ts --archives > <tmp>/package-specs   # 11 packages
pnpm --filter <each> pack --pack-destination <tmp>/packages
node packages/create-threenative/dist/index.js <tmp>/starter-native \
  --template starter --no-install --threenative-<pkg>-package <tarball> ...
pnpm --dir <tmp>/starter-native install --ignore-scripts                  # exit 0

# 3. The generated game's own script — the exact command CI's starter-linux job runs
THREENATIVE_RUNTIME_BINARY=<worktree>/packages/runtime-native/build/tn-linux/mystral \
  pnpm --dir <tmp>/starter-native test:native
# exit 0
# starter desktop gate passed: 300 frames, 21951 colors, 336 asset pixels
# consumer gameplay qualified on desktop: 5 assertions, artifact b0f7d4e28e11, app com.threenative.starternative
```

`TMPDIR` was pointed at a disk-backed directory (`/home/joao/.cache/tn366`), not the 32 GB `/tmp`
tmpfs. A worktree-local `TMPDIR` is **not** usable here: the resulting `tsx` IPC socket path exceeds
the 108-byte unix-socket limit and `pnpm build` fails with a misleading `EADDRINUSE`.

The qualifying row, verbatim from `<project>/artifacts/native/consumer-targets.json`:

| Field | Value |
| --- | --- |
| `target` | `desktop` |
| `pass` | `true` |
| `assertions` | `5` |
| `failures` | `[]` (empty) |
| `applicationId` | `com.threenative.starternative` |
| `artifactHash` | `b0f7d4e28e115b6a422eec851a2b4525c953c672088482e74d01d97e8b5fd1bf` |
| `scenario` | `playtests/production-readiness.playtest.json` |
| `scenarioHash` | `4edb52f1fb8d6ded2159a4d39cb35b48089db917edbe79d3b52109edbf3146ed` |
| `os` / `osVersion` | `linux` / `7.2.3-1-cachyos` |
| `architecture` | `x64` |
| `session` | `wayland` |

All five assertions evaluated real observations, not hardcoded strings:

| Assertion id | Observed |
| --- | --- |
| `resource.state.score.atSteps` | `collected` = 1, `restarted` = 0 |
| `resource.state.entityCount.atSteps` | `collected` = 3, `restarted` = 4 |
| `diagnostics` | 0 console errors, 0 runtime diagnostics, `runtimeReady` true |
| `movement.axisDelta` | `-z` delta 3.99997 (required ≥ 0.5) |
| `visibility.player` | 3699.6 projected pixels (required ≥ 20), offscreen ratio 0 |

The run reached tick 985; startup settled at `readyMs` 3178.68 with `compileSettled: true` and
14/14 warm-up pipelines created, 0 failed. The `diagnostics` policy record shows the target-aware
waiver working as designed on a network-blind target: `noConsoleErrors` true and **evaluated**,
`noNetworkErrors` false with the recorded reason "The run target has no network observer; its
network observation is hardwired empty, so the default network policy is waived rather than
evaluated against nothing." This is the C1 blocker closed by execution, not by assertion.

Artifacts: `<project>/artifacts/native/consumer-targets.json`, `consumer-desktop.log` (715 KB),
`consumer-desktop.stdout.json`, `starter-desktop.png`, `starter-desktop-report.json`.

Scope of this row: **Linux x64 desktop only.** macOS and Windows desktop rows are produced by the
`desktop` matrix job through the same `test:native` script and are not executed on this machine;
they are named, not claimed.

### Desktop (Linux x64) — independently reproduced on a GitHub runner

The same row was produced a second time, on different hardware, by CI run `35054258943`
(`native-platforms / Scaffolded starter desktop artifact`, job `104662689257`, pass, 6m11s):

```
starter desktop gate passed: 300 frames, 21296 colors, 306 asset pixels
consumer gameplay qualified on desktop: 5 assertions, artifact 648ca9ff2bef, app com.threenative.threenativestarternative
```

Same scenario, same assertion count, different machine, different artifact hash and application id
(the CI job scaffolds under its own project name). Two independent desktop executions agree.

### Desktop containers — still BLOCKED (unchanged)

PRD-365's release containers landed on `develop` and are merged into this branch, but this row was
produced against the `dist-native/starter-native` executable that `threenative build --target
desktop` emits, not against a relocated release container. No container consumer row was run here.

### Android — building the APK (the recorded blocker was stale)

The PRD's recorded Android blocker ("`pnpm build --target android` exits 1 at the Android prebuilt
fetch with `fetch failed`, so no APK exists") is **stale**. An APK was built and a qualifying
Android consumer row was produced here. Three gates stood between the recorded state and the row,
each with an actionable message that named its own fix:

```sh
# 1. The packager's documented escape hatch gets past the prebuilt fetch.
THREENATIVE_RUNTIME_SOURCE=<worktree>/packages/runtime-native \
  pnpm exec threenative build --target android --allow-source-build
# -> "Android source checkout ... is missing SDL3-3.2.30.aar. Provision the maintainer
#     dependencies with node scripts/download-deps.mjs --android"

# 2. Provisioning them: five of six succeed, v8-android names the NDK it needs.
node packages/runtime-native/scripts/download-deps.mjs --android
# sdl3 OK, wgpu-android OK, sdl3-android OK, quiche-android OK, webp-source OK
# v8-android FAILED: "Android V8 requires NDK 28.2.13676358 ... select that NDK with
#   ANDROID_NDK_HOME"

# 3. That NDK is installed here, and selecting it does let v8-android proceed -- but it has no
#    usable prebuilt payload and falls through to compiling V8 from Chromium source (3519 ninja
#    steps, ~3.5 h at the observed rate). Stopped at step ~1800 and rolled back to QuickJS, which
#    `android/app/build.gradle.kts` documents as exactly this escape.
```

The QuickJS rollback builds the APK:

```sh
export ANDROID_HOME=/home/joao/Android/Sdk
export ANDROID_NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk          # JDK 17; JDK 26 fails Gradle
export THREENATIVE_RUNTIME_SOURCE=<worktree>/packages/runtime-native
export THREENATIVE_GRADLE_ARGS="-PthreenativeJsEngine=quickjs"
pnpm exec threenative build --target android --allow-source-build
# BUILD SUCCESSFUL in 2m 34s; 39 actionable tasks
# 16 KB ok: lib/arm64-v8a/libSDL3.so, lib/arm64-v8a/libmystral-runtime.so,
#           lib/x86_64/libSDL3.so, lib/x86_64/libmystral-runtime.so
# ThreeNative Android APK: dist-native/starter-native.apk (47,585,025 bytes)
sha256sum dist-native/starter-native.apk
#   3f24116fb41a3e890d51fad9eb4834e3715c284cd023cdb96b310f151015f211
```

`third_party/` was copied from the primary checkout (never symlinked -- `download-deps.mjs`
`mkdirSync`s that path and a symlink puts the shared cache at risk).

Both Android rows produced from this APK are recorded in the two sections below. Each row
records the **device's** own OS and ABI (`getprop`), not the host's — the earlier review
finding working as intended.

### Android (physical Pixel 8, arm64-v8a) — PASS on re-run; the earlier failure did not reproduce

Corrected 2026-09-15 on two counts, both of which weaken an earlier claim of mine rather than
strengthen it.

**Run 2 (current evidence).** Device charging, level 74%, 34.6 °C, `Thermal Status: 0`, app
confirmed dead (`pidof` empty) before the cold launch:

```sh
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs \
  --consumer --target android --device 192.168.1.192:5555 --project .
# exit 0
# consumer gameplay qualified on android: 5 assertions, artifact 3f24116fb41a, app com.threenative.starternative
```

| Field | Value |
| --- | --- |
| `pass` / `assertions` / `failures` | `true` / `5` / `[]` |
| `architecture` | `arm64-v8a` |
| `osVersion` | `17 (API 37)` |
| `session` | `android-device` |
| `artifactHash` | `3f24116fb41a3e890d51fad9eb4834e3715c284cd023cdb96b310f151015f211` |
| `assertionIds` | `diagnostics, movement.axisDelta, resource.state.entityCount.atSteps, resource.state.score.atSteps, visibility.player` |

So **arm64-v8a is proven**, and the earlier statement that "the passing Android row is x86_64
emulator only" no longer holds.

**Run 1 (earlier, failing) — cause corrected, and it did not reproduce.** The first physical attempt
exited 1 with `TN_STARTER_CONSUMER_NO_ASSERTIONS: assertion 'diagnostics' was not evaluated`,
`pass: false`, `assertions: 0`. I recorded that as "the diagnostics channel is not evaluated on
API 37 while it is on API 35" and called it a phase-3 finding. **That was wrong.** A single
unevaluated `diagnostics` result with `details.reason: 'not-evaluated'` is what
`failureReport()` (`packages/playtest/src/runner/shared.ts:119-130`) emits for **any** abort before
assertions run — it is the generic pre-assertion failure shape, not a diagnostics-channel gap. The
real cause was whatever `diagnostics[0]` named, which my row did not retain.

**Sample, not a single re-run.** The physical device was run **four** consecutive times after the
repair, with the app force-stopped between each so every launch was cold:

```
run 1  exit 0  5 assertions   run 3  exit 0  5 assertions
run 2  exit 0  5 assertions   run 4  exit 0  5 assertions
```

4/4 pass, same artifact `3f24116fb41a` each time. So arm64-v8a gameplay is proven **under the
conditions tested**, and the earlier one-run failure is not reproducible under them.

**The confound is an operator intervention on the machine under test, and it was NOT isolated — so
the prior failure is not retired.** Between the failing run and the passing runs the device state
did not merely drift: **the lane coordinator plugged the Pixel into AC and set
`stay_on_while_plugged_in=15` to hold the screen awake, at the owner's request.** That is a
deliberate change to the machine under test, made by a person, between the two observations — not
an independent variable that happened to move. Stated precisely: the failure happened at **15%
battery, discharging, screen not held awake**; all four passes happened at **74-82%, on AC, with
`stay_on_while_plugged_in=15` set**. Reproducing the failing condition would require draining the
phone to ~15% and restoring `stayon false`; that was not done, so the intervention and the outcome
change are confounded and neither can be credited over the other.

An earlier draft of this paragraph said the "only measured difference between the two runs is device
state". That was **false as written** — it omitted that a person changed that state on purpose — and
it is corrected here rather than footnoted, because this is the paragraph a reader uses to weigh the
whole hardware claim.

**The claim this evidence supports** is therefore narrower than "no defect exists", and narrower
than "arm64-v8a is proven" full stop:

> Physical arm64-v8a is **proven across four runs, with a named unexplained prior failure.**

Unpacked:

- Physical arm64-v8a passes the consumer gameplay scenario **4/4** on a charged, awake Pixel 8,
  cold-launched each time.
- One physical run aborted **before assertions ran** on the same APK under low-battery/discharging
  conditions. Its cause was misattributed by me (see above) and the real `diagnostics[0]` was never
  retained, so it is **unexplained**. A run that aborted on the very target now being claimed is
  evidence of something even while unexplained; it is not "no evidence in either direction", and it
  is not dismissed by later passes under a changed and partly intervened-upon device state.
- **Survives as a phase-3 observation, not retired:** *physical arm64 aborted before assertions
  once; cause unisolated, did not reproduce across four subsequent runs under changed and partly
  intervened-upon device state.* The open questions it carries: whether a physical device under
  power pressure aborts before gameplay, and whether the consumer row should retain
  `diagnostics[0]` so a future abort names itself instead of showing only `failureReport()`'s
  generic pre-assertion shape.

### Android (emulator, x86_64) — PASS

Run against `emulator-5556` with the same APK:

```sh
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs \
  --consumer --target android --device emulator-5556 --project .
# exit 0
# consumer gameplay qualified on android: 5 assertions, artifact 3f24116fb41a, app com.threenative.starternative
```

`pass: true`, `assertions: 5`, `failures: []`, `architecture: x86_64`, `osVersion: 15 (API 35)`,
`session: android-emulator`, and the same five `assertionIds` as desktop and the physical device.

Both Android rows are real and both are recorded here because `consumer-targets.json` keys rows by
`target` alone, so the later physical run replaced the emulator row in the file. The file currently
holds the **physical** row. Per PRD-366's acceptance, an emulator run cannot take physical
*performance* credit; neither row is a performance claim, and the distinction is kept explicit.

### Owner platform policy

Linux desktop is produced locally; Android uses the emulator or Wi-Fi adb to the Pixel 8 (both were
used); macOS, Windows and iOS are delegated to the `native-platforms` CI legs by owner decision and
are not attempted locally or reported as environment-blocked.

### Devices available on this machine

`adb devices -l`: `emulator-5554` (`sdk_gphone16k_x86_64`), `emulator-5556`
(`sdk_gphone64_x86_64`), `192.168.1.192:5555` (`Pixel_8`, `shiba`). The lane is live; the PRD's
"no APK existed to install" note no longer holds.

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

All re-measured at HEAD on this machine for the second review; superseded figures are named as such.

- `starter-desktop.test.mjs` **25**, `starter-consumer-gameplay.test.mjs` **12**,
  `starter-consumer-qualification.test.mjs` **50**, together **87**. (Supersedes "31/31" and the
  "73 passed" pair, neither of which reproduces.)
- B4 red→green: 6 failed / 43 passed → 50 passed. Merge-hazard control: 1 failed / 24 passed → 25.
- `scripts/__tests__/verify-registry-install.spec.ts` **25**;
  `packages/create-threenative/__tests__/scaffold.spec.ts` **61** at starter hash `f9b0ac87…`.
- `pnpm typecheck` exit 0; `pnpm lint` exit 0 (warnings only); `pnpm check:docs` 2130 links across
  1101 files; prose lane 164/164.
- Three real consumer rows, all `pass: true` / 5 assertions / 0 failures, all sharing one
  `scenarioHash` and one `assertionIds` set: desktop (linux x64), physical Pixel 8 (arm64-v8a,
  API 37), emulator (x86_64, API 35). Cross-target set equality machine-checked; perturbing one id
  raises `ASSERTION_SET_MISMATCH`.
- `.github/workflows/native-platforms.yml` is **unchanged by this PR**; the wiring is the starter
  template's `test:native`. The workflow is not part of the merge verdict.

## Files changed

Corrected 2026-09-15 (review B3): this section previously described the pre-refactor shape. It
listed `.github/workflows/native-platforms.yml` and `packages/runtime-native/tests/starter-desktop.test.mjs`
as edited — `git diff --stat <merge-base>..HEAD` shows the workflow untouched — and omitted every
new file that is the actual substance. What ships:

- NEW `packages/runtime-native/scripts/verify-starter-consumer.mjs` — the consumer row contract:
  `verifyStarterConsumerGameplay`, `parseConsumerPlaytestReport`, `validateConsumerTargetRow`,
  `qualifyConsumerTargetRow`, `assertConsumerTargetRows`, `describeConsumerSession`,
  `declaredConsumerAssertionFamilies`.
- NEW `packages/runtime-native/scripts/verify-starter-desktop-base.mjs` — PRD-365's desktop and
  container verifier, moved out of `verify-starter-desktop.mjs`. Byte-for-byte identical to the
  merge-base file apart from the `parseCliFlags` guard described under "Cross-PR merge hazard".
- EDIT `packages/runtime-native/scripts/verify-starter-desktop.mjs` — reduced to a 31-line router
  that spawns whichever of the two files the flags select. **Not** a `--consumer` branch appended to
  the original, which is what section "What this phase added" §1 used to describe.
- NEW `packages/runtime-native/tests/starter-consumer-gameplay.test.mjs` — holds both PRD-named rows.
- NEW `packages/runtime-native/tests/starter-consumer-qualification.test.mjs` — evidence regressions.
- EDIT `packages/runtime-native/tests/starter-desktop.test.mjs` — one added control, for the
  cross-PR merge hazard only.
- EDIT `scripts/verify-registry-install.ts` — `readConsumerTargetRows` + additive `consumerTargets`.
- EDIT `packages/create-threenative/templates/starter/package.json` — `test:native` chains the
  consumer row. **This is the entire workflow wiring**; the workflow YAML is unchanged.
- EDIT `packages/create-threenative/templates/starter/playtests/production-readiness.playtest.json`
  — portable `KeyR` restart, no explicit `noNetworkErrors`.
- EDIT `packages/playtest/src/runner/desktop.ts` + `packages/playtest/__tests__/desktop-playtest.spec.ts`
  — platform-library noise is not the game's console error.
- EDIT `packages/create-threenative/__tests__/scaffold.spec.ts` — starter scaffold hash.
- EDIT this file and the PRD.

## Full runtime-native suite — the reds here are environmental, named so the claim is checkable

`pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts` on this
machine at HEAD: **Test Files 4 failed | 112 passed (116); Tests 8 failed | 1204 passed | 23
skipped (1235).** The four files, all of the standing "contract binary is not built" class —
`pnpm native:build` builds `mystral` but not the contract-test targets, so an absent executable is
reported as a failure rather than a silent pass:

| File | Failed | Cause |
| --- | --- | --- |
| `tests/rg11b10-renderable.test.mjs` | 2 | `build/tn-linux{,-quickjs}/threenative-rg11b10-renderable-test is not built` |
| `tests/timestamp-query.test.mjs` | 2 | same class, timestamp-query target |
| `tests/crash-handler-policy.test.mjs` | 1 | same class |
| `tests/runtime-next-contract.test.mjs` | 3 | same class (`tn-linux-quickjs`, Canvas2D lane) |

`grep -l verify-starter` over all four returns **nothing**, so none imports anything this branch
changed — the attribution is checkable rather than asserted.

**My count differs from the reviewer's (4 files / 8 tests here vs 7 files / 21 reported), and the
difference is itself informative.** Two of its seven were its own worktree's unbuilt
`packages/playtest/dist`, which is built here. A `tests/webtransport/webtransport.test.ts` failure
also appeared in one earlier full run here (1 of 36, after 92.8 s) and did not recur in this one, so
that one is a flake rather than a standing red. Counts of this suite are worktree-dependent; only
the per-file causes above are stable.

**Precision on the CI half of this claim:** `test-native` passed on CI in run `35054258943`
(job `104662199850`, 7m30s) against `97637e6f9`. It has **not** re-run to completion on the current
HEAD — successive pushes cancelled the runs in between, and the run for the latest commit is queued
at the time of writing. So "CI builds these targets and they pass" is verified for `97637e6f9`, not
yet for HEAD.

## Not fixed in this pass (non-blocking review findings)

**Promoted to a named phase-3 follow-up, because it lost data in practice rather than in theory:**
consumer rows are keyed by `target` alone, so the physical Pixel run **overwrote** the emulator row
in `consumer-targets.json`. Both Android rows survive only because they are written out in this
document by hand. A target that can be reached by more than one device needs the device identity in
the key. Recorded as an open item under PRD-366 phase 3, which already owns physical-device
qualification. *Alternative rejected:* minting a new PRD number for it — the owner is AFK, a number
cannot be confirmed free tonight, and phase 3 is the natural owner; split it out if it grows past
that.

### Two latent traps — inert today, false-pass the moment one thing changes

Both are properties of the B4 coverage check. Neither can fire against the shipped starter. Both
become real false-pass paths on a specific, foreseeable change, so they are written with that
trigger named rather than as generic future work.

1. **Per-family coverage accepts a bogus id inside a declared family.** Coverage asks whether some
   result id begins with each declared family token, not whether the id is one the scenario could
   produce. `visibility.q` satisfies `visibility`. **Inert today** because the starter's five ids are
   the real ones and the row now names them, so a reader sees the substitution. **False-pass the
   moment** a runner emits a plausible-looking id in the right family — the coverage check would
   pass it. Note the cross-target check *does* catch this when two targets are compared in one call
   (the red control above uses exactly `visibility.q`), so the trap is narrowest for a single target.
2. **`CONSUMER_ASSERTION_FAMILIES` maps only four families** (`diagnostics`, `movement`, `resources`,
   `visibility`); any other declared key is **silently ignored**, exiting 0 with the family dropped.
   **Inert today** because the starter's scenario declares exactly those four and all are recognised.
   **False-pass the moment** a scenario declares a fifth — `components`, say — because the check
   would then confirm coverage of everything it understands while quietly not requiring the new one.
   The fix is to refuse an unrecognised declared key rather than skip it.

Also recorded so they are not lost: `--qualify-existing` trusts the row file rather than re-running;
`readConsumerTargetRows` (`scripts/verify-registry-install.ts:493`) never checks `pass`/`assertions`
and does not affect `exitCode`; `desktop.ts:196` reclassifies the game's own `[Audio] Failed to open
audio device` to `log` with no override; and the router guard in `verify-starter-desktop.mjs:14`
uses a path-string compare where both wrapped files use `pathToFileURL`.
