---
prd_contract: v1
---

# PRD-225 — Physics callback crashes are named or fixed

**Status:** PROBE FIRST — filed 2026-08-26 for the night batch. Nothing in this file asserts the
crash still reproduces; the first phase exists to answer that before any code moves.

**Complexity:** +1 probe harness, +2 native lifetime work if red = **MEDIUM mode**.

## Context

Two recorded facts disagree about whether physics callbacks crash tonight:

| Record | Observation |
| --- | --- |
| [PRD-222 reassessment trap table](../../verification/prd-222-reassessment-2026-08-26.md) | "Physics callback SIGSEGV — roughly 5 of 9 launches died in one session" |
| [PRD-222 loop log](../../verification/prd-222-loop-log.md), staging-v3 pair | "zero SIGSEGV deaths in this pair after fresh installs" |

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

- [ ] Install the current arm64 Bayview APK fresh (`pm clear` or uninstall/reinstall), then
      cold-launch N=10, monitoring `pidof` + logcat tombstones through at least 60 s of live play.
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

- [ ] The N=10 relaunch loop joins the device preflight / verification tooling so a regression
      reports itself on the next session rather than being rediscovered by hand mid-capture.
- [ ] Refutation recorded in the loop log next to the original 5-of-9 observation.

## Verification

Record `docs/verification/prd-225-physics-callback-stability-<date>.md`.

1. The probe table: launches, timestamps, thermal/battery side conditions, deaths per launch.
2. Phase 1 red: tombstone excerpt pasted alongside the repro; fix commit carries its own red paste.
3. Phase 1' green: where the guard runs and what fails when physics crashes are simulated.

## Acceptance Criteria

- [ ] One dated answer exists: reproduces-at-HEAD yes/no, from ≥10 controlled launches.
- [ ] Either the crash has a pinned minimal repro and a red-green fix, or the N=10 guard exists
      so the question can never again depend on whoever noticed last time.
