# PRD-168 — present-path framebuffer capture gated behind a request

Date: 2026-08-22. Desktop Linux lane only; Android/iOS unverified by this change.

## What changed

- `captureFrameScreenshot()` now requires `g_screenshotRequested` (set only via
  `requestFrameScreenshot()`, cleared once the capture lands). An unrequested presented frame
  performs **no framebuffer copy and none of the completion-wait iterations**.
- Consumers raise it explicitly: the desktop CLI screenshot-mode loop (per frame of a
  `--screenshot` run, so the final presented frame is the captured one), and the playtest
  mailbox path, which became a small state machine — request file seen → request raised →
  ready polled with a 120-tick bound → saved → `clearFrameScreenshotReady()` so the next
  request waits for its own capture instead of reading a consumed buffer. That path also
  stopped constructing an `ifstream` every frame (one stat + cached resolved path instead).
- Consumer inventory checked: `Context::saveScreenshot`, `Context::captureFrame`,
  `runtime.saveScreenshot` JS binding (no repo callers), CLI end-of-run save, playtest mailbox,
  conformance via the same CLI path. The Canvas-2D composite path keeps its own capture
  behaviour (different present mechanism, Canvas-2D games only).

## Evidence

- `pnpm native:build` — exit 0 (twice: capture gate, then the PRD-175 frame tag).
- `pnpm native:verify:desktop` — **exit 0**: 300 frames, 1280×720, non-blank screenshot
  (`packages/runtime-native/artifacts/desktop-core-2026-08-22.png`). The screenshot lane still
  captures through the requested path.
- Desktop load ladder A/B, same machine, `pnpm bench:engines --arm tn-desktop`
  (before = `knee-baseline-tn-desktop-2026-08-21.json`, captured pre-change on this binary's
  parent; after = `prd168-after-tn-desktop-2026-08-22.json`; p50 over each rung's repeats):

| L1 rung (draws) | before p50 ms | after p50 ms | delta |
|---|---|---|---|
| 164 | 30.28 | 27.24 | **−3.0** |
| 629 | 38.97 | 35.81 | **−3.2** |
| 2 469 | 72.19 | 71.76 | −0.4 |
| 9 809 | 212.3 | 217.4 | +5.1 |

Reading: a consistent ~3 ms/frame recovery exactly where the mechanism predicts — the copy plus
its wait was a fixed adder — converging into noise once real render work dominates. The 9 809
row is inside this machine's documented contention drift (the 2026-08-21 record measured
212→321 ms across one day on that rung); no claim is made from it either direction.

## Not executed

- Device (Android/iOS) numbers: phone attached but charging over USB; no device claim.
- The optional early-exit inside the 100-iteration wait was descoped: a completion signal
  differs per backend (wgpu-native queue-work-done vs Dawn tick semantics), and after gating the
  wait only ever runs on frames somebody actually screenshotted. Recorded rather than half-built.
- Every native benchmark taken before this change carries the removed tax; comparisons across
  the boundary must say which side they were measured on.
