# Device runbook — mobile-stability batch, physical Pixel 8

Self-contained on purpose. Each rung names its command, its green, and what a *false* green looks
like, so whoever is free can run it without holding the phone for a particular lane.

**Lane discipline, every time.** Both a physical Pixel 8 (`192.168.1.192:5555`, product `shiba`) and
an emulator (`emulator-5554`) answer `adb devices` on this machine. Always pass `-s <serial>`, and
always name the lane in the record — the two have disagreed before, and two PRDs were mis-attributed
because of it. `adb` is on disk at `~/Android/Sdk/platform-tools/adb`, off `PATH`.

**One lease at a time.** Concurrent logcat or install corrupts every measurement in flight. The
holder announces hand-back.

**Thermal and battery.** Cool to <=31.5 C before a first-proof launch; thermal LIGHT has tripped
between launch and preflight on this phone. The battery floor bites after roughly 4-6 rungs.

**A dropped Wi-Fi ADB transport voids the rung.** Re-run it. Never stitch partial windows together.

---

## Queue

| # | Owner | Rung | Cost |
| --- | --- | --- | --- |
| 1 | PRD-210 | tombstone returns | ~20 min |
| 2 | PRD-210 | pre-fix negative control at `01ec0658` | ~15 min |
| 3 | PRD-211 | bug-5 end-to-end boot — **also closes PRD-211 Phase 2's WebP criterion** | 1 install + ~60 s |
| 4 | PRD-210 | screen-off stops presenting, resume, `backgroundMode:"continue"` | ~40 min |
| 5 | PRD-209 | row 31, needs the phone **unlocked and awake** | ~5 min |
| 6 | PRD-213 | three cold launches at three fixed resolutions | ~15 min |

Rung 3 is blocked until `docs/bugs/core-ktx2-blocks-android-build-2026-08-23.md` is fixed: core at
HEAD cannot build for Android at all.

---

## Rung 1-2 — tombstones (PRD-210)

Launch, let it settle, trigger a deliberate post-startup native fault, then:

```sh
adb -s 192.168.1.192:5555 shell dumpsys dropbox --print data_app_native_crash | head -80
```

- **Green:** a symbolized entry naming the failing frame.
- **Rung 2 is not optional.** Repeat the identical fault on `01ec0658` (pre-fix). Expect *nothing*
  in dropbox, exit-info only. Without it, criterion 1 is an assertion rather than a proof.

## Rung 3 — bug 5 end-to-end, and PRD-211 Phase 2 in the same capture

Clean clone, `threenative build --target android` from repo `public/`, install, launch.

```sh
adb -s 192.168.1.192:5555 logcat -c        # before launch, so the run is its own
# launch, CONFIRM THE APP IS FOREGROUND, then:
adb -s 192.168.1.192:5555 logcat -d -s MystralStdio:I MystralRuntime:I > run.log
```

Both tags are required. Filtering on one silently drops one of the two criteria.

- **Green, bug 5 closed** (tag `MystralStdio`):
  `[Audio] Decoded audio: <N> frames, <C> channels, 44100 Hz (Ogg Vorbis)`
  The `(Ogg Vorbis)` suffix **is** the proof.
- **False green:** `(RIFF/WAVE)` on an `.ogg`. That means someone is testing a hand-transcoded
  asset — the bug, not the fix.
- **Red, bug 5 alive:** `[Audio] Failed to load audio:`, then
  `[Audio] decodeAudioData could not decode the supplied audio.`, then `TN_NATIVE_START_FAILED`.
- **Green, PRD-211 Phase 2** (tag `MystralRuntime`, a JS `console.log` from `src/runtime.cpp:4447`):
  `[Mystral] WebP format support: YES`, with WebP-textured models rendering rather than white.
- A `resampled from` clause in the audio line is **correct behaviour**, not a defect: the asset's
  rate differed from the context's and was converted rather than played sharp.

The decode logs through `std::cout`, which owns no terminal on Android. It reaches logcat only
because PRD-183 pipes stdout and stderr there under tag `MystralStdio`
(`src/platform/android_main.cpp:34-60`). Without that, this rung would fail for the wrong reason and
read as "Ogg decode is broken on device".

## Rung 4 — lifecycle (PRD-210)

```sh
adb -s 192.168.1.192:5555 logcat -c
adb -s 192.168.1.192:5555 shell input keyevent KEYCODE_SLEEP && sleep 10
adb -s 192.168.1.192:5555 logcat -d -s MystralRuntime | grep -E 'TN_PRESENTS_TICK|TN_LIFECYCLE'
```

- **Green:** `TN_LIFECYCLE:{"event":"paused","applied":true,...}` then zero new `TN_PRESENTS_TICK`.
- Resume with `KEYCODE_WAKEUP`; expect `"event":"resumed"` and the `catchUp` marker, ticks resuming
  without a burst.
- **No marker is observable while the app is paused.** SDL parks the writing thread inside
  `Android_WaitLifecycleEvent`, so the paused marker, the resumed marker and
  `TN_LIFECYCLE_SURFACE` all arrive in one burst at the instant of resume, one millisecond apart.
  Background, resume, and *then* read the whole window; anything that waits for a live marker
  during the background waits forever.
- **The resume half was closed on 2026-08-23**
  ([`resume-presents-2026-08-23.md`](resume-presents-2026-08-23.md)): resume rebuilds the surface,
  `presents` advances with `frames`, and the capture is not blank. Re-run it with
  `KEYCODE_HOME` + `am start` rather than sleep/wake if the phone's keyguard is secured — the pid
  must be unchanged across the pair, or it was a relaunch and proves nothing. Green:
  `TN_LIFECYCLE_SURFACE:{"event":"revalidated",...}` with `previousWindow` != `window`. Red control,
  same APK: `adb shell setprop debug.threenative.skip_surface_revalidate 1`, which brings back
  `TN_SURFACE_ACQUIRE_FAILED` and the black screen.
- Repackage with `display.backgroundMode: "continue"` and repeat: ticks must **keep flowing** and
  the marker must still appear with `"applied":false`. Turning the convention off must not turn its
  measurement off.

## Rung 5 — PRD-209 row 31

Needs the phone **unlocked and awake**; the keyguard holds focus behind the owner's credential. A
previous attempt died with `ERROR_SURFACE_LOST_KHR` and a `SIGABRT` in `SDLThread` when the phone
dozed — which is PRD-210's bug reproducing unprompted, and useful corroboration in its own right.

## Rung 6 — PRD-213 cold-launch triple

Three **independent cold launches** at three fixed resolutions, `GL mtrack` at each. Sequential
rungs in one process cannot answer this: PRD-214's series drifted upward ~143 MB over six minutes
independent of resolution, so a per-resolution constant read off it would be reading the drift.

```sh
adb -s 192.168.1.192:5555 shell dumpsys meminfo $(adb -s 192.168.1.192:5555 shell pidof com.threenative.bayview) | grep -E "GL mtrack|EGL mtrack|Gfx dev"
```

`EGL mtrack` is the surface BufferQueue and scales with area as expected — that is not the question.
`GL mtrack` is the ~480 MiB floor whose owner is unnamed.

---

## Two traps this batch has already hit

1. **Capture only with the app confirmed foreground.** A blind `screencap` returns whatever the
   screen's owner has up. One black portrait capture was recorded as a bug before anyone checked
   the surface had presented.
2. **Never call `xvfb-run`** for the desktop half of any comparison — its exit status is its own
   failing cleanup kill. The playtest runner provisions its own Xvfb.
