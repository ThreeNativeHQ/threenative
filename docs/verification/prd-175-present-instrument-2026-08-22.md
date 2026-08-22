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
