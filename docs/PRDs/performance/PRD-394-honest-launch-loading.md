# PRD-394 — An honest launch: progress you can read, failures that fail closed, a load that is not 104 seconds

Status: PHASE 3 (phases 1-2 landed; phase 3 blocked on an idle GPU)
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

- [x] Engine: a startup stall watchdog. When `startup.progress` does not move for `stallMs`
      (`STARTUP_STALL_MS`, 45 s) the engine reports `TN_STARTUP_STALLED` once, naming elapsed time,
      the last progress value and the assets still outstanding. Observed on midway:
      `TN_STARTUP_STALLED: ... stood at 59.4% for 20s, 25s into the launch`.
- [x] Engine: both reach the page through `onLaunchFailure`; core does not draw them, because
      native `document` is a Three.js stub whose `appendChild` is a no-op.
- [ ] The desktop host's own device-lost dialog (`SDL_ShowSimpleMessageBox`, `context.cpp`) gets a
      **Copy** button. That dialog — not the page — is what a player sees when the device dies,
      because the host exits 1 immediately and never resolves the JS `device.lost` promise.
- [x] Red-green: `packages/core/__tests__/launch-diagnostics.spec.ts`, 4 tests, all green
      (`pnpm exec vitest run packages/core/__tests__/launch-diagnostics.spec.ts`).
- [x] Verified on midway: the stall report fired on the real 104 s launch and named the outstanding
      assets. The copyable surface is the game's own loading layer (COPY MESSAGE button).

### Phase 2 — Progress you can read

- [x] Engine: `assets.progress.pending` names the outstanding logical paths. (`pending`, not
      `inFlight`: `constraints.spec.ts` forbids the substring "light" in core sources.)
- [x] Game (midway): `IShell.loading` drives a real `#load-bar` and a `NN% — /assets/…` status
      line, replacing the indeterminate stripe that moved whether or not anything was happening.
- [x] Both surfaces: implemented once in `src/ui/dom.ts` and replayed through the bridge, so the
      native web view shows the same call.
- [ ] Playtest asserts the bar moves and the label changes during load.
      Not yet run: every launch on this host currently dies with `VK_ERROR_DEVICE_LOST` — another
      process holds 7726 of 8192 MiB of VRAM.

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
