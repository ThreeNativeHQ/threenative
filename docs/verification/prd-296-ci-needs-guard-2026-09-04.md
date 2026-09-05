# PRD-296 item 3 — a skipped job says so, and the arrangement cannot come back

**Executed 2026-09-04** on branch `quickwins/2026-09-04-five-closes`. Row 3 of
[`docs/PRDs/quickwins-2026-09-04/README.md`](../PRDs/quickwins-2026-09-04/README.md).

## Re-measured before anything was written

PRD-296's status line still read `PROPOSED` while two thirds of it had shipped, so the batch
README's warning applies: its §"What happened" table is not a Phase 0 red. `ci.yml` at
`73846470`:

| Claim | Measured |
| --- | --- |
| Item 1 — no coverage job needs another coverage job | **Met.** Five `needs:` edges: `golden-path-template`, `template-nonvisual`, `benchmark` and `budgets` on `build` (which runs `actions/upload-artifact`), and `golden-path` on `golden-path-template`, which it aggregates through `needs.golden-path-template.result`. |
| Item 2 — a job that cannot run on the hosted runner says so in its own file | **Met.** `visuals` is not a job any more and `ci.yml:743-754` writes down why in prose; `native-platforms.yml` is its own workflow with its own triggers. |
| Item 3 — a skipped job is reported as skipped-and-why in the run summary | **Open.** `GITHUB_STEP_SUMMARY` appeared in none of the five workflow files. |

```
$ grep -c "GITHUB_STEP_SUMMARY" .github/workflows/*.yml
.github/workflows/ci.yml:0
.github/workflows/native-platforms.yml:0
.github/workflows/native-release.yml:0
.github/workflows/npm-release.yml:0
.github/workflows/site.yml:0
```

## What shipped

**The regression guard — `scripts/ci-workflow.ts` + `scripts/__tests__/ci-needs.spec.ts`.** This
is the half that stops the arrangement returning, and it runs under `pnpm test` in milliseconds
rather than costing a CI round trip.

The rule is stated over the workflow text and **derived, not listed**: an edge `job -> dependsOn`
is legal when `dependsOn` runs `actions/upload-artifact` (artifact production, which is the
carve-out PRD-296 itself grants `needs: build`), or when `job` reads that verdict — either
`needs.<dependsOn>.result` or `toJSON(needs)`. Everything else is a coverage job ordered behind a
coverage job. A hand-kept allowlist of legal edges would be one more parallel list to forget, and
forgetting it restores exactly the invisible arrangement.

Fail-closed: an edge naming a job the workflow does not declare is a finding; a workflow with no
`jobs:` mapping throws rather than reporting a green zero.

**The summary — `scripts/ci-run-summary.ts` + the `run-summary` job.** It reports and never gates,
so it is not a required check and cannot become something to route around. It is also the one job
that may legitimately declare `needs:` on coverage jobs; the guard grants that exemption through
`toJSON(needs)` and nothing else.

## Red control — the guard catches the original arrangement

`benchmark`'s `needs: build` changed to `needs: test`, which is the exact shape that concealed
three gates:

```
$ pnpm vitest run scripts/__tests__/ci-needs.spec.ts
 × should find no gate ordered behind another gate 6ms
   → benchmark declares needs: test, and test produces no artifact and is not aggregated by
     benchmark — a gate behind a gate is skipped on every run the upstream is red, which is
     indistinguishable from passing
 ✓ 12 others
```

Reverted; green again below.

## The summary, executed

Not asserted — run, against a `needs` payload shaped like the failure PRD-296 describes: `build`
red, and every lane ordered behind it skipped.

```
$ pnpm tsx scripts/ci-run-summary.ts --workflow .github/workflows/ci.yml \
    --results needs.json --reporter run-summary
## CI job results

| Job | Result | Why |
| --- | --- | --- |
| `typecheck` | success | — |
…
| `golden-path-template` | **skipped** | never ran — needs: build (failure) |
| `template-nonvisual` | **skipped** | never ran — needs: build (failure) |
| `golden-path` | **skipped** | never ran — needs: golden-path-template (skipped) |
| `benchmark` | **skipped** | never ran — needs: build (failure) |
| `build` | failure | — |
| `budgets` | **skipped** | never ran — needs: build (failure) |
| `supply-chain` | success | — |

**5 of 14 jobs did not run.** A job that never ran proved nothing; a skipped required check still
counts as satisfied by the ruleset, so read the reasons above rather than the green tick.
```

A job skipped by its own `if:` rather than by an upstream is distinguished:
`never ran — its \`if:\` condition was false`.

## The summary cannot go quiet either

`summaryRows` throws when the workflow declares a job the reporter does not depend on — a job
added to `ci.yml` and forgotten in `run-summary`'s `needs:` is an unreported job, which is the
same defect one level up:

```
CI_SUMMARY_UNREPORTED_JOBS: budgets — run-summary does not declare needs: on it, so the run
summary cannot say whether it ran
```

and it throws rather than rendering a verdict when a result is missing
(`CI_SUMMARY_NO_RESULT: build`). Both are specs.

## Gates

```
$ python3 -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml')); ..."
ci.yml parses; jobs: 15
run-summary needs: 14
jobs missing from run-summary needs: []

$ pnpm vitest run scripts/__tests__/ci-needs.spec.ts scripts/__tests__/ci-structure.spec.ts
 ✓ scripts/__tests__/ci-needs.spec.ts (13 tests)
 ✓ scripts/__tests__/ci-structure.spec.ts (43 tests)
 Tests  56 passed (56)

$ pnpm typecheck   # Done, all packages
$ pnpm lint        # exit 0
```

## What is deliberately not gated

`native-release.yml` and `npm-release.yml` declare `needs: gates` — a release ordered behind its
own test gate, which is correct: a release must not publish on red. The guard covers `ci.yml`,
which is the file PRD-296 is about, and does not run over the release workflows.

The run summary is a **report**, not a check. PRD-296 item 3 asks that "never ran" be visible
rather than indistinguishable from "passed"; making the reporter fail the run would be a different
decision, and one that turns a reporting surface into another gate to route around.
