# PRD-222 (return-from-background) Phase 0 — reload reproduced and attributed — 2026-08-25

**Result: K2 confirmed live on two lanes.** A mid-play font-scale change kills the game process
(`EXIT_SELF`, status 0 — the SDL refuse-recreate `System.exit(0)` path) and the next entry is a
full cold start through the loading sequence. Ambient short backgrounding survives as designed;
the 10-minute ambient rung and a phone locked-screen rung are pending a quiet device (see
"Open rungs").

Record name note: `prd-222-2026-08-25.md` already belongs to the *other* PRD-222
(per-platform performance targets); this file owns the return-from-background PRD's evidence and
deliberately does not share its filename.

## Run identity

| Field | Pixel 8 lane | Emulator lane |
| --- | --- | --- |
| Device | Pixel 8 `shiba`, serial `192.168.1.192:5555`, Android 17, Wi-Fi ADB (discharging) | `emulator-5554`, `sdk_gphone64_x86_64` |
| Game | `sandbox/fps-framework` "Bayview", `com.threenative.bayview` versionCode 1 | same APK, installed fresh |
| Installed APK | SHA-256 `9337780446616cc7cf4f5623504d2b5c7baa4a150da88733dc3cf29b03903b64` — byte-identical to the build recorded in `prd-222-2026-08-25.md`; installed 2026-08-25 13:20:52 | same bytes, streamed install |
| Probe | `packages/runtime-native/scripts/prd-222-resume-probe.mjs` | same |
| Artifacts | `docs/verification/artifacts/prd-222-resume/pixel8/` | `docs/verification/artifacts/prd-222-resume/emulator/` |
| Thermal/battery | battery 24.2 °C / 47 % discharging at probe start (below the 50 % performance-run floor by intent: lifecycle arms are not performance measurements; no fps claim is made from them) | n/a |

Arms are independent: launch → warm to mid-play (20 s, past the measured 12–14 s load) → clear
logcat → perturb → restore → settle 6 s → capture logcat slice, exit-info dump, screencap, meminfo.
Raw whole-device logcat slices stay untracked (`.gitignore` beside them); committed
`*-evidence.txt` files carry the filtered marker/kill lines.

## Arm results

### fontscale (K2, deliberate) — reproduced on BOTH lanes

Pixel 8: pid 4899 → 6040 (**not stable — process died and cold-restarted**). Footprint before
death: 1 631 340 kB total PSS.

Attribution chain, all timestamps local to the device:

1. `14:13:32.070` WindowManager applies the override config:
   `Override config changes=40000000 {1.3 …}` (`fontscale-logcat.txt`).
2. `fontScale` is not in the activity's covered set
   (`AndroidManifest.xml` `android:configChanges="keyboard|keyboardHidden|orientation|screenSize|screenLayout|navigation|uiMode|density"`),
   so Android recreates the activity in-process.
3. `14:14:32.852` exit-info records the death:
   `reason=1 (EXIT_SELF) subreason=0 (UNKNOWN) status=0`, pid 4899 (`fontscale-exit-info.txt`,
   `ApplicationExitInfo #0`). EXIT_SELF/status 0 is the host exiting itself: SDL3's
   `SDLActivity.onCreate` sees `mActivityCreated` already true, calls
   `nativeAllowRecreateActivity()` (`SDLActivity.java:357-370`), which no code in this repo
   implements or hints, so SDL calls `System.exit(0)` rather than let a new activity attach.
4. The ActivityManager line names the death `fg TOP` — foreground priority, **not** an LMK victim
   (the same second, lowmemorykiller killed two unrelated cached apps).
5. Relaunch produced a fresh pid replaying the loading sequence — the player-visible complaint.

Emulator: identical signature — pid 12277 → 12616,
`reason=1 (EXIT_SELF) … status=0` (`emulator/fontscale-exit-info.txt`). Font baseline differed
(phone 1.15, emulator 1.0); both directions trigger the uncovered-axis change.

