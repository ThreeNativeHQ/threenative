# Metrics

**Status:** proposal, 2026-08-02. The five-minute stranger test remains open.

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

The five-minute stranger test, defined once in
[`docs/product/STRANGER-TEST-PROTOCOL.md`](../product/STRANGER-TEST-PROTOCOL.md) and nowhere
else. In one line: **one stranger plays one ThreeNative game at a URL, and the result is how long
they keep playing before stopping of their own accord.**

The protocol is the definition; this paragraph is a pointer to it. It was restated here, and in
two places in `ROADMAP.md`, in forms that turned out to describe two different experiments.

v1 spent seven weeks unable to answer whether it was working, because its decisive
experiment was specified three times and never run. This criterion costs an afternoon
and is still open. Until it is closed, every metric above is a plan to measure something
instead of measuring it.

## Signals to keep watching

| Signal | Command | Last known |
|---|---|---|
| Framework LOC review trigger | `pnpm budgets` | 15,285 against the 15,000 review trigger |
| Framework packages and example workspaces | `pnpm budgets` | 7 packages, 5 examples; informational counts |
| Vanilla vs framework LOC | `pnpm tsx scripts/count-loc.ts` | generated comparison; current table is 410 vs 432 |
| CI | GitHub Actions | must be green; no merge while red |

The LOC comparison currently says **vanilla wins**. The kill switch makes that
is a live finding, not a footnote — and it belongs on this list precisely because it is
the metric most tempting to stop reporting.
