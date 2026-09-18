# PRD-394 — An honest launch: progress you can read, failures that fail closed, a load that is not 104 seconds

Status: PHASE 1
Owner: engine + `midway-open-pacific` (sandbox)

## Why

`midway-open-pacific` on desktop takes **104 s** from process start to `startup.whenReady()`, behind
an opaque layer that says "Preparing the Pacific theatre…" and never changes. Measured on this host
(`TN_LOAD_STEP`, 2026-09-18, local host `build/tn-linux/mystral`):

| step | settled at |
| --- | --- |
| audio | 1.1 s |
| aircraft | 31.4 s |
| ships | 52.6 s |
| fleet | 70.7 s |
| hulls | 97.3 s |
| environment | 97.5 s |
| deck-crew | 97.5 s |
| `enter()` | 100.8 s |
| `whenReady` | 104.4 s |

Every one of the 222 bundle reads (164.9 MB) completes inside the **first 1.5 s** — so none of the
remaining ~100 s is I/O. It is GLB parse, texture decode and GPU upload (1128 MB of textures, 227
of them) on the main thread, in ~1 s blocking chunks: `TN_SLOW_PHASE:{"phase":"animationFrames",
"ms":998}` once per second for the whole launch, which also caps the loading screen at one repaint
per second.

Three separate defects fall out of that:

1. **Nothing reports.** The engine already computes `ctx.startup.progress` (byte-weighted,
   monotonic) and the game never reads it. Nothing anywhere names the asset being worked on.
2. **Nothing fails closed.** A launch that stops making progress just hangs. The same run ended in
   `[FATAL] The GPU device was lost: vkQueueSubmit failed with VK_ERROR_DEVICE_LOST` (VRAM was
   exhausted by another process on this host — 7726/8192 MiB taken) and the *player* saw a still
   loading screen, with the diagnosis only in a terminal they do not have.
3. **It is too slow**, and the work is all on one thread in one-second blocks.

## Phases

### Phase 1 — Fail closed, and make a failure copyable

- [ ] Engine: a startup stall watchdog. When `startup.progress` does not move for `stallMs`
      (default 20 s) the engine reports `TN_STARTUP_STALLED` once, naming elapsed time, the last
      progress value and the assets still in flight.
- [ ] Engine: the stall and any fatal device error reach the *page*, not only stdout, so a game can
      show them; the built-in native error surface renders the message with a **Copy** button.
- [ ] Red-green: a scenario/unit test that a stalled startup reports rather than hangs.
- [ ] Verified on midway: a stalled or device-lost launch shows a readable, copyable message.

### Phase 2 — Progress you can read

- [ ] Engine: `assets.progress` gains the in-flight logical paths, so a loading view can name what
      is being loaded right now.
- [ ] Game (midway): the loading layer shows a percentage bar driven by `ctx.startup.progress` and
      the current asset path; `#load-status` stops being a fixed string.
- [ ] Both surfaces: web DOM shell and the native web view get the same reading.
- [ ] Playtest asserts the bar moves and the label changes during load.

### Phase 3 — Cut the 104 s

- [ ] Re-measure on an idle GPU (the 104 s reading was taken with 94% of VRAM held by another
      process); record the clean baseline here.
- [ ] Attribute the ~100 s of post-fetch work between GLB parse, texture decode and GPU upload.
- [ ] Land the cuts that the attribution justifies, each with a before/after number in this file.
- [ ] Nothing regresses: `pnpm test:templates` and midway's own playtests stay green.

### Phase 4 — Never ship a stale host again

- [ ] `threenative doctor` fails when the installed `@threenative/runtime-native` prebuilt is older
      than the installed `@threenative/core` contract it must satisfy (found the hard way: the
      published `runtime-native-v0.3.2` prebuilt predates PRD-393, so every scaffolded game built a
      desktop binary whose UI never appeared).
- [ ] Red-green: doctor spec covers the stale-prebuilt case.

## Acceptance criteria

- [ ] A launch that stalls or loses the device says so on screen, with a copy button.
- [ ] The loading screen shows a moving percentage and the asset being loaded.
- [ ] Midway's desktop launch is measurably faster than the 104 s baseline, re-measured on an idle
      GPU, with the number in this file.
- [ ] `threenative doctor` rejects a prebuilt host older than the core it is installed beside.
