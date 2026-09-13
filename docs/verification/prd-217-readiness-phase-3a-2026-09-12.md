# PRD-217 Phase 3A readiness — normal native builds include the desktop overlay

**Date:** 2026-09-12
**Candidate:** `e69914fc1` (`prd217/native-desktop-hud`, develop merged in).
**Platform:** hosted `windows-2025`, `macos-15`; local Linux `tn-linux`.
**Scope:** Phase 3A of [`PRD-217-webview-ui-layer.md`](../PRDs/production-readiness/PRD-217-webview-ui-layer.md).

## What ran

`scripts/native-build.mjs` no longer carries a Linux-only overlay branch: it builds the overlay on
every desktop host (`packages/runtime-native/scripts/native-build.mjs:60-70`) and derives the
artifact name from the host toolchain (`build-native-ui-overlay.mjs`, `threenative_ui_overlay.lib`
on MSVC, `libthreenative_ui_overlay.a` elsewhere). `tests/native-build-ui-overlay.test.mjs:29-33`
asserts that mapping.

Hosted run
[34730410868](https://github.com/ThreeNativeHQ/threenative/actions/runs/34730410868) ran
`pnpm native:build` on the Windows and macOS desktop-core jobs (both PASS) and so configured CMake
with `-DTN_ENABLE_UI_OVERLAY=ON` and the host-named library path on both. Local Linux 2026-09-12:
`cmake --preset tn-linux -DTN_ENABLE_UI_OVERLAY=ON` configures and `ui_overlay.cpp` compiles;
`tests/native-build-ui-overlay.test.mjs` 2/2 green.

Observed red for the linkage, real and on the host: an earlier Windows run failed
`LNK1181: cannot open input file 'WebView2LoaderStatic.lib'` because a static library's `PRIVATE`
link directories do not reach `mystral.exe`; fixed in `291211df3` by linking the full WebView2
loader path `PUBLIC`. `291211df3` then built and ran green on `windows-2025`.

## What did not run

- **The phase required test on each supported platform.** `tests/native-build-ui-overlay.test.mjs`
  still only runs its build-plan assertion on Linux (`test.runIf(process.platform === 'linux')`);
  there is no Windows or macOS branch asserting normal-build overlay linkage, and the real
  default-starter scenario on the normal-build runtime has not run.
- **The PRD's observed-red control** (restore the Linux-only branch or force the Unix `.a` name on
  Windows) has not been executed; the LNK1181 red is adjacent but not that control.
- **User verification** — a maintainer running the normal host build and getting a runtime that
  renders and handles the unchanged starter HUD through the internal proof route — has not been
  performed.
- **Independent reviewer:** returned NEEDS CORRECTION (2026-09-12).

## Verdict

Phase 3A is **NOT closed**: the normal build includes the overlay on all three hosts (proved by the
hosted jobs) and the *callers wired and building* box is ticked, but the per-platform required test,
the named observed-red control, user verification and the reviewer PASS are open.
