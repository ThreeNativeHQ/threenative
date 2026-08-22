# PRD-175 — present instrument counts once per frame; ladder rungs 500/4000 remain unmeasured

Date: 2026-08-22.

## LOW lane — landed

- `bindings.cpp` profile marker now tags every submit with the completed-frame count
  (`"frame":N`), so the analysis can group exactly. Additive field; old parsers ignore it.
- `measure-android-js-engine.mjs` no longer sums `presentNs` per submit. With frame tags it
  takes each frame's max; legacy markers fall back to run-length dedupe of identical consecutive
  values (exact except when two consecutive frames present in the same nanosecond). Mixed
  tagged/untagged logs throw `TN_ANDROID_JS_FRAME_TAG_MISMATCH`. Report carries
  `presentEvents` and `presentCountedOncePerFrame: true`.
- `nativeMsPerSubmit` now means submit+poll only — present no longer belongs to submits.

Red-first: both new fixtures failed against the old formula (inflated per-submit sum), then
passed; the pinned 300-identical-submits expectation was updated from 0.15 to the deduped
0.1002 with the reason inline. Suite: **14 passed / 14**
(`cd packages/runtime-native && pnpm exec vitest run --config vitest.config.ts
tests/android-js-engine-measurement.test.mjs`).

The 2026-08-21 record's hand-corrected figures (present ≈0.71 ms/frame against a reported
3.37) are the real-world shape this fix automates; rerunning that ladder would now produce the
corrected split directly.

## HIGH lane — attempted, not obtained, recorded

`sweep.sh "500 4000"` was not run. Device state observed at 2026-08-22 ~02:50 local: Pixel 8
`37251FDJH0037Z`, battery temperature **28.2 °C** (inside the ≤31.5 °C launch margin) but
battery **status 2 — charging** over USB. The measurement preflight requires a discharging
device; the 2026-08-21 discipline ran over Wi-Fi adb precisely so the phone discharges, and
unplugging the cable is a physical action nobody present can take. The rungs stay explicitly
**UNMEASURED** — the tooling reruns them in one command when the phone is on Wi-Fi adb and cool:
`sweep.sh "500 4000"`.

## HIGH lane — second attempt session, 2026-08-23 morning (cable out)

Three automated attempts under the full discipline (discharging over Wi-Fi adb, thermal NONE,
battery temp <=31.5 degC, --cold-start-runs 0): the first tripped the screen-off preflight
(no USB means no stay-awake); the second fixed screen wake but exposed a stale baked APK
(subject marker never emitted -> rebuilt clean); the third built cleanly, cooled from a
38 degC heat soak left by the runaway first app, and still lost the race between wake and
launch -- `screen: expected on, observed off`, then a first-proof timeout on rung 4000 whose
APK reuse would also have baked the wrong mesh count. Logs:
`artifacts/engine-load-test/prd175-rung-{500,4000}-2026-08-23.logcat.txt`.

Verdict unchanged: the rungs stay **UNMEASURED**. The remaining blocker is screen/keyguard
management over adb alone -- plausibly the lock screen, which adb cannot cross. Next session
should start here: unlock the phone by hand once, leave the cable out, and rerun
`measure-android-js-engine.mjs --expected-engine V8 --meshes <N> --cold-start-runs 0`
per rung (each rung needs its own build; the mesh count is baked at build time).

## HIGH lane — third attempt session, 2026-08-23 (~10:45-11:00 local): RUNG 500 MEASURED

Root causes of every earlier failure, fixed this session:
1. **Logcat ring reset to 256 KiB** (device rebooted since 2026-08-21 lost the `logcat -G 16M`
   sizing) — at ~1,100 marker lines/s uncapped, SUBJECT/PURE/WINDOW_START evicted within a
   second while later lines survived. Restored `logcat -G 16M`; verified against the device
   bundle pulled off the phone (subject marker and meshes:500 both present).
2. **Screen/keyguard over adb**: wake-pulse loop every 5 s for the script's duration; screen
   timeout raised to 30 min; brightness dimmed to cut display heat.
3. **Stale APK reuse**: each rung's mesh count is baked into the bundle at build time; rung
   4000 must build its own APK (an early attempt reused a first-proof APK).

Rung 500 row — device Pixel 8 `37251FDJH0037Z` via Wi-Fi adb `192.168.1.192:5555`, V8,
uncapped present, discharging (status 3), battery temp ~31.5 °C falling, thermal NONE,
300-frame window after 60 warmup, `-O2`, acceptance-eligible:

| meshes | ms/frame | fps | calls/frame | submits/frame | native submit+present (present counted once) | js+uninstrumented |
|---|---|---|---|---|---|---|
| 500 | 3.622 | 276.1 | 32 | 4 | 1.427 ms (301 presentEvents) | 2.169 ms |

The corrected instrument ran live: `presentCountedOncePerFrame: true`, 301 present events for
a 301-frame window — PRD-175's LOW-lane fix producing honest numbers in a real measurement.
Report artifact (untracked, local): `artifacts/engine-load-test/prd175-rung-500-2026-08-23.json`.

### Rung 4000 — measured 11:29-11:33 local

After one failed attempt (the app stalled ~4 s into its window while the display dozed between
no-op WAKEUP pulses; rendering resumed only in fragments), an instrumented retry with a 3 s
wake-pulse loop held the device awake for the whole window. Battery temp 30.1 °C at preflight,
discharging, thermal NONE, uncapped mailbox present:

| meshes | ms/frame | fps | draws/frame | native submit+present | js+uninstrumented |
|---|---|---|---|---|---|
| 4000 | 5.413 | 184.7 | 6 | 0.571 ms (301 presentEvents) | 4.810 ms |

## The completed ladder under the shipped engine

Same subject and protocol as `prd-069-phase-0-v8-draw-ladder-2026-08-21.md` (shared geometry +
material lattice; draws/frame stay ~4-6 because the subject is frustum-culled — per-object
costs, not per-draw):

| meshes | 2026-08-21 | 2026-08-23 |
|---|---|---|
| 500 | UNMEASURED | 3.622 ms |
| 1000 | 4.013 ms | — |
| 2000 | 4.711 ms | — |
| 4000 | UNMEASURED | 5.413 ms |

Marginals: 500→1000 ≈ 0.78 µs/object, 2000→4000 ≈ 0.35 µs/object — the flat-to-gently-rising
curve Phase 0 described, no threshold anywhere. Both rows acceptance-eligible on the named
serial; nothing here claims any platform or build other than what executed.
