# PRD-360 — first physical Android measurement, 2026-09-07

Bounded claim: **the preserved Bayview baseline was cold-launched three times on a physical Pixel 8,
preflight-qualified, the player moved under input, and the launch-to-first-playable bound was
measured.** The bound exceeds PRD-360's 8-second criterion by roughly six times. Nothing here
accepts the PRD; the criterion is measured and **unmet**.

## Evidence lineage

This record preserves three same-day observations at their original branch heads:

- `3dd71a4ced3ac169ef3235d2a9ecde0adc831221` at `2026-09-07T09:15:52-07:00` added
  the qualified physical runs retained as `qualified-{a,b,c}.json`.
- `caf6c90f24bd0d70a84bd7abde9ba9f7e8b6b916` at `2026-09-07T09:52:25-07:00`
  decomposed the baseline stall.
- `8fd902bc3a0f40cb13dc734b620c3dd5e7ec5c5a` at `2026-09-07T10:20:13-07:00`
  recorded the asset-resolution failure of the named candidate APK.

Later commit `e2e871f1feac6fa0f7dc4d372f30d3cb586a8f72` at
`2026-09-07T14:26:20-07:00` records a different single retained-package launch at
16,020.007 ms. It is not a cold-install sample, still exceeds 8,000 ms, and does not replace the
qualified baseline or make the candidate APK diagnosed below start. Its scope is recorded in
[prd-360-warmup-cache-2026-09-07](../prd-360-warmup-cache-2026-09-07/README.md).

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

## Where the time actually goes — probe, 2026-09-07

The 49.8 s bound is not the game's startup. Decomposed from `host.log` (`TN_COLD_START`,
`TN_STALL_SEGMENTS`, `TN_HOST_GAP`), consistent across all three qualified runs:

| Phase | Cost |
| --- | ---: |
| process → `game_eval_begin` (assets, UI overlay, runtime, V8 snapshot) | **~0.6 s** |
| `game_eval_begin` → `first_frame` | **~14.1 s** |
| `first_frame` → last playtest command (280 `compile`/`execute` cycles out to 39.5 s) | **~25 s** |
| teardown, 698 KB screenshot pull, sampling | **~10 s** |

**The game's own cold start is ~15 s, not 50 s.** The remaining ~35 s is harness traffic — which is
why the evaluator warns that a bound above the criterion "does not isolate game latency". Once
running, the frame period is p50 **16.3 ms** (~61 fps), so this is a startup problem only.

Inside the ~14.1 s stall, per `TN_STALL_SEGMENTS` (run a / b / c):

| Segment | Cost | Calls |
| --- | ---: | ---: |
| **`pipelineCompile`** | **8,079 / 8,296 / 8,385 ms** | **103** |
| `shaderCompile` | 354 / 348 / 352 ms | 141 |
| `bufferUpload` | 124 / 124 / — ms | 1,415 |
| `textureUpload` | 96 / 99 / — ms | 74 |
| attributed | 8,654 ms (`attributedShare` 0.660) | |
| **residual, unattributed** | **4,450 / 4,457 / 4,594 ms** | |

So one launch is roughly: 0.6 s of real init, 8.3 s of **103 synchronous pipeline compiles**, 0.35 s
of shader compiles, and **4.5 s that nothing currently attributes**. Two thirds of the stall is
named; a third is not, and naming it needs instrumentation that does not exist yet.

## The measured APK predates the fix — read the number as a baseline, not a verdict

The subject's source tree is `prd259-bayview-current-20260830`, dated **2026-08-30**. The startup
work landed after it:

| Commit | Date | What |
| --- | --- | --- |
| `0d0565fc` | 2026-09-03 | PRD-327 Phase 2 — the automatic startup warm-up default, `packages/core/src/game.ts` |
| `befc1094` | 2026-09-04 | `perf(core): startup holds the player's wait` |

Bayview does call `defineGame`, so on a current engine it would inherit the automatic warm-up whose
comment reads *"A game with this unset still warms up."* This APK is four to five days older than
that, which is consistent with what the log shows: 103 pipelines compiling synchronously on the
first frame because nothing warmed them.

