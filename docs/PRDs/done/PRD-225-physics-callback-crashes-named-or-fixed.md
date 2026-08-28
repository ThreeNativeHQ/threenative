---
prd_contract: v1
---

# PRD-225 — Physics callback crashes are named or fixed

**Status:** DELIVERED 2026-08-27 — Phase 0 answered (not reproducing at HEAD: 10/10 clean
fresh-install cold launches) and Phase 1' converted the green into the standing N-launch guard
(`packages/runtime-native/scripts/device-physics-stability.mjs`). Evidence:
[`docs/verification/prd-225-physics-callback-stability-2026-08-27.md`](../../verification/prd-225-physics-callback-stability-2026-08-27.md).
Scope is part of the answer: both original disagreeing observations were physical Pixel 8; the
10-launch answer is emulator-lane (x86_64) and the physical rerun stays open on the device lane.
Filed 2026-08-26 for the night batch.

**Complexity:** +1 probe harness, +2 native lifetime work if red = **MEDIUM mode**.

## Context

Two recorded facts disagree about whether physics callbacks crash tonight:

| Record | Observation |
| --- | --- |
| [PRD-222 reassessment trap table](../../verification/runtime-perf-state.md) | "Physics callback SIGSEGV — roughly 5 of 9 launches died in one session" |
| [PRD-222 loop log](../../verification/runtime-perf-state.md), staging-v3 pair | "zero SIGSEGV deaths in this pair after fresh installs" |

Both are Bayview on a physical Pixel 8. Candidate explanations for the disagreement, in order:
the staging pair's **fresh installs** cleared state (a warm-upgrade path keeps dying); `ebcc480d`
("run physics scene on enabled binary") removed one instance; or it is probabilistic and both
sessions sampled different tails of the same defect. The loop log ranks fixing this as next action
#1 because it multiplies every measurement: with crashes active, one clean 210 s capture costs
×2–4 attempts ≈ 7–14 minutes.

## Solution (probe first, fix second)

A deterministic relaunch probe decides whether HEAD crashes, independent of any single session's
luck. If red, root cause the native callback lifetime into Rapier steps with a minimal repro
before touching code — no speculative guards.

## Execution Phases

### Phase 0 — Decide if HEAD reproduces at all

**Files (1):** verification record (NEW).

- [x] Install the current Bayview APK fresh (`pm clear` or uninstall/reinstall), then
      cold-launch N=10, monitoring `pidof` + logcat tombstones through at least 60 s of live
      play. (Run 2026-08-27 on the emulator lane, x86_64 — not arm64; the physical arm stays
      open. See the verification record's scope section.)
- [ ] Red criterion named up front: ≥1 SIGSEGV/tombstone inside gameplay windows (live windows,
      `update.mean ≥ 3 ms`) in 10 launches = reproduced. Zero in 10 = not reproducing at HEAD;
      record that honestly under Phase 1's contract below.

### Phase 1 — If red: attribute and fix

- [ ] Tombstone stack names the crashing frame (engine, Rapier WASM, or bridge).
- [ ] Minimal repro: either a native conformance executable or a playtest scenario — startup
      attribute, callback identity, and payload pinned down before the fix.
- [ ] Red-green in one commit; mutation stated (revert which line → the repro dies again).
- [ ] Whether warm-upgrade-from-old-install re-triggers it decides if install freshness is part
      of the mechanism.

### Phase 1' — If green: convert to a guard instead

Zero deaths is a result, not silence:

- [x] The N=10 relaunch loop joins the device preflight / verification tooling so a regression
      reports itself on the next session rather than being rediscovered by hand mid-capture.
      (`packages/runtime-native/scripts/device-physics-stability.mjs`, one command.)
- [x] Refutation recorded in the loop log next to the original 5-of-9 observation (F5 row, with
      its scope limits inline).

## Verification

Record `docs/verification/prd-225-physics-callback-stability-<date>.md`.

1. The probe table: launches, timestamps, thermal/battery side conditions, deaths per launch.
2. Phase 1 red: tombstone excerpt pasted alongside the repro; fix commit carries its own red paste.
3. Phase 1' green: where the guard runs and what fails when physics crashes are simulated.

## Acceptance Criteria

- [x] One dated answer exists: reproduces-at-HEAD **no (emulator lane)**, from 10 controlled
      launches; the physical rerun stays open on the device lane.
- [x] Either the crash has a pinned minimal repro and a red-green fix, or the N=10 guard exists
      so the question can never again depend on whoever noticed last time. (Guard path: the
      guard exists.)
