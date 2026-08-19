# PRD-158 execution evidence — 2026-08-19

The PRD-158 lane commits are `f515f75` (schema/report/registry implementation), `f2b5c01`
(held-value evaluator guards), `b3c3d16` (template waiver migration and formatting), and `a37e830`
(settled pose-distance guard and regression test). The
final integrated commit is recorded by the delivery ledger.

## Phase 0 and negative control

The frozen-corpse scenario was run in the scratch game before the repair. After the all-waived
guard was enabled, the same scenario produced this observed-red result:

```text
TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING
Scenario 'death-no-snap' waived every triviality-eligible assertion, so it asserts nothing independently of its initial state.
"pass": false
ACTUAL_CLI_EXIT=1
```

## Migration and registry audit

The live baseline contained 39 boolean waiver entries under `packages/` and `examples/`; all 39
became reason strings. The source PRD's prose count of 40 was one higher than the scoped tree.
The registry audit reclassified six additional kinds (`tags`, `states`, `visibility`, `settled`,
`occluded`, and `animation`) to `reject-initial-value`, which exposed 18 more live held invariants
in templates and required their reasons. The lane census was:

```text
playtest JSON files: 87
allowTrivial entries: 57
boolean waivers: 0
short or invalid reasons: 0
```

Integration against the current main branch also included three existing platformer playtests;
the newly guarded web visibility row received a written reason. The final integrated census was:

```text
playtest JSON files: 90
allowTrivial entries: 58
boolean waivers: 0
short or invalid reasons: 0
```

Archived `docs/benchmark/sweeps/` files were intentionally not migrated. The 21 registry entries
all carry a non-empty `trivialityRationale`; the per-kind audit table is in the PRD.

## Verification

Manager command:

```text
pnpm typecheck && pnpm lint && pnpm test && pnpm test:templates
```

Result: exit `0`.

Observed output:

```text
Test Files  148 passed (148)
Tests       1400 passed (1400)
action-rpg: scaffolded playtests passed.
defense: scaffolded playtests passed.
minimal: scaffolded playtests passed.
platformer: scaffolded playtests passed.
racing: scaffolded playtests passed.
shooter: scaffolded playtests passed.
starter: scaffolded playtests passed.
```

`pnpm sync:agents --check` and `git diff --check` also exited `0`. Lint reported 229 existing
warn-level cognitive-complexity diagnostics and no errors. Integration also required a bounded,
fail-closed retry for the exact fixed-step startup race exposed by the sequential template gate;
its unit test and the green seven-template run are included in the final result. Focused evaluator
tests covered parser rejection, report reasons, all six newly guarded kinds, and the all-waived
exit code.
