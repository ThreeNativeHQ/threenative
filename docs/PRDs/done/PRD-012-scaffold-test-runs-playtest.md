# PRD-012 — A scaffolded project's `test` runs a playtest, not `vite build`

**Complexity: 5 → MEDIUM mode** (6-9 files +2, no new system, multi-package +2, fail-closed
gate design +1)

**Depends on:** PRD-007 (Phase 2 only — Phase 1 needs no bridge). **Blocks:** nothing.
**Charter authority:** `CHARTER.md` §3 criterion 3 ("has proof it isn't broken"), §8;
`AGENTS.md` "Verification honesty".

## 1. Context

**Problem:** every project scaffolded by `pnpm create threenative` ships a `test` command
that compiles the app and reports green without asserting anything about it — and ships a
playtest scenario the shipped runner physically cannot load.

**Files analyzed:** `packages/create-threenative/templates/{starter,minimal}/package.json`,
`templates/{starter,minimal}/tests/play.playtest.ts`,
`packages/playtest/src/scenario.ts:282-305`, `src/runner/runner.ts:131`,
`src/runner/init.ts:12-28`, `src/runner/config.ts:21-24`, `src/assertions.ts:655-656,
1293-1302`.

**Current behavior:**

| Fact | Evidence | Consequence |
| --- | --- | --- |
| `"test": "vite build"` in both templates | `templates/starter/package.json:8`, `templates/minimal/package.json:8` | a user's `pnpm test` proves the app **compiles**, nothing more, and prints green |
| The shipped scenario is TypeScript | `templates/starter/tests/play.playtest.ts` — `export const playScenario` | — |
| The loader is `JSON.parse` | `scenario.ts:297` | the shipped scenario **cannot be loaded by the shipped CLI**: `TN_PLAYTEST_SCENARIO_INVALID` |
| Two path conventions | templates use `tests/*.playtest.ts`; `init.ts:22` and the loader's own suggestion (`scenario.ts:292`) use `playtests/*.playtest.json` | the CLI's error message points users at a directory the template did not create |
| `observations.hud` is a literal `{}` | `runner.ts:131` | the starter's `hud` assertion on `id: "score"` (`play.playtest.ts:11`) can never be satisfied |
| Always-`{}` hud already caused a silent green once | `assertions.ts:1301-1302` — *"since observations.hud is always {}, that made every hud changed:false assertion green"* | this exact hole has bitten before and is documented in the source |

The last two rows are the point. This is not a missing feature; it is `AGENTS.md`'s named
worst case — **a check that reports green while asserting nothing** — shipped to every user
who scaffolds a project.

## 2. Solution

Make the scaffolded `test` command run the harness that already exists, against a scenario
the harness can actually read.

- **`"test"` becomes `vite build && threenative-playtest --scenario …`** in both templates,
  with the dev server managed by the runner's existing `--server-command`.
- **Scenarios move to `playtests/*.playtest.json`** — the convention `init.ts:22` already
  writes and `scenario.ts:292` already tells users to expect. One convention, not two.
