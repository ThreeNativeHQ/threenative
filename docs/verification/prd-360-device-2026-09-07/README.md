# PRD-360 — first physical Android measurement, 2026-09-07

Bounded claim: **the preserved Bayview baseline was cold-launched three times on a physical Pixel 8,
preflight-qualified, the player moved under input, and the launch-to-first-playable bound was
measured.** The bound exceeds PRD-360's 8-second criterion by roughly six times. Nothing here
accepts the PRD; the criterion is measured and **unmet**.

## Qualified result — the one to cite

Three cold launches with the device unplugged and **no** `--allow-device-condition`, so the preflight
decided rather than being overridden. `R0B_PREFLIGHT` **passes** on all three: `charging: false`,
`provisional: []`, battery 100%, thermal status NONE, 29.6-30.6 °C.

| Run | Bound | Runner | Preflight |
| --- | ---: | --- | --- |
| a | 50,219.2 ms | exit 0 | qualified |
| b | 49,788.7 ms | exit 0 | qualified |
| c | 49,689.1 ms | exit 0 | qualified |

**Median 49,788.7 ms against a criterion of 8,000 ms.** Seven of nine checks pass, including
`R4_MOVEMENT` at 2.147 m and `R5_VISIBLE_WORLD`. Two fail: `R6_BOUND_EXCEEDED`, and
`R7_PUMP_SILENCE_MISSING` because this APK predates the observer. Retained as
`qualified-{a,b,c}.json`.

The screen must be awake for the preflight — an unplugged Pixel 8 sleeps and the run fails closed
with `TN_DEVICE_PREFLIGHT_CONDITION_FAILED: screen: expected on, observed off`. A
`KEYCODE_WAKEUP` before each launch is enough; `screen_off_timeout` was already 1,800,000 ms and was
not modified.

The section below records the earlier, **superseded** set taken while the device was still plugged.

## Subject and device

| | |
| --- | --- |
| APK | `com.threenative.bayview`, installed on the device, SHA-256 `007e1dc247b58cc13126f44c52cff97f230934bcc2f305c83e35805bcba9077e` |
| Identity | Byte-identical to the SHA-256 PRD-360 recorded as the preserved installed baseline. `R1_ARM_IDENTITY` passes on all three runs. |
| Device | Pixel 8 (`shiba`), serial `37251FDJH0037Z`, arm64-v8a, Android 17, driven over Wi-Fi ADB at `192.168.1.192:5555` |
| Condition | Battery 100%, thermal status `0` (NONE); 29.6–30.6 °C for the qualified set, 25.0–26.7 °C for the superseded one |

The APK carries **no** pump observer — `strings` over its packaged `lib/arm64-v8a/*.so` finds neither
`TN_PUMP_SILENCE` nor `TN_PUMP_ENDPOINT`. It predates the observer, so `R7` cannot be assessed on it.

## Superseded: the first set, taken plugged in

| Run | Bound | Runner |
| --- | ---: | --- |
| a | 50,073.3 ms | exit 0 |
| b | 51,331.9 ms | exit 0 |
| c | 50,948.7 ms | exit 0 |

**Median 50,948.7 ms against a criterion of 8,000 ms.** Every run reports
`R6_BOUND_EXCEEDED`.

Per-run evaluations are retained verbatim beside this file as `evaluation-{a,b,c}.json`.

## What passes, and what the failures are

Six checks pass on every run: `R0_ANDROID_TARGET`, `R1_ARM_IDENTITY`, `R2_CLOCK` (real
`process.hrtime.bigint`, `synthetic: false`), `R3_RUNNER` (exit 0, no diagnostics),
`R4_MOVEMENT` and `R5_VISIBLE_WORLD`.

- **`R4_MOVEMENT`** — the player moved **2.147 m** horizontally under `KeyW`, against a 0.25 m
  minimum. The game is genuinely playable at the point the bound closes; this is not a launch that
  merely reached a ready flag.
- **`R5_VISIBLE_WORLD`** — 65,855 distinct colours, bright-pixel ratio 0.197, luminance standard
  deviation 0.154 at 1080×2400. A rendered world, not a blank frame.

Three fail, and they are not equivalent:

- **`R6_BOUND_EXCEEDED` is the finding.** The evaluator states its own limit: *"a bound above the
  criterion does not isolate game latency and proves nothing about it."* The bound is a
  coordinator-clock **upper** bound containing adb, the mailbox transport and runner process
  startup, so the game's own latency is smaller than 50.9 s and unmeasured. At six times the
  criterion, that overhead cannot account for the gap.
- **`R7_PUMP_SILENCE_MISSING`** is structural, not a regression: this APK predates the observer, so
  the pump-silence half of the acceptance is unexecuted rather than failed.
- **`R0B_PREFLIGHT_UNQUALIFIED`** is a recorded override, disclosed rather than hidden. The
  preflight requires the device discharging; it was plugged throughout, reporting level 100 with
  `status: 4` (`NOT_CHARGING`) at 25–27 °C, so no charge current was flowing and the thermal
  condition the rule protects against was absent. `--allow-device-condition` was passed and each
  run's `bound.json` records the real observed preflight. **These runs are therefore not
  preflight-qualified acceptance evidence.** A qualified rerun needs the cable out; Wi-Fi ADB is
  already configured, so that is the only change required.

## Harness notes, so a rerun does not rediscover them

The scenario and evaluator disagreed in three places, all fixed here rather than worked around:

1. A playtest scenario's `target` must be `web`; the platform comes from the runner's `--target`
   flag. `"target": "android"` is rejected with `TN_PLAYTEST_SCENARIO_INVALID`.
2. A settle step with no input needs `waitTicks`, not a bare `holdTicks`, or the step is rejected
   with `TN_PLAYTEST_SCENARIO_STEP_INVALID`.
3. The runner writes the post-input frame as `after.png`; `evaluate-first-playable.mjs` reads
   `first-input.png`. The frames were copied across for `R5`, which is a **naming mismatch between
   harness and evaluator, not a passing frame invented for the check** — the stats above are that
   real capture.

The scenario used is `bayview-first-playable.playtest.json`: press `Enter`, three 20-tick `KeyW`
holds, then a 6-tick settle, asserting `movement.minDistance` 0.25.

## What this does and does not close

Closes: PRD-360's first acceptance bullet is no longer unmeasured. Three physical cold launches ran,
on the recorded baseline, on real hardware, with movement and a visible world proved.

Does not close: the criterion is **unmet by ~6×**, and the pump-silence bullet is unexecuted for
want of an observer-carrying build. PRD-360 is not accepted and no acceptance box is ticked. The
preflight caveat is gone — the qualified set at the top of this file has `R0B_PREFLIGHT` passing —
so what remains is an implementation gap, not an evidence gap.