**Verdict: K2 confirmed live, mechanism exactly as PRD-predicted, on two lanes.**

### lock / screen-off 30 s (K3 family)

Pixel 8 first attempt **invalid**: `input keyevent KEYCODE_POWER` injects down+up inside the
policy window, so the UP woke the device 0.7 s after sleep (`WAKE_REASON_WAKE_KEY`); nothing was
measured. The probe now injects DOWN only and verifies sleep state before proceeding.

Emulator, valid run: display slept (verified), 30 s off, wake, unlock, resume —
pid 12277 stable, full lifecycle sequence in `emulator/lock-evidence.txt`: FOCUS_LOST(527),
MINIMIZED(521), WILL/DID_ENTER_BACKGROUND(259/260) all `paused applied:true`, LOW_MEMORY(258)
observed, then WILL/DID_ENTER_FOREGROUND(261/262) resumed. The loop parked, audio suspended, and
the surface revalidated — **no reload**. Markers drain at resume time because the watch queues
them while the pump is parked; that is the designed reporting path.

A terminal-failure resume (revalidation exhausting its 5 s wait) did **not** occur in this rung;
K3 remains a cited mechanism (`runtime.cpp:1021-1030`, recorded family in
`docs/bugs/resume-presents-nothing-2026-08-23.md`), not an observed death today. Phase 2's
forced-fail harness exercises the code path directly.

### Ambient HOME arms (K1)

| Arm | Lane | pid stable? | Notes |
| --- | --- | --- | --- |
| 30 s | Pixel 8 | yes (6040) | frames continued across resume; footprint ~1.56 GB |
| 2 min | Pixel 8 | yes (6040) | loop parked (tick math matches active-time-only counting) |
| 10 min | Pixel 8 | **invalid arm** | see below |

