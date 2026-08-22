---
prd_contract: v1
---

# PRD-180 — Core lifecycle is failure-atomic on every path, not just the abort path

**Status:** OPEN, 2026-08-22. Filed from the 2026-08-22 area scorecard (findings #7, #10; core
scored 70/100). Evidence verified at HEAD `a84f08da` by two independent passes — including a
correction: boot rollback exists for **abort** paths (`#aborted` checks + tested in
`game.spec.ts:326-354`) but NOT for thrown plugin/scene failures.

Complexity: 4 → MEDIUM mode (one file carries nearly all of it; the subtlety is semantics, not
surface).

**Outcome:** when any part of starting fails, or any cleanup throws while stopping, the game ends
in the same state `stop()` would have produced: canvas unmounted, listeners gone, renderer
disposed, every registered cleanup attempted. And a typo'd `goto` no longer wipes live state.

**Layer:** engine bug — `packages/core/src/game.ts`.

## Context (verified evidence)

1. **Throw-paths during boot leak partial state.** In `game.ts`, `await plugin.setup?.(ctx,
   runtime)` (~`:596-606`), `await scene.load(ctx)` (~`:612`) and `this.#enterScene(scene, ctx)`
   (~`:617`) are uncaught. A rejection leaves the renderer created (`:401-411`), canvas mounted
   (`:414-421`), InputMap listening (`:430-436`), and the store started (`:437`). Only the
   stop-during-boot abort path tears down.
2. **Teardown is first-throw-wins.** The plugin dispose loop (~`:667-668`) and the cleanup loop
   (~`:670`) run unguarded: one throwing dispose skips every later release — exactly the scenario
   teardown exists for — and can mask the original error with the fail-closed leak-check throw at
   the end.
3. **`goto()` resets before validating** (~`:336-344`): the store reset happens before the scene
   name check, so `goto("typo")` silently wipes live state and then throws.

House contract being honored (core CLAUDE.md): "stop() must fully reverse start()" — these paths
currently don't, and the repo's verification culture is fail-closed.

## Integration Ledger

| # | New thing | Live caller (`file:line` — fill during implementation) | Replaces | Old path removed? | Negative control |
|---|-----------|--------------------------------------------------------|----------|-------------------|------------------|
| 1 | Boot try/catch → teardown-and-rethrow around setup/load/enter | `#boot` failure flow in `game.ts` | uncaught awaits | replaced in place | new spec reds when the try/catch is reverted |
| 2 | Error-collecting teardown loops | `#teardown` in `game.ts` | first-throw-wins loops | replaced in place | spec with throwing first cleanup proves later cleanups ran |
| 3 | Validate-before-reset in `goto()` | `goto()` in `game.ts` | reset-then-validate | replaced in place | typo'd goto preserves state → red on revert |

## Phases

#### Phase 1: Teardown attempts every cleanup

**Files (2):** `packages/core/src/game.ts` - EDIT; `packages/core/__tests__/game.spec.ts` - EDIT.

**Implementation:**
- [ ] Wrap each plugin dispose and each cleanup in its own try/catch; collect errors; after all
      attempts, throw the FIRST collected error (precedence: original cause first), still running
      the final scene-leak check.
- [ ] Dispose-once guard stays exactly as is.

| Test File | Test Name | Assertion | Negative control |
|-----------|-----------|-----------|------------------|
| `game.spec.ts` | `should run every cleanup when an earlier cleanup throws` | spy cleanups [throws, ok] — second runs; error surfaces | revert loop guards → second spy never runs, red |
| `game.spec.ts` | `should report the first failing cleanup, not the leak check, when both would fire` | error message names the thrown cleanup | revert ordering → leak message wins, red |

#### Phase 2: Thrown boots roll back like aborted boots

**Files (2):** same as Phase 1.

**Implementation:**
- [ ] Wrap the plugin-setup loop, `scene.load()`, and `#enterScene` so any throw runs
      `#teardown(ctx)` then rethrows the original error.
- [ ] Abort-path behavior unchanged (its tests already pin it).

| Test File | Test Name | Assertion | Negative control |
|-----------|-----------|-----------|------------------|
| `game.spec.ts` | `should dispose renderer, input and run cleanups when plugin.setup throws` | spies confirm full teardown; rethrown error is the plugin's own | revert wrapper → renderer.dispose never called, red |
| `game.spec.ts` | `should tear down when scene.load rejects` | same shape for the scene path | same revert pattern |

#### Phase 3: `goto()` validates before it wipes

**Files (2):** same as Phase 1.

| Test File | Test Name | Assertion | Negative control |
|-----------|-----------|-----------|------------------|
| `game.spec.ts` | `should keep state intact when goto names an unknown scene` | store state survives; throws `TN_…` naming the scene | move the reset back before validation → state wiped, red |

#### Verification Plan (whole PRD)

1. Unit specs above green; paste outputs.
2. Existing lifecycle pins stay green (`game.spec.ts:326-400` abort/dispose-once/leak-check).
3. Red-green mutation per phase: name the line reverted for each criterion's red (house rule —
   five historical repair rounds were burned on wrong-thing reds).
4. `pnpm typecheck && pnpm lint && pnpm test` green — pasted.
5. Playtest note: pure engine-unit semantics change with no observable web-lane behavior difference
   in a healthy game; the abyss playtests re-run green as regression proof (paste one).

## Acceptance criteria (consumer-scoped)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | A game whose third plugin throws during setup leaves zero mounted canvas, zero live listeners, zero undisposed renderer — verifiable from the spec's spies, which stand in for what a retrying agent would observe | pasted spec |
| 2 | One bad cleanup can no longer strand the resources after it | pasted spec |
| 3 | `goto` to a nonexistent scene throws without destroying the current session | pasted spec |
| 4 | Every red above was produced by reverting its named line, not by an unrelated failure | pasted reds |

## Deliberately out of scope

- Changing plugin/scene API shapes, error taxonomy beyond surfacing the original error, or adding
  retry logic — callers keep owning retries.
- Native-side lifecycle (PRD-177 owns the native restart story).
