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

## Hosted evidence and handoff

At this source-record commit, the new hosted proof has not yet produced native observations. Do not read the isolated results above as hosted acceptance. The workflow retains the following candidate-keyed records, including failure records:

- `release-prerequisites-<checkout-SHA>-<attempt>`: refusal-control output, exact main-CI metadata and row table, or explicitly PR-only scope; generated maintenance diagnostics.
- `runtime-<platform>` and `evidence-desktop-<platform>`: runtime payloads and existing platform-verifier evidence from this run.
- `clean-consumer-linux-x64`: desktop capture/log, each Android control log/exit and observation directory, APK hashes, packed tarballs, proof manifest and `proof-consumer-evidence.json`.

The evidence JSON records actual checkout SHA, workflow run ID and attempt at execution time. Assertion counts and hashes come from those outputs, never a proposed command or expected result. The generated maintenance output is restored after capture and is not substituted for the checked-out sources during validation.

Windows, macOS, Linux native, Android emulator and main exact-candidate acceptance remain unverified by this local record. iOS and physical Android are not claimed. Independent reviewer decision remains **PENDING**, not PASS. Keep PRD-078 PARTIAL and in production-readiness until actual candidate evidence and that review close its acceptance criteria.
