# PRD-217 Phase 3B readiness — installed desktop builds carry the WebView backend

**Date:** 2026-09-12
**Candidate:** `3740b253d` (`prd217/native-desktop-hud`)
**Platform:** Linux development host; hosted `windows-2025` and `macos-15` runners for the platform lanes.
**Scope:** Phase 3B of [`PRD-217-webview-ui-layer.md`](../PRDs/production-readiness/PRD-217-webview-ui-layer.md).

## What changed

`assertNativeUiRendererCompatible` refused `ui.renderer: "web"` on every desktop host except Linux.
It now admits `linux`, `darwin` and `win32`, whose overlays are proven by phases 1/2, and still
refuses a desktop window system without a backend. The internal proof bypass
`THREENATIVE_INTERNAL_DESKTOP_UI_PROOF=1` was removed from `build.ts`, the verifier and the CI lane —
the guard it existed to bypass is open, so a user build needs no flag.

## Evidence

- `packages/create-threenative/__tests__/build.spec.ts` — 19/19. `darwin` and `win32` no longer
  throw; `freebsd` still throws `TN_UI_RENDERER_UNSUPPORTED`; the portable-graph DOM rejection
  (`assertNativeBundleCompatible`, `TN_NATIVE_WEB_ONLY_UI`) is unchanged and still covered.
- Package `tsc --noEmit` clean.
- Hosted `native-platforms` run 34739248955: the `windows-2025` and `macos-15` desktop-core jobs
  scaffold the starter from local tarballs, run the normal `build:desktop`, and pass
  `Build and verify the starter's WebView HUD` including `Upload the starter HUD input evidence`.
  The starter's unchanged `src/ui` is what is built — no renderer override, no source patch.
- `packages/create-threenative/templates/starter/threenative.config.ts` keeps `ui.renderer` at its
  default, so the lane proves the shipped default rather than a scenario-authored one.

## Not run, and not claimed

- `ui.renderer: "native"` opt-out creating no WebView, and a registry-installed consumer, are not
  re-proved here; the opt-out path is unchanged and the regression guard is the existing suite.
- The OS hit-region cut (`SetWindowRgn` / AppKit `hitTest:`) is not independently probed on
  Windows/macOS; the routing proof is the shared published-rectangle decision plus the Linux
  end-to-end X11 input shape (`docs/verification/prd-217-readiness-phase-4-2026-09-12.md`).
