# Batch — the three beta blockers this machine can move, and the instrument that stopped working

**Status: CLOSED, 2026-08-19.** All four PRDs are **COMPLETE** and archived individually to
`docs/PRDs/done/`. No device result, no mobile-readiness claim, and no platform-parity claim
exists for any PRD in it.

## Why this batch, today

`docs/strategy/ROADMAP.md` names five beta requirements. Rows 1 and 2 are held green on every
change. **Rows 3, 4 and 5 are the blockers**, and only two of them can move without something this
repository does not have:

| Beta row | Blocker | Movable here today? |
|---|---|---|
| 3 — a paired result vanilla cannot match | The exit gate asks the paired instrument to demonstrate a capability that instrument is designed to neutralise | **moved** — [PRD-079](../PRD-079-phase-2-exit-criteria.md); the gate was replaced and its first execution is red |
| 4 — parity is checkable, not asserted | The Android emulator lane had two contradicting ledgers and was red on what turned out to be a harness defect | **moved** — [PRD-160](../PRD-160-android-emulator-lane-repair-and-parity-adjudication.md); adjudicated, one number, still not green |
| 5 — a toolchain-free user ships from published artifacts | Ten release tags, zero surviving releases; needs a hosted run | **no** — [PRD-078](../../BLOCKED/requires-hosted-run/PRD-078-toolchain-free-consumer-proof.md), stays blocked |

Two more things were found by running the repository's own commands on `HEAD` while assembling
this batch, and neither had a PRD:

- **`pnpm budgets`** reports `14738/15000` framework LOC — 262 lines of headroom — and `78266/50000`
  native runtime LOC, an overshoot that grew from +3,851 to +28,266 since 2026-08-09 with no
  written justification anywhere.
- **`pnpm round:deletions`** crashes: `Error: Round 10 has no framework archive rows`. The sweep
  that finds deletable surface — one of the two commands the agent instructions name for the
  self-improvement loop — has been dead since round 10.

Both are [PRD-161](../PRD-161-the-kill-switch-has-no-working-instrument.md).

And the last round ledger named its own next action, which nobody ran:

> Next action: round 11 runs `scripts/visual-ab.ts` — both conditions in one blind bundle

Four of round 10's five visual gaps have had their template source changed since. **None of the
five has been re-scored.** Reading `sky.ts` and concluding a gradient reaches the screen is the
exact false signal that made the baseline necessary in the first place. That is
[PRD-159](../PRD-159-round-11-paired-visual-ab.md).

## The work

| PRD | What it closes | Complexity | State |
| --- | --- | --- | --- |
| [079](../PRD-079-phase-2-exit-criteria.md) | Beta row 3 — rewrites the Phase 2 exit criteria with the owner, now that the harness defect half of it has shipped as PRD-081 | 7 | COMPLETE — gate adopted by the owner; its one execution is RED and Phase 2 stays open |
| [160](../PRD-160-android-emulator-lane-repair-and-parity-adjudication.md) | Beta row 4's Android half — the overlay red is a harness defect, and `67/0/0` is adjudicated against `27/40/0` with provenance | 6 | COMPLETE — `67/0/0` reproduces, `27/40/0` retired; one row deferred to PRD-166 |
| [159](../PRD-159-round-11-paired-visual-ab.md) | Round 11 — one paired blind bundle with a measured minimum detectable effect, and a disposition for all five round-10 visual gaps | 4 | COMPLETE — MDE 1; gaps 4 and 5 re-opened with frames |
| [161](../PRD-161-the-kill-switch-has-no-working-instrument.md) | The framework LOC trigger 262 lines away with no attribution, the native trigger 28,266 past with no owner, and a dead `round:deletions` | 5 | COMPLETE |

## Order

**1. PRD-161 Phase 0 first, and it is cheap.** `round:deletions` is an input to any deletion
decision the other three might produce, and repairing a crashing script is a bounded change. The
rest of 161 can follow later in the day.

**2. PRD-160 second — done.** The overlay red was attributed to a **harness defect**: Android 15
stopped printing `mCurrentFocus` under `dumpsys window windows`, so the foreground guard could only
fail closed and 66 rows died before any pixel was compared. Repaired with a regression test; two
full lanes then measured `66 / 1 / 0` and adjudicated the two ledgers:
[`android-parity-2026-08-19.md`](../../../verification/android-parity-2026-08-19.md).

**3. PRD-159 third — done.** Two conditions captured, one blind bundle scored, five gaps disposed:
[`round-11-2026-08-19.md`](../../../verification/round-11-2026-08-19.md).

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

**Closed 2026-08-19.** All four PRDs finished and were archived individually to
`docs/PRDs/done/`, so this folder keeps only this README as the batch's record.

What the batch moved, and what it did not:

| Beta row | Before | After |
|---|---|---|
| 3 | A Phase 2 exit gate that could not be passed as written | A three-part gate adopted by the owner; its first execution is **RED** and claims no score points. Row still open, now on shipping a capability |
| 4 | Two contradicting Android ledgers, lane red on a bisected commit | One number: `67/0/0` reproduces, `27/40/0` retired. Row still **not green** — the lane exits `1` on [PRD-166](../../done/PRD-166-camera-parented-overlay-never-marks-on-android.md) |
| 5 | Untouched by design | Untouched. [PRD-078](../../BLOCKED/requires-hosted-run/PRD-078-toolchain-free-consumer-proof.md) still needs a hosted run |

Two instruments were also repaired: `pnpm round:deletions` runs again after being dead since round
10, and round 11 scored the five round-10 visual gaps that nobody had re-measured.

The bisect this batch was written on — `3677542` passes, `c842a6a` fails — **did not survive
execution.** The baseline's old script printed a generic `4/4 PASS` and never asserted the overlay,
and the current assertion finds `0` overlay pixels at that same baseline. There was no PRD-155
regression to attribute; the lane was reading a field its Android version had stopped printing.

## Deliberately outside this batch

- **Beta row 5.** PRD-078 needs one hosted release run with five green legs. CI minutes are scarce
  on this plan and the row is blocked on an external lane, not on work.
- **PRD-133's last red criterion.** Clearing it means publishing to npm — an outward-facing action
  that needs an owner decision, not an unattended run.
- **Any physical-device, iOS or arm64 result.** The emulator proves the emulator.
- **Repairing what PRD-159 re-opens.** The round measures; the repair is the next round's spend.
- **Raising any budget limit.** PRD-161 explicitly forbids it without a recorded owner decision.