- **`observations.hud` gets supplied** from the DOM the runner already has, replacing the
  `{}` literal at `runner.ts:131`. Until it is supplied, the starter's `hud` assertion is
  **narrowed to what is observable — never deleted** (`AGENTS.md`: "Install the bridge or
  narrow the scenario, never delete the assertion to get green").
- **The scaffold smoke test in CI runs the scaffolded `pnpm test`**, so a template that
  ships an unloadable scenario fails here instead of in a user's terminal.

**Key decisions:**

- **No new CLI command.** `CHARTER.md:275` fixes the vocabulary at `dev`, `build`, `test`,
  `ship`; this PRD makes `test` mean something, and adds nothing beside it.
- **Phase 1 needs no bridge.** `diagnostics` and screenshot assertions run adapter-free, so
  the fake green dies immediately rather than waiting on PRD-007. Semantic assertions land
  in Phase 2 on the `playtest()` plugin PRD-007 now installs in
  `templates/starter/src/main.ts:14`.
- **Fail closed on an empty scenario.** A scenario whose assertion set is empty must fail,
  not pass. That is the v1 harness bug verbatim, and it gets its own test.

**Data changes:** scenario files change extension and directory. No schema change.

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | `test` runs the playtest CLI | `templates/*/package.json` | `"test": "vite build"` | **line deleted, both templates** | break the app at runtime → `pnpm test` goes red (today it stays green) |
| 2 | `playtests/play.playtest.json` | the `test` script | `tests/play.playtest.ts` | **file deleted** | keep the `.ts` → `TN_PLAYTEST_SCENARIO_INVALID` |
| 3 | supplied `observations.hud` | `runner.ts` snapshot path | `hud: {}` at `runner.ts:131` | **literal deleted** | restore `{}` → the starter's `score` assertion fails, not passes |
| 4 | scaffold smoke runs `pnpm test` | `.github/workflows/ci.yml` | build-only smoke | n/a | ship a malformed scenario → CI red |

**Reachability:** `pnpm create threenative` → `pnpm test` in the user's own project.

## 4. Phases

#### Phase 1: the fake green dies — no bridge required

**Files:** `templates/starter/package.json` EDIT ·
`templates/minimal/package.json` EDIT · `templates/starter/playtests/play.playtest.json`
NEW · `templates/minimal/playtests/play.playtest.json` NEW ·
`templates/starter/tests/play.playtest.ts` DELETE ·
`templates/minimal/tests/play.playtest.ts` DELETE · `.github/workflows/ci.yml` EDIT ·
`templates/{starter,minimal}/AGENTS.md` EDIT · `create-threenative/__tests__/scaffold.spec.ts`
(`STARTER_PATHS`) EDIT · `create-threenative/__tests__/playtest.spec.ts` EDIT.

**The generated `AGENTS.md` is part of the product** (`create-threenative/AGENTS.md`), and
it currently documents the bug to the user's agent: `templates/starter/AGENTS.md` says
`pnpm build  # production build — also the test gate` and calls
`tests/play.playtest.ts` "one scenario, green on the scaffold" — a file the runner cannot
parse. Both lines are corrected in this phase.

**Wiring:** the scenario keeps only assertions the adapter-free runner can supply —
`diagnostics.noConsoleErrors`, `diagnostics.runtimeReady`. The `hud` assertion is
**carried forward into Phase 2, not dropped**; it is recorded in this PRD as owed.

| Test | Assertion | Negative control (observe red) |
| --- | --- | --- |
| scaffolded `pnpm test` | fails when the app throws at runtime | throw in `Play.enter` → red (against `main`, this stays green) |
| scenario loads | no `TN_PLAYTEST_SCENARIO_INVALID` | restore the `.ts` scenario → fails |
| empty assertion set | **fails**, does not pass | strip `assert` to `{}` → must go red |
| CI scaffold smoke | runs the scaffolded `pnpm test`, not just the build | revert to build-only → the runtime-throw case passes again |

#### Phase 2: `observations.hud` is real, and the score assertion comes back

**Files:** `packages/playtest/src/runner/runner.ts` EDIT ·
`templates/starter/playtests/play.playtest.json` EDIT ·
`packages/playtest/__tests__/runner.spec.ts` EDIT.

**Wiring:** `runner.ts:131`'s `hud: {}` is replaced by values read from the page. The
starter scenario regains `{ id: "score", path: "#root", textIncludes: "1" }` — the
assertion Phase 1 owed.

| Test | Assertion | Negative control |
| --- | --- | --- |
| hud observation is supplied | `observations.hud.score` is defined after the run | restore `hud: {}` → fails |
| `changed:false` is not trivially green | a hud id that never existed **fails** | the `assertions.ts:1301` hole reopens → test goes red |
| starter scenario end to end | player reaches the pickup, `#root` shows `1` | unsubscribe the pickup handler → fails |

**User verification:** `pnpm create threenative demo && cd demo && pnpm test` — passes; then
delete the pickup handler and it fails.

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets

# No template ships an unloadable scenario
find packages/create-threenative/templates -name '*.playtest.ts'    # expected: no output

# The fake green is gone, not shadowed
grep -rn '"test": "vite build"' packages/create-threenative/templates  # expected: no output

# The hud literal is gone
grep -n "hud: {}" packages/playtest/src/runner/runner.ts            # expected: no output

# Revert check: restore "test": "vite build", break Play.enter, re-run the scaffold smoke
# Expected: CI passes — which is the bug this PRD removes
```

## 6. Acceptance (consumer-scoped)

- [x] In a freshly scaffolded project, `pnpm test` **fails** when the game throws at
      runtime — observed red against the current `main`, where it passes.
- [x] No template ships a scenario the shipped runner cannot parse.
- [x] A scenario with an empty assertion set fails, proved by a test.
- [x] `observations.hud` is supplied, and the starter's `score` assertion is restored
      rather than deleted.
- [x] Every gate observed red once, recorded in `docs/verification/PRD-012.md`.
