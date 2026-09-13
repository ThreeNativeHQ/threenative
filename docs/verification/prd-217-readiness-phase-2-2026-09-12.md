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

## Observed red, then restored green

Run [34734548984](https://github.com/ThreeNativeHQ/threenative/actions/runs/34734548984), job
`macOS desktop core`, failed the required test: the overlay attached but the press did not toggle
`paused` — the Menu's buttons sat after a variable-width instruction string, so the fixed press
fraction missed the pause island. Anchoring the buttons to the panel's left edge (previous commit)
and pressing at x 0.05 made the row green in 34739248955.

## What is still not run

- **User verification** on macOS: the human click / type / focus / Retina-scaling / app-activation
  sequence with capture inspection has not been performed.
- Independent reviewer PASS is recorded separately.

## Verdict

Phase 2's required test is green on the hosted macOS runner. The remaining open box is the human
interaction check.
