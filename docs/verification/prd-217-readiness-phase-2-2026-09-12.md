# PRD-217 Phase 2 readiness — macOS desktop UI overlay

**Date:** 2026-09-12
**Candidate:** `e69914fc1` (`prd217/native-desktop-hud`, develop merged in).
**Platform:** macOS 15 hosted runner (`macos-15`) for the build; no interactive macOS host for input.
**Scope:** Phase 2 of [`PRD-217-webview-ui-layer.md`](../PRDs/production-readiness/PRD-217-webview-ui-layer.md).

## What ran

Hosted `native-platforms` run
[34730410868](https://github.com/ThreeNativeHQ/threenative/actions/runs/34730410868), job
**`native-platforms / macOS desktop core`** (PASS, 11m34s), ran `pnpm --filter
@threenative/runtime-native native:build` on `macos-15`. That compiles the objc2/AppKit backend
(`native/ui-overlay/src/desktop.rs`, `TnUiOverlayView` + `NSView hitTest:`) with clang and links
`libthreenative_ui_overlay.a` plus WebKit/AppKit into `mystral` via the overlay CMake block
(`packages/runtime-native/CMakeLists.txt:1617-1650`). The job then ran `native:verify:desktop`
(300 frames, non-blank screenshot, cold-start markers).

`cargo check --release --lib --target aarch64-apple-darwin` is green locally via a stubbed Apple
`cc`/`ar` (Rust type-check only; not a real Xcode/WebKit link).

## What did not run

- **The phase required test.** `packages/runtime-native/tests/native-build-ui-overlay.test.mjs` does
  not run on macOS at all: the build-plan test is `test.runIf(process.platform === 'linux')` and the
  other is a pure filename-mapping unit test. Nothing scaffolds the starter, bundles it, builds the
  app, or drives the installed playtest CLI to observe HUD/intent synchronization across resize or
  focus.
- **Observed red then restored green:** no detach/suppress-resize control has been run on macOS.
- **User verification:** no Retina-scaling and app-activation sequence, no transparent-composition
  inspection, no capture or adapter identity.
- **Independent reviewer:** returned NEEDS CORRECTION (2026-09-12).

## Why the required test is not closable on CI as the code stands

The resize/focus rows need input to be routed by AppKit through `-[TnUiOverlayView hitTest:]`
(`native/ui-overlay/src/desktop.rs:528-552`). The playtest `input.pointers` bridge dispatches into
the game runtime, never through AppKit's hit test, so a green row would not exercise the mechanism.
Hosted macOS runners are also the worst place for OS-level injection: `CGEventPost` needs
Accessibility permission the runner does not grant.

Closing Phase 2 needs either (a) an OS-level pointer-injection harness with the required
permissions, or (b) a host change that makes synthetic playtest pointers consult the published hit
regions before dispatch. Neither exists today.

## Verdict

Phase 2 is **NOT closed**: the caller is wired and builds on macOS, but the required test, the
observed red, user verification and the reviewer PASS are all open. No box beyond *callers wired
and building* is ticked.
