# Metrics

**Status:** proposal, 2026-08-02. **Charter authority:** `CHARTER.md` §12.

## The north star

> **Weekly projects that reach a verified playable milestone on a physical device.**

Not "games generated." Generation count rewards disposable output and would have shown
v1 succeeding right up to the week it was abandoned. Every word in the north star is load
bearing: *verified* (a playtest ran), *playable* (a scenario reached its goal), *physical
device* (not a simulator, not a browser tab).

## Supporting metrics

| Metric | Why it is not vanity | Measurable today? |
|---|---|---|
| Projects reaching first physical-device session | The Phase 1 gate, as a number | No — needs Phase 0a |
| Successful native build rate | Distinguishes "we have a build system" from "builds work" | No |
| Time from `create-threenative` to first device run | The whole onboarding promise, in one number | No |
| % of AI patches that typecheck and pass their declared scenario | Whether validation actually catches breakage | **Partly** — `pnpm typecheck` + `@threenative/playtest` exist |
| % of AI patches accepted rather than reverted | Whether the agent is a net positive | No — needs checkpoints |
| Projects meeting their chosen frame-time budget | See [../product/PERFORMANCE-BUDGETS.md](../product/PERFORMANCE-BUDGETS.md) | No |
| Crash-free test sessions | Regression signal that does not need a human | **Partly** |
| Projects reaching TestFlight / Play internal testing | The commercial funnel's real bottom | No |
| 4-week retained projects | The only honest measure of "maintainable" | No |
| External testers invited per project | Whether anyone but the author ever plays it | No |

Most of this column reads "No" because Cloud does not exist. That is the correct state
at this phase, and the honest thing to do is not to substitute a metric that *is*
measurable but means nothing.

## The one measurement that outranks all of these

`CHARTER.md` §12 criterion 3: **one game played by a stranger for five minutes, with a
transcript.**

v1 spent seven weeks unable to answer whether it was working, because its decisive
experiment was specified three times and never run. This criterion costs an afternoon
and is still open. Until it is closed, every metric above is a plan to measure something
instead of measuring it.

## Currently green, and worth keeping green

| Signal | Command | Last known |
|---|---|---|
| Framework LOC vs 15k cap | `pnpm budgets` | ~1,600 |
| Packages vs cap of 8 | `pnpm budgets` | 7 — see [CONFLICTS.md](CONFLICTS.md) |
| Vanilla vs framework LOC | `pnpm tsx scripts/count-loc.ts` | vanilla wins, 410 vs 412 |
| CI | GitHub Actions | must be green; §11.6 |

The LOC comparison currently says **vanilla wins**. Per `CHARTER.md` §3's kill switch that
is a live finding, not a footnote — and it belongs on this list precisely because it is
the metric most tempting to stop reporting.
