# Metrics

**Status:** proposal, 2026-08-02. Re-pointed at the agent test 2026-08-17; the cold-agent
build has not been run yet.

## Who this is measured for

**An agent builds with this framework; a human plays what it built.** Those are two different
customers and they need two different scorecards, which this file previously ran together under
one human-shaped north star.

| Scorecard | Measures | Instrument |
|---|---|---|
| **Framework** | Does ThreeNative help or hurt the thing writing the game | the agent test, below |
| **Output** | Is the resulting game worth playing | the five-minute stranger test, below |

Neither gates the other. A framework result that waits on an external person is a framework
result that does not get measured.

## The north star

> **Cold-agent builds that ship a passing sealed proof, at a falling friction cost.**

Not "games generated." Generation count rewards disposable output and would have shown
v1 succeeding right up to the week it was abandoned. Every word is load bearing: *cold*
(the agent has never read this repository), *sealed proof* (the scenario was hashed before the
build began, so the bar cannot move to meet the result), and *falling friction cost* — the build
got cheaper than the last one, or the number did not move.

## Supporting metrics

| Metric | Why it is not vanity | Measurable today? |
|---|---|---|
| **Friction rows per cold-agent build** | The framework's own quality, in the only units its customer feels | **Yes** — every sweep ledger already carries the list; nothing tracks it as a series |
| **Tool calls before the first line of game code** | How much of an agent's budget the framework spends before the game starts | **Yes** — round 9: 16 of ~139 framework, 3 of ~120 vanilla |
| **Cold-agent builds shipping a passing sealed proof** | The north star, as a count | **Yes**, and unrun — the subject has always read the repo |
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

## The agent test — the framework's decisive experiment

**One agent that has never read this repository builds a game from the published packages
alone, against a sealed brief and a sealed proof, and every place the framework got in its way
is written down.**

The subject is cold or the run does not count. Cold means: no access to this repository, no
sweep ledgers, no PRDs — the published packages, `pnpm create threenative`, the generated
`AGENTS.md`, and the brief. `docs/verification/adopter-pilot-2026-08-14.md` is the closest run
so far and it opens by disqualifying itself on exactly this point: its subject had read the
repo. That pilot is the protocol working; it is not a result.

What the run returns, in order of what it decides:

| Output | What it decides |
|---|---|
| **Friction rows** — every API, message or document that cost the agent time, with the workaround | the framework's quality, and the next round's work |
| Sealed proof passed / total | whether the thing it built runs |
| Tool calls before the first line of game code | how much of the budget the framework spends before the game starts |
| Authored LOC and reach rate | the kill switch, and which exports are dead weight |

**Friction rows per build, trending down, is the number.** Round 9's framework arm produced ten
— an undocumented gravity sign, a capsule origin that floats every character, an overloaded
`IInputAction.down` with no discriminator, an error message naming an artifact the runner never
writes. Each is an agent spending calls on our API instead of on the game. Nothing currently
tracks that count as a series, and it is the most useful number this project can produce.

## The output test — the five-minute stranger

Defined once in
[`docs/product/STRANGER-TEST-PROTOCOL.md`](../product/STRANGER-TEST-PROTOCOL.md) and nowhere
else. In one line: **one stranger plays one ThreeNative game at a URL, and the result is how long
they keep playing before stopping of their own accord.**

It is still the only honest measure of whether the output is worth playing, and it is still open.
What changed on 2026-08-17 is its scope: **it grades the game, which means it grades the
templates — not the framework.** It was previously written here as the one measurement
outranking all others, which put every framework result behind the availability of an external
person. It no longer gates anything on this page.

v1 spent seven weeks unable to answer whether it was working, because its decisive experiment was
specified three times and never run. That failure is the reason both tests above name their
protocol file and their instrument.

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
