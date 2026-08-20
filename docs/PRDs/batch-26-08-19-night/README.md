# Batch — the night of 2026-08-19: the one beta blocker that is open to work, the template regression that was measured and not repaired, and two instruments that are down

**Status: PROPOSED, 2026-08-19 (night).** Nothing in this folder has executed. Every number quoted
below was observed on `HEAD` (`21960efd`) while assembling the batch, and is recorded as a prior
observation rather than as a result of any PRD in it.

## Why this batch, tonight

The day batch [`batch-26-08-19`](../batch-26-08-19/README.md) closed three of its four PRDs. What it
produced was not a finish line but a shortlist, because two of its results explicitly deferred their
own next spend and two of its instruments broke after it was written:

| Observed tonight on `HEAD` | Consequence | PRD |
|---|---|---|
| The adopted Phase 2 gate has one execution and it is **RED** — the subject was pre-adoption work and the control was a plugin deletion, not a vanilla arm | Beta row 3, the only beta blocker open to work rather than to an owner decision or a hosted run, has no path except shipping something new | [162](./PRD-162-a-capability-that-can-pass-the-adopted-phase-2-gate.md) |
| Round 11 re-opened two template gaps and refused to repair them in its measurement lane — the `starter` lost **2 points, above resolution** | The first template a cold agent scaffolds is measurably worse than its own earlier self, and nothing is scheduled to fix it | [163](./PRD-163-round-12-repairs-what-round-11-re-opened.md) |
| `pnpm round:next` and `pnpm round:deletions` **both exit 1** on round 11's archives | The two commands the root instructions name for the self-improvement loop are down, one day after PRD-161 repaired them for a different shape | [164](./PRD-164-the-round-loop-is-dead-again.md) |
| `pnpm budgets` reports **15,025/15,000** framework LOC with "packages moved since last recorded attribution: none" | The kill switch's own counter is past its trigger with nobody named, and the `ui` package's `Undecided` row from this morning is unresolved evidence debt | [165](./PRD-165-the-framework-counter-crossed-its-own-trigger.md) |

## The work

| PRD | What it closes | Complexity | State |
| --- | --- | --- | --- |
| [164](./PRD-164-the-round-loop-is-dead-again.md) | The loop's two navigation commands, dead again on a shape PRD-161's repair did not cover | 3 | PROPOSED |
| [163](./PRD-163-round-12-repairs-what-round-11-re-opened.md) | Round 11's two re-opened gaps — the `starter` LOSS and the `minimal` HUD contradiction — repaired and re-measured blind | 5 | PROPOSED |
| [162](./PRD-162-a-capability-that-can-pass-the-adopted-phase-2-gate.md) | Beta row 3 — one post-adoption capability, a real vanilla control arm, a same-subject negative control | 8 | PROPOSED |
| [165](./PRD-165-the-framework-counter-crossed-its-own-trigger.md) | The framework counter 25 lines past its trigger, and the `ui` package's undecided row | 4 | PROPOSED |

## Order

**1. PRD-164 first, and it is under an hour.** It is the cheapest thing here and it is an input to
two of the others: PRD-163 has to validate a round-12 ledger, and PRD-165 may not claim a deletion
candidate from any source other than the repaired sweep.

**2. PRD-162 starts next and runs longest.** It is the only item that touches the beta bar, it has a
selection phase that must be written before code, and it has a native leg whose build is slow. Start
it early so its `pnpm native:build` overlaps with reading and repair work elsewhere. It is explicitly
permitted to end PARTIAL with a named unexecuted leg.

**3. PRD-163 fills the capture waits.** Its two repairs are small; its paired capture and blind score
are long and unattended, which is the right shape for a night.

**4. PRD-165 last, because Phase 3 needs the sweep PRD-164 repairs** and its `ui` audit is reading
work that does not block anything else.

**[PRD-160](../batch-26-08-19/PRD-160-android-emulator-lane-repair-and-parity-adjudication.md) stays
in the day batch and stays owned there.** It is not re-filed here. If the emulator is free, its
boot-and-wait shape overlaps well with any of the above — but its Phase 1 attribution must be written
before any code is touched, and re-running the parity lane while it is red on an unrelated defect
produces a third disputed ledger.

Within each PRD, its own phases are the order, and a later phase does not start on an unrun earlier
one.

## What this batch can be executed against

Everything here runs on this machine: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:templates`,
`pnpm budgets`, `pnpm round:next`, `pnpm round:deletions`, browser playtests under
`sh scripts/xvfb.sh` with `--browser-recipe webgpu`, `pnpm visuals:baseline`, `scripts/visual-ab.ts`,
`scripts/score-blind.ts`, `pnpm tsx scripts/count-loc.ts`, and the native desktop lane via
`pnpm native:build` and `pnpm native:verify:desktop`.

**No phone, no Mac, no CI minute, no npm publication and no external person is required by anything
in this folder.** `xcrun` is genuinely absent — this is Linux — so every iOS row stays UNVERIFIED.

## Rules this batch inherits and does not renegotiate

- **Never claim a gate you did not run.** Paste the output. "Unverified" is an acceptable answer, and
  four of these PRDs have a permitted red ending.
- **Red-green, bugfixes included.** The reproduction lands before the fix, in the same commit.
- **Fail closed everywhere.** PRD-164 in particular may not make a command exit `0` by ignoring
  missing data — that is the defect, not the repair.
- **No limit is raised.** Not `frameworkLoc`, not `nativeRuntimeLoc`, not a template LOC cap.
- **Measurement and repair stay in separate lanes.** Round 12 does not repair what it is measuring in
  the same worktree, and it does not read source to conclude that a pixel reached the screen.

## Batch completion

This folder stays active while any PRD in it is `PROPOSED`, `OPEN`, `PARTIAL`, `BLOCKED` or otherwise
unfinished. Archive the whole folder to `docs/PRDs/done/batch-26-08-19-night/` in the commit that
closes the last one, with executed evidence linked and every acceptance row resolved. A PRD that
finishes well ahead of its siblings is archived on its own.

## Deliberately outside this batch

- **The native runtime's +28,289 LOC overshoot.** It needs an owner decision about what the native
  host may weigh, not an unattended night's deletion. It stays reported and unowned.
- **Beta row 5 / PRD-078.** It needs one hosted release run with five green legs; CI minutes are
  scarce and the row is blocked on a lane, not on work.
- **PRD-133's last red criterion.** Clearing it means publishing to npm — an outward-facing action
  that needs an owner decision.
- **Any physical-device, iOS, arm64 or mobile-readiness claim.**
- **The human visual baseline.** Round 12's raters are models. `docs/product/VISUAL-BASELINE.md`
  requires a human blind session, and no model score may be converted into that claim.
