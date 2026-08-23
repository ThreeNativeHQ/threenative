---
prd_contract: v1
---

# PRD-183 — The Android runtime aborts silently on the first draw against a resized swapchain

**Status:** COMPLETE, 2026-08-22 (commit `4538536f`). Root cause named with its own panic text —
wgpu-native refuses `wgpuSurfaceConfigure` while a SurfaceOutput is outstanding; the host now
discards the stale acquisition before reconfiguring (`webgpu/bindings.cpp`) and pipes
stdout/stderr to logcat so every future native failure names itself (`platform/android_main.cpp`).
Evidence: [prd183-android-resize-abort-2026-08-22.md](../../verification/prd183-android-resize-abort-2026-08-22.md)
— phase-0 repro without conformance machinery reproducing the original panic pre-fix and
completing post-fix; row `25-camera-parented-overlay` mutation cycle on emulator-5554 (fix pass →
commenting exactly the discard block fails with "Error in wgpuSurfaceConfigure: Validation Error"
→ restored pass); full Android lane **67 pass / 0 fail / 1 blocked**, where the single blocked row
(`97-input-restart-lifetime`, which completed its native leg) belongs to PRD-177's parked phase-4
parity wiring, not to this defect. Desktop rows 25 and 60-resize-render-target pass against pixel
references. No physical-device, iOS, arm64, driver or mobile-readiness claim is made or licensed
by anything in this file. The emulator proves the emulator.

**Outcome:** the `25-camera-parented-overlay` conformance row completes on the Android emulator,
or dies with a named diagnostic naming the reconfigure step — never again as a silent SIGABRT
that logcat reports only as a vanished process.

**Layer:** engine — `packages/runtime-native/src`, the WebGPU surface reconfiguration and
present path (`ThreeNativeWGPU` / wgpu-native behind it).

**Owner:** the native lane, spawned after the desktop lane finishes — the host binary must not
rebuild mid-measurement.

**Depends on:** nothing outside this package.

**Blocks:** [PRD-166](PRD-166-camera-parented-overlay-never-marks-on-android.md) phases 2–3 (its
row can neither pass nor fail honestly until this defect has an owner), and therefore the
Android lane reaching `67 / 0 / 0` on this machine.

## Context (verified evidence, 2026-08-22)

All observations are from unfiltered parallel logcat plus the harness report of isolated
`--only-tests 25-camera-parented-overlay` runs at commit range `43c99465..680e7c7f`,
device `emulator-5554`, AVD `threenative-prd050`, API 35, x86_64, V8,
`swiftshader_indirect`, Three.js 0.185.1.

1. **The process aborts, and it is not slow.** With `TN_ANDROID_TIMEOUT_MS=180000` (4× the
   default) the row fails identically. Zygote reports signal 6 (SIGABRT) 497 ms after
   `evalScript` began — the 45-second default window never came into play, and the 2026-08-19
   ledger's "no fatal signal" reading was an artifact of `filterAppLog` dropping the Zygote
   line (it comes from pid 395).
2. **The scene layer is exonerated by execution.** With a trace ladder in the scene
   (`TN_PRD166_TRACE` lines in `conformance/scenes/shared/camera-parented-overlay.js`),
   viewport 0 — a full `renderer.setSize`, a real render, and both assertions — passes
   completely, including its pixel-space anchor proof.
3. **`setSize` returns cleanly; the abort is in the first render against the resized
   swapchain.** Run C split the two native calls inside the dying iteration:

   ```text
   14:40:58.341  TN_PRD166_TRACE:{"stage":"viewport-begin","index":1,"width":1024,"height":768}
   14:40:58.341  TN_PRD166_TRACE:{"stage":"set-size-returned","index":1,"width":1024,"height":768}
   14:40:58.450  Zygote: Process 8771 exited due to signal 6 (Aborted)
   ```

   `renderer.setSize(1024, 768)` returns; the SIGABRT lands ~109 ms later, before
   `render-returned`. Between the two markers the app process logs nothing at all — no JS
   exception text, no wgpu panic message, no GPU validation line, no tombstone in logcat.
