---
prd_contract: v1
---

# PRD-160 — The Android emulator lane is red on a bisected commit, and beta row 4's Android half has been open since the day two ledgers disagreed

**Status:** PROPOSED, 2026-08-19. Nothing below has executed. The bisect in §1.2 was performed on
one booted emulator on 2026-08-19 and is recorded here as a prior observation, not as this PRD's
result. **No physical-device, iOS, or mobile-readiness claim is made or licensed by anything in
this file.**

**Outcome:** the Android emulator gate is green or its red is attributed to a named defect with an
owner, and the two contradicting Android parity ledgers are adjudicated the way the desktop pair
already was — so beta row 4 ("web/native parity is checkable, not asserted") has one Android
number instead of two.

**Depends on:** nothing external. `adb` is at `~/Android/Sdk/platform-tools/adb`, four AVDs exist,
and `threenative-prd050` boots on KVM in about 30 s. **This does not need CI minutes and does not
need a phone.**

**Blocks:** beta row 4 aggregate. [PRD-076](../done/PRD-076-tier-1-parity-reconciliation.md)
adjudicated the desktop lane on 2026-08-15 and explicitly left Android open.
[PRD-054](../BLOCKED/requires-parity-rerun/PRD-054-write-once-run-anywhere.md) and
[PRD-064](../PRD-064-tier-1-native-reliability.md) both carry an Android cell this settles.

**Complexity: 6 → MEDIUM mode.** One bisected regression to attribute across a web/native seam, one
lane re-run, one adjudication written against two existing ledgers.

**Blast radius: ~15 files.** `packages/runtime-native/src/` (only if the defect is there),
`docs/verification/android-parity-2026-08-19.md`, and superseded banners on the two ledgers it
adjudicates.

---

## 1. The two problems, in the order they have to be solved

### 1.1 Beta row 4's Android half is two numbers

The roadmap records the same lane, on the same device, on the same day, measured twice:

| Ledger | Android emulator result |
|---|---|
| `docs/verification/parity-2026-08-10-r2.md` | `67 / 0 / 0` |
| `docs/verification/tier-1-2026-08-10.md` | `27 / 40 / 0` |

PRD-076 measured a third desktop run with provenance and settled the desktop column. It stated the
Android disagreement is still open. Nine days later it still is, and every Tier-1 and parity claim
that touches Android inherits the ambiguity.

### 1.2 The lane cannot be re-run clean, because it is red on something else

As of 2026-08-19 the first-proof gate fails on:

```
canvas-layer overlay missing: found 0 pixels of #ff00ff
```

Run as:

```sh
ANDROID_HOME=~/Android/Sdk node packages/runtime-native/scripts/verify-android-first-proof.mjs \
  --device emulator-5554
```

Bisected on one booted emulator: **`3677542` passes, `c842a6a` fails, and everything after it
fails.** `c842a6a` is PRD-155's present-once-per-frame fix, whose own Android evidence was a
**Pixel 8 where the same overlay was green** (`docs/verification/prd-155-2026-08-18.md`, 4,096
overlay pixels).

So the current state is: a fix proved green on a physical phone turned the emulator red, and
nothing owns that. Two readings are open and this PRD does not pre-judge which:

- **Engine bug.** Present-once-per-frame reorders or drops the composite the overlay lives in, and
  the phone's driver hides it. Home: `packages/runtime-native/`.
- **Harness bug.** The emulator's capture reads a frame the overlay is not in yet, or reads the
  swapchain rather than the presented frame. Home: the verification script.

**Attribution comes before repair, and before the re-run.** Re-running the parity lane on a lane
that is red for an unrelated reason produces a third disputed ledger, which is precisely the
failure PRD-076 was written to end.

### 1.3 What this PRD explicitly is not

It is not a mobile-readiness claim, an arm64 result, a frame-rate parity result, or a physical
device result. The emulator is not a phone. Tier 1 is "browser + Linux desktop + Android
emulator", and this file moves exactly the third of those three.

## 2. Execution phases

A later phase does not start on an unrun earlier one.

