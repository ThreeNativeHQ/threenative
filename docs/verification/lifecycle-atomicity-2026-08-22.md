# Verification — PRD-180 core lifecycle failure atomicity (2026-08-22)

Lane: lane-core. Files touched: `packages/core/src/game.ts`,
`packages/core/__tests__/game.spec.ts` only. Commits: `e93adb5c` (phase 1),
`92469871` (phase 2), `3e78f5c6` (phase 3).

## Gates

| Gate | Result |
| --- | --- |
| `pnpm exec vitest run packages/core/__tests__/game.spec.ts` | 31 passed (31), all phases green |
| `pnpm exec tsc -p packages/core --noEmit` | exit 0 after every phase |
| `pnpm exec biome check packages/core/src/game.ts packages/core/__tests__/game.spec.ts` | exit 0; 3 non-fatal complexity warnings (`#boot` 43 pre-existing, `#teardown` 20 after the guards, `onRender`) — warnings only, per repo quality policy |
| Abyss web playtest regression (port 5181, `--browser-recipe webgpu`, `--headed`, via `sh scripts/xvfb.sh`) | scenario `framework-movement`: `"pass": true`; `movement.distance` 28.61 ≥ 10; consoleErrors 0; networkErrors 0; runtimeReady true |

Not run here: full workspace `pnpm test` / `pnpm typecheck` / `pnpm lint` (the coordinator runs
them between waves) and any native lane (pure engine-unit semantics change; PRD notes no
observable healthy-game behavior difference on web).

## Phase 1 — teardown attempts every cleanup

Red before implementing:

```
FAIL ... should run every cleanup when an earlier cleanup throws
AssertionError: expected [ 'first' ] to deeply equal [ 'first', 'second' ]
  [ "first", - "second" ]
❯ packages/core/__tests__/game.spec.ts:443:20
```

```
FAIL ... should report the first failing cleanup, not the leak check, when both would fire
AssertionError: expected +0 to be 1 // Object.is equality
❯ packages/core/__tests__/game.spec.ts:491:22   (expect(disposed).toBe(1))
```

(The second red's meaning: with first-throw-wins, `stop()` surfaced the cleanup message but by
aborting teardown outright — renderer.dispose never ran. An earlier draft asserted
`expect(game.ctx).toBeUndefined()` directly and vitest's diff printer crashed walking the live
ctx into the renderer's fail-closed `info` getter; assertions were reordered to scalars so the
red is legible.)

Mutation proofs:
- Reverted exactly the cleanup-loop guard in `#teardown`
  (`for (...) cleanup();` unguarded) → test 1 red at the events assertion: second spy absent.
- Restored leak-check precedence over collected errors (leak check throws before
  `throw failures[0]`) → test 2 red: got `IGame teardown leaked scene objects.` instead of the
  cleanup's message.

## Phase 2 — thrown boots roll back like aborted boots

Reds before implementing (both tests):

```
AssertionError: expected [] to deeply equal [ 'cleanup' ]
❯ packages/core/__tests__/game.spec.ts:538:22   (plugin.setup throws)
❯ packages/core/__tests__/game.spec.ts:587:20   (scene.load rejects)
```

Meaning: `start()` rejected with the plugin/scene error but zero rollback happened — no cleanup
ran, renderer undisposed.

Mutation proofs:
- Reverted the plugin-setup guard to the bare assignment → test 1 red again at `events`.
- Reverted the scene.load wrapper to bare `await scene.load(ctx);` → test 2 red again.
Rethrow identity pinned with `rejects.toBe(boom)`; abort-path pins
(`should dispose plugins exactly once when stopped during setup`,
`should leave no renderer or loop when stopped during an in-flight start`) stayed green
throughout.

## Phase 3 — goto validates before it wipes

Red before implementing:

```
AssertionError: expected { score: +0 } to deeply equal { score: 42 }
❯ packages/core/__tests__/game.spec.ts:1226:35
```

Mutation proof: moved the store reset back before the validation (exact pre-fix ordering) → same
red reproduced. Fix restored → green; existing pin `should throw when goto names an unknown
scene` (ctx.goto path) unaffected.
