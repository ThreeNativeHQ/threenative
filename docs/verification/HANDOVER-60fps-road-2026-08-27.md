# HANDOVER — the 60 fps road. Read this, do task 1, nothing else first.

**2026-08-27.** The entry point for the next session on the native-frame goal. Read the two chained
docs for depth, but your task is §3 and only §3 first.

- Evidence and full tried-ledger: [prd-227-hostgap-decomposition-2026-08-27](prd-227-hostgap-decomposition-2026-08-27.md)
  — **§4 is the graveyard; do not rebuild any row of it.**
- Device lane commands, rebuild recipe, tree state: [HANDOVER-hostgap-2026-08-27](HANDOVER-hostgap-2026-08-27.md) §6
  (its task 1 is **done** — the `TN_HOST_GAP` instrument landed at `73e0baec`; do not re-run it).
- The open PRD this work rides: `docs/PRDs/PRD-227-the-frame-crosses-once.md` (Change 1 landed;
  Change 2 falsified; do not "execute PRD-227" as a task).

---

## 1. Where it stands, in one table

Pixel 8 `shiba`, Bayview, measured 2026-08-27 with the landed instrument (p50 ms, 300-frame
windows; every arm a verified cold launch):

| Arm | CPU-side (JS + replay + misc) | GPU tail at present | period | fps |
| --- | ---: | ---: | ---: | ---: |
| 1080p FIFO | ~36 | 14.6 | 48.75 | 20.9 |
| 1080p mailbox | ~36 | 14.2 | 48.42 | 20.55 |
| 1080p mailbox, frame latency 3 / 1 | ~36 | 14.7 | ~49.5 | flat |
| 720p mailbox | ~36 | 0.91 | 32.57 | **34.39** (SurfaceFlinger: 34.2) |

hostGap is no longer one mystery: **~8 ms is real C++ replay work** (Change 1 moved it out of the
JS meter), **~14 ms is a GPU-tail wait inside `wgpuSurfacePresent`** — it survives mailbox and
frame latency 1/3 (both falsified), collapses at 720p. Everything else (microtasks, timers,
events, audio, handles, screenshot) measures < 1 ms. Dead.

## 2. The goal, stated honestly

Owner's bar: **60 fps+ on Android** (30 fps was never acceptable; it is a milestone). Chrome runs
this same scene at 59.99 fps on this same phone, so it is physically reachable. But no single lever
reaches it — that conclusion is three sessions old and each half of it is now measured:

```
60 fps  needs  CPU-side ≤ 16.7 ms  AND  GPU frame ≤ 16.7 ms  AND  real pipelining (frames in flight)
today      CPU-side ≈ 36 ms          GPU frame = unknown (tail 14 ms + unmeasured overlap)     serialized at present

30 fps milestone ≈ pipelining fix + ~3–5 ms CPU cut        (36 + 0 → ~33 ms ⇒ ~30 fps)
60 fps           ≈ pipelining fix + JS halving + GPU ≤ 16.7  (the PRD-227 story, re-attributed)
```

**The one number that decides which road dominates: GPU frame time at 1080p.** No GPU-side timing
has ever been taken (named as not-run in every record to date). That is task 1.

## 3. TASK 1 — measure GPU frame time. One diagnostic build, two device runs.

Instrumentation, not optimisation. In `packages/runtime-native/src/webgpu/bindings.cpp`,
`endDawnFrame()`: after `presentPendingSurface(state)` (and after `paceToPresentationCap()`), time
a **blocking** `wgpuDevicePoll(state->device, true, nullptr)` and emit it through `TN_HOST_GAP` as
a new `gpuDrain` segment (add it to `HostGapMeter` in `runtime.cpp`; `BindingsState` already
carries the `framePhase*Ns` pattern to copy). That wait is the GPU's remaining work at the instant
present returns; together with the existing segments it yields the GPU frame estimate:

```
GPU frame ≈ drain (tail) + overlap,  where overlap ≈ (present end − frameReplay start) ≈ period − update − JS render − drain
```

Report `drain.p50` and your derived GPU-frame estimate per arm. Then the pre-registered fork:

