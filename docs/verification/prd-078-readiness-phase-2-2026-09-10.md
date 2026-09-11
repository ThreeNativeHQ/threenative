# PRD-078 phase 2 — non-publishing hosted proof

**Status: PARTIAL.** Implementation and isolated regression tests are recorded below. Hosted native observations and independent acceptance review are not supplied by these local tests. No release, tag or npm publication is authorized by this record.

## Identity and bounded assignment

CI/native-host layer, based on main `0d91643402ca87d5154bef363e3be4a1e08c5380`. This includes the separately merged MCP probe repair from PR #176 instead of reimplementing that fix. The source gate, native workflow tests, CI structure guard, companion coverage digest and historical evidence from PR #168 (`5aac0abeb8527ff45d0f7a61d593d8d532948c86`) are retained together.

The [PRD](../PRDs/production-readiness/PRD-078-toolchain-free-consumer-proof.md) assigns phase 2 five files: the existing workflow, its new proof regression test, the PRD, this record and the generated retention index. Phase 1's retained source work has its own five-file assignment and [evidence record](prd-078-readiness-phase-1-2026-09-09.md). Neither phase has a self-awarded acceptance PASS.

## Implementation

The existing `.github/workflows/native-release.yml` owns both invocation routes. The tag route still requires its exact successful releaseCandidateV1 artifact and registry verification before publication. PR/manual events cannot execute `validate-tag`, `publish`, `finalize` or release cleanup. Existing iOS jobs are unchanged and are not credited by this non-iOS proof.

PR proof runs existing desktop builds, the Android runtime build and the same `clean-consumer` job at the checkout merge SHA. It records the PR head separately and lists main-CI prerequisites as unavailable, not accepted. Relevant pushes to main run the same proof automatically; a manual invocation on main is available when needed. Main proof waits for exact-SHA main CI and requires every named prerequisite. A failed main run produces a refusal table rather than becoming substitute evidence.

The proof consumer downloads artifacts from its own run, verifies the complete non-iOS asset set and SHA-256 bytes through the existing installer, and serves them only over loopback. Its manifest override is scoped to the proof job. Native compilers remain masked, and the consumer SDK exposes no NDK or CMake. This proves packaged mechanics, not public installation. PRD-262 receives the eventual accepted main run identity; PRD-060 retains public promotion ownership.

All four negative controls retain their specific exit-1 and assertion-marker checks. Both positive controls require exit 0. The evidence collector additionally refuses missing/truncated reports, zero observed assertions, wrong scenarios, wrong exits, wrong markers and missing artifact/APK identities. It records each actual assertion count, scenario/log/APK hash, observation-file hashes, package versions and SHA-512 tarball integrities in `proof-consumer-evidence.json`.

## Executed local verification

GitHub source snapshots were read with the connector. The recreated unmodified workflow matched its Git blob `7b80d998a5661634c3320faf26697ac5aef51116` before editing. The container has Node 22.16.0 and TypeScript, but no pnpm/gh and cannot resolve github.com; a Git clone was attempted and failed at DNS resolution.

The new TypeScript test file was transpiled with TypeScript and executed with `node --test`. For this isolated execution only, Vitest's `test` import was replaced with Node's test registration and the repository temporary-directory helper with equivalent exit-cleaned local directories. Assertions execute the actual inline Bash/Node bodies from the workflow; GitHub API responses are controlled fixtures. Collector fixtures contain real tar archives and temporary Git commits. None of this simulates a native frame or qualifies a platform.

```text
Proof routing and gate regressions:
  Original workflow: 17 tests, 5 passed, 12 failed, exit 1
  Patched workflow:  17 tests, 17 passed, 0 failed, exit 0
  Revert workflow:   17 tests, 5 passed, 12 failed, exit 1
  Restore workflow:  17 tests, 17 passed, 0 failed, exit 0

Consumer evidence regressions:
  Before collector:  23 tests, 17 passed, 6 failed, exit 1
  With collector:    23 tests, 23 passed, 0 failed, 0 skipped, exit 0

Isolated strict TypeScript check, including noUncheckedIndexedAccess: exit 0
YAML parsing and inline Bash/Node syntax checks: exit 0
Existing build-ios-simulator and clean-consumer-ios job comparison: identical
```

Mutations are executable, not prose: restore the tag-only workflow; feed a different-SHA successful CI run; remove/skip a required job; remove an Android result; empty its assertion set; change its marker, exit or scenario. The corresponding tests must fail when the production guard is removed.

