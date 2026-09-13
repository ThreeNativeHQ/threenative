# PRD-217 Phase 3A readiness — normal native builds include the desktop overlay

**Date:** 2026-09-12
**Candidate:** `7b3592bd2` (`prd217/native-desktop-hud`).
**Platform:** hosted `windows-2025` and `macos-15` (run
[34739248955](https://github.com/ThreeNativeHQ/threenative/actions/runs/34739248955)); local Linux
`tn-linux`.
**Scope:** Phase 3A of [`PRD-217-webview-ui-layer.md`](../PRDs/production-readiness/PRD-217-webview-ui-layer.md).

## What ran

`scripts/native-build.mjs` builds the overlay on every desktop host
(`packages/runtime-native/scripts/native-build.mjs:60-70`) and derives the artifact name from the
host toolchain (`build-native-ui-overlay.mjs`, `threenative_ui_overlay.lib` on MSVC,
`libthreenative_ui_overlay.a` elsewhere). `tests/native-build-ui-overlay.test.mjs:29-33` asserts that
mapping for all three hosts, and the plan test now derives the CMake preset and library name from
`process.platform`, so it runs on `linux` and `darwin` (Windows keeps the mapping test plus the
hosted job).

Hosted run 34739248955 ran `pnpm native:build` on the Windows and macOS desktop-core jobs (both
PASS), configuring CMake with `-DTN_ENABLE_UI_OVERLAY=ON` and the host-named library path on both,
then ran the default-starter HUD input proof (see the phase 1/2 records) on those normal-build
runtimes. Local Linux 2026-09-12: `cmake --preset tn-linux -DTN_ENABLE_UI_OVERLAY=ON` configures,
`ui_overlay.cpp` compiles, `mystral` links, and
`node scripts/verify-starter-ui-overlay.mjs --project <starter> --runtime build/tn-linux/mystral`
passes (`TN_STARTER_UI_OVERLAY_PASS`).

Observed red for the linkage, real and on the host: an earlier Windows run failed
`LNK1181: cannot open input file 'WebView2LoaderStatic.lib'` because a static library's `PRIVATE`
link directories do not reach `mystral.exe`; fixed in `291211df3` by linking the full WebView2
loader path `PUBLIC`.

## Observed red / restored green — the PRD's "force the Unix `.a` name on Windows" control

```sh
# red: force `.a` on every platform in uiOverlayLibraryName
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/native-build-ui-overlay.test.mjs -t "named for the host toolchain"
# Expected: "threenative_ui_overlay.lib"  Received: "libthreenative_ui_overlay.a"  (1 failed)
# restore the measured mapping
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/native-build-ui-overlay.test.mjs
# 4 passed (4)
```

## What is still not run

- The Windows/MSVC and macOS/clang builds are proved by the hosted jobs.
- The PRD's alternative control (restore the Linux-only branch and fail `native:build` on a host)
  was not run as written; the mapping control and the real `LNK1181` link red are the recorded reds.
- The starter HUD input proof's OS-cut limitation is inherited from phases 1/2 (see those records).
- **User verification** was owner-delegated to an agent inspection 2026-09-12 (the owner cannot run
  Windows/macOS); no human was at a Windows/macOS machine, and the owner waived the human-at-machine
  check.

## Verdict

Phase 3A's build/integration work is green: the normal build includes the overlay on all three
desktop hosts and the starter HUD input proof runs on the normal-build runtimes. The narrowed claim
is attach + bridge + shared-region routing; the Windows/macOS OS cut itself is not independently
probed.
