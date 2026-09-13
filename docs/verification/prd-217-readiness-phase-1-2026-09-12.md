# PRD-217 Phase 1 readiness — Windows desktop UI overlay

**Date:** 2026-09-12
**Candidate:** `e69914fc1` (`prd217/native-desktop-hud`, develop merged in).
**Platform:** Windows 2025 hosted runner (`windows-2025`) for the build; no interactive Windows host for input.
**Scope:** Phase 1 of [`PRD-217-webview-ui-layer.md`](../PRDs/production-readiness/PRD-217-webview-ui-layer.md).

## What ran

Hosted `native-platforms` run
[34730410868](https://github.com/ThreeNativeHQ/threenative/actions/runs/34730410868), job
**`native-platforms / Windows desktop core`** (PASS, 17m14s), ran `pnpm --filter
@threenative/runtime-native native:build` on `windows-2025` with MSVC + vcpkg. `native-build.mjs`
builds the Rust overlay (`cargo build --manifest-path native/ui-overlay/Cargo.toml --lib`) and
configures CMake with `-DTN_ENABLE_UI_OVERLAY=ON -DTHREENATIVE_UI_OVERLAY_LIBRARY=...\threenative_ui_overlay.lib`
on every desktop host. The Windows link is what this proves: `WebView2LoaderStatic.lib` reaches
`mystral.exe` and the objc2-free Windows backend compiles under MSVC. The same job then ran
`native:verify:desktop` (300 frames, non-blank screenshot, cold-start markers).

`cargo check --release --lib --target x86_64-pc-windows-msvc` is green locally (2026-09-12).

## What did not run

- **The phase required test.** `packages/runtime-native/tests/native-build-ui-overlay.test.mjs` is
  still the weaker build-plan test: a host filename mapping unit test and a Linux-only plan test
  with stubbed `cargo`/`cmake`/`ninja`. It does not scaffold the default starter, bundle it, build
  the app, produce an executable, or run the installed playtest CLI. It observed no HUD intent and
  no movement through empty UI space.
- **Observed red then restored green** on Windows: the only real red was the `LNK1181: cannot open
  input file 'WebView2LoaderStatic.lib'` link failure on an earlier run, fixed in `291211df3`; that
  is a build-link red, not the PRD's "disable attach / drop one bridge intent" control.
- **User verification** on Windows: no click / type / focus / resize-at-two-DPI / minimize / restore
  / close sequence has been performed; no capture, adapter identity or session is recorded.
- **Independent reviewer:** returned NEEDS CORRECTION (2026-09-12).

## Why the required test is not closable on CI as the code stands

The hit-routing rows need a pointer to be routed by the OS through the WebView2 container window
region (`native/ui-overlay/src/desktop.rs:473-503`, `SetWindowRgn`). The playtest
`input.pointers`" bridge (`packages/playtest/src/three/device.ts:237-288`) calls
`host.pointer(...)` on the mailbox host, which reaches `dispatchPointerEvent`
(`packages/runtime-native/src/runtime.cpp:3729`) and dispatches to the game's
`document`/`window`/`canvas` only. It never crosses the container region, so a green row would
prove the bridge and the page, not the mechanism under test.

Closing Phase 1 needs either (a) an OS-level pointer-injection harness (Windows `SendInput`) aimed
at island and non-island coordinates with observed game-state and page-intent effects, or (b) a
host change that makes synthetic playtest pointers consult the published hit regions before
dispatch. Neither exists today.

## Verdict

Phase 1 is **NOT closed**: the caller is wired and builds on Windows, but the required test, the
observed red, user verification and the reviewer PASS are all open. No box beyond *callers wired
and building* is ticked.
