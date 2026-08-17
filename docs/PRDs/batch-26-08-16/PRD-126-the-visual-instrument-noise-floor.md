---
prd_contract: v1
---

# PRD-126 — The visual instrument cannot tell a change from noise, and it has already optimised noise once

**Status: PARTIAL, 2026-08-16 — the instrument is built and enforced; its own measurement is the
one thing still open.** Record:
[`docs/verification/prd-126-visual-instrument-2026-08-16.md`](../../verification/prd-126-visual-instrument-2026-08-16.md).

Built, wired as `pnpm visuals:ab`, eight negative controls observed red with exit codes, twelve unit
tests, and `scripts/round-ledger.ts` now refuses a round ledger that reports a sub-MDE delta as a win
or a loss. Round 10's seven deltas are re-classified in round 10's own ledger: two carry information,
five are `INDETERMINATE`, and its *"at floor 2/7 → 1/7, mean 2.86 → 2.57"* headline is withdrawn.

**Phase 0's measurement was not taken, deliberately.** The only rater available had already read
round 10's score column and the committed critic's verdict before scoring, and reproduced both
exactly — which would have published `mde = 0`. At zero resolution every one-point move becomes a
result, so that is round 10's failure with a certificate attached, and it is precisely the
*confidently wrong rather than visibly noisy* outcome §9 warns about. **Phase 0 needs three critic
sessions that have not read this one**, which is one command away and was not available here. Until
then the working resolution stays at round 10's ±1 — the more conservative number, and the only one
measured between independent raters.

No visual-quality result is claimed by this file, and no round-10 score is revised — only what may
be concluded from the ones already recorded.

**Outcome:** every visual comparison this repository runs publishes a **minimum detectable
effect** measured in the same bundle that produced the scores, and refuses to report a delta
smaller than it. A change whose effect the instrument cannot resolve comes back `INDETERMINATE`,
not as a win or a loss.

**Depends on:** nothing. `scripts/visual-ab.ts` and `scripts/score-blind.ts` exist and are
unit-tested; this PRD wires and calibrates them.

**Blocks:** round 11, and every template or template-adjacent visual change after it.

**Complexity: 5 → MEDIUM mode.** No package code, no new dependency. One script, its npm entry,
one test file, and a calibration run.

**Blast radius: ~6 repository paths.** `scripts/visual-ab.ts`, `scripts/score-blind.ts`,
`scripts/template-baseline.ts`, `scripts/__tests__/visual-ab.spec.ts`, `package.json`,
`docs/verification/`.

---

## 1. Why this exists

Round 10 ran a before/after comparison across the seven templates and reported seven deltas.
Its own calibration row says what those deltas are worth
([`round-10-2026-08-16.md`](../../verification/round-10-2026-08-16.md)):

| Template | Before | After | Δ | Changed? |
| --- | --- | --- | --- | --- |
| shooter | 2 | **4** | **+2** | yes — doubled HUD removed |
| defense | 2 | 3 | +1 | yes — gradient sky |
| minimal | 2 | 2 | 0 | no |
| **action-rpg** | **4** | **3** | **−1** | **no — nothing was touched** |
| platformer | 3 | 2 | −1 | yes — fog range |
| racing | 3 | 2 | −1 | yes — gradient sky |
| starter | 4 | **2** | **−2** | yes — landmark replaced |

`action-rpg` moved a full point with no input. **±1 is the noise floor**, so four of the seven
rows carry no information, and the round's headline — *at floor 2/7 → 1/7, mean 2.86 → 2.57* —
is computed from a column that is mostly variance.

The cost was not theoretical. The round replaced `starter`'s torus-knot landmark on a
one-point observation, shipped a floating unshadowed replacement, measured 4 → 2, and reverted.
The round's own note: *"a visual change made without looking at the result is a guess, and the
fact that this loop's whole purpose is to stop that makes it worse."*

**The mechanism is known and the fix is half-built.** `scripts/visual-ab.ts` already exists and
already argues the right thing in its own header comment: round 10 scored the before frames with
one critic and the after frames with another, and averaging more raters per condition shrinks the
error bar without removing the bias. Putting both conditions in one bundle cancels each rater's
personal calibration in the difference.