The 10-minute arm was killed at `14:25:17` by `ActivityManager: Killing 6040:…bayview (adj 905):
remove task`; exit-info says `reason=10 (USER REQUESTED) subreason=22 (REMOVE TASK)` with
rss 2.4 GB. Logcat shows a recents swipe-up gesture at `14:25:14` driven by an alarm activity
from another app (`droom.sleepIfUCan`) — **a person handled the phone mid-arm** and removed the
task. That is user action, not any framework death path; preserved as
`10min-interfered-*` artifacts and excluded from attribution. Two observations survive it:
the parked process had grown to rss 2.4 GB (from 1.56 GB measured at arm start), and ambient
pressure is real on this device (lowmemorykiller freed other apps' caches during the arms).

## Cause table

| Death | Observed? | Evidence | Status |
| --- | --- | --- | --- |
| K2 — uncovered config change → activity recreate → SDL `System.exit(0)` | **Yes, twice** | fontscale arms on both lanes: EXIT_SELF status 0 within ~800 ms of CONFIG_FONT_SCALE, died as fg TOP | confirmed live; Phase 1 fixes |
| K3 — terminal resume failure after bounded surface wait | Not observed | emulator locked-screen rung recovered cleanly with full marker trail | mechanism cited from code + recorded bug; Phase 2 harness will drive it directly |
| K1 — LMK kill of cached game process under ambient pressure | Not observed | 30 s / 2 min survived on Pixel 8; 10 min rung invalidated by external interference (alarm + task removal) | open; retry needs a quiet device |
| Fourth path — external task removal | Yes | `remove task` kill during interfered 10-min arm | user action; out of framework scope |

Negative control: satisfied — the protocol produced ≥1 real reload (twice, on two lanes).

## Open rungs (do not close Phase 0 claims beyond this)

- 10-minute ambient survival on the Pixel 8 lane: pending a quiet device (the phone's owner was
  actively using it during this session — gesture wakes recorded). Required by acceptance
  criterion 4 either as survival evidence or as Phase 3 headroom numbers.
- Manual split-screen entry: `am start --windowingMode 5` does not move an existing task;
  scripting it needs a UI-automation step. `smallestScreenSize` and `fontScale` fail through the
  same uncovered-axis mechanism, so Phase 1's red/green uses font-scale as the scripted mutation.

## Phase 1 — split-screen and font-scale stop killing the process (K2)

**Result: green on the emulator lane; phone confirmation pending a quiet device.**

### The fix

`packages/runtime-native/android/app/src/main/AndroidManifest.xml` — the activity's
`android:configChanges` now also covers `smallestScreenSize`, `fontScale`, `locale`,
`layoutDirection` and `colorMode` (PRD ledger row 1). Verified in the packaged APK, not just the
source: `aapt2 dump xmltree` reads `configChanges=0x40007ff4`, which decodes against the
android-36 `ActivityInfo` constants as exactly the thirteen declared axes — including
`CONFIG_SMALLEST_SCREEN_SIZE` (0x800) and `CONFIG_FONT_SCALE` (0x40000000).

**Decision recorded: SDL's recreate hint stays off (manifest-only fix).** With every axis
covered, no in-process recreate is triggered by these changes; enabling
`nativeAllowRecreateActivity()` would instead let a fresh activity attach to a native thread the
host owns, which SDL3 treats as unsupported-by-default and this repo does not implement. The
fail-closed exit remains the behaviour for any genuinely unrecoverable case.

Packager check (ledger row 1's "+ packager-written manifest if one exists"):
`package-android.mjs` `renderAndroidManifest` only patches icon, `screenOrientation` and the
orientation-override property onto the activity tag it copies from this source manifest — it
never touches `configChanges`, so this file is the single fix site. No test asserted the axis list
before; `packages/runtime-native/tests/android-manifest-config-changes.test.mjs` now does, and
its mutation check bites: removing `fontScale` from the manifest fails the spec (red pasted in the
spec's history), restoring it passes.

### Red / green

- **Red** (axes absent): the Phase 0 fontscale arms — Pixel 8 pid 4899 → 6040 and emulator
  pid 12277 → 12616, both `EXIT_SELF status=0` within ~800 ms of the config change
  (`fontscale-exit-info.txt` on both lanes). The green build differs from those binaries by
  exactly the manifest line: the `.so` sources are the same commit (`3cec79f0`), so the A/B is
  one variable. A third rebuild with the axes hand-reverted would reproduce the Phase 0 binary
  and was not spent.
- **Green** (axes present): emulator, `emulator-phase1/fontscale-*` — font-scale 1.0 → 1.3 →
  restored mid-session, **pid 12912 stable across the change and across a second cycle**,
  `ActivityManager … onActivityRestartAttempt` observed without a process death, scene intact in
  `fontscale-screen.png` (full HUD, match timer running, enemies live).

### Named limitation (emulator lane)

After the font-scale change, the emulator's presentation cadence degraded: the marker stream
shows steady `TN_FRAME_HITCH` gaps of ~3.3 s where the same build presented continuously before
the change (`TN_PRESENTS_TICK` absent from the post-change buffer). The process survives and the
scene renders, but this emulator runs bayview through ANGLE/GL rather than the phone's
Vulkan/WebGPU path, and the two lanes have disagreed before
(`packages/runtime-native/AGENTS.md`). This is recorded as an open emulator-lane observation, not
a green claim: **the physical-lane confirmation (pid stable + presents continuous through a
font-scale change) is still owed** and is blocked only by the phone being in use.

## Probe protocol notes (for reruns)

- `input keyevent KEYCODE_POWER` toggles twice per injected press; use
  `input keyevent --action DOWN KEYCODE_POWER` and verify `dumpsys power` shows Dozing/Asleep.
- Lifecycle markers are queued while the pump is parked and drained on resume — their logcat
  timestamps read late; correlate with system lines, not arm wall-clock.
- TN_PRESENTS_TICK `frames` is cumulative per process; continuity across an arm proves no restart,
  a reset near zero proves one.
