# PRD-126 — the visual instrument now measures its own resolution, and has not yet been given raters that can

2026-08-16. [PRD-126](../PRDs/batch-26-08-16/PRD-126-the-visual-instrument-noise-floor.md) asks for
two things: an instrument that publishes a minimum detectable effect and refuses to report a delta
smaller than it, and a Phase 0 run that measures what that number actually is.

**The instrument is built, wired and its controls are observed red. Phase 0's measurement was not
taken, and this file says why rather than publishing a number it would have to withdraw.**

This is a model instrument. It is not the human blind session `docs/product/VISUAL-BASELINE.md`
requires, and no charter result is claimed from anything here.

## 1. What Phase 0 asked, and why it was refused

Phase 0 is a bundle of the committed frames scored by three independent fresh critics, with
byte-identical duplicate pairs hidden in the shuffle. The spread between a rater's two scores for
one image is that rater's self-consistency; the widest such disagreement is the run's resolution.

The bundle was built. Seven templates, both conditions, two duplicate pairs — 16 samples:

```sh
pnpm visuals:ab --before <the seven committed frames> --after <the same seven> --out <dir> --duplicates 2
```

Before and after are byte-identical by construction, so **every delta the instrument reports in this
run is noise and nothing else** — a null control, and a stronger one than two duplicate pairs on
their own.

It was then scored by the only rater this session had: me. That rater is not independent, and the
disqualification is specific rather than a scruple:

**Before scoring a single frame I had read round 10's ledger, including its after-column —
shooter 4, defense 3, minimal 2, action-rpg 3, platformer 2, racing 2, starter 2 — and the first
fifty lines of the committed critic's verdict, rationales included.**

My scores came out `platformer 2, defense 3, racing 2, shooter 4, starter 2, minimal 2,
action-rpg 3`. Identical to the committed critic on all seven, and every duplicate pair scored the
same on both copies, so the instrument would have published **`mde = 0`**.

**`mde = 0` is the worst number this PRD could produce.** At zero resolution every one-point move
becomes a `WIN` or a `LOSS`, which is round 10's failure with a certificate attached. The PRD's own
framing is that getting this wrong makes the instrument *confidently* wrong rather than visibly
noisy, and that is strictly worse because nothing reports it. So the number is not published.

Two further reasons the same score would have been reached without any anchoring, both of which
would have made it uninterpretable anyway:

- **One rater in one pass cannot be blind to a duplicate.** Sixteen images read in sequence in one
  context; identical PNGs are recognisable as identical. The self-consistency being measured is not
  being measured.
- **Round 10's ±1 came from two *different* critics.** Between-rater spread is the variance that
  actually bit, and no arrangement of one rater measures it.

**What Phase 0 needs is three critic sessions that have not read this one.** The repository already
has that shape — `round:next` asks for a *fresh read-only critic* and `sweep:judge` runs one. Phase 0
is one command away from being answerable and is not answerable from inside this session.

Phase 0's two pre-committed outcomes — spread ≥ 1, proceed; spread < 1, cut the scope — therefore
both remain open. **Neither was chosen, and the three-rater median in §2 was built rather than cut,
because cutting it on an anchored measurement would be deciding the question with the evidence the
PRD exists to distrust.**

## 2. What was built, and what it refuses

`scripts/visual-ab.ts`, reachable as `pnpm visuals:ab`, which it was not before — it was a script
with a unit test and no caller.

- **Duplicate-pair injection.** `--duplicates n` carries `n` frames twice under distinct shuffled
  identifiers. The reveal records which copy pairs with which original; the bundle does not, and the
  build output prints counts rather than names so the mapping does not leak into the terminal a
  rater is reading.
- **The MDE.** The widest disagreement across every duplicate pair and every rater. `max`, not a
  mean: an average would claim a resolution finer than something actually failed at.
- **`--raters n` and a median.** The reported score per frame is the median across raters, so one
  outlier does not drag a result the way a mean would.
- **`WIN` / `LOSS` / `INDETERMINATE`.** Any delta at or under the measured MDE is `INDETERMINATE`,
  and `INDETERMINATE` rows are **excluded** from the aggregates rather than down-weighted. A run
  where nothing is resolvable prints *"No aggregate"* and no mean at all.
- **`scripts/round-ledger.ts` enforces it in the ledger.** A `## Visual deltas` table requires a
  `Visual MDE:` field, every row's Δ must equal after − before, and a row at or under the MDE may
  only be recorded `INDETERMINATE`. `pnpm round:next` refuses a ledger that breaks this.

