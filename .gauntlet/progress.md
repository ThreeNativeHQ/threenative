# Gauntlet progress — ThreeNative self-improvement round 2

## Current bar

The framework must match or beat a fresh vanilla builder on sealed functional proof, blind
visual score, and user source LOC, without owning the look or contaminating the comparison.

## Current result

- Frozen Abyss: framework 402 normalized LOC versus vanilla 473 (85.0%); the honest look/game
  floor is 301 framework LOC.
- Prior platformer: framework 726 LOC versus vanilla 769; both sealed proofs pass and the
  framework wins the blind visual comparison.
- Prior top-down action: framework 1606 LOC versus vanilla 1620; both sealed proofs pass and
  both arms render readable win loops.
- Round 2 is open in `docs/verification/round-2-2026-08-07.md`; exploration arms are pending.

## Components

| Component | Status | Evidence |
|---|---|---|
| Viewport lifecycle in core | complete | `packages/core/src/viewport.ts`, `game.ts`, `scene.ts` |
| Scene callers | complete | Abyss and platformer template |
| Unit proof | complete | `packages/core/__tests__/viewport.spec.ts` |
| Playwright proof | complete | `benchmark.playwright.config.ts` + `?viewport` |
| Full gates | complete | typecheck, lint, test, budgets |
| Capture guard | complete | `scripts/capture-guard.ts`, 6 tests |
| Live capture command | complete | headed WebGPU guard passes for framework `-50` and vanilla `-11`; four nonblank frames per arm |
| Blind image bundle | complete | metadata stripping, external reveal, 5 tests |
| Judge validator | complete | guard recheck, bounded schema, 3 tests |
| Round ledger and resume command | complete | ledger records final pair, blind judge, gap dispositions, and next action |
| Round 1 paired builds | complete | framework `docs/benchmark/sweeps/platformer-2026-08-07-50` and vanilla `docs/benchmark/sweeps/platformer-2026-08-07-11` both pass 2/2 |

## Closed gaps

- Visual composition: the generated framework camera now uses a behind/above route view; the
  completion gate retains route, spikes, player, and 8/8 HUD context.
- Authoring cost: redundant coin physics areas, unused hazard visibility state, and starter
  ceremony were removed without adding package look APIs. Framework is lower in both measured
  LOC and source bytes.
- No open framework-vs-vanilla column loss remains. The critic still notes that no single frame
  shows every cue at once; this is a shared evidence limitation, not a framework regression.

## Current result

The viewport candidate is accepted. The focused lifecycle tests and dedicated Chromium probe pass;
the probe resizes from 1280×720 to 720×1280 and keeps the player visible with zero page or
request failures. Repository gates pass: typecheck, lint, 108 package test files / 619 tests,
and budgets. Full evidence is in `docs/verification/PRD-022.md`. A regression test also proves
`game.stop()` disposes the viewport observer.

The final capture candidate is complete. `pnpm sweep:capture` produced four validated 1280×720
frames for each arm with 2/2 sealed proof; final archive 50 has nonblank active and completion
frames. `docs/verification/blind-platformer-round-1-final13/judge.json` is accepted from a fresh
anonymous critic input.

PRD-021 phases 1–2 are complete: 19 focused tests pass across the round-resume and proof
validators, malformed ledgers and failed proof artifacts fail closed. The final round ledger
contains the pair report, anonymous reveal/judge, closed gap dispositions, and passing final
repository gates. PRD-023 and PRD-024 are moved to `done/`.

## Round 2 work

| Component | Status | Evidence |
|---|---|---|
| Exploration framework arm | pending | isolated builder sandbox not yet created |
| Exploration vanilla arm | pending | must follow the archived framework arm |
| Cross-genre abstraction candidate | in review | requires >20 caller-line savings and a named live caller |
| Fresh critic | pending | must inspect both real captures read-only |

The lead has not written game code. Existing physics rotation synchronization is retained as
a correctness fix, not counted as a LOC claim; target-lock logic remains user-space because it
is combat-specific.