## Correction: the main prerequisite wait could not outlast main CI

The `gates` job waits for the exact-candidate main CI run before validating its eleven required
rows. That wait was 180 attempts at 20 seconds, a 60 minute budget, inside a job capped at 65
minutes. Successful `ci.yml` push runs on `main` took 61.2, 62.5, 63.0, 64.8, 70.7, 73.7, 88.5 and
115.4 minutes on the full board (measured 2026-09-10 from
`repos/ThreeNativeHQ/threenative/actions/workflows/ci.yml/runs?branch=main&event=push`). The merge
that enables this proof changes `native-release.yml` and both proof specs, so it takes the full
board and would have refused its own candidate for elapsed time rather than for its evidence.

The budget is now 150 attempts at 60 seconds inside a 160 minute job, polling three times less
often. Refusal semantics are unchanged: a red, missing, malformed or non-`main` CI run is still
refused by the row validation below, never retried to green.

Red then green, executed locally:

```text
pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts -t "outlasts a full-board"

FAIL scripts/__tests__/native-release-proof.spec.ts > the main prerequisite wait outlasts a full-board main CI run
AssertionError: the prerequisite wait budget is 60 minutes, under the 115.4 minute worst observed main CI run
Test Files  1 failed (1)
Tests  1 failed | 23 skipped (24)
EXIT_CODE=1
```

```text
pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts
Test Files  1 passed (1)
Tests  24 passed (24)
EXIT_CODE=0

pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts scripts/__tests__/native-release-android-staging.spec.ts scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-needs.spec.ts
Test Files  4 passed (4)
Tests  123 passed (123)
EXIT_CODE=0

pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-platform-workflow.test.mjs
Test Files  1 passed (1)
Tests  30 passed (30)
EXIT_CODE=0

pnpm typecheck  EXIT_CODE=0
pnpm lint       EXIT_CODE=0 (678 pre-existing warnings, 0 errors)
```

The test parses the workflow's own loop bound, poll interval and job timeout, so a later edit that
shortens either one fails again rather than silently restoring the false refusal.

## Correction: the headless desktop gate had no sound card