### Phase 0 — Reproduce, on this machine, and write down the state

1. Boot `threenative-prd050`, confirm `adb devices` lists it.
2. Run the first-proof gate on `HEAD`. Record the exact failure and the frame it captured.
3. Run it on `3677542`. Record the pass.
4. If either result disagrees with §1.2, this PRD's §1.2 is wrong and gets corrected before
   Phase 1 starts. A bisect nobody re-ran is a claim, not evidence.

### Phase 1 — Attribute the overlay red to a layer, in writing, before touching code

Name it engine bug or harness bug, and say why, with the file and the observation that decides it.
The two have opposite homes and fixing an engine bug inside the verification script buys a green
gate and leaves every native game broken.

Minimum evidence to close this phase:

- Whether the overlay pixels exist in the framebuffer at all on the emulator, or only fail to be
  captured. These are different defects and the current message cannot tell them apart.
- Whether a desktop native run on `HEAD` shows the same overlay behaviour. Desktop and emulator
  share the present path; the phone did not reproduce it, so the third data point decides whether
  this is a driver-specific composite issue or a general one.

### Phase 2 — Fix it in the layer Phase 1 named

With a test in the same commit. If it is an engine bug, the fix is in `packages/runtime-native/`
and the same gate is the proof. If the fix cannot be made without a phone, the PRD goes to
`docs/PRDs/BLOCKED/requires-physical-device/` with the phase-1 attribution attached — that is an
acceptable ending and is not a failure of this PRD.

### Phase 3 — Re-run the Android parity lane once, with provenance

Same lane, same scenarios, provenance recorded exactly as PRD-076 recorded it for desktop: commit,
device fingerprint, emulator image, JS engine, per-scenario pass/fail/blocked, and the exit code
with the rule that produced it.

`reportExitCode` returns `2` whenever `blocked > 0`. PRD-076 caught an impossible `66/0/1 exit 0`
cell in a predecessor ledger by checking that rule. Check it here too, on the new run and on both
old ones.

### Phase 4 — Adjudicate

Write `docs/verification/android-parity-2026-08-19.md` saying which of `67/0/0` and `27/40/0`
reproduces, which does not, and what the third run measured. Put a scoped superseded banner on
whichever predecessor the evidence retires — scoped to Android, the way PRD-076's banners are
scoped to desktop.

Then update the beta row 4 line in `docs/strategy/ROADMAP.md` to the adjudicated Android number.
**The row does not become green from this alone**: the desktop multitouch exclusion
([PRD-077](../BLOCKED/requires-evdev-delivery/PRD-077-desktop-multitouch-injector.md)) still
guarantees the desktop lane cannot exit `0`, and that is stated rather than glossed.

## 3. Verification

| # | Check | Expected |
|---|---|---|
| 1 | First-proof gate on `HEAD` and on `3677542` | the §1.2 bisect reproduces, or §1.2 is corrected |
| 2 | Phase 1 attribution | names engine or harness, with the deciding observation |
| 3 | Regression test for the fix | fails on the unfixed tree, passes on the fixed one |
| 4 | Desktop native overlay on `HEAD` | recorded either way; it is the third data point |
| 5 | Exit-code rule applied to all three Android ledgers | no run reports `exit 0` with `blocked > 0` |
| 6 | `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` | green |

## 4. Acceptance criteria

1. The overlay red is reproduced on this machine and attributed to a layer in writing.
2. It is fixed with a test in the same commit, **or** the PRD is filed under
   `docs/PRDs/BLOCKED/requires-physical-device/` with the attribution attached.
3. One Android parity re-run exists with full provenance.
4. `docs/verification/android-parity-2026-08-19.md` states which prior ledger reproduces and which
   is retired, with a scoped superseded banner on the retired one.
5. `docs/strategy/ROADMAP.md` beta row 4 carries the adjudicated Android number and still states
   that the row is not green.
6. No sentence anywhere in the output says mobile-ready, device-proved, or claims arm64,
   real-driver, or frame-rate parity evidence. The emulator proves the emulator.
