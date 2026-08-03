# PRD-007 — Wire playtest into the runtime (`playtest()` plugin)

**Complexity: 7 → HIGH mode** (10+ files +3, new system +2, multi-package +2)

**Depends on:** PRD-002, PRD-006. **Blocks:** PRD-008, PRD-009, PRD-010.
**Design authority:** `DESIGN.md` §8, §12.3; `AGENTS.md` "Verification honesty".

## 1. Context

**Problem:** `@threenative/playtest` is 4,563 lines with **zero non-test callers**. No
ThreeNative game can be observed by it, so no later PRD has an acceptance mechanism.

**Files analyzed:** `packages/playtest/src/three/bridge.ts`, `src/three/observations.ts`,
`src/protocol.ts`, `src/runner/runner.ts:102-163`, `src/runner/bridgeClient.ts:43-72`,
`src/assertions.ts:324-343`, `packages/core/src/game.ts:110-176`, `src/entities.ts`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| `installThreePlaytestBridge` is called only by tests and a template string | `runner/init.ts:6`; `__tests__/three-bridge.spec.ts` |
| Bridge takes `WebGLRenderer`; core produces `RendererLike` (WebGPU-first) | `three/bridge.ts:11`; `core/src/renderer.ts` |
| Snapshot carries only `clock`, `diagnostics`, `entities`, `resources` | `protocol.ts:51-60` |
| Runner leaves `observations.hud` as a literal `{}` | `runner/runner.ts:131` |
| Missing capabilities **do** fail closed | `bridgeClient.ts:72` |

That last row is the load-bearing one: a scenario asserting an unsupplied kind errors
instead of passing. Every later PRD leans on it.

## 2. Solution

- `playtest()` plugin in `@threenative/core` (subpath `@threenative/core/playtest`) that
  installs the bridge from inside `defineGame`, sourcing entities from `ctx.entities` —
  the registry PRD-006 built for exactly this.
- Register `ctx.camera` as `camera.main` so `assert.camera` resolves.
- `runtime.fixedStep` by driving `FixedStepLoop.stepFrame`, so scenarios advance
  deterministically instead of racing `requestAnimationFrame`.
- `runtime.resources` from `ctx.state`; `runtime.diagnostics` from renderer/asset failures.
- Widen the bridge's `renderer` parameter to the structural type it actually uses
  (`getDrawingBufferSize`), so WebGPU works.
- **Advertise only what is supplied.** A capability in `describe()` with no channel behind
  it is precisely the silent pass this repo bans.

**Key decisions:** no protocol change — `entities` and `resources` cover this PRD's kinds.
Channels for `animation`, `states`, `contacts`, `tags` are added by the PRDs that own those
features, each proving its assertion in the same phase.

**Proof subject:** `examples/abyss-framework` + `templates/starter`.
**Requirements this subject does NOT exercise:** animation, state machines, contacts, tags.
**Phase that closes each gap:** PRD-009 (animation, states), PRD-010 (contacts, tags).

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `playtest()` plugin | `templates/starter/src/main.ts` plugins array | — | n/a | drop plugin → scenario fails `TN_PLAYTEST_BRIDGE_MISSING` |
| 2 | Registry→bridge sync | `core/src/playtest.ts`, via `game.ts` plugin loop | manual `entities:[]` arg | arg kept for non-core users | unregister `player` → `assert.movement` fails "not observed" |
| 3 | `camera.main` registration | `core/src/playtest.ts` | — | n/a | freeze camera → `assert.camera.follows` fails |
| 4 | `runtime.fixedStep` | `core/src/loop.ts` `stepFrame` | rAF frame waiting | rAF kept as fallback | no-op `advance` → tick delta 0, fails |
| 5 | `examples/abyss-framework/playtest/*.json` | `pnpm test:playtest` in CI | `tests/play.playtest.ts` | **deleted in Phase 3** | delete a scenario → suite count drops, gate fails |

**Reachability:** `defineGame` plugin setup → `installThreePlaytestBridge` →
`globalThis.__THREENATIVE_PLAYTEST_BRIDGE__` → Playwright runner. Internal, not user-facing.

## 4. Phases

#### Phase 1: `playtest()` installs a live bridge — a scenario observes a real game

**Files:** `core/src/playtest.ts` NEW · `core/package.json` EDIT (exports map) ·
`core/src/game.ts` EDIT · `playtest/src/three/bridge.ts` EDIT (renderer type) ·
`core/__tests__/playtest.spec.ts` NEW.

| Test | Assertion | Negative control (observe red) |
|---|---|---|
| `should advertise only supplied capabilities` | `describe().capabilities` excludes `runtime.animation` | add the string without a channel → fails |
| `should observe registry entities` | `sample().entities` holds `ctx.entities` ids | clear registry → empty, fails |
| `should register the active camera as camera.main` | id present with transform | — |
| `should install on a WebGPU RendererLike` | `getDrawingBufferSize` called | stub without it → throws |

#### Phase 2: deterministic advance — scenarios step the loop, not the wall clock

**Files:** `core/src/loop.ts` EDIT · `core/src/playtest.ts` EDIT · `core/src/game.ts` EDIT ·
`core/__tests__/loop.spec.ts` EDIT.

| Test | Assertion | Negative control |
|---|---|---|
| `should advance N fixed ticks when the bridge advances` | `onUpdate` × N, clock tick +N | stub `advance` no-op → delta 0, fails |
| `should throw when advancing a stopped loop` | throws, not a silent 0 | — |

#### Phase 3: real scenarios replace the hand-written Playwright test

**Files:** `examples/abyss-framework/playtest/moves.json` NEW · `playtest/camera.json` NEW ·
`examples/abyss-framework/tests/play.playtest.ts` **DELETE** · root `package.json` EDIT ·
CI workflow EDIT.

| Test | Assertion | Negative control |
|---|---|---|
| `moves.json` | `assert.movement.minDistance` under held input | zero the binding → fails |
| `camera.json` | `assert.camera.follows` + `targetInViewport` | detach camera → fails |
| both | `assert.diagnostics.noConsoleErrors` | `console.error` in scene → fails |

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets
pnpm test:playtest                      # new gate

# Caller census — must return a non-test hit
grep -rn "installThreePlaytestBridge" packages examples --include=*.ts | grep -v __tests__

# Revert check — comment the plugin out of templates/starter/src/main.ts
# Expected: both scenarios fail TN_PLAYTEST_BRIDGE_MISSING, not "0 assertions, pass"

# Trivial-assertion control — run moves.json with warmup only, no steps
# Expected: FAIL. A scenario asserting nothing must never pass.
```

## 6. Acceptance (consumer-scoped)

- [ ] A CI scenario observes `examples/abyss-framework` and fails when the game's movement
      breaks — the framework arm has an executable proof, not a smoke test.
- [ ] Removing `playtest()` from the starter breaks a CI gate.
- [ ] A test asserts `describe().capabilities` equals the channels `sample()` returns, so a
      later PRD cannot advertise a dead capability.
- [ ] `tests/play.playtest.ts` no longer exists.
- [ ] Every gate observed red once, recorded in `docs/verification/PRD-007.md`.
