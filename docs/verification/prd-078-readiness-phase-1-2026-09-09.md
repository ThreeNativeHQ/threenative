# PRD-078 readiness phase 1 — 2026-09-09

**Status: PARTIAL.** The release prerequisite and Android shell-guard regressions below
were reproduced and fixed. Exact-candidate hosted native-release acceptance and independent
review remain **NOT RUN**. This record is not a release approval or platform qualification.

## Scope and source identity

CI/native-host layer, against main commit
`6972d87c1881a021afb041f44d4fcddcb469e971`. The supplied specification is
[PRD-078](../PRDs/production-readiness/PRD-078-toolchain-free-consumer-proof.md).
Only the existing native-release workflow, its existing workflow test file, and this record
change. No new publisher, consumer lane, runtime implementation, tag, release, or package
publication was created. PRD-262 still owns artifact/installation proof; PRD-060 owns promotion.

The original workflow and test snapshots were obtained through the connected GitHub API and
verified byte-for-byte using Git blob hashes before editing:

| File | Original blob | Patched blob |
| --- | --- | --- |
| `.github/workflows/native-release.yml` | `50e230776587dba1362559d7a972b0f7eddf3ec4` | `1554a7659d00048aaedf2a5fde3020782d0c429e` |
| `packages/runtime-native/tests/native-platform-workflow.test.mjs` | `4a05539bd1dc167cd4b16de59ced829505ab8ec4` | `f5e3f825b47474e6de31ab32d769955da9437d87` |

## Hosted observations, not candidate acceptance

