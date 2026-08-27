# PRD-225 — Physics callback stability probe, 2026-08-27

**Lane:** `emulator-5554` (threenative_api35 AVD, Android 15, **x86_64**, gpu host) — the batch
manifest assigns the emulator to this lane; the two disagreeing records it arbitrates between
were both physical Pixel 8, so the platform scope of tonight's answer is the emulator and is
stated everywhere below. APK: Bayview (`com.threenative.bayview`) built tonight from merged
`main` (core/physics/ui/playtest/runtime-native packed from HEAD `0b3c611c`+tonight's commits,
reinstalled into the sandbox, `THREENATIVE_RUNTIME_SOURCE` at the merged checkout, JDK 17).

## Phase 0 — does HEAD reproduce at all? **No, on this lane**

Red criterion named in the PRD before running: ≥1 SIGSEGV/tombstone inside gameplay windows in
10 fresh cold launches = reproduced; zero = not reproducing at HEAD.

Protocol per launch: uninstall → fresh install → logcat cleared → `am start -W` cold launch →
62 s → `pidof` + full-logcat crash scan → force-stop → 3 s. Raw per-launch logs:
`/tmp/prd225-probe/launch-{1..10}.log` (transcribed summary below; the folder is ephemeral, the
`device-physics-stability.mjs` guard reproduces the protocol).

| launch | UTC | alive after 62 s | crash lines | TN_FRAME_BUDGET windows |
| --- | --- | --- | ---: | ---: |
| 1 | 00:37:30 | yes | 0 | 4 |
| 2 | 00:38:36 | yes | 0 | 6 |
| 3 | 00:39:43 | yes | 0 | 6 |
| 4 | 00:40:50 | yes | 0 | 6 |
| 5 | 00:41:56 | yes | 0 | 6 |
| 6 | 00:43:03 | yes | 0 | 6 |
| 7 | 00:44:09 | yes | 0 | 6 |
| 8 | 00:45:16 | yes | 0 | 12 |
| 9 | 00:46:22 | yes | 0 | 18 |
| 10 | 00:47:29 | yes | 0 | 18 |

Crash scan = `FATAL EXCEPTION|Fatal signal|SIGSEGV|SIGABRT|SIGBUS|SIGTRAP|>>> … <<<`, excluding
the crash-policy info line ("debuggerd owns the tombstone") that merely names the policy. All
ten logs scanned; ten zeroes.

Gameplay was live, not a menu idle: e.g. launch 10's first window reads
`"update":{"mean":1.68,"p50":1.26}` at `"fps":57.31` — the emulator runs the scene far below the
device's load, so the device-lane "live window" bar (`update.mean ≥ 3 ms`) does not transfer;
physics executed on every launch (fixed-step running, frame budgets flowing for up to 18
windows).

**Answer: zero SIGSEGV/tombstones in 10 controlled fresh-install cold launches at HEAD on
emulator-5554/x86_64.** The crash did not reproduce on this lane tonight.

## What this does and does not arbitrate

Both disagreeing records (5-of-9 deaths; zero deaths in the staging pair) are **physical Pixel
8** observations. Tonight's green can retire neither by itself: it is a different SoC, ABI,
GPU driver and thermal profile. What it does establish: HEAD's runtime, at merged `main`, does
not crash deterministically on fresh installs, and the failure mode is not a plain
always-on defect — consistent with the loop log's own zero-death pair. The physical-device arm
was owed tonight too but the Pixel was offline (`adb connect 192.168.1.192:5555` → "No route to
host", one attempt made and recorded per the batch README); it stays open on Lane D.

The warm-upgrade hypothesis (a warm upgrade path keeps dying while fresh installs live) was
also not exercised tonight: only fresh installs ran.

## Phase 1' — the guard exists (green result converted, per contract)

`packages/runtime-native/scripts/device-physics-stability.mjs`: the N-launch fresh-install
cold-launch tombstone watch as one command. Any dead launch, any crash signature, or an app
that never produced frame-budget windows fails the script; a missing/dead install fails before
the first launch (`adb install` can exit 0 on a failed stat, so `pm path` is verified — that
trap was hit and fixed while writing the guard).

- Green: `--launches 3 --window-seconds 20` on emulator-5554 → `physics stability: 3/3
  launches clean`, exit 0.
- Simulated failure: `--apk /tmp/nonexistent.apk` → `install did not land`-class failure,
  exit 1 — the guard reports, it never skips.
- A regression on any future session is now one command:
  `node packages/runtime-native/scripts/device-physics-stability.mjs --apk <apk> --package <id> --serial <serial>`.

Refutation is recorded in the loop log next to the original 5-of-9 observation (same commit as
this record).

## Acceptance

- [x] One dated answer exists: reproduces-at-HEAD **no (emulator lane)**, from 10 controlled
      fresh-install launches; physical arm explicitly still open.
- [x] The N=10 guard exists so the question never again depends on whoever noticed last time.
