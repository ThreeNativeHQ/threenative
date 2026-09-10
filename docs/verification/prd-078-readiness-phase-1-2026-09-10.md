# PRD-078 readiness phase 1 — 2026-09-10 (closeout)

**Status: PASS (source-gate scope).** The release prerequisite gate and Android
shell-guard controls are implemented, red-green proven, and reviewed. Hosted
`native-release.yml` execution remains NOT RUN by phase design (tag-triggered
publishing lane; no tag was pushed in this phase). This record hands the exact
candidate identity to PRD-262 without claiming release proof.

## Scope and source identity

CI/native-host layer. PRD: [PRD-078](../PRDs/production-readiness/PRD-078-toolchain-free-consumer-proof.md).
PR: [ThreeNativeHQ/threenative#168](https://github.com/ThreeNativeHQ/threenative/pull/168).

- Candidate SHA: `81fe46c004f652d7145d965c9b777fb57e96902a` (PR head after merge with `origin/main` at `2950765d4`).
- Base for the gate behavior: PR commits `9d8bcf3fd` (gate + 4th control), `064e89838` (API-path assertion), closeout `c8f9765a8` (harness repair), `33211faf2` + merge `81fe46c00` (main sync + regenerated digests).
- Files changed vs `origin/main`: `.github/workflows/native-release.yml`, `packages/runtime-native/tests/native-platform-workflow.test.mjs`, `scripts/__tests__/ci-structure.spec.ts`, plus the two gate-mandated generated files (`docs/verification/native-coverage-2026-08-28.md` digest refresh, `docs/benchmark/SCREENSHOT-RETENTION.md` index refresh) and this record.

Only the existing `gates` job and the existing packed-Android block change. Job graph
(`validate-tag, gates, build, build-android, build-ios-simulator, publish,
clean-consumer, clean-consumer-ios, finalize, cleanup-failed-release`) is otherwise
byte-identical. Publishing and iOS lanes are untouched. No tag, release, package
publication, or new consumer lane was created in this phase.

## Implementation

The checkout-free `gates` job requires a completed successful main-push CI run at the
exact source SHA, then revalidates the selected run via `gh run view`, pages all CI jobs
via `gh api --paginate --slurp`, and rejects incomplete pagination, malformed/duplicate
job IDs, cross-run/cross-SHA rows, and any missing or non-successful required job:

- `typecheck`, `lint`, `test`, `budgets`, `build`, `test-native`
- `native-platforms / Windows desktop core`
- `native-platforms / macOS desktop core`
- `native-platforms / Scaffolded starter desktop artifact`
- `native-platforms / Desktop web/native parity`
- `native-platforms / Android emulator visual parity`

A skipped, cancelled, neutral, queued, or unfinished required job is never accepted.
Prerequisite JSON, validation report, exit status, and a linked job summary are retained
as attempt-specific artifacts even on failure. Desktop diagnostics upload on failed
verification; runtime asset uploads stay success-gated.

The Android consumer keeps the dedicated `examples/native-smoke/src/physics.ts` subject
and now exercises six emulator invocations — two positives and four negatives, each a
single shell line, each negative requiring exit 1 plus its exact marker:

| Build control | Scenario | Required result | Artifact suffix |
| --- | --- | --- | --- |
| normal | `physics.playtest.json` | exit 0 | `packed-android-physics` |
| normal | `physics-wrong-height.playtest.json` | exit 1 + `TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED` | `packed-android-wrong-height` |
| normal | `physics-mask.playtest.json` | exit 1 + `TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED` | `packed-android-mask-control` |
| masked | `physics-mask.playtest.json` | exit 0 | `packed-android-mask-pass` |
| masked | `physics.playtest.json` | exit 1 + `TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED` | `packed-android-masked-physics-control` |
| wrong-gravity | `physics.playtest.json` | exit 1 + `TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED` | `packed-android-wrong-gravity` |

Closeout repairs (committed on this branch, reviewed): `spawnSync('bash', ['-c',
'set -euo pipefail\n…'])` in all three test harnesses (separate `-euo` argv entries
mis-split bash's `$0`/script arguments); `FORCE_COLOR=0` on the run-picker `node`
(`console.log(databaseId)` is machine-parsed and ANSI-poisons under colored
environments); `gh`-stub subcommand index `$2` (was `$3`).

## Executed evidence (this worktree, merged tree)

```text
pnpm --filter @threenative/runtime-native exec vitest run tests/native-platform-workflow.test.mjs
  Test Files 1 passed (1); Tests 30 passed (30)
pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts
  Test Files 1 passed (1); Tests 83 passed (83)
pnpm typecheck   -> pass (workspace-wide, post-build)
pnpm lint        -> pass (2099 files, 676 warnings, no errors)
pnpm budgets     -> exit 0 (evidence budget ok; retention index fresh)
```

Red-green: on the pre-fix harness the six gate tests failed (wrong-SHA-accepted,
missing-job-accepted, color-poisoned run ID); post-fix all 30 pass. The pre-existing
runtime-native contract reds (18, native-host dependent) are unchanged by this lane —
verified by baseline-vs-fix failing-set diff.

Hosted CI on the candidate SHA: PR CI run `34528782083` (event `pull_request`,
`81fe46c0`) completed with `budgets`, `build`, and all `native-platforms` legs green,
including `Android emulator visual parity` (success) — i.e. the current hosted
platform evidence for this exact source. `Desktop web/native parity` skipped by lane
policy on pull requests (runs on main/nightly/`native`-labelled runs), named here as
the unavailable row. The run's single failure is `test-unit (3/3)`: exactly one test,
`scaffold-mcp.spec.ts` "runs the published anyCreature loop" (`MCP initialize timed
out`), a main-side file last touched by #170/#174 that also fails on main CI runs
`34516862973`/`34481103377` — pre-existing flake, not this lane. Rerun record:
`34528725950` queued at time of writing.

## Negative controls (executed, not asserted-only)

- Wrong-SHA refusal: observed main-CI run `34437894675` (SHA `6972d87c…`) supplied as the
  candidate for synthetic SHA `a…a` → gate exits 1 naming the candidate. In-test.
- Absent/invalid run identity (empty list, null/string/zero/negative/fractional
  `databaseId`) → exit 1 naming the candidate. In-test.
- Every missing required job against an otherwise-green run → exit 1 naming the job.
  In-test, all 11 names.
- Skipped/cancelled/failed/unfinished per-job states → exit 1. In-test.
- Crossed evidence (list run ≠ detail run, job `run_id`/`head_sha` mismatch, duplicate
  IDs, `total_count` mismatch) → exit 1. In-test.
- `gh` query failures (list/view/jobs) → exit 1 with prerequisite diagnostics retained.
  In-test.
- Sixteen Android shell exit/marker combinations (4 controls × [right-wrong exit,
  right exit/wrong marker, nonzero variants]) → guard exits 0 only on exit-1-plus-marker.
  In-test; emulator physics proper remains hosted-only (see NOT RUN below).

## Independent review

Verdict **BLOCKED-as-scoped** (code correct on all six executed checks; phase cannot
close until hosted release proof exists), returned by an independent read-only reviewer
with no author context. Findings: caller integration PASS, wrong-SHA refusal PASS, four
Android negatives with exact markers in the workflow PASS, publishing/iOS unchanged PASS,
closeout fixes correct PASS, digest refresh byte-verified PASS. Non-blocking notes: the
`NB:` comment prose in the test file, the tightly-scoped `ci-structure` API-path
exemption, and the 6-file vs 5-file budget (extras are gate-mandated generated files).

## NOT RUN / handed to PRD-262

- No `native-release.yml` run exists for the candidate SHA (tag-triggered lane; no tag
  pushed — phase boundary, not an omission). No release-candidate dispatch was performed.
- The six emulator invocations above are shell-guard-proven only; actual hosted Android
  assertion-failure output for all four negatives plus both positives must be observed on
  the release lane and handed to PRD-262 with immutable run/artifact identities.
- iOS remains out of batch scope; no iOS readiness credit created or removed.
- `test-unit (3/3)` anyCreature MCP-timeout flake: pre-existing, main-side, unrelated;
  recorded, not fixed here.
