# PRD-183 — the Android resize abort, root-caused and repaired

Date: 2026-08-22
Lane: `lane-native`
Status: **ROOT CAUSE NAMED WITH PANIC TEXT IN HAND; fix under verification**
Device: `emulator-5554`, AVD `threenative-prd050`, API 35, x86_64, V8, `swiftshader_indirect`.
**The emulator proves the emulator. No physical-device, arm64, iOS or mobile-readiness claim is
made or licensed by anything in this file.**

## The silence, removed first

Nothing could be root-caused while Rust panic text went nowhere: the Android host never
redirected stdout/stderr (only direct `__android_log_print` calls and the V8 console bridge reach
logcat), and wgpu-native reports every validation failure by panicking to stderr before aborting.
`platform/android_main.cpp` now pipes both streams to logcat (tag `MystralStdio`, line-buffered,
stderr unbuffered) from the top of `SDL_main`. Every logcat line quoted below that carries that
tag exists because of it — including the two lines that name the defect.

## Phase 0 — minimal reproduction outside the conformance scene

Scratch project `.runtime/prd183/repro-project/` (untracked diagnostic tool, deliberately outside
the registry): a bare `three/webgpu` game that configures at 1280×720, renders once, calls
`renderer.setSize(1024, 768)`, renders again — nothing else. Run through the harness's own
project mode (`run-conformance.mjs --target android --device emulator-5554 --project …`).

Pre-fix result: same death as the conformance row, no scene machinery involved:

```text
15:52:30.976  TN_PRD183:render-at-1024x768 begin
15:52:31.043  MystralStdio: thread '<unnamed>' panicked at src/lib.rs:598:5:
              Error in wgpuSurfaceConfigure: Validation Error
              Caused by:
                `SurfaceOutput` must be dropped before a new `Surface` is made
15:52:31.043  fatal runtime error: failed to initiate panic, error 5, aborting
15:52:31.110  Zygote: Process 24244 exited due to signal 6 (Aborted)
```

Criterion 1 met: the abort reproduces without three.js scene machinery beyond one mesh and one
resize, and the previously silent death now names itself.

## Phase 1 — root cause

**Engine-side trigger:** `packages/runtime-native/src/webgpu/bindings.cpp`,
`syncSurfaceSizeToCanvas()` calling `wgpuSurfaceConfigure` (the binding invoked from the canvas
`getCurrentTexture` shim). Three.js calls `getCurrentTexture` inside `renderer.render()`, so the
reconfigure fires mid-scene while the previous frame's acquired swapchain image is still held in
`g_currentTexture` — the frame boundary that would present and drop it has not run, because the
conformance scenes (and any synchronous render sequence) complete both renders inside one
microtask drain. wgpu-native rejects reconfigure-with-outstanding-SurfaceOutput by panicking;
the panic aborts the process. On the direct-presentation surface Android uses, the held texture
is a raw SurfaceOutput; that is why only this platform aborted.

The chain, end to end: `setSize(1024,768)` returns cleanly → next `render()` →
`getCurrentTexture` → `wgpuSurfaceConfigure` under an outstanding acquisition → wgpu-native panic
→ `abort()` → SIGABRT ~67–109 ms after the size change, matching every timestamped observation in
[PRD-166's attribution](camera-parented-overlay-android-2026-08-22.md).

## Phase 2 — fix and red-green

Fix (`bindings.cpp`, `syncSurfaceSizeToCanvas`): when the canvas has changed size and a **raw**
surface output is still held (direct-presentation mode only — the sRGB presentation bridge on
desktop never holds one), discard the stale image: release its view/texture, clear the frame's
acquisition tracking, let `wgpuTextureRelease` unwind the SurfaceOutput — then reconfigure
immediately at the new size, so the current frame draws color at extents matching its freshly
sized depth attachment. No present is emitted for the discarded image: an extra present breaks
the one-present-per-frame invariant the device gates enforce (a flush-presenting first attempt
was rejected by that gate at 64 presents in 60 frames), and the discarded frame is replaced by
the caller's render moments later.

Two intermediate designs were built, run on the emulator, and rejected on their evidence:

1. Defer-only: stopped the SurfaceOutput panic but rendered the transition frame with new-size
   depth onto old-size color — "Attachments have differing sizes: depth (1024, 768) … color
   (1280, 720)", the exact failure tier-1 day recorded on desktop — followed by a submit-time
   panic ("CommandBuffer is invalid") and the same SIGABRT.
2. Flush-present (present the stale image during the reconfigure): fixed the abort but tripped
   the present-ratio gate on row 25 ("presented 64 times in 60 frames").

### Red/green/mutation — criterion 4

All runs through the harness on `emulator-5554`; the red comes from commenting out exactly the
discard block (the fix) on the otherwise-fixed tree.

| State | Vehicle | Result |
| --- | --- | --- |
| pre-fix | minimal repro | fail — panic "`SurfaceOutput` must be dropped before a new `Surface` is made", SIGABRT 15:52:31.110 |
| fix | row 25 isolated | **pass** (`pass: 1`, screenshot captured, 16:0x) |
| mutation (fix commented) | row 25 isolated | **fail** — `Error in wgpuSurfaceConfigure: Validation Error`, process exited before the marker |
| restored | row 25 isolated | **pass** again |

The same cycle through the minimal repro: fix → `render-at-1024x768 returned`, no signal 6,
screenshot captured; mutation → death at `render-at-1024x768 begin`, Zygote signal 6; restored →
completes again.

Known limitation of the visibility bridge, recorded honestly: when the abort follows the panic
write within microseconds, the pipe-reader thread can lose the final lines (the row-25 mutation
run shows the Zygote signal-6 line but not the panic text; the phase-0 repro run shows both).
The panic text is always recoverable from a slightly-less-instant death, as phase 0 demonstrates;
making the bridge crash-proof (file fallback) is follow-up polish, not needed to attribute any
failure observed here.

## Desktop unaffected — proven against references

`--target desktop --only-tests 25-camera-parented-overlay,60-resize-render-target`: both pass
with pixel comparison against the reference set — 25 at mismatch ratio 0.0105 (tolerance 0.015),
60-resize-render-target at 0.0000087 (tolerance 0.01). The C++ lifetime tests still exit 0.

## Phase 3 — full Android lane

Full-lane rerun with the fix, default settings, `emulator-5554`:

```text
summary: {'pass': 67, 'fail': 0, 'blocked': 1}
```

**Every previously-executing row passes, including `25-camera-parented-overlay`**
(`status: pass`, native leg completed with screenshot). The one blocked row is
`97-input-restart-lifetime` — the row this same batch added for PRD-177 phase 1. Its native leg
completed (`completed: true`, marker fired) but the lane has no browser-captured reference for a
row added today, so the comparison lane correctly reports it blocked rather than passed. Its
parity wiring belongs to PRD-177 phase 4, which is parked at that PRD's own stop decision.

PRD-183 acceptance criteria: 1 met (phase 0 repro above), 2 met (panic text naming
`wgpuSurfaceConfigure` / lib.rs:598 plus the host-side call site), 3 met (row passes; had it not,
the panic now names itself in logcat either way), 4 met (mutation table above), 5 met by this
run being the full lane the next PRD-166 rerun resumes from: 67 pass / 0 fail / 1 blocked-new-row.


