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

## User verification on the named platform — DESKTOP VERIFIED (Linux), Android open

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

### Desktop containers — still BLOCKED (unchanged)

PRD-365's release containers landed on `develop` and are merged into this branch, but this row was
produced against the `dist-native/starter-native` executable that `threenative build --target
desktop` emits, not against a relocated release container. No container consumer row was run here.

### Android — OPEN, with the blocker corrected

The PRD's recorded Android blocker ("`fetch failed` at the Android prebuilt fetch, no APK exists")
is **partly stale**. Two corrections, both executed here:

1. The packager prints an actionable escape hatch for exactly this case, so a published install
   without a prebuilt is not the end of the road:
   `THREENATIVE_RUNTIME_SOURCE=<runtime-native> pnpm exec threenative build --target android --allow-source-build`.
   Run against this candidate it gets past the fetch and fails with a different, actionable error:

   ```sh
   THREENATIVE_RUNTIME_SOURCE=<worktree>/packages/runtime-native \
     pnpm exec threenative build --target android --allow-source-build
   # ✓ built in 468ms   (native game bundle)
   # ✓ built in 492ms   (UI)
   # Android source checkout at <...>/packages/runtime-native is missing SDL3-3.2.30.aar.
   # Provision the maintainer dependencies with node scripts/download-deps.mjs --android
   # from the runtime checkout, then retry --allow-source-build.
   # node exited with code 1.
   ```

2. The device lane is live, not absent: `adb devices -l` reports `emulator-5554`
   (`sdk_gphone16k_x86_64`), `emulator-5556` (`sdk_gphone64_x86_64`) and a physical
   `192.168.1.192:5555` (`Pixel_8`, `shiba`).

Provisioning the maintainer dependencies then exposed a third, real gate:

```sh
node packages/runtime-native/scripts/download-deps.mjs --android
# sdl3: OK  wgpu-android: OK  sdl3-android: OK  quiche-android: OK  webp-source: OK
# v8-android: FAILED
# Failed to provision v8-android: Android V8 requires NDK 28.2.13676358; install it with
#   sdkmanager "ndk;28.2.13676358" and select that NDK with ANDROID_NDK_HOME
```

That NDK is installed here, and re-running with `ANDROID_NDK_HOME=$ANDROID_HOME/ndk/28.2.13676358`
does proceed — but `v8-android` has no usable prebuilt payload and provisioning falls through to
compiling V8 from Chromium source (3519 ninja steps). **No Android consumer row was produced in
this session**, so the Android half of this box stays open and is credited to nothing. The
correction that matters for the next attempt: the blocker is the `v8-android` payload, not
`fetch failed` and not a missing device.

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