| GPU frame @1080p | Meaning | Road |
| --- | --- | --- |
| **≥ 30 ms** | The GPU owns the frame at full resolution. No seam fix can buy 30/60. | **B — GPU work**: the game-owned cut is Bayview's 224 frustum-culling-disabled decal materials (~54 % of draws); a render-scale knob banks 30+ fps today (feature decision — file it, don't sneak it). |
| **16–24 ms** | The frame is CPU-bound and the 14 ms present serialization is the defect. | **A — the seam**: take **Dawn on Android** for a ride (A1 only ever ran on desktop; the device backend swap is *untried*, not refuted), or patch/upgrade wgpu-native's present path. |
| **≤ 15 ms** | Both roads open; pipelining alone lands ~27 fps and the JS halving becomes the 60 fps lever. | A and B, in that order. |

**Red-green:** the new segment must move only itself — insert a deliberate 5 ms sleep beside the
poll, confirm `gpuDrain` rises 5 ms and no other segment does, remove it, paste both. (Copy the
`frameReplay`/`present` wiring verbatim; the meter's cross-check — Σ segments ≈ hostGap — must
still hold, noting `gpuDrain` sits *outside* hostGap and adds to `period` instead. State where it
lands in your record.)

**Never ship a blocking poll in the loop** — PRD-222 F4 measured that class of wait as a ~2×
render regression on device. This build is diagnostic-only; the segment (or its gating) is the
first thing the next session removes.

**Acceptance:** one record in `docs/verification/` naming GPU frame time at 1080p on both present
modes, the fork taken, and the next change pre-registered before it is written. Do not fix
anything in the same commit.

## 4. Then, and only then

- **Road A**: Dawn-on-Android arm (same bundle, interleaved, device lane; the desktop Dawn swap
  recipe and its pitfalls are in prd-226-a1) → if flat too, the seam is wgpu-native's present
  itself: upgrade or patch (`Surface::present` draining the GPU tail), desktop-first, then device.
- **Road B**: GPU work — but the game owns its draw counts: that is a game-config experiment +
  framework render-scale feature, not a `packages/` change (the ownership rule killed Phase 4 for
  exactly this; do not re-litigate it from the GPU side).
- **Either road**: the CPU side still owns ~36 ms. `frameReplay` (~8 ms, device; 3.2 ms desktop
  for the same stream) is profiled next with `simpleperf` — `framePhaseReplayNs` already isolates
  it. The 27 ms JS render is back on the table with clean attribution (mailbox arm: render.p50
  16.6 with hostGap fully accounted) — Chrome does the same three.js in 16.7 total.

## 5. Method rules — paid for, binding

1. **Every A/B a same-session pair**; discard the first two whole runs of a session, not just
   window 1 (F15).
2. **Desktop is never an fps verdict** — Xvfb throttles presents (`present` reads 33.7 ms there by
   design); judge desktop by `render.p50`. The device owns fps.
3. **Cross-check every fps claim** against `dumpsys SurfaceFlinger --timestats`; `gfxinfo` is a
   5× flattering error for this app (it reads the Skia view hierarchy, not the game's SurfaceView).
4. **Cold launches verified**: `am force-stop` → `pidof` empty → `am start -W`. The first
   latency=3 arm raced its own restart and nearly measured a stale process.
5. **Verify the binary carries the change** before trusting a number (strings the packaged `.so`
   for your marker; gradle properties reach CMake only via the engine's `package-android.mjs`).
6. **Pre-register any lever** with predicted ms/frame and the call count it is based on; refuse
   anything predicting < 2 ms (PRD-226 binding rule — it retroactively refuses half the graveyard).
7. **Red-green, bugfixes included; never claim a gate you did not run; paste the output.**
8. Device preflight (thermal/battery, Wi-Fi adb = discharging) per
   `packages/runtime-native/AGENTS.md`; the owner's discharge waiver is recorded in
   prd-227-cadence-lock.
9. **Commit as you go, path-limited** — another lane may hold this tree. `.worktrees/` is dead
   lanes; never search it.

## 6. Tree state

| Tree | HEAD at this handover | Note |
| --- | --- | --- |
| engine (`threenative-engine`, `main`) | `5f324df5` | instrument at `73e0baec`, report at `5f324df5` |
| game (`sandbox/fps-framework`) | `d421330` | Bayview; `dist-native/fps-framework.apk` currently carries latency=1 |

Device restored: `present_uncapped=0`, `wm size` 1080×2400. The APK in the sandbox was last built
with `-PthreenativeFrameLatency=1` — rebuild before any arm that assumes defaults.