4. **A JavaScript throw cannot be the killer.** A deliberate in-loop throw (probe run B) was
   caught by the generated entry, printed to logcat as
   `[ThreeNative conformance] failed: Error: …`, and left the process alive to the timeout.
   Whatever aborts here is below the JS boundary.
5. **This scene is the only one that resizes the swapchain mid-scene**, which is why the other
   66 rows pass. It also matches this scene's own history on another backend: tier-1 day
   recorded it failing the *desktop* lane on GPU validation — "mismatched depth and colour
   attachment sizes after resize" (`docs/verification/tier-1-2026-08-10.md`) — before a
   2026-08-15 desktop run measured it passing there. The resize path has form.

Working theory to disprove, not a conclusion: the surface reconfiguration triggered by
`setSize` takes effect lazily or partially, and the first `render`/present against the
reconfigured swapchain drives wgpu-native (or the ANativeWindow/gfxstream bridge under it)
into an `abort()` with no diagnostic output.

## Integration Ledger

| # | New thing | Live caller (`file:line` — fill during implementation) | Replaces | Old path removed? | Negative control |
|---|-----------|--------------------------------------------------------|----------|-------------------|------------------|
| 1 | Named diagnostic on reconfigure/present failure instead of silent abort | fill: the aborting file in `packages/runtime-native/src` | silent `abort()`/panic path | replaced in place | revert → row dies silently again, red |
| 2 | Correct behaviour on first present after size change | same | current abort | replaced in place | `25-camera-parented-overlay` completes; revert → red |

## Phases

#### Phase 0 — Minimal reproduction outside the conformance scene

**Files:** a scratch native bundle or example — NOT the conformance scene; the scene must stay
a consumer that merely witnesses the fix.

- [ ] Reproduce the abort with the smallest program that configures a WebGPU surface at one
      size, renders, calls `setSize` to a different size, renders again — on the same emulator
      image and renderer flags. Record whether it reproduces without three.js scene machinery
      (plain `WebGPURenderer` resize + render may suffice).

#### Phase 1 — Root cause named at file:line

- [ ] Name the file and line where the abort originates (`abort()`, Rust panic route, assert,
      or unchecked error promoted to abort). The silent death ends here: whatever the fix, the
      failure mode afterwards must name itself in logcat.

#### Phase 2 — Fix with a test in the same commit

- [ ] Fix in the named layer. The row completes on the emulator, or the failure surfaces as a
      named diagnostic naming the reconfigure step.
- [ ] Test in the same commit. House rule: the red is produced by reverting the EXACT fixed
      line(s) on the fixed tree, not by an unrelated failure — paste both states.

#### Phase 3 — Verified through PRD-166

- [ ] `25-camera-parented-overlay` passes on the Android emulator in PRD-166's Phase 3
      full-lane rerun (`67 / 0 / 0`), or dies with the new named diagnostic. That rerun, not a
      unit test alone, retires this defect.

## Acceptance criteria (consumer-scoped)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | A minimal resize-then-render program reproduces the abort without the conformance scene | pasted run |
| 2 | The aborting file and line are named in writing | pasted location + the observation that pins it |
| 3 | After the fix, the failure mode either does not occur (row passes) or names the reconfigure step in logcat | pasted logcat/report |
| 4 | The fix's red comes from reverting its named lines | pasted red and green |
| 5 | PRD-166's full-lane rerun reflects the outcome | pasted summary |

## Deliberately out of scope

- Any physical-device, arm64, iOS or frame-rate claim — this PRD executes on the emulator and
  concludes about the emulator.
- The harness reporting defect (an assertion failure surfacing as a generic timeout) — owned by
  PRD-166 phase 2, not here.
- Widening the host shim surface; whatever the fix is, it stays inside the existing contract
  that `document`/`window` are compatibility stubs.