`native-platforms.yml`'s desktop-core matrix is macOS and Windows only, so `verify-desktop-core.mjs`
had never run on Linux until this proof route executed it on `ubuntu-24.04`. Run
[34543393235](https://github.com/ThreeNativeHQ/threenative/actions/runs/34543393235) aborted before
the first frame:

```text
[Audio] Failed to open audio device: ALSA: Couldn't open audio device: No such file or directory
```

`SDL_AUDIODRIVER` is now defaulted, not forced (`??=`), inside the same
`process.platform === 'linux'` branch that already scopes `SDL_VIDEODRIVER`. A machine with a real
device keeps it, and the audio contract stays with `verify-desktop-audio.mjs`, which owns the
suspend/resume lifecycle against real AudioContexts and runs first in the same command. The gate
test binds both drivers to that one branch and refuses an unconditional override at the spawn site.

## Correction: release staging asked for an SDL AAR that no longer existed

`package-android.mjs` moved to SDL3 3.2.30 deliberately, because 3.2.8's 64-bit libraries are not
16 KB `LOAD`-aligned, while the staging step still spelled out the old filename:

```text
ENOENT: no such file or directory, copyfile
  'packages/runtime-native/third_party/sdl3-android/SDL3-3.2.8.aar'
```

Only a tag push reached that code, so no earlier gate could catch it. The filename is now derived
from `SDL3_ANDROID_VERSION`, and `scripts/__tests__/native-release-android-staging.spec.ts` requires
the derivation rather than a matching literal, so the next version bump cannot reintroduce the
drift. It also binds `download-deps.mjs` to the same constant.

The ENOENT was reproduced on this branch's PR run
[34540703352](https://github.com/ThreeNativeHQ/threenative/actions/runs/34540703352), where
`build-android` failed at the step named `Stage Android runtime payloads`. That run was itself
later cancelled by the next push, which is the concurrency defect recorded above. After the repair,
`build-android` succeeded on runs 34551637777 and 34553793360. Nothing beyond those rows is
claimed: the desktop Linux row and every packed Android control remain open.

## Correction: the CLI contract test could not compile

Commit `4a8fb124b` installed Web Streams before `webtransport::initBindings` in
`packages/runtime-native/tests/cli_network_fs_test.cpp`, which is the prerequisite that test
documents, but referenced the embedded script table unqualified and without its generated header.
All three desktop `build` rows of run
[34546754768](https://github.com/ThreeNativeHQ/threenative/actions/runs/34546754768) failed inside
`native:verify:desktop` with the same error:

```text
packages/runtime-native/tests/cli_network_fs_test.cpp:1049:30: error: 'runtime_scripts' has not been declared
Error: 1 native contract target(s) failed:
```

Commits `476a15681` and `6487d0c0e` qualify `mystral::runtime_scripts::find`, include the generated
`runtime_scripts.h`, guard a missing script and a failed `initBindings`, and give the target its
generated include directory plus a dependency on `threenative-runtime-scripts`. Verified locally
against the exact CI compile line taken from `build/tn-linux/compile_commands.json`, with the
generated include directory added exactly as the CMake change adds it, `-fsyntax-only`:

```text
4a8fb124b  -> error: 'runtime_scripts' has not been declared   EXIT_CODE=1
d47457c35  -> no diagnostics                                   EXIT_CODE=0
```

That is a compile result, not a hosted platform claim. The desktop rows remain owned by the hosted
run recorded below.

## Correction: the packed consumer job could not have finished, and refused its own runner

`clean-consumer` has never started on any route, so neither of these had ever been executed. Both
were found by review against measured durations already recorded in this repository.

**The 35 minute cap.** Four successful `Android emulator visual parity` runs measured 27m00s,
27m33s, 27m50s and 30m18s (2026-09-09: runs 34409182260, 34394025867, 34405960973, 34380548307),
corroborating the 1858s cost note at `native-platforms.yml:197`. That job is cached, builds Android
once and boots one emulator, and its own cap was raised 35 → 45 after measurement
(`native-platforms.yml:217`). `clean-consumer` is an uncached superset: packing every workspace
package, scaffolding and installing a consumer, a desktop build and 300-frame launch, an uncached
system-image pull, three `pnpm build --target android`, an emulator boot and six playtests, plus
this change's artifact download, loopback server and evidence collector. Raised to 60.

One honest limit on that comparison: the consumer's three Android builds compile a game APK against
a prebuilt runtime with the toolchain masked, so they are cheaper than `build-android`'s measured
7m40s-8m36s in this same workflow. No number is claimed for them. The case rests on the 27.0-30.3
minute comparable and the boot inside it.

**The emulator boot budget.** A cold software-emulation boot was measured at 474s
(`native-platforms.yml:335-341`), against this action's 600s default; the step set no boot timeout
at all. It now sets 900, matching the lane that measured it, and takes the same cheap emulator
options.

**The KVM assertion.** `native-platforms.yml:317-332` already records this defect and names this
file as its origin: asserting `test -w /dev/kvm` "turned 'this runner has no KVM' into a failed job,
which is worse than the slow boot it was meant to fix". That lane was repaired and this one was not,
so a runner without KVM failed `clean-consumer` outright — gating every packed Android control. It
now reports `TN_EMULATOR_ACCEL:kvm` or `TN_EMULATOR_ACCEL:software` and warns, never asserts.

Red then green, executed locally:

```text
pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts

× the emulator lane reports acceleration instead of asserting it
  AssertionError: a runner without KVM must fall back to software emulation, not fail the job
× the packed consumer job outlasts its measured comparable
  AssertionError: clean-consumer's 35 minute cap is under its measured comparable
Tests  2 failed | 26 passed (28)
EXIT_CODE=1
```

```text
pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts
Tests  28 passed (28)
EXIT_CODE=0
```

Both tests read the workflow's own numbers, so a later edit that restores either failure reds again.

**Coverage gap closed in the same file.** The publication-safety parametrisation covered
`validate-tag`, `publish`, `finalize` and `cleanup-failed-release`, but not `clean-consumer-ios` or
`build-ios-simulator` — the only two publishing-adjacent jobs with no event condition of their own,
held out solely by `validate-tag` skipping and emitting no `candidate_sha`. They are now pinned
against every non-tag route, including that the skip can still propagate: the dependency is declared
and no `always()`/`!cancelled()` escape overrides it. Their guards were already correct; this is
coverage, not a repair.

## Correction: proof runs were cancelled before they could report

Over this workflow's entire history — 18 runs — **13 cancelled, 4 failed, 1 in progress, zero
successes.** Every cancellation was a proof run killed by the next push to its own branch, including
run 34540703352, the run that reproduced the SDL-AAR ENOENT above. `clean-consumer` sits behind a
~20 minute build matrix, so on an actively-pushed branch it cannot reach its own first line no
matter what its timeout is. That is why this sits alongside the timeout raise rather than instead of
it.

`cancel-in-progress` was `${{ github.ref_type != 'tag' }}`, so every non-tag run was evictable. It
is now `false`, and `github.event_name` joins the group key because a manual proof on main and an
automatic one otherwise shared `native-release-refs/heads/main` and evicted each other. Evidence
here is candidate-keyed, so a superseded run's output is still valid for the SHA it came from and is
worth letting finish.

Red then green:

```text
pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts -t "not cancelled by the next push"

× a proof run is not cancelled by the next push to its own branch
AssertionError: cancelling every non-tag run is what produced 13 cancellations in 18 runs
Tests  1 failed | 28 skipped (29)
EXIT_CODE=1
```

```text
pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts
Tests  29 passed (29)
EXIT_CODE=0
```

## The RT handle repair, measured locally

The repair guards the three RT ID readers with `isObject` before they read `_id`, so the exception
is never created rather than drained downstream. Executed on this machine, Linux x86_64, against a
build of the branch source:

```text
packages/runtime-native/build/tn-linux-coverage/threenative-cli-network-fs-test
EXIT_CODE=0
native CLI network and FS comprehensive contract passed
```

Exit 0 alone does not discriminate: the dispatch event that exposed the defect is not delivered on
this machine, and the pre-repair binary also exits 0 here. The discriminating observation is the
diagnostic `reportException` prints, since that is the same function that sets `lastException_`:

| Binary | `[V8] rt_test.js:NN: TypeError: Cannot read properties of null (reading '_id')` |
| --- | --- |
| pre-repair source | 6 |
| repaired source | 0 |

Zero prints means zero writes to the sticky string, so nothing remains for the next `hasException()`
caller to misattribute. The two binaries differ in more than this one change, but the lines
themselves originate in the RT block, which is identical apart from the guards.

The regenerated coverage record moves consistently with it: `src/raytracing/` gains 3 instrumented
lines (the three guards) and `src/webtransport/` loses 3 covered lines. Totals stay above the floors
and `pnpm budgets` is green.

**Still not claimed:** the hosted Linux row. Its green is owned by the run on this head, not by this
record.

## Correction: the contract lane ran without a display, and the `_id` line was not the cause

The `_id` diagnostic analysed above is real, and the repair for it is correct, but it was **not**
what failed the Linux row. Counting the three Linux logs settles it:

| Run | `testCliSubsystem failed` | `SDL_Init failed: x11 not available` | `dispatch threw` |
| --- | --- | --- | --- |
| 34551637777 | present | present | present |
| 34553793360 | present | present | present |
| 34555922045 (after the RT repair) | present | present | **absent** |

The RT repair did exactly what it claimed — the `dispatch threw` line is gone — and the row still
failed, because `testCliSubsystem` had been failing in all three. The loudest line was not the fatal
one.

`verify-desktop-core.mjs` wraps itself in `scripts/xvfb.sh` and `verify-desktop-loading.mjs` is
wrapped in the script chain, but `verify-native-contracts.mjs` was wrapped by nothing.
`testCliSubsystem` creates a window, so on a runner with no display it fails and takes
`threenative-cli-network-fs-test` down with it while all ~40 other contract targets pass. Same root
as the audio default in Phase 3: `native-platforms.yml`'s desktop-core matrix is macOS and Windows
only, so no Linux run reached this lane until this proof route existed.

Reproduced and cleared locally on Linux x86_64, against a build of the branch source:

```text
./threenative-cli-network-fs-test                                   EXIT_CODE=0   (a display exists)
env -u DISPLAY -u WAYLAND_DISPLAY ./threenative-cli-network-fs-test  EXIT_CODE=1
  [Window] SDL_Init failed: x11 not available
  testCliSubsystem failed
env -u DISPLAY -u WAYLAND_DISPLAY sh scripts/xvfb.sh ./threenative-cli-network-fs-test  EXIT_CODE=0
  0 occurrences of either line
```

The first line is also why the earlier local run in this record exited 0: this machine has a
display, so it could not reproduce a failure that depends on not having one. `scripts/xvfb.sh` is a
no-op where a display exists, so macOS and Windows are unaffected, and `xvfb-run` is not used
because its exit status is its own failing cleanup kill.

## First hosted proof: every build row green, and what `clean-consumer` found

Run [34557447467](https://github.com/ThreeNativeHQ/threenative/actions/runs/34557447467) on
`0dcadaada` is the first in this workflow's history to get past the build matrix:

| Job | Result |
| --- | --- |
| `gates` | success |
| `build (linux-x64)` | success — first ever |
| `build (darwin-arm64)` | success |
| `build (win32-x64)` | success |
| `build-android` | success |
| `validate-tag`, `publish`, `clean-consumer-ios`, `build-ios-simulator` | skipped, as the proof route requires |
| `clean-consumer` | **reached for the first time**, failed at `Install and build without a native toolchain` |

The Phase 6 display repair is confirmed hosted: the Linux row passed the contract lane that had
failed it four times, matching the local pre-flight of the same lane under the same no-display
conditions (41 PASS, 0 FAIL, exit 0).

`clean-consumer` then failed 3 minutes in, before reaching any of the emulator repairs, because
`Prepare the scaffolded consumer proof` copied `game.ts` without the two modules it imports:

```text
[UNRESOLVED_IMPORT] Could not resolve './networking-game.js' in src/game.ts
[UNRESOLVED_IMPORT] Could not resolve './worker-proof.js' in src/game.ts
```

Repaired in Phase 7. The steps that did run first — artifact download, the loopback asset server,
package packing, scaffolding from tarballs, the Android SDK exposure and the toolchain mask — all
succeeded, so the failure is bounded to that copy.

**Still unexecuted:** the desktop 300-frame launch, the KVM report, the packed Android build and all
six Android controls. The emulator repairs recorded above remain untested, and acceptance criterion
4 still has no evidence.

## Local pre-flight of the whole consumer job, and two more defects it caught

The hosted job costs ~35 minutes to reach `clean-consumer`, so the rest of it was replicated on a
Linux workstation: the real packed tarballs, the composite action's exact scaffold flags, the same
loopback manifest serving the **actual payloads from green run 34557447467**, the same twelve
masked toolchain entry points, and a software-emulated `android-35 google_apis x86_64` AVD.

| Step | Local result |
| --- | --- |
| Pack and scaffold from tarballs | pass |
| Prepare consumer, including the Phase 7 sibling copies | pass |
| `install-status.ok` | `true`, sha256 `1bef8af5…` |
| `build --target desktop`, toolchain masked | 147,842,001-byte artifact, 0 toolchain invocations |
| 300-frame launch: all four markers, non-blank 1280x720 capture | pass |
| `build --target android`, toolchain masked | 106,148,117-byte APK, 0 toolchain invocations |
| Six emulator controls | blocked locally, see below |

**Defect: the runtime's own shared libraries were never installed.** `ldd` on the prebuilt this job
downloads names `libwebkit2gtk-4.1.so.0`, `libjavascriptcoregtk-4.1.so.0`, `libsoup-3.0.so.0` and
`libgtk-3.so.0`, because the desktop runtime links the UI overlay. The job installed only the Vulkan
ICD, so run 34559147906 died with

```text
threenative-runtime: error while loading shared libraries: libwebkit2gtk-4.1.so.0
Runtime packager exited with code 127.
```

`libwebkit2gtk-4.1-0` now installs beside the ICD. This is what a real Linux consumer needs as well,
so it belongs inside the proof rather than around it.

This repair was written once, lost before it was committed - the worktree is shared and was
reset between applying it and committing - and landed only on the second attempt. Run
[34562254905](https://github.com/ThreeNativeHQ/threenative/actions/runs/34562254905) therefore
still shows the same `exited with code 127`, with its apt step running
`sudo apt-get install -y mesa-vulkan-drivers` alone. The package-and-activity repair below did
land in that run; only this one was missing.

**Defect: every control launched an app that was not installed.** The playtest runner defaults to
`--package com.mystral.engine` and `--activity .MystralActivity`
(`packages/playtest/src/runner/config.ts:82,267`). A scaffolded consumer is neither: its application
id is derived from the target directory, and its launch activity is runtime-owned. Observed on the
local emulator with the real APK installed:

```text
Error type 3
Error: Activity class {com.mystral.engine/com.mystral.engine.MystralActivity} does not exist.
TN_PLAYTEST_RUNNER_FAILED
```

`adb shell cmd package resolve-activity --brief com.threenative.consumer` returns
`com.threenative.runtime.MystralActivity`, and the project's own `threenative.config.ts` declares
`id: "com.threenative.consumer"`. All six invocations now pass `--package "$CONSUMER_APP_ID"` and
the runtime-owned activity, with the id read back from the consumer's config rather than assumed, so
renaming the target directory cannot silently point the controls at an app that is not installed.
Without this, all six controls fail before asserting anything — the hosted job would have reported
six red controls rather than a defect in its own invocation.

**Why the six controls are still not closed here.** The local AVD launches the app but reports
`TN_PLAYTEST_BRIDGE_MISSING`, with no app output in logcat. That is a property of an ad-hoc
software-GPU AVD on this machine, not of the workflow: the repository's own
`Android emulator visual parity` leg uses the same `-gpu swiftshader_indirect` and passes. The six
controls remain owned by the hosted emulator lane, and acceptance criterion 4 stays open.

The emulator boot itself is now measured twice: 474s on a hosted runner
(`native-platforms.yml:335-341`) and 212,330 ms locally under pure software emulation with no KVM.
Both exceed this action's 600s default comfortably enough to justify the 900s budget recorded above.

## Blocking product gap: no release publishes the build tool helper

Run [34564200217](https://github.com/ThreeNativeHQ/threenative/actions/runs/34564200217) cleared the
shared-library failure and reached the next one:

```text
Error: build tool helper is missing:
  .../node_modules/@threenative/runtime-native/prebuilt/linux-x64/mystral-tools
Runtime packager exited with code 127.
```

This is not a CI defect. `src/cli/tool_dispatch.cpp:52` has the runtime dispatch desktop packaging
to a `mystral-tools` binary sitting beside it. `native:build` produces that binary, but the build
matrix staged only `release/<asset>`, and `PREBUILT_ASSET_NAMES` declares no tools asset at all, so
nothing has ever published it.

**Consequence, stated plainly: a consumer installing `@threenative/runtime-native` from a published
release cannot run `threenative build --target desktop`.** It fails on the helper before it reaches
any of its own code. Finding exactly this is what a toolchain-free consumer proof is for.

Ownership: publishing a new runtime asset is PRD-262's contract, not this PRD's, so the durable fix
is handed there rather than taken here. Meanwhile the proof carries the helper as a **same-run**
artifact, which is the model this job already uses for every runtime payload it serves over
loopback, and the placement is asserted before the consumer build rather than after it. The claim
this supports is therefore "the packaged consumer path works when the helper is present", not "a
public installation works" — the latter stays false until PRD-262 publishes it.

Scope note: only `--target desktop` needs the helper. The packed Android build completed locally
without it, so the six Android controls are blocked by this only because the desktop build runs
first in the same job.

## Self-inflicted: a duplicate key made GitHub reject the whole workflow

The Phase 9 edit left `if-no-files-found` twice inside one `with:` block. `yaml.safe_load` accepts a
repeated key silently, so the local check passed; GitHub does not, and rejected the file before any
job started. Runs 34567513116 and 34568650504 therefore have **zero jobs** and report only "This run
likely failed because of a workflow file issue", which reads nothing like a duplicate key and cost
two cycles to attribute.

The duplicate is removed, and an indentation-aware guard now fails on any repeated key in any
mapping in the file. Red control: reintroducing the exact duplicate reports
`repeated keys: if-no-files-found (line 415)`; removing it passes 35/35. A parser that tolerates
what the consumer rejects is not a check, which is the same lesson as the earlier evidence in this
record.

## Hosted evidence and handoff

At this source-record commit, the new hosted proof has not yet produced native observations. Do not read the isolated results above as hosted acceptance. The workflow retains the following candidate-keyed records, including failure records:

- `release-prerequisites-<checkout-SHA>-<attempt>`: refusal-control output, exact main-CI metadata and row table, or explicitly PR-only scope; generated maintenance diagnostics.
- `runtime-<platform>` and `evidence-desktop-<platform>`: runtime payloads and existing platform-verifier evidence from this run.
- `clean-consumer-linux-x64`: desktop capture/log, each Android control log/exit and observation directory, APK hashes, packed tarballs, proof manifest and `proof-consumer-evidence.json`.

The evidence JSON records actual checkout SHA, workflow run ID and attempt at execution time. Assertion counts and hashes come from those outputs, never a proposed command or expected result. The generated maintenance output is restored after capture and is not substituted for the checked-out sources during validation.

Windows, macOS, Linux native, Android emulator and main exact-candidate acceptance remain unverified by this local record. iOS and physical Android are not claimed. Independent reviewer decision remains **PENDING**, not PASS. Keep PRD-078 PARTIAL and in production-readiness until actual candidate evidence and that review close its acceptance criteria.