Exit codes, fail-closed throughout: `0` scored and classified, `1` a measured regression, `2` the
run never reached a verdict.

## 3. Negative controls, observed red

Every row was run and its exit code recorded before the matching pass was written.

| Control | Command | Observed | Exit |
| --- | --- | --- | --- |
| `one-sided-template` | a template removed from the after directory | `TN_VISUAL_AB_UNPAIRED: before-only [gamma]` | **2** |
| `empty-bundle` | both directories empty | `TN_VISUAL_AB_EMPTY: no frames in …` | **2** |
| `no-duplicate-pair` | `--duplicates 0`, then score it | `TN_VISUAL_AB_NO_DUPLICATE_PAIR: … its resolution cannot be measured and no score may be reported` | **2** |
| `rater-shortfall` | `--raters 3` with two verdicts | `TN_VISUAL_AB_RATER_SHORTFALL: 3 rater(s) requested, 2 verdict file(s) supplied` | **2** |
| `unparseable-verdict` | one rater returns malformed JSON | `TN_VISUAL_AB_VERDICT_UNPARSEABLE: … is not JSON` | **2** |
| `no-verdict` | build without scoring | `TN_VISUAL_AB_NO_VERDICT: bundle written to …` | **2** |
| `sub-mde-delta` | a Δ of 1 against a measured MDE of 1 | row prints `INDETERMINATE`; *"No aggregate. All 3 row(s) are INDETERMINATE"* | 0 |
| `ledger-overclaim` | round 10's `defense +1` hand-edited to `WIN` under `Visual MDE: 1` | `pnpm round:next` → *"the instrument cannot resolve it, so it may only be recorded INDETERMINATE, not 'WIN'"* | **1** |

`unparseable-verdict` is the one that matters most. Dropping quietly to the raters that did parse
would report a two-rater number under a three-rater heading, and nothing downstream could tell.

Twelve unit tests cover the same ground plus the median, the aggregate exclusion, an out-of-rubric
score, and a skipped sample.

## 4. Round 10's seven deltas, re-classified

Recorded in [`round-10-2026-08-16.md`](./round-10-2026-08-16.md) itself, not only here, because that
is the file a reader quotes.

The resolution used is **1** — round 10's own measurement, from `action-rpg` moving a full point
between its two critics with nothing touched. It is a between-rater observation from a single
untouched template, not the duplicate-pair number Phase 0 will produce, and the ledger says so.

| Template | Δ | Verdict |
| --- | --- | --- |
| shooter | +2 | **WIN** |
| starter | −2 | **LOSS** |
| defense | +1 | INDETERMINATE |
| minimal | 0 | INDETERMINATE |
| action-rpg | −1 | INDETERMINATE |
| platformer | −1 | INDETERMINATE |
| racing | −1 | INDETERMINATE |

**Two of seven rows carry information.** Round 10's prose already read both correctly; what the
re-classification withdraws is *"at floor 2/7 → 1/7, mean 2.86 → 2.57"*, which was computed over all
seven and is now struck from that file.

## 5. Where PRD-126 stands

| Criterion | State |
| --- | --- |
| A dated record states the measured MDE from duplicate pairs in the same bundle | **open** — §1 |
| Round 10's deltas re-classified in the round-10 ledger itself | done — §4 |
| `pnpm visuals:ab` exists, runs end to end, exits 0 | done |
| One-sided template exits 2, observed red | done |
| No duplicate pair exits 2, observed red | done |
| Three raters requested, two supplied, exits 2 naming the shortfall | done |
| A sub-MDE delta prints INDETERMINATE and is excluded from aggregates | done |
| `round:next` refuses a ledger overclaiming a sub-MDE delta, observed red | done |
| The record states this is a model instrument, not the human session | done |
| `typecheck`, `lint`, `test`, `budgets` | green |

**The one open criterion is the measurement, and it needs three critic sessions that have not read
this one.** Until it is taken, the working resolution stays at round 10's ±1, which is the more
conservative of the two numbers on offer and the only one that was measured between independent
raters.

## 6. What this does not claim

- **No visual-quality result.** Nothing was scored for the record; the one scoring pass taken here
  is disclosed as anchored and is not evidence.
- **Not a rubric change.** `docs/product/VISUAL-BASELINE.md` and its 4/5 floor are untouched.
- **Not a human session.** Three model raters, when they exist, will still be three model raters.
- **Not a re-scoring of rounds 1–9.** Only round 10 ran the two-critic split this corrects.