**What it does not have:** a `package.json` entry, a single round run through it, any measurement
of rater spread, and any rule that stops a sub-resolution delta being reported as a result. It is
a script with a unit test and no caller.

## 2. What "minimum detectable effect" means here, concretely

The instrument must answer one question before it answers any other: **how far apart do two
scores have to be before this instrument can tell them apart?**

It is measured in-band, not asserted from a prior round:

- **Duplicate pairs.** Every bundle carries at least two frames that are byte-identical copies of
  one another under different shuffled identifiers. A rater's two scores for the same image are
  its self-consistency; the spread across all duplicate pairs in the bundle is the instrument's
  resolution for that run.
- **Median of three raters, not a mean of one.** Three independent fresh read-only critics score
  the same bundle. The reported score per frame is the median. A mean of one rater is what round
  10 ran and is the thing being replaced.
- **The floor is published with every result.** A run reports `mde = <n>` and every delta smaller
  than `n` is labelled `INDETERMINATE`. The label is not advisory: `INDETERMINATE` rows are
  excluded from any aggregate the run prints.

This is deliberately not a statistical apparatus. Three raters and a duplicate pair is the
smallest thing that measures its own resolution, and the loop's problem is not precision, it is
that it had no resolution number at all.

## 3. Public shape

```sh
pnpm visuals:ab --before <dir> --after <dir> --out <dir> --raters 3
```

Exit codes, fail-closed throughout:

| Code | Meaning |
| --- | --- |
| `0` | The bundle scored, the MDE is computed, and every delta is classified |
| `1` | A delta exceeded the MDE in the losing direction — a measured regression |
| `2` | The run never reached a verdict: a missing frame, a template on one side only, fewer raters than requested, no duplicate pair, or a rater that returned an unparseable verdict |

`2` is the important one. An instrument that cannot measure its own resolution must not fall back
to reporting scores without one — that is the exact shape of the v1 harness defect this repository
exists downstream of, where a scenario asserting nothing reported pass.

## 4. Phases

### Phase 0 — Measure the instrument before changing it

Score the **existing** committed frames at `docs/verification/visuals/` through the paired bundle
with three raters and duplicate pairs, and publish the spread. No template is touched.

This is the number the whole PRD turns on, and it is cheap. Two outcomes, both pre-committed:

- **Spread ≥ 1.** The round-10 reading is confirmed, and every ±1 conclusion in rounds 9 and 10
  is formally unattributable. Proceed.
- **Spread < 1 under pairing alone.** Then the pairing fix in `visual-ab.ts` was sufficient on its
  own, the three-rater median is unnecessary cost, and Phases 1–2 shrink to wiring plus the
  duplicate-pair guard. **Say so and cut the scope** rather than building the larger thing because
  it was planned.

### Phase 1 — Duplicate pairs and the MDE computation

`buildVisualAbBundle` injects duplicate pairs and records their identifiers in the reveal file.
The scorer computes the spread across duplicate pairs and emits `mde` into the run's JSON.

### Phase 2 — Three raters, median, and the `INDETERMINATE` classification

`--raters n` spawns `n` fresh read-only critics against the same bundle. Median per frame.
Every delta classified `WIN` / `LOSS` / `INDETERMINATE` against the measured `mde`.

### Phase 3 — Wire it, and make the round ledger read it

`pnpm visuals:ab` in `package.json`. `scripts/round-next.ts` learns the `INDETERMINATE` label so
a round cannot close claiming a visual result the instrument classified as unresolvable.

## 5. Integration ledger

Filled with real non-test `file:line` during implementation. A `TBD` at phase end means the phase
is incomplete.

