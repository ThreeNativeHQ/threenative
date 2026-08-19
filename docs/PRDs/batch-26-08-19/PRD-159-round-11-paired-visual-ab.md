---
prd_contract: v1
---

# PRD-159 — Round 10 named five visual defects, four were changed, and nobody scored the result

**Status:** PROPOSED, 2026-08-19. Nothing below has executed. §1 is a read of the tree and of
`docs/verification/template-visual-baseline-2026-08-16.md`; it contains no new score.

**Outcome:** the seven templates carry a paired, self-calibrating visual score with a stated
minimum detectable effect, so "the template quality floor moved" is a measurement instead of a
belief — and the round-10 gap list is either closed with evidence or re-opened with evidence.

**Depends on:** nothing. `scripts/visual-ab.ts` and `pnpm visuals:baseline` both exist and run on
this machine.

**Blocks:** any future claim that a template change improved how a generated project looks. It does
not block [PRD-079](./PRD-079-phase-2-exit-criteria.md), which measures the paired *game* arms.

**Complexity: 4 → MEDIUM mode.** No new module. One capture of before-frames from a known commit,
one capture of after-frames from `HEAD`, one bundle, one scored run, one ledger.

**Blast radius: ~10 files.** `docs/verification/round-11-2026-08-19.md`,
`docs/verification/visuals/**`, and template source under
`packages/create-threenative/templates/*/src/render/` only if the run re-opens a gap.

---

## 1. What is actually true today

Round 10 is the last ledger on disk. It scored every template's own first frame for the first
time and found **2 of 7 at the stated 4/5 floor, mean 2.86**
(`docs/verification/template-visual-baseline-2026-08-16.md`).

It listed five gaps and recorded its own next action verbatim:

> Next action: round 11 runs `scripts/visual-ab.ts` — both conditions in one blind bundle, so each
> rater scores before and after and its own calibration cancels in the difference

That run has not happened. `docs/verification/` ends at `round-10-2026-08-16.md`.

Meanwhile the tree changed under four of the five gaps. Read on `HEAD` today:

| Gap | Round-10 defect | State of the source now | Scored? |
|---|---|---|---|
| 1 | `shooter` and `platformer` draw two HUDs at once | Neither template imports `createHud` any more; `minimal` is now the only template that does. Shape A appears to have been taken | **no** |
| 2 | `defense` and `racing` have no sky gradient | Both now have a `src/render/sky.ts` carrying a gradient/vertex-colour reference | **no** |
| 3 | `platformer` fog washes the frame to one value band | Template render source changed; the fog range was not re-measured | **no** |
| 4 | `starter`'s hero is an unmodified torus-knot | Unverified in this read | **no** |
| 5 | `minimal`'s HUD reads `ITEMS 20` with zero items | `minimal/src/scenes/Play.ts:28` still calls `createHud(..., "SCORE", "ITEMS")` | **no** |

**Gap 2 is the one that should make this uncomfortable.** Round 10's own account of why the
baseline was needed is that "four templates shipped a sky gradient which never reached the screen,
for months" — a gradient *existing in source* was the exact false signal that made the baseline
necessary. Reading `sky.ts` and concluding gap 2 is closed repeats that error one level up.

## 2. Why a re-run of `visuals:baseline` is not the answer

`scripts/visual-ab.ts` states the defect in round 10's method in its own header: round 10 scored
the before frames with one critic and the after frames with another, and read the difference as a
result. A template nobody touched moved a full point between those raters. A second
single-condition baseline would produce a second number with the same unknown error bar, and the
difference between them would again be rater variance wearing a result's clothes.

The paired bundle is the instrument that exists for this and has never been run.

## 3. Solution

Run the instrument once, end to end, and write the ledger.

- **Before frames** come from the commit round 10 measured, `937085e1`, captured by the same
  harness on the same adapter as the after frames.
- **After frames** come from `HEAD`.
- Both go into **one** shuffled bundle with duplicate pairs, so the run measures its own
  resolution. Any delta at or under that resolution is `INDETERMINATE` and is excluded from every
  aggregate, which is the script's existing fail-closed behaviour and is not to be relaxed.
- Every gap in round 10's list gets one of three dispositions in the ledger: **closed** with a
  delta above resolution, **INDETERMINATE**, or **re-opened** with the frame that shows it.

No template is edited before the run. A change made to chase a number the instrument has not yet
produced is the thing this PRD exists to stop.

## 4. Execution phases

A later phase does not start on an unrun earlier one.

### Phase 0 — Capture both conditions

1. Capture the after set from `HEAD`: `sh scripts/xvfb.sh pnpm visuals:baseline`, headed, on a
   real adapter. **Record `adapter.info` in the ledger and fail the run if it names
   `swiftshader`** — a WebGPU run that does not name its adapter is not evidence.
2. Capture the before set from `937085e1` in a detached worktree, with the same command and the
   same recipe, into a separate directory.
3. Assert seven frames on each side and no template present on one side only. The script already
   fails closed on this; the phase records that it did.

### Phase 1 — Score one bundle

```sh
pnpm tsx scripts/visual-ab.ts --before <before-dir> --after <after-dir> \
  --out docs/verification/visuals/ab-2026-08-19 --duplicates 2 --raters 3
# then score the bundle blind and re-run with --verdict <file> per rater
```

Raters are fresh read-only critics that are never told which condition a frame belongs to and are
forbidden from reading the reveal.

### Phase 2 — Dispose of all five gaps

Write `docs/verification/round-11-2026-08-19.md` with: the run's measured resolution, the per
template delta, the disposition of each round-10 gap, and the mean against the 4/5 floor.

Gap 1 gets one extra row that the score cannot supply: **`platformer` claims desktop, and desktop
is native.** If Shape A was taken, the platformer now ships with no HUD on native. State whether
that capability loss happened, in one sentence, with the file that shows it. This is a fact about
the tree, not a taste question, and it is the cost round 10 recorded before anyone chose.

### Phase 3 — Re-open, do not repair

Any gap the run re-opens is written down with its frame and left open. Repairing it is the next
round's spend and its own decision. This PRD ships a measurement, not a redesign.

## 5. Verification

| # | Check | Expected |
|---|---|---|
| 1 | `adapter.info` recorded for both conditions | a real Vulkan adapter, never `swiftshader` |
| 2 | Bundle contains duplicate pairs | run reports a resolution; a bundle with none fails closed |
| 3 | Delta table | every template has a row; `INDETERMINATE` rows excluded from aggregates |
| 4 | Round-10 gap dispositions | 5 of 5 disposed |
| 5 | `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` | green |
| 6 | Template source diff attributable to this PRD | empty, unless Phase 3 explicitly records why |

## 6. Acceptance criteria

1. `docs/verification/round-11-2026-08-19.md` exists, names both commits, both adapters, the rater
   count, and the run's minimum detectable effect.
2. All five round-10 gaps carry a disposition of closed, `INDETERMINATE`, or re-opened, each with
   the evidence that produced it.
3. The ledger states the mean against the 4/5 floor and does **not** claim the human blind session
   that `docs/product/VISUAL-BASELINE.md` requires. A model score is a model score.
4. The platformer's native HUD state after gap 1 is stated as a fact with a file reference.
5. The four required gates are green.
