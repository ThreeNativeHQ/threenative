# CI has never been green, and that is the release blocker — 2026-08-29

## The finding

```console
$ gh run list --repo ThreeNativeHQ/threenative --workflow ci.yml --status success --limit 3
(no output)
```

**Zero successful CI runs exist.** Every run in the workflow's history is a failure. The batch
README recorded "CI is red on a stale tree" and named the 157-commit push gap; the push gap was
real, and it was hiding a larger fact — there was never a green run to go stale.

This is load-bearing for the whole release. `.github/workflows/native-release.yml`'s `gates` job
refuses to build unless a completed successful CI push run on `main` exists for the release commit.
No such run has ever existed, for any commit, which is why
`gh api repos/ThreeNativeHQ/threenative/releases` returns `0` and why `prebuilt-lock.json` is 404
for every version.

## What was failing

Local `main` at `ff7a0abb` is green — `pnpm typecheck` exit 0, `pnpm lint` exit 0, `pnpm test`
2585/2585. Pushed to CI, the same tree failed:

```text
✓ install    28s
✓ typecheck  1m50s
✓ lint       22s
X test       2m32s

FAIL tests/crash-handler-policy.test.mjs > the crash-handler decision is one pure function
AssertionError: .../packages/runtime-native/build/tn-linux/threenative-crash-handler-policy-test
is not built. Run: cmake --build build/tn-linux --target threenative-crash-handler-policy-test

FAIL tests/runtime-next-contract.test.mjs > Android preserves native crash evidence …
FAIL tests/timestamp-query.test.mjs > timestamp-query resolves a monotonic nonzero delta on 'V8' …
FAIL tests/timestamp-query.test.mjs > … on 'QuickJS' …

Test Files  3 failed | 84 passed (87)
Tests  4 failed | 613 passed | 39 skipped (656)
```

**The tests are right and the workflow was wrong.** `crashPolicyContractOutput` says so in a
comment: *"An unbuilt executable is unexecuted and says so — never a silent skip, which would read
as a pass."* That is PRD-229 Phase 5's thesis and the repository's fail-closed rule. These four
tests pass on this machine only because the native host is built here. The CI `test` job installed
Node dependencies and Chromium and never compiled a line of C++, so the four could never pass — and
because they can never pass, no run could ever be green.

That is also why the failure was invisible: a developer with a local native build sees green, and
the workflow that sees red is one nobody had a green baseline for.

## The change

`.github/workflows/ci.yml`, `test` job: `ubuntu-latest` → `ubuntu-24.04` (matching the release
workflow's desktop runner), `timeout-minutes` 20 → 90, and three steps before `pnpm test` —
the Linux desktop build dependencies the release workflow already installs, a cache keyed on
`download-deps.mjs` for `packages/runtime-native/third_party`, and
`pnpm --filter @threenative/runtime-native native:build`.

Skipping the four tests when the executable is absent was considered and rejected: it would make CI
green by teaching the suite to report a pass for a platform it did not execute, which is the exact
failure the repository's verification rules exist to prevent.

## Status

Filed with the change pushed. **The proof of this record is a green CI run on `main`, and that run
is what this record is waiting for** — the native build's real duration on a runner is not known
until it executes, and the 90-minute budget is an estimate, not a measurement. Until a green run
exists, this record claims a diagnosis and a change, not a result.
