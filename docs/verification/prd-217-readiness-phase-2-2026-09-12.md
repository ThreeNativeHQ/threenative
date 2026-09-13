# PRD-217 Phase 2 readiness — macOS desktop UI overlay

**Date:** 2026-09-12
**Candidate:** `7b3592bd2` (`prd217/native-desktop-hud`); the required test passed in run
[34739248955](https://github.com/ThreeNativeHQ/threenative/actions/runs/34739248955).
**Platform:** macOS 15 hosted runner (`macos-15`), job
[`native-platforms / macOS desktop core`](https://github.com/ThreeNativeHQ/threenative/actions/runs/34739248955/job/103676547400) — PASS.
**Scope:** Phase 2 of [`PRD-217-webview-ui-layer.md`](../PRDs/production-readiness/PRD-217-webview-ui-layer.md).

## Required test — green on macOS

The macOS desktop core job runs `pnpm --filter @threenative/runtime-native native:build` (clang
builds the objc2/AppKit backend and links WebKit/AppKit plus `libthreenative_ui_overlay.a` into
`mystral`), then `native:verify:desktop`, then the same internal starter route described in the
phase 1 record:

```sh
THREENATIVE_RUNTIME_BINARY=<build>/tn-macos/mystral pnpm --dir <starter> test:native
node packages/runtime-native/scripts/verify-starter-ui-overlay.mjs \
  --project <starter> --runtime <build>/tn-macos/mystral --skip-build
```

The scenario's rows all passed: `GameState.paused` `false → true → false` across the two presses
inside the pause island, subject `player` moving `-z` ≈ 2.0 m, and zero console errors.
`TN_UI_OVERLAY:{"attached":true}` confirms the WKWebView HUD attached; the pointer press is routed
by `tn_ui_overlay_hit_test` through the same published rectangles the macOS `hitTest:` owns and
dispatched into the page by `tn_ui_overlay_inject_pointer`.

**What this proves, and what it does not.** It proves the WKWebView HUD attaches on macOS and that
a synthetic pointer routed through the in-process rectangle list drives a HUD intent and game-state
change. It does **not** call AppKit's `hitTest:` with a real event, so the `hitTest:` implementation
(including the unexercised y-orientation between AppKit's bottom-left origin and the page's
top-left normalized rectangles) is not measured. The independent reviewer returned NEEDS CORRECTION
on this basis. Closing Phase 2 needs OS-level pointer injection (`CGEvent`) or an explicit narrowing
of the claim to attach + bridge + shared-region routing.

## Observed red, then restored green — the PRD's controls, run

The PRD requires detaching the overlay (or suppressing one resize/intent callback in isolation) and
running the same scenario. The detach ("disable attachment") and drop-intent controls were run on
Linux against the packaged starter — each `exit 1` with `resource.GameState.paused.atSteps`
failing, then restored green (see the phase 1 record for the exact table).

A layout-miss red also occurred on the host: run
[34734548984](https://github.com/ThreeNativeHQ/threenative/actions/runs/34734548984), job
`macOS desktop core`, attached the overlay but the fixed press fraction missed the pause island
because the Menu's buttons sat after a variable-width instruction string. Anchoring the buttons and
pressing at x 0.05 made the row green in 34739248955.

## Narrowed claim (independent-review fix)

The reviewer returned NEEDS CORRECTION because the synthetic route never calls AppKit's `hitTest:`
with a real event. The claim is narrowed to what is proved:

- **Proved on macOS (hosted):** the WKWebView HUD attaches to the real `NSWindow`, the host
  publishes rectangles, a routed pointer produces a HUD intent and game-state change, and movement
  reaches the game.
- **Proved on Linux (local, real OS input):** the xdotool proof drives real pointer events through
  the actual input shape, 8/8 — the OS-cut analog of `hitTest:`.
- **Not independently probed:** `-[TnUiOverlayView hitTest:]` itself, including the y-orientation
  between AppKit's bottom-left origin and the page's top-left normalized rectangles. Closing that
  needs OS-level `CGEvent` (or a direct `hitTest:` probe).

## User verification — owner-delegated

The owner cannot run a Windows/macOS machine and explicitly delegated the human review to an agent
(2026-09-12). The agent inspected the hosted macOS captures and confirmed the WKWebView HUD
attaches, the routed press produces a game-state change, and movement reaches the game. **No human
was at a macOS machine**; the owner waived the human-at-the-machine check. The click/type/
Retina-scale/app-activation sequence itself was not performed by a person.

## Verdict

Phase 2's required test is green on the hosted macOS runner under the narrowed claim (attach +
bridge + region routing), with AppKit `hitTest:` not independently probed. Closed by owner
delegation.