Observations were made on September 9 Vancouver time (September 10 UTC).
[Main CI run 34437894675](https://github.com/ThreeNativeHQ/threenative/actions/runs/34437894675)
was completed/success, event `push`, branch `main`, at the base SHA above. Its job summaries
reported successful `test-native`, Windows/macOS desktop, Linux starter/desktop parity, and
Android emulator visual parity. The jobs API wrapper returned only its first page; this is
not an assertion that every job or artifact was independently inspected.

The exact-SHA Actions run query returned two runs: that CI run and a separate failed site
run. Neither was `native-release.yml` or a release-candidate producer. The historical
[run 31965691750](https://github.com/ThreeNativeHQ/threenative/actions/runs/31965691750)
returned HTTP 404, so its failed subject/logs could not be fetched or safely retried.
No unrelated successful run was rerun or relabeled as release evidence.

The current native-release workflow is tag-triggered and publishes a prerelease before its
clean consumers run. Running it just to obtain proof would cross phase 1's no-publication
boundary. No such dispatch/tag/publication was performed. There is **no new hosted release
candidate/run identity to hand to PRD-262 yet**; the base CI identity is not a substitute.

## Implementation and preserved boundaries

The checkout-free `gates` job still requires a completed successful main-push CI run at the
exact source SHA. It now revalidates the selected run and collects all latest job pages using
`gh api --paginate --slurp`, rejecting incomplete page counts, malformed/duplicate job IDs,
cross-run/cross-SHA rows, and any missing or non-successful required job. Required names are
`typecheck`, `lint`, `test`, `budgets`, `build`, `test-native`, plus the existing Windows,
macOS, Linux starter, desktop parity, and Android emulator jobs under `native-platforms`.
A skipped, cancelled, neutral, queued, or unfinished required job is never accepted.

The job retains raw run/job responses, validation JSON, exit status, and a linked job summary.
Its diagnostic artifact includes the release run attempt in its name, retaining earlier
attempts rather than overwriting them. Desktop diagnostic upload also runs after a failed
verification; runtime asset uploads remain success-gated. No refusal was converted to a warning.

The Android consumer still builds the dedicated `examples/native-smoke/src/physics.ts`
subject. The missing fourth negative invokes the normal physics assertions against the
masked build, after its mask-positive check and before rebuilding with wrong gravity.
Each invocation remains a single shell line for the emulator action's execution model.

| Build control | Scenario | Required result | Retained artifact suffix |
| --- | --- | --- | --- |
| normal | `physics.playtest.json` | exit 0 | `packed-android-physics` |
| normal | `physics-wrong-height.playtest.json` | exit 1 + `TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED` | `packed-android-wrong-height` |
| normal | `physics-mask.playtest.json` | exit 1 + `TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED` | `packed-android-mask-control` |
| masked | `physics-mask.playtest.json` | exit 0 | `packed-android-mask-pass` |
| masked | `physics.playtest.json` | exit 1 + `TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED` | `packed-android-masked-physics-control` |
| wrong-gravity | `physics.playtest.json` | exit 1 + `TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED` | `packed-android-wrong-gravity` |

All six **native/emulator invocations above are NOT RUN for this change**. Their actual
expanded commands are retained in the workflow. Locally executing their shell guards with
a stub CLI verifies only the exit/marker policy, not collision behavior or native frames.

Parsed-job comparison confirmed that `validate-tag`, `build-android`, `build-ios-simulator`,
`publish`, `clean-consumer-ios`, `finalize`, and `cleanup-failed-release` are unchanged.
The existing ten-job graph, package preflight, Vulkan/MSVC fixes, iOS boundaries, release
promotion, and failed-release cleanup remain intact.

## Executed local regression evidence

Environment: Linux sandbox, Node `v22.16.0`, Bash, PyYAML `6.0.3`. GitHub DNS resolution
prevented a clone; neither `pnpm` nor `gh` was available. This was an isolated source snapshot,
not an installed workspace. No framework package versions, tarball integrities, native binary
hashes, screenshots, GPU adapters, or physical-device results were measured.

The ten new contract bodies were extracted verbatim from the test file between the PRD-078
comments. They were run using `node:test` and real `node:assert/strict`, with Node temporary
directories replacing the repository's Vitest-managed temporary-directory lifecycle. The
production shell/inline Node code was extracted from the actual YAML, not reimplemented.
Only external GitHub responses and the Android CLI process were stubbed. The synthetic
candidate is forty `a` characters; its run ID `123` is a fixture, never hosted proof.

```text
node --test /mnt/data/prd-078/contracts.test.mjs
RED, original workflow: tests 10; pass 2; fail 8; exit 1
  missing required job: expected exit 1, received 0
  completed/skipped required job: expected exit 1, received 0
  Android negative invocation count: expected 4, received 3
GREEN, patched workflow: tests 10; pass 10; fail 0; exit 0

WORKFLOW=/mnt/data/prd-078/source/.github/workflows/native-release.yml \
  node --test /mnt/data/prd-078/contracts.test.mjs
REVERT RED: tests 10; pass 2; fail 8; exit 1

node --test /mnt/data/prd-078/contracts.test.mjs
RESTORED GREEN: tests 10; pass 10; fail 0; exit 0
FINAL GREEN: tests 10; pass 10; fail 0; skipped 0; exit 0
  executed_node_assertions=227
```

The final assertion count was measured by a forwarding proxy around Node's real assertion
methods. The existing wrong-SHA refusal passed before and after this change; it was preserved,
not falsely reported as a new fix. Coverage includes every absent required job, non-success
states, malformed/missing identities, crossed evidence, pagination, API errors, retained
failure diagnostics, and sixteen Android shell exit/marker combinations.

Additional executed checks: `node --check` on the changed test file and both embedded gate
scripts; YAML parsing; `bash -n` on the gate and every emulator script line; legacy timeout
and consumer upload assertions; parsed equality for the preserved jobs listed above. All
passed. These checks do not stand in for the full repository lint/typecheck/test gates.

## Required gates and handoff

```text
pnpm --filter @threenative/runtime-native exec vitest run \
  --config vitest.config.ts tests/native-platform-workflow.test.mjs
  -> pnpm: command not found; exit 127
pnpm typecheck && pnpm lint && pnpm test
  -> pnpm: command not found; exit 127 (later commands not executed)
pnpm budgets
  -> pnpm: command not found; exit 127
gh run list --repo ThreeNativeHQ/threenative --workflow native-release.yml --limit 10
  -> gh: command not found; exit 127 (connected API observations recorded above)
```

**Independent reviewer decision: PENDING / NOT RUN.** No independent reviewer or reviewer
PASS is claimed. No PRD acceptance checkbox is closed by this record. Before phase 1 can be
accepted, run the required workspace gates, obtain the authorized exact-candidate hosted
release/non-iOS job and artifact identities, inspect all four actual Android assertion-failure
controls and both positives, and obtain independent review. Hand those immutable identities
to PRD-262 without treating the local fixture or the older main CI run as release proof.