**This measurement therefore characterises the problem PRD-360 was opened against, measured properly
for the first time. It is not evidence about current `main`.** At the `caf6c90f` evidence head,
deciding whether the criterion was met on current `main` still needed a new APK. The later
retained-package result linked above supplied one non-cold sample, not the three qualified cold
launches required by the criterion.

## The candidate arm was built and does not start — 2026-09-07

This diagnosis belongs to evidence head `8fd902bc` and the candidate APK identified below; it is not
a claim that every later artifact fails in the same way.

To judge current `main` rather than the 2026-08-30 baseline, Bayview was rebuilt against the live
engine and installed on the same Pixel 8. Getting there cleared three walls worth recording:

1. A consumer install cannot build the native host — the published `runtime-native` ships no C++.
   The packager's own escape hatch is `THREENATIVE_RUNTIME_SOURCE=<path to packages/runtime-native>`,
   and its error message names it. That alone is not enough: `packageAndroid` also requires
   `third_party/sdl3-android/SDL3-3.2.30.aar`, so `download-deps.mjs --android` must have run
   against the same checkout.
2. With both satisfied the Gradle build succeeds. The resulting APK
   (`1cebbd4e…`, `com.threenative.bayview`, arm64-v8a + x86_64) carries `TN_PUMP_SILENCE` in
   `libmystral-runtime.so`, which is what proves it is current engine rather than a prebuilt.
3. The asset preflight rejects six models for interleaved buffer views. Converting them with
   `gltf-transform cp --vertex-layout separate` makes the preflight pass on its own terms.

**The build does not start.** On the device it reaches `execute_complete` at ~792 ms, never emits
`first_frame`, and spins with `presents: 0` across ~2.1 million frames until the playtest times out
with `TN_PLAYTEST_OPERATION_TIMEOUT`. Direct launch names the cause:

```text
TN_NATIVE_START_FAILED:TN_ASSETS_UNRESOLVED: 'assets/enemy-terrorist.glb' could not be
loaded from 2 candidate url(s)
Uncaught TypeError: Cannot read properties of null (reading 'useState')
```

The first build attempted — pristine source, no model conversion, preflight skipped — showed the
same `presents: 0`, so the asset conversion is **not** the cause and this is not an artefact of the
rebuild procedure.

Three reference forms were tried in the game source and all fail identically:

| `ctx.assets.model(...)` argument | Runtime resolves to | Result |
| --- | --- | --- |
| `assets/enemy-terrorist.glb` (as shipped, 2026-08-30) | `game/assets/enemy-terrorist.glb` | unresolved |
| `assets/models/enemy-terrorist.glb` | `game/assets/models/enemy-terrorist.glb` | unresolved |
| `models/enemy-terrorist.glb` — **the exact manifest key** | `game/models/enemy-terrorist.glb` | unresolved |

Both APKs ship `assets/game/assets.manifest.json` keyed on `models/enemy-terrorist.glb` with
`output: models/enemy-terrorist.<hash>.glb`, and both stage that hashed file. The runtime asks for
the **unhashed** name in every case, so the manifest's logical-to-output mapping is not being
applied. The game declares `assets: { models: "none" }`, which disables the pipeline, and the
2026-08-30 binary resolves these references anyway while a current-engine binary does not.

That is where this stops: it is engine-side asset resolution, not a path typo in the game, and
isolating it is a separate piece of work from PRD-360. Both APKs stage the same content-hashed models under `assets/game/models/`;
neither ships the unhashed `assets/enemy-terrorist.glb` the running game asks for, yet the
2026-08-30 binary resolves it and a current-engine binary does not.

**So the candidate arm has no number, and the reason is a compatibility break rather than a
measurement problem: this game's 2026-08-30 source does not run on current `main`.** Whether the
startup work meets the 8-second criterion is still unmeasured, and isolating that break is the next
piece of work. It is recorded here rather than guessed at.

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
