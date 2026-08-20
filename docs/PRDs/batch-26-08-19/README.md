# Batch — the three beta blockers this machine can move, and the instrument that stopped working

**Status: ACTIVE, 2026-08-19.** PRD-161 and PRD-159 are **COMPLETE**; the batch remains ACTIVE for
PRD-079 and PRD-160. No device result, no mobile-readiness claim, and no platform-parity claim
exists for any PRD in it.

## Why this batch, today

`docs/strategy/ROADMAP.md` names five beta requirements. Rows 1 and 2 are held green on every
change. **Rows 3, 4 and 5 are the blockers**, and only two of them can move without something this
repository does not have:

| Beta row | Blocker | Movable here today? |
|---|---|---|
| 3 — a paired result vanilla cannot match | The exit gate asks the paired instrument to demonstrate a capability that instrument is designed to neutralise | **yes** — [PRD-079](../done/PRD-079-phase-2-exit-criteria.md), half two |
| 4 — parity is checkable, not asserted | The Android emulator lane has two contradicting ledgers, and is currently red on a bisected commit | **yes** — [PRD-160](./PRD-160-android-emulator-lane-repair-and-parity-adjudication.md) |
| 5 — a toolchain-free user ships from published artifacts | Ten release tags, zero surviving releases; needs a hosted run | **no** — [PRD-078](../BLOCKED/requires-hosted-run/PRD-078-toolchain-free-consumer-proof.md), stays blocked |

Two more things were found by running the repository's own commands on `HEAD` while assembling
this batch, and neither had a PRD:

- **`pnpm budgets`** reports `14738/15000` framework LOC — 262 lines of headroom — and `78266/50000`
  native runtime LOC, an overshoot that grew from +3,851 to +28,266 since 2026-08-09 with no
  written justification anywhere.
- **`pnpm round:deletions`** crashes: `Error: Round 10 has no framework archive rows`. The sweep
  that finds deletable surface — one of the two commands the agent instructions name for the
  self-improvement loop — has been dead since round 10.

Both are [PRD-161](../done/PRD-161-the-kill-switch-has-no-working-instrument.md).

And the last round ledger named its own next action, which nobody ran:

> Next action: round 11 runs `scripts/visual-ab.ts` — both conditions in one blind bundle

Four of round 10's five visual gaps have had their template source changed since. **None of the
five has been re-scored.** Reading `sky.ts` and concluding a gradient reaches the screen is the
exact false signal that made the baseline necessary in the first place. That is
[PRD-159](../done/PRD-159-round-11-paired-visual-ab.md).

## The work

| PRD | What it closes | Complexity | State |
| --- | --- | --- | --- |
| [079](../done/PRD-079-phase-2-exit-criteria.md) | Beta row 3 — rewrites the Phase 2 exit criteria with the owner, now that the harness defect half of it has shipped as PRD-081 | 7 | COMPLETE — gate adopted by the owner; its one execution is RED and Phase 2 stays open |
| [160](./PRD-160-android-emulator-lane-repair-and-parity-adjudication.md) | Beta row 4's Android half — attributes the emulator overlay red bisected to `c842a6a`, then adjudicates `67/0/0` against `27/40/0` with provenance | 6 | PROPOSED |
| [159](../done/PRD-159-round-11-paired-visual-ab.md) | Round 11 — one paired blind bundle with a measured minimum detectable effect, and a disposition for all five round-10 visual gaps | 4 | COMPLETE — MDE 1; gaps 4 and 5 re-opened with frames |
| [161](../done/PRD-161-the-kill-switch-has-no-working-instrument.md) | The framework LOC trigger 262 lines away with no attribution, the native trigger 28,266 past with no owner, and a dead `round:deletions` | 5 | COMPLETE |

## Order

**1. PRD-161 Phase 0 first, and it is cheap.** `round:deletions` is an input to any deletion
decision the other three might produce, and repairing a crashing script is a bounded change. The
rest of 161 can follow later in the day.

**2. PRD-160 next, because it has a boot-and-wait shape.** The emulator takes about 30 s to boot
and the lane runs unattended; starting it early overlaps its runtime with reading work elsewhere.
Its Phase 1 attribution — engine bug or harness bug — must be written before any code is touched.

**3. PRD-159 third — done.** Two conditions captured, one blind bundle scored, five gaps disposed:
[`round-11-2026-08-19.md`](../../verification/round-11-2026-08-19.md).

**4. PRD-079 last, and only its half two — done.** The rewrite and its evidence were prepared, the
owner adopted the gate on 2026-08-19, and it was executed once. The execution is RED and claims no
score points.

Within each PRD, its own phases are the order, and a later phase does not start on an unrun
earlier one.

## What this batch can be executed against

Everything here runs on this machine: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm budgets`,
`pnpm round:deletions`, browser playtests under `sh scripts/xvfb.sh`, `pnpm visuals:baseline`,
`scripts/visual-ab.ts`, and the Android emulator lane via
`ANDROID_HOME=~/Android/Sdk node packages/runtime-native/scripts/verify-android-first-proof.mjs
--device emulator-5554` — `adb` lives at `~/Android/Sdk/platform-tools/adb` and is simply off
`PATH`. **No phone, no Mac, no CI minute and no external person is required by anything in this
folder.**

`xcrun` is genuinely absent: this is Linux, so every iOS row stays UNVERIFIED here.

## Batch completion

This folder stays active while any PRD in it is `PROPOSED`, `OPEN`, `PARTIAL`, `BLOCKED` or
otherwise unfinished. Archive the whole folder to `docs/PRDs/done/batch-26-08-19/` in the commit
that closes the last one, with executed evidence linked and every acceptance row resolved. A PRD
that finishes well ahead of its siblings is archived individually. PRD-160 is explicitly permitted
to end in `docs/PRDs/BLOCKED/requires-physical-device/` if Phase 1 attributes the overlay red to
something only a phone can decide — that is a result, not a failure.

## Deliberately outside this batch

- **Beta row 5.** PRD-078 needs one hosted release run with five green legs. CI minutes are scarce
  on this plan and the row is blocked on an external lane, not on work.
- **PRD-133's last red criterion.** Clearing it means publishing to npm — an outward-facing action
  that needs an owner decision, not an unattended run.
- **Any physical-device, iOS or arm64 result.** The emulator proves the emulator.
- **Repairing what PRD-159 re-opens.** The round measures; the repair is the next round's spend.
- **Raising any budget limit.** PRD-161 explicitly forbids it without a recorded owner decision.
