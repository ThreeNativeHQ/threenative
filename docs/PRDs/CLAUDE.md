<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — docs/PRDs

Read `/AGENTS.md` first. This file is about filing, not about how the work gets done.

## Where a PRD lives

- **Finished** → `git mv` it to `docs/PRDs/done/` **in the commit that finishes it**.
- **Explicitly `BLOCKED`** → `docs/PRDs/BLOCKED/<reason>/`, where the folder names the missing
  evidence or failing gate. See `BLOCKED/README.md`.
- `NOT STARTED`, `PARTIAL`, `OPEN`, `SCOPING` and `PROPOSED` stay in their owning batch, even when a
  dependency is not ready.

**Never un-file a finished PRD by rewriting it.** Re-scoping is not a reason to pull a PRD out of
`done/` and replace it with a fresh plan: that deletes the ticked boxes and the landed commits that
justified them, and the work reads as never done. If finished work regressed or its scope grew,
either reopen the *same* file — keeping its ticked boxes and its evidence, adding the new items
unticked — or open a new PRD that cites the done one. A `git mv` out of `done/` needs a line in the
commit message naming what specifically regressed, with the commit or gate that shows it.

Grouped batches (`starter-kits/`, `native-performance-fixes/`, dated batch folders) move whole:
`git mv docs/PRDs/<batch>/ docs/PRDs/done/<batch>/` in the commit that closes the last PRD. Never
archive a batch while any PRD in it is partial — a blocked criterion is not completion. A PRD that
finishes ahead of its siblings gets archived on its own.

## Keep the PRD current while you work

The PRD is the live state of the work, not a plan written once. Update it as each piece lands, in
the same commit as the change:

- **Tick the checkbox** (`- [ ]` → `- [x]`) when that item is done *and* verified. A box ticked on
  unrun work is the same lie as a claimed gate.
- **Partial or abandoned** items stay `- [ ]` with a short note on the line below saying what is
  left or why it stopped — never delete the item to make the list look finished.
- **Move the status line** (`NOT STARTED` → `PARTIAL` → done, or the phase marker) with the boxes;
  a PRD whose boxes are all ticked but still reads `NOT STARTED` is drift.
- **Write the result beside the item** where it carries evidence: the command, the number, the exit
  code, the artifact path. One line, in the PRD — not a new report file (see Evidence below).
- Only when every box is ticked and the status says so does the archive move apply above.

If a PRD has no checkboxes and you are working it, add them as you discover the steps, then keep
them current the same way.

**Every phase carries its own boxes.** Acceptance criteria alone are not a progress record: they
are the last thing to go green, so a PRD whose only boxes sit under *Acceptance criteria* shows
zero progress until the whole thing is finished, and nobody ever ticks anything. Give each phase a
short checklist — the files wired, the required test passing, the observed red, the user
verification — and tick those as the phase lands. `prd-creator`'s phase template already has them;
do not compress them away.

**One box, one claim.** A criterion that conjoins several independent facts ("Windows, macOS and
Linux all do X *and* Y *and* Z") can never move from `[ ]` to `[x]`, because some clause is always
out of reach. Split it: one box per platform, per artifact, per property. Boxes you cannot reach
yet — a host you do not own, a credential you do not have — are still separate boxes, each naming
its blocker on the line below.

## One PR per PRD

**A PRD gets exactly one pull request, opened as a draft before phase 1 starts.** Never one PR per
phase: phase-sized PRs split the evidence across branches nobody re-reads, and the PRD's progress
stops being visible anywhere. Open the draft early, push each phase to it as that phase lands, and
let the PR grow.

The PR body carries the PRD's checklist — copy the boxes, keep them in the same order — and you
tick them there in the same push that ticks them in the PRD. The two must agree; a PR box ticked
ahead of the PRD is the same lie as a claimed gate.

Progress is a label, applied on every push and never more than one at a time:

| Label | Meaning | Colour |
|---|---|---|
| `prd:25%` | phase 1 landed and verified | `#d73a4a` red |
| `prd:50%` | half the phases landed and verified | `#e36209` orange |
| `prd:75%` | all but the last phase landed and verified | `#fbca04` yellow |
| `prd:100% — ready` | every phase and every acceptance box ticked; take the PR out of draft | `#0e8a16` green |

Round to the nearest bucket by *verified* phases, never by lines written or files touched. A PRD
whose phases are all in but whose acceptance criteria are not yet ticked is `prd:75%`, not ready.
`scripts/prd-progress.ts` computes the bucket from the PRD file; `pnpm prd:progress <file>` prints
the label to apply.

## Try a blocked reason before you believe it

`BLOCKED/` folders name a missing tool or lane, and several have outlived the condition that put
them there — a device that is now attached, an SDK installed but off `PATH`, an emulator that boots
fine. Attempt the blocked step once and record what actually happened before filing or re-filing
under that reason; two lanes were once parked for a day on a tool that was on disk the whole time.

## Evidence

Keep routine verification results in the existing PRD, PR or response. Creating or editing a PRD
does not require a verification report, an evidence ledger, pasted logs or artificial red/green
checks. Create a separate file only when the user requests one or an existing automated workflow
consumes it. The self-improvement loop uses `docs/verification/round-*.md`; those workflow records
are distinct from routine planning and editing.

## Retention — evidence has a lifecycle, and `pnpm budgets` enforces it

Evidence goes **live → cited → deleted**. What keeps a file is a *citation*, not its age: a round
ledger, a done PRD, an open PRD, or a script that names it — or one that opens its directory as a
root, which no by-name scan can see, so those roots are listed in `scripts/evidence-citations.ts`.
`docs/benchmark/SCREENSHOT-RETENTION.md` is generated from that scan; never hand-edit it.

The tracked-byte caps in `scripts/check-evidence-budget.ts` fail closed, and raising one needs its
own commit saying why. The report still prints file counts and duplicate-byte measurements for
cleanup work, but those measurements do not block a change. Generated sweep instruction files,
Git/read failures and byte overages remain hard failures.

Before deleting tracked evidence, obtain owner authorization and check its actual consumers.
Workflow records need the affected workflow checks; removing an unused planning report does not
require unrelated round or release gates.

Runtime/core performance findings update `docs/verification/runtime-perf-state.md` in place
(owner decision, 2026-08-27). Do not open another report for each run.

Under `docs/benchmark/sweeps/` the generated arm sources are untracked build output; the
measurements beside them — `proof.json`, `proof-artifacts/`, captures — are the benchmark record
and stay in git. Three test suites read them by path.

For behavior changes, regression evidence must exercise the changed behavior. Planning and prose
edits do not require deliberate breakage or a separate record of document checks.
