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

## What this does not claim

- **Phase 5 is not finished.** Two files of its scope are converted; the remaining source-text
  assertions in this package are untouched, including two in `crash-handler-policy.test.mjs` that
  read `crash_handlers.cpp` and are currently green. They red on the next reformat and belong to
  [the refactor batch](../PRDs/refactor-2026-08-28/README.md), not to this one.
- **The `runtime.cpp` assertions in the converted test were kept**, deliberately: they assert the
  *absence* of `signal(SIGSEGV, ...)` calls, which no executable can observe, and they were not red.
- No device, no Android build, and no CI run is claimed here.
