# Playtest monolith containment — PRD-182 — 2026-08-22

Lane: lane-hygiene. PRD: `docs/PRDs/batch-2026-08-22/PRD-182-playtest-monolith-containment.md`.

## Phase 1 — characterization net (commit d0a9d7a7, landed before any movement)

Three new spec files, 24 rows, zero production files touched:

| File | Rows | Pins |
| --- | --- | --- |
| `__tests__/evaluator-semantics.spec.ts` | 9 | verdict ids/pass values captured verbatim (`movement.distance`, `world.seed`, `states.enemy`, `tags.undefined`), detail shapes, framebuffer diagnostic ladder priority, vacuous/unknown-family rejection (`registered-without-evaluator` + `TN_PLAYTEST_ASSERTION_NOT_EVALUATED`), cross-family ordering. Wrong-looking behavior pinned as-is: states require terminal evidence even when already matching; tags pass with count 0. |
| `__tests__/scenario-load.spec.ts` | 9 | exact fail-closed messages: root/schemaVersion/target/inputDelivery/name, unknown assert key (enumerating all supported keys), missing reachability artifact; canonical-load field preservation. |
| `__tests__/runner-orchestration.spec.ts` | 6 | failedDiagnosticsAssertion shape; signal path teardown(true)→exitCode 2→exit 2 with throwing teardown swallowed; buildReport's verbatim empty-scenario assembly; preflight silence branches; playtestStepDrivesMovement truth table (press:"" suppresses held input). |

**Mutation check, pasted honestly:** the first net draft SURVIVED the ordered flip
(`>=` → `>` in the movement verdict): distance 2 vs minimum 1 passes both ways. Per the PRD the
net was thickened before any code moved (exact-boundary pin added); the re-applied flip turned
exactly its own row red —

```
× movement treats distance exactly equal to the minimum as passing
Tests  1 failed | 23 passed (24)
```

— and reverting restored 24/24.

## Phase 2 — assertion-evaluators.ts split (commit ad191e07)

2,312 → 44-line facade + nine modules under `src/evaluators/` (largest successor 605 lines).
Also repairs PRD-181 debris: the pathspec-limited commit had silently excluded the deletions of
`playtest/src/replay.ts`, `three/pose.ts` and the two moved pose specs, so duplicate copies
remained tracked; they land deleted here.

## Phase 3 — scenario.ts split (commit 7460cca8)

1,867 → 71-line facade + `scenario/schema-base.ts` (379), `schema-validate.ts` (765),
`schema-accessors.ts` (634), `errors.ts` (52).

## Phase 4 — runner.ts split (commit ba8619d5)

1,880 → 610-line orchestration facade + `runner-support.ts` (310), `steps.ts` (514),
`sampling.ts` (649). Desktop watchdog sites (deviceTransport/androidRunner/diagnostics) untouched;
both xvfb.sh advice strings preserved byte-for-byte; import paths for all consumers unchanged.

## End-to-end paired proof (moves.json, standard recipe, headed webgpu)

**CORRECTION (STOP-SHIP fix 97f1c0e9):** the two runs below were both made AFTER the
7b25a032 packaging regression, so their identical failure was that regression manifesting —
NOT a pre-existing game-side red as this section originally claimed. The bridge red was my own
misattribution; lane-desktop's stale-recording theory and this regression were separate issues.

Pre-split runner at HEAD (post-7b25a032):

```
MOVES HEAD_RUN_EXIT=2   diagnostics: TN_PLAYTEST_BRIDGE_MISSING   pass: false
```

Split runner, same command (pre-fix):

```
SPLIT_RUN_EXIT=2        diagnostics: TN_PLAYTEST_BRIDGE_MISSING   pass: false
```

Identical outcomes through the split — the Phase 4 parity proof stands.

**After the STOP-SHIP fix**, same recipe:

```
MOVES_EXIT=0    "pass": true across all assertions
```

Criterion 4 is satisfied for real once the browser-tier regression is fixed; the regression
itself is documented under PRD-181 in commit 97f1c0e9 with live RED/GREEN boot probes:
RED `pageerror: Module "fs/promises" has been externalized for browser compatibility`,
bridgePresent false → GREEN `BOOT={"bridgePresent":true,"errors":[]}`.

## Instrument results

- Characterization net: 24/24 green after every phase AND re-run after the STOP-SHIP fix.
- Full playtest suite: identical totals per phase — final: 47 files / 468 tests, all green
  (plus the export-map pin updated for the new ./protocol subpath).
- Kill-switch sanity (`pnpm tsx scripts/count-loc.ts`): "suggested framework normalised
  baseline: 432 (current baseline 441)" — pure module splits, no new abstraction cost.
- Honest quality report (NOT regenerated to hide anything):
  `quality report: 58 findings (12 new, 1 grew, 45 inherited, 0 waived)` — the three monolith
  findings are resolved by the splits themselves (largest playtest module now 649 lines);
  remaining rows are other files' pre-existing growth, visible honestly under PRD-179's
  value-aware semantics.
- Gates this lane: scoped vitest everywhere cited; tsc clean for touched files (package-scoped
  tsc also shows foreign untracked WIP errors from the desktop lane's capture work while it is
  mid-flight — attributed, not mine); full `pnpm test` unclaimed per standing orders.
