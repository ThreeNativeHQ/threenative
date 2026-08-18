# Batch — the phone, the instrument, and the front door, 2026-08-16

**Status: PARTIALLY EXECUTED, 2026-08-17. Four of seven PRDs are archived; three remain active
and none is blocked.** Five new PRDs, PRD-125 through PRD-129, plus four existing PRDs this batch
schedules for execution on hardware. No mobile, iOS or performance claim is made anywhere in it —
the point of the batch is to make three of those claims *measurable*, not to assert them.

| PRD | State, read off the tree 2026-08-17 | What it needs to reach `done/` |
| --- | --- | --- |
| [129](../done/PRD-129-licensing-and-the-studio-split.md) | **DONE**, archived | — |
| [130](./PRD-130-android-default-js-engine.md) | six phases executed; the conformance row was **attempted 2026-08-17 and not obtained** — the parity lane could not photograph the app, [record](../../verification/prd-130-conformance-attempt-2026-08-17.md) | dismiss the device's test-app dialog, then one clean run |
| [131](../done/PRD-131-recover-the-qualification-orchestrator.md) | **DONE 2026-08-17**, archived — last criterion run on the Pixel 8, no signal 6, [evidence](../../verification/prd-131-first-proof-2026-08-17.md) | — |
| [127](./PRD-127-device-measurement-preflight.md) | code landed on all four lanes; every physical criterion `UNVERIFIED` | the device lanes observed red on the phone |
| [126](../done/PRD-126-the-visual-instrument-noise-floor.md) | **DONE 2026-08-17**, archived — Phase 0 run with three blind raters, [evidence](../../verification/prd-126-phase-0-2026-08-17.md) | — |
| [128](./PRD-128-android-qualification-split.md) | Phase 0 only; the split itself is not done | Phases 1 onward |
| [125](../done/PRD-125-docs-and-readme-overhaul.md) | **DONE 2026-08-17**, archived — all ten criteria run, [evidence](../../verification/prd-125-docs-and-readme-2026-08-17.md) | — |

**Nothing here belongs in `BLOCKED/`.** The lifecycle rule reserves that folder for a status that
is explicitly BLOCKED on a named external dependency; `NOT STARTED`, `PARTIAL` and `PROPOSED` stay
in their owning batch. The Pixel 8 is attached and every remaining criterion above runs on this
machine, so these are unfinished, not blocked — and the batch cannot be archived while any of them
is open.

**This file is a map. The work is indexed in two files, and they do not overlap.**

**The line is each PRD's own complexity rating, and it falls cleanly between 4 and 5.**

| Index | Complexity | Who runs it | Contents |
| --- | --- | --- | --- |
| [`README-LOW-COMPLEXITY.md`](./README-LOW-COMPLEXITY.md) | **2, 4, 4** | a cheap model, today | PRD-129 §3–§4, PRD-125, PRD-127's code — no hardware, nothing irreversible |
| [`README-HIGH-COMPLEXITY.md`](./README-HIGH-COMPLEXITY.md) | **5, 6, 7** | the operator, with the phone | PRD-126, PRD-128, PRD-129 §5–§7, and the four hardware runs |

Hand the low-complexity file over on its own. It is self-contained by design, and it never
mentions the high-complexity lane — a model that cannot read about PRD-128 cannot wander into it.

**Low does not mean unsupervised.** Two things in the low lane are judgement, not mechanics,
and both need reading before they land: the new `README.md` prose that PRD-125 §3.2 produces,
and the retention recommendation PRD-125 §6.3 writes. Everything else in that lane is a
command with an expected exit code.

## Why this batch, today

Three things changed, and between them they decide what is worth building.

1. **A physical Pixel 8 is available to the operator** (`shiba`, arm64-v8a, Android 17,
   Mali-G715). Four PRDs are `PARTIAL` with a phone-shaped hole in them, and one is filed
   under `BLOCKED/requires-physical-device/`.
2. **Round 10 measured its own instrument and found it cannot resolve the changes it was
   making.** `action-rpg` was touched by nothing and moved a full point between two raters.
   Five of the round's seven deltas were inside that noise.
3. **The repository is public, publishes seven packages, and grants nobody any rights.**
   There is no `LICENSE` file and six of seven packages declare no `license` field, so the
   MIT engine is open source in appearance only. The front page opens on the word VOID and
   never mentions `pnpm create threenative`.

Three lanes that do not block each other: put the phone to work, make the visual loop's
numbers mean something, and make the repository legible and licensed to somebody who is not
us.

## The five new PRDs

| PRD | What it closes | Lane |
| --- | --- | --- |
| [125](../done/PRD-125-docs-and-readme-overhaul.md) | A README that opens on VOID, 18 broken links, and 189 MiB of docs in a 199 MiB repository | low |
| [126](../done/PRD-126-the-visual-instrument-noise-floor.md) | The visual loop cannot tell a change from rater variance, and has already optimised noise once | high |
| [127](./PRD-127-device-measurement-preflight.md) | One of four device lanes checks the phone's condition; three check nothing | code is **low**, verification is **high** (needs the phone) |
| [128](./PRD-128-android-qualification-split.md) | PRD-056 is blocked on the *union* of four dependencies; the part a Pixel 8 can run today is held up by an Apple signing identity nobody has | high |
| [129](../done/PRD-129-licensing-and-the-studio-split.md) | The engine grants no rights to anyone, and the paid editor's source sits in a public MIT repository | **§3–§4 low, §5–§7 high** |

Ordering across the two lanes: PRD-129 §3 unblocks PRD-125's licence section. PRD-127's code
must land before PRD-117, PRD-074 and PRD-066 run. Nothing else is ordered.

## Deliberately left out

Five defects found by the last two rounds and by writing this batch, recorded so the next
round does not rediscover them and so their absence is a decision rather than an oversight:

1. **`pnpm sweep:archive` reports success while deleting the builder's own directories.**
   Round 9's 27 iteration screenshots, including its final hero shot, no longer exist anywhere
   (`scripts/sweep-archive.ts:96`, `copyAppShell`). Round 9 disposed this to a PRD number that
   another PRD took the same day, so it has had no owner since 2026-08-15.
2. **The test suite leaks its temp directories and then fails on the space they occupy.** 146
   leaked `/tmp/threenative-*` directories on round 9; 34 present as this was written. It has
   been misdiagnosed as machine contention twice.
3. **A scaffolded project's default gate asserts a starter internal.**
   `templates/starter/playtests/seed.playtest.json:13` asserts `levelX` equals
   `-0.6056551518850029`. The user's first level edit turns their own `pnpm test` red.
4. **`@threenative/core`, `@threenative/ui` and `@threenative/runtime-native` publish with no
   `README.md`** and render as blank pages on npm. Three separate documents; PRD-125 §9
   records it as a follow-up.
5. **`docs/PRDs/alpha-readiness/README.md` says `EXECUTED, 2026-08-16`** while the folder is
   still active. By the lifecycle rule it should have been archived in the commit that closed
   its last PRD.

None blocks this batch. Item 1 destroys evidence every time a sweep runs, which is the one
with a deadline attached.

## What this batch does not claim

**Not mobile-ready** — one Android phone is not mobile, and iOS has no physical evidence at
all. **Not a better README, only an honest one** — nobody outside this project has read the
front page, and whether it makes anyone start is unmeasurable until a stranger tries, which
is PRD-080, blocked on a person. Each lane's index repeats the limits that bind it.
