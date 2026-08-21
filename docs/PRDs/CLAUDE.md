<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

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

A red-green acceptance criterion states its mutation: which line, reverted, makes the test fail —
and pastes that failure. Five repair rounds in one batch were spent on reds produced by the wrong
thing failing; a test whose "red" survives the feature's removal proves nothing.
