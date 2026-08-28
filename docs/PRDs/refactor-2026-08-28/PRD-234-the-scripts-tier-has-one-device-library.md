---
prd_contract: v1
---

# PRD-234 — the scripts tier has one device library

**Status:** PROPOSED — filed 2026-08-28. **Independent** — it touches no C++ and can run in
parallel with any other PRD in this batch.

Sixth PRD of [the runtime-native refactor batch](./README.md).

**Goal: one implementation of "talk to an Android device", used by every script that does.**

**Complexity:** +3 (10+ files) +1 (device transport, timeouts, retries) = **4 → MEDIUM mode.**

## The problem, measured

| Metric | Value |
| --- | ---: |
| `packages/runtime-native/scripts/` | **15,347 lines** |
| Shared library directory | **none** |
| Scripts invoking `adb` | 12 |
| Scripts defining their own `adb` wrapper | **9** |
| `qualify-physical-mobile.mjs` | 1,321 lines |
| `measure-android-js-engine.mjs` | 1,024 lines |
| `verify-android-first-proof.mjs` | 700 lines |
| `device-preflight.mjs` | 449 lines |

Nine independent answers to "run a command on the device" means nine independent answers to which
transport is used, what the timeout is, whether a non-zero exit is fatal, and whether the device
was checked for the discharging-battery and thermal preconditions the benchmark protocol requires.
The device lane's known traps — Wi-Fi ADB to keep the phone discharging, `applicationId` that is
not the directory name, verifying the APK actually carries the change — are each implemented in
some scripts and not others.

## Solution

- `scripts/lib/adb.mjs` — one device command surface: transport selection, timeout, exit handling,
  logcat ring sizing.
- `scripts/lib/device.mjs` — preflight (thermal, battery, discharging), package resolution from
  `app.id`, install verification.
- Each script deletes its own copy in the commit that adopts the library.

**Data changes:** none. Every script's CLI, output format and exit codes stay identical — several
are parsed by tests and by the playtest runner.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `scripts/lib/adb.mjs` | each adopting script, one per commit | 9 private wrappers | deleted per commit | a wrapper's behaviour test fails if the library changes timeout or exit semantics |
| 2 | `scripts/lib/device.mjs` | `device-preflight.mjs`, `qualify-physical-mobile.mjs`, `measure-android-js-engine.mjs` | duplicated preflight | deleted per commit | a preflight that should refuse a charging device must still refuse it |

## Execution phases

One adopting script per commit. Order: the two with tests first, so the library is proved before
it spreads.

1. `scripts/lib/adb.mjs` + `device-preflight.mjs` (has `tests/device-preflight.test.mjs`)
2. `scripts/lib/device.mjs` + `measure-android-js-engine.mjs` (has
   `tests/android-js-engine-measurement.test.mjs`)
3. `qualify-physical-mobile.mjs` (has `tests/physical-mobile-qualification.test.mjs`)
4. remaining six adopters, one per commit

**Files per commit:** the library, the adopting script, its test, the record.

**Tests required, per commit:**

| Test file | Test name | Assertion | Negative control |
|---|---|---|---|
| `tests/scripts-adb-lib.test.mjs` | `should refuse a charging device in preflight` | refusal is returned, not warned | make the device look discharging → passes; charging → red |
| `tests/scripts-adb-lib.test.mjs` | `should use the wireless transport when one is configured` | the command line names it | remove the branch → red |
| the adopting script's existing test | unchanged assertions | the script's output is identical | revert the adoption → still green (proving the adoption changed nothing observable) |

**Revert check per commit:** delete the library import from the adopting script → its existing test
fails to resolve, and the suite reds.

## Acceptance criteria

- [ ] **A device-lane script that gets a new trap right gets it right everywhere** — no script
      defines its own `adb` invocation.
- [ ] **Every adopting script's output and exit codes are unchanged**, proved by its pre-existing
      test.
- [ ] **The preflight refusal rules have one definition** and one test.
- [ ] `scripts/` line count falls, recorded via `pnpm census`.

## Risks

| Risk | Mitigation |
| --- | --- |
| **A script's subtle local behaviour is lost in adoption.** | One script per commit; its own pre-existing test is the control; adoption must be invisible to it. |
| **No device attached when this lands.** | The library is testable with a faked `adb` binary; a device run is required only for the two scripts that already have device evidence, and its absence is recorded, never implied. |

## Verification evidence

- NOT RUN
