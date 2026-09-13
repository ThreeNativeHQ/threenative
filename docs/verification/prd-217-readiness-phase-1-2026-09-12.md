# PRD-217 Phase 1 readiness — Windows desktop UI overlay

**Date:** 2026-09-12
**Candidate:** `7b3592bd2` (`prd217/native-desktop-hud`); the required test first passed in run
[34739248955](https://github.com/ThreeNativeHQ/threenative/actions/runs/34739248955).
**Platform:** Windows 2025 hosted runner (`windows-2025`), job
[`native-platforms / Windows desktop core`](https://github.com/ThreeNativeHQ/threenative/actions/runs/34739248955/job/103676547409) — PASS.
**Scope:** Phase 1 of [`PRD-217-webview-ui-layer.md`](../PRDs/production-readiness/PRD-217-webview-ui-layer.md).

## Required test — green on Windows

The desktop core job runs `pnpm --filter @threenative/runtime-native native:build` (MSVC + vcpkg;
the Rust overlay and `WebView2LoaderStatic.lib` link into `mystral.exe`), then `native:verify:desktop`
(300 frames, non-blank capture), then the internal starter route:

```sh
pnpm --dir <scaffolded starter> install --ignore-scripts
THREENATIVE_RUNTIME_BINARY=<build>/tn-windows/mystral.exe pnpm --dir <starter> test:native
node packages/runtime-native/scripts/verify-starter-ui-overlay.mjs \
  --project <starter> --runtime <build>/tn-windows/mystral.exe --skip-build
```

`verify-starter-ui-overlay.mjs` builds the real default starter (`src/ui` included) with
`THREENATIVE_INTERNAL_DESKTOP_UI_PROOF=1` and runs
`scenarios/starter-ui-overlay-desktop.playtest.json` through the installed playtest CLI against
`dist-native/<name>`. The scenario's rows all passed:

- `GameState.paused` — `false` at load, `true` after the pointer press inside the pause island,
  `false` after the press inside the same island (now `resume`).
- movement — subject `player`, `-z` delta ≈ 2.0 m after keyboard input while the HUD is up.
- diagnostics — zero console errors.

`TN_UI_POINTER_ROUTE:{"type":"pointerdown","nx":0.05,"ny":0.9306,"hit":true,"injected":true}` is the
host routing the synthetic pointer through the overlay's published region and the page accepting it.

**What this proves, and what it does not.** It proves the overlay attaches on Windows, the host
publishes hit rectangles, and a synthetic pointer routed through that same in-process list produces
a HUD intent and game-state change. It does **not** cross the OS hit path: no real pointer traverses
the wry container's `SetWindowRgn` cut (`native/ui-overlay/src/desktop.rs` `apply_region`), so a bug
in that cut, in the resize re-cut, or in the AWS pixel rounding would stay green. The independent
reviewer returned NEEDS CORRECTION on this basis. Closing Phase 1 needs OS-level pointer injection
(Windows `SendInput`) at island and non-island coordinates, or an explicit narrowing of the phase
claim to attach + bridge + shared-region routing.

## Observed red, then restored green

Run [34737563582](https://github.com/ThreeNativeHQ/threenative/actions/runs/34737563582), job
`Windows desktop core`, failed the required test: the press routed correctly
(`hit:true, injected:true`) but landed on the **restart** island. The Menu's buttons sat after a
variable-width instruction string, so the published pause region moved from x 0.455 on Linux to
x 0.409 on Windows and the fixed fraction 0.4788 hit `restart`; `paused` stayed `false`. The row now
leads with the buttons, anchoring them to the panel's left edge, and the press is at x 0.05; the
required test is green in 34739248955.

## What is still not run

- **User verification** on Windows: the human click / type / focus / resize-at-two-DPI / minimize /
  restore / close sequence with capture inspection has not been performed. The CI proof is
  synthetic input, not a human at the machine.
- Independent reviewer PASS is recorded separately.

## Verdict

Phase 1's required test is green on the hosted Windows runner. The remaining open box is the human
interaction check.