| # | Thing built | Caller edited so it is reached | What it replaces | When it may claim green | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | Duplicate-pair injection | `scripts/visual-ab.ts` `buildVisualAbBundle` | nothing — no rater self-consistency is measured today | a bundle contains ≥2 identical frames under distinct identifiers and the reveal records the mapping | remove the pair → exit `2`, never score |
| 2 | MDE computation | the scorer's report writer | a score column with no stated resolution | duplicate-pair spread is in the JSON and in the printed table | feed identical duplicate scores → `mde` is 0 and the run says so, rather than defaulting to a constant |
| 3 | `--raters n` median | `scripts/visual-ab.ts` CLI | one rater per condition | three verdicts exist and the median is what is reported | request 3, supply 2 → exit `2` naming the shortfall |
| 4 | `INDETERMINATE` classification | the report writer and `scripts/round-next.ts` | every delta reported as a result | a sub-MDE delta prints `INDETERMINATE` and is excluded from aggregates | hand-edit a round ledger to call a sub-MDE delta a win → `round:next` rejects it |
| 5 | `pnpm visuals:ab` | `package.json` | a script with a unit test and no caller | the command runs end to end and writes a dated record | TBD |

## 6. Acceptance criteria

Consumer-scoped: each is about a report someone could read and disagree with, not about code
that exists.

- [ ] A dated record in `docs/verification/` states this instrument's measured MDE, computed from
      duplicate pairs in the same bundle that produced its scores.
- [ ] Round 10's seven deltas are re-classified against that MDE, and the ones that do not clear
      it are marked unattributable **in the round-10 ledger itself**, not only here.
- [ ] `pnpm visuals:ab` exists, runs end to end on the committed frames, and exits `0`.
- [ ] A bundle with a template present on one side only exits `2`, and the control was observed
      red with its exit code recorded.
- [ ] A bundle with no duplicate pair exits `2`, observed red.
- [ ] Requesting three raters and supplying two exits `2` naming the shortfall, observed red.
- [ ] A delta smaller than the measured MDE prints `INDETERMINATE` and does not appear in any
      aggregate the run prints.
- [ ] `scripts/round-next.ts` refuses a round ledger that reports a sub-MDE delta as a win or a
      loss, observed red.
- [ ] The record states in one clause that this is a model instrument, not the human blind
      session `docs/product/VISUAL-BASELINE.md` requires, and no charter result is claimed.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` passes.

## 7. Negative controls

Every row must be **observed red** with its exit code recorded before the matching pass is
written. A pass with no observed red is recorded `UNVERIFIED`.

| Control | Change | Expected | Status |
| --- | --- | --- | --- |
| `one-sided-template` | remove one template's frame from the after directory | exit `2` naming the template; no scores printed | **observed red, exit 2** |
| `no-duplicate-pair` | build a bundle with duplicate injection disabled | exit `2`; the run refuses to report scores without a resolution | **observed red, exit 2** |
| `rater-shortfall` | request `--raters 3`, supply two verdicts | exit `2` naming the shortfall | **observed red, exit 2** |
| `unparseable-verdict` | one rater returns malformed JSON | exit `2`; never silently drop to two raters | **observed red, exit 2** |
| `sub-mde-delta` | feed a delta of 1 with a measured MDE of 1 | `INDETERMINATE`, excluded from aggregates | **observed, exit 0, "No aggregate"** |
| `ledger-overclaim` | hand-edit a round ledger to call a sub-MDE delta a win | `round:next` rejects it | **observed red, exit 1** |
| `empty-bundle` | both directories empty | exit `2`, never `0` | **observed red, exit 2** |

## 8. Non-goals

- **Not a rubric change.** `docs/product/VISUAL-BASELINE.md` and its 4/5 floor are untouched. This
  PRD changes how confidently a score can be read, not what a score means.
- **Not a human session.** Three model raters are three model raters.
- **Not more raters as the answer.** The paired bundle is the fix; the raters are for the median
  and, more importantly, for measuring the spread. Phase 0 may cut them.
- **Not a re-scoring of rounds 1–9.** Only round 10's deltas are re-classified, because only round
  10 ran the two-critic split this PRD exists to correct.

## 9. Kill switches and rollback

- **If Phase 0 measures a spread under 1**, Phases 1–2 shrink as written above. Building a
  three-rater median against a resolution that does not need it is the kill switch firing.
- **If the MDE turns out to exceed 2**, the instrument cannot resolve even the doubled-HUD result
  that round 10 called its one real finding. In that case the loop stops optimising template
  visuals on model scores entirely and the human blind session becomes the blocking ask. Say so;
  do not lower the bar to keep the loop running.
- Everything here is a script and a JSON field. Rollback is deleting the npm entry.
