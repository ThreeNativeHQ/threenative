# PRD-254 V8 lifetime lane rejection — 2026-08-30

Baseline: `2a6b0b50`  
Source lane: `e5d46a9bc951fdf7c3afcaa7355462a64185fb2d`  
Rebased candidate: `3de67407`  
Disposition: **REJECT — do not merge or retry the lifetime-held entry**

## What ran

The stale one-commit lane was replayed in
`.worktrees/feature-mining-prd254-v8-lifetime-20260830`. Its only conflict was an obsolete native
LOC census; current main counts were retained.

```sh
pnpm exec vitest run --config vitest.config.ts \
  tests/js-engine-fast-path.test.mjs tests/js-engine-version-skew.test.mjs
```

Result: exit 0, 2 files and 12 tests passed.

The required mutation replaced the two engine-lifetime `.emplace(...)` calls with constructor-local
V8 scopes. `tests/js-engine-fast-path.test.mjs` then exited 1 with one failed test:

```text
host methods share the engine-lifetime V8 isolate and context entry
AssertionError: input did not match /engineIsolateScope_\.emplace\(isolate_\)/
Test Files 1 failed (1)
Tests 1 failed | 4 passed (5)
```

The exact mutation was reverted and the 12-test command returned green.

```sh
pnpm native:build
cmake --build packages/runtime-native/build/tn-linux \
  --target threenative-js-engine-contract-test
packages/runtime-native/build/tn-linux/threenative-js-engine-contract-test
```

Both commands exited 0. The compiled V8 13.1.201.22 contract reported:

```text
js-engine-contract: engine=V8 property=own-data global=assignment \
  nested=return+exception+cleanup+reentrant entry=held
```

QuickJS and JSC were reported as uncompiled and were not counted as passes.

## Decisive production failure

`node packages/runtime-native/scripts/verify-native-contracts.mjs` failed two targets. The relevant
failure was `threenative-worker-production-test`: while exercising concurrent V8 workers, it caught
`SIGSEGV`. Running that executable alone reproduced the same segfault during worker teardown.

The control changed only `v8_engine.cpp` back to main's conditional per-call `V8EntryScope`, rebuilt
the affected target, and ran the identical executable:

```sh
cmake --build packages/runtime-native/build/tn-linux \
  --target threenative-worker-production-test
packages/runtime-native/build/tn-linux/threenative-worker-production-test
```

Result: exit 0. All 11 named worker contracts passed, followed by:

```text
[worker-production] every worker contract held
WORKER_CONTRACT registryReopensForASecondRuntime PASS
```

This same-build A/B causally rejects the candidate. The other suite failure,
`threenative-bindings-creation-test`, reported `proof: creation-refusal`; it is outside this V8
entry change and is not claimed green or diagnosed here.

## Not executed

- Physical Pixel 8 performance: no physical device was attached; `adb devices -l` exposed only
  `emulator-5554`.
- Full repository typecheck, lint, test, budgets, templates, and visuals: not run because the
  production worker contract already rejects the candidate.
- Sandbox mini game/playtest: not applicable. The sandbox-validation contract explicitly excludes
  internal refactors with no observable gameplay behavior.
- Merge to main: prohibited by the reproducible production segfault.
