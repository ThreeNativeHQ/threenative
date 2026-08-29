# PRD-229 Phase 5 — the crash-policy source-text assertions become behaviour tests, 2026-08-29

**Lane A of [the release batch](../PRDs/batch-2026-08-29/README.md).** Two files converted, the
first two of Phase 5's scope. Executed on `main` at `c94942d6`, machine `linux-x64`, no device.

## The red

`pnpm test` aborted in `package-test` at `@threenative/runtime-native`, so the root `unit` phase
never ran on `8491c5d5`:

```text
 Test Files  2 failed | 87 passed (89)
      Tests  2 failed | 620 passed | 34 skipped (656)

 FAIL  tests/crash-handler-policy.test.mjs > the crash-handler decision is one pure function, not a scattered ifdef
AssertionError: the decision must be a pure function so it can be proven without crashing a process
 FAIL  tests/runtime-next-contract.test.mjs > Android preserves native crash evidence and QuickJS reports each evaluation boundary
AssertionError: Android must preserve the original signal for debuggerd tombstones
```

**Neither behaviour changed.** Commit `8ff06738` added a third parameter (`bool sanitizerBuild`) to
`crashHandlerPolicy` and clang-format wrapped the ternary across two lines. The assertions demanded
a two-argument signature and `androidPlatform ? CrashHandlerPolicy::LeaveToPlatform` on one line.
Android still resolves to `LeaveToPlatform`.

This is Phase 5's thesis observed in the wild: the suite red on a safe reformat.

## What the assertions were really protecting

| Deleted assertion | The property | Where it is now proved |
|---|---|---|
| `crashHandlerPolicy(bool androidPlatform, const char* showCrashDialogEnv)` matched as text | the decision is a *pure function*, callable with a platform argument rather than compiled into one — which is what makes it provable without crashing a process | the executable calls it with both values and checks the result |
| `androidPlatform ? CrashHandlerPolicy::LeaveToPlatform` matched as text | Android never reaches an install branch | `PASS Android with no MYSTRAL_SHOW_CRASH_DIALOG leaves the handlers to the platform` |
| `crashHandlers` matched against `/LeaveToPlatform/` | the applier honours the Android policy | `PASS the Android policy leaves SIGSEGV chained to debuggerd's stand-in`, observed through `sigaction(2)` |

The behaviour test already existed: `tests/crash_handler_policy_test.cpp`, built as
`threenative-crash-handler-policy-test` and registered by `tn_register_contract_test`. It stands a
`sigaction` handler in for debuggerd, applies each policy, and reads the disposition back. Nothing
new was written — the vitest files now **drive** it instead of regexing its subject. An unbuilt
executable calls `assert.fail` naming the `cmake --build` line; it is never a silent skip.

## The two negative controls Phase 5 requires

### (a) Rename the C++ symbol → the test stays green

`sed -i 's/\bandroidPlatform\b/isAndroidPlatform/g' include/mystral/platform/crash_policy.h`,
rebuild, run. This is the exact edit that would have reddened the deleted assertion.

```text
 Test Files  2 passed (2)
      Tests  34 passed | 2 skipped (36)
```

### (b) Break the behaviour → the test goes red

`Android -> CrashHandlerPolicy::SuppressDialog`, rebuild, run.

```text
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/crash-handler-policy.test.mjs > the crash-handler decision is one pure function, not a scattered ifdef
Error: Command failed: .../build/tn-linux/threenative-crash-handler-policy-test
FAIL Android with no MYSTRAL_SHOW_CRASH_DIALOG leaves the handlers to the platform
FAIL Android with MYSTRAL_SHOW_CRASH_DIALOG=1 still leaves the handlers to the platform
FAIL Android still names debuggerd, not the sanitizer
 FAIL  tests/runtime-next-contract.test.mjs > Android preserves native crash evidence and QuickJS reports each evaluation boundary
Error: Command failed: .../build/tn-linux/threenative-crash-handler-policy-test
```

The header was restored from a backup and `git diff` on it is empty. A test that passes (a) and
fails (b) is a behaviour test; one that fails (a) is a text assertion wearing a costume.

## The green

```text
 Test Files  89 passed (89)
      Tests  622 passed | 34 skipped (656)
```

`build/tn-linux`, `cmake --build --target threenative-crash-handler-policy-test`, exit 0.

## The root `unit` phase, run for the first time on this HEAD

With `package-test` green, `pnpm test` reached the phase the abort had been hiding. It found two
failures in 2552 tests, and **both are timeouts, not assertions**:

```text
 FAIL  scripts/__tests__/temp-dir-guard.spec.ts > requires every test-owned temporary directory to register cleanup
Error: Test timed out in 5000ms.
 FAIL  packages/core/__tests__/build.spec.ts > should bundle a usable import-meta declaration for the hot subpath
Error: Test timed out in 15000ms.

 Test Files  2 failed | 254 passed (256)
      Tests  2 failed | 2550 passed (2552)
```

Re-run alone on a quiet machine, both pass with room to spare:

```text
 ✓ scripts/__tests__/temp-dir-guard.spec.ts (1 test) 1078ms
 ✓ packages/core/__tests__/build.spec.ts (2 tests) 6596ms
     ✓ should bundle a usable import-meta declaration for the hot subpath  5123ms
 Test Files  2 passed (2)
```

1.08 s against a 5 s budget and 5.12 s against a 15 s one. Under the full suite's parallelism —
`tests 508.22s` of CPU inside 83.81 s of wall clock — both exceed it. **This is a timeout budget
that the suite's own concurrency exhausts, not a defect in either subject.** It is left as found:
naming it belongs to this record, fixing it does not belong to Lane A.

## Two traps this lane hit, recorded so the next one does not

1. **Committing while `pnpm test` runs aborts it.** The lease guard compares HEAD across phases and
   refused the `unit` phase with `TN_WORKTREE_GUARD_FAILED: phase 'unit' — worktree HEAD changed
   from c94942d6 to 6c9442e0`. Every package suite had already passed. The repository also tells
   agents to commit as they go, because siblings overwrite; the two rules collide exactly here, and
   the resolution is to commit between gates, never during one.
2. **`bash scripts/run-test-suite.sh --resume --phase unit` fails with `vitest: command not
   found`.** The script calls bare `vitest`, which is only on `PATH` under pnpm's bin injection.
   `pnpm exec bash scripts/run-test-suite.sh --resume --phase unit` works.

## What this does not claim

- **Phase 5 is not finished.** Two files of its scope are converted; the remaining source-text
  assertions in this package are untouched, including two in `crash-handler-policy.test.mjs` that
  read `crash_handlers.cpp` and are currently green. They red on the next reformat and belong to
  [the refactor batch](../PRDs/refactor-2026-08-28/README.md), not to this one.
- **The `runtime.cpp` assertions in the converted test were kept**, deliberately: they assert the
  *absence* of `signal(SIGSEGV, ...)` calls, which no executable can observe, and they were not red.
- No device, no Android build, and no CI run is claimed here.
