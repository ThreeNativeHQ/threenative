# AGENTS.md — docs/PRDs

Read `/AGENTS.md` first. This file is about filing, not about how the work gets done.

## Where a PRD lives

- **Finished** → `git mv` it to `docs/PRDs/done/` **in the commit that finishes it**.
- **Explicitly `BLOCKED`** → `docs/PRDs/BLOCKED/<reason>/`, where the folder names the missing
  evidence or failing gate. See `BLOCKED/README.md`.
- `NOT STARTED`, `PARTIAL`, `OPEN`, `SCOPING` and `PROPOSED` stay in their owning batch, even when a
  dependency is not ready.

Grouped batches (`starter-kits/`, `native-performance-fixes/`, dated batch folders) move whole:
`git mv docs/PRDs/<batch>/ docs/PRDs/done/<batch>/` in the commit that closes the last PRD. Never
archive a batch while any PRD in it is partial — a blocked criterion is not completion. A PRD that
finishes ahead of its siblings gets archived on its own.

## Try a blocked reason before you believe it

`BLOCKED/` folders name a missing tool or lane, and several have outlived the condition that put
them there — a device that is now attached, an SDK installed but off `PATH`, an emulator that boots
fine. Attempt the blocked step once and record what actually happened before filing or re-filing
under that reason; two lanes were once parked for a day on a tool that was on disk the whole time.

## Evidence

`docs/verification/` is the evidence record: one file per run, naming what executed and what did
not. A gate result that lives only in a commit message does not exist. The self-improvement loop
resumes from `docs/verification/round-*.md` — `pnpm round:next` computes the single next action and
`pnpm round:deletions` reports exports unreached across consecutive rounds.

## Retention — evidence has a lifecycle, and `pnpm budgets` enforces it

Evidence goes **live → cited → deleted**. What keeps a file is a *citation*, not its age: a round
ledger, a done PRD, an open PRD, or a script that names it — or one that opens its directory as a
root, which no by-name scan can see, so those roots are listed in `scripts/evidence-citations.ts`.
`docs/benchmark/SCREENSHOT-RETENTION.md` is generated from that scan; never hand-edit it.

Three caps in `scripts/check-evidence-budget.ts` fail closed, and raising one needs its own commit
saying why: tracked bytes and file counts per tree, and **1,000 lines per evidence file**. Past the
line cap a file consolidates in place, keeping every result a ledger or a done PRD cites. Two files
are exempt with their reasons recorded beside them — a pinned third-party source snapshot a live
PRD's borrow map addresses, and the consolidation target below.

Deleting tracked evidence needs the owner's checkpoint, and `pnpm round:next`, `pnpm
round:deletions` and `pnpm alpha:bar` must print byte-identical output either side of it.

**The one consolidation exception — runtime/core performance records go into
`docs/verification/runtime-perf-state.md`** (owner decision, 2026-08-27), now one case of the rule
above: a new performance finding updates that file in place instead of opening another
`perf`-report file, which keeps the frame ledger, the lever graveyard and the method rules in one
place. Everything else stays one file per run.

`docs/benchmark/sweeps/` is untracked build output — regenerable arm sources, on disk, not in git.

A red-green acceptance criterion states its mutation: which line, reverted, makes the test fail —
and pastes that failure. Five repair rounds in one batch were spent on reds produced by the wrong
thing failing; a test whose "red" survives the feature's removal proves nothing.
