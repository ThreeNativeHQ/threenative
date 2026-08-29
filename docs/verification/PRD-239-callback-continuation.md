# PRD-239 callback continuation verification

Status: **implementation verified; native runtime execution unverified**. This lane adds
source-contract proof only. The predecessor wheel sign and browser-consumer behavior remain
unchanged.

## Contract proved

`packages/runtime-native/tests/input-multitouch.test.mjs` now proves the complete native wheel
handoff:

- `processMouseWheel` assigns every `WheelEventData` field (`type`, `clientX`, `clientY`, `deltaX`,
  `deltaY`, `deltaZ`, `deltaMode`, `ctrlKey`, `shiftKey`, `altKey`, and `metaKey`) before invoking
  `g_wheelCallback(data)`.
- The runtime's registered wheel callback invokes `dispatchWheelEvent(e)`.
- `dispatchWheelEvent` sends the event to document, window, and canvas listener tables.

The SDL event route and real conformance scene listener remain asserted. No native target was
executed in this lane.

## Required negative controls

Both controls used the exact focused command from the source PRD, went red, and were restored
immediately before the green runs.

### `native-wheel-callback`

Temporary mutation: remove `g_wheelCallback(data);` from `processMouseWheel`.

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/input-multitouch.test.mjs -t 'native scroll conformance records the host source contract'
AssertionError: native wheel callback handoff is absent
Tests 1 failed | 11 skipped (12)
exit_code=1
```

### `native-wheel-dispatch`

Temporary mutation: remove the canvas `dispatchToListeners` call from `dispatchWheelEvent`.

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/input-multitouch.test.mjs -t 'native scroll conformance records the host source contract'
AssertionError: native wheel listener dispatch handoff is absent
Tests 1 failed | 11 skipped (12)
exit_code=1
```

## Repair regression

Temporary mutation: move `data.deltaY = event.y * -120.0;` below `g_wheelCallback(data);`.
The strengthened focused source-contract test went red before the source was restored:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/input-multitouch.test.mjs -t 'native scroll conformance records the host source contract'
AssertionError: native wheel callback handoff is absent
Tests 1 failed | 11 skipped (12)
exit_code=1
```

## Restored evidence

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/input-multitouch.test.mjs -t 'native scroll conformance records the host source contract'
Test Files  1 passed (1)
Tests 1 passed | 11 skipped (12)
exit_code=0

$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/input-multitouch.test.mjs
Test Files  1 passed (1)
Tests 12 passed (12)
exit_code=0

$ pnpm exec vitest run packages/core/__tests__/input.spec.ts
Test Files  1 passed (1)
Tests 42 passed (42)
exit_code=0
```

## Lane gates

| Gate | Result | Exact command/result |
| --- | --- | --- |
| Typecheck | PASS | `pnpm typecheck` — exit 0; all 16 of 17 workspace projects completed. |
| Budgets | PASS | `pnpm budgets` — exit 0; `budgets ok`; framework/native LOC triggers are report-only. |
| Changed-file Biome | PASS | `pnpm exec biome check packages/runtime-native/tests/input-multitouch.test.mjs` — exit 0; one file checked, no fixes applied. |
| Committed diff check | PASS | `git diff HEAD^ HEAD --check` — exit 0; no output. |

The fresh worktree required `pnpm install --frozen-lockfile` (exit 0) and the repository
`pnpm build` bootstrap (exit 0) before typecheck could resolve generated workspace declarations.

`pnpm lint` remains red on five pre-existing cognitive-complexity errors and 447 warnings in
unrelated files. `pnpm test` stops in the existing documentation-link check on stale links in
`docs/PRDs` and the predecessor `docs/verification/PRD-239.md`; neither failure involves this
lane's two files.

Native runtime execution is **UNVERIFIED**: no desktop, Android, or iOS target executed. The
source-contract suite is the only native evidence recorded here.
