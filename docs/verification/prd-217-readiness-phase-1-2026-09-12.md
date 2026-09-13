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

## Observed red, then restored green — the PRD's controls, run

The PRD requires disabling the platform attachment and separately dropping one bridge intent, then
running the same starter scenario and showing the state assertions fail. Both were run on Linux
(`:3` + `xcompmin`) against the packaged starter, each `exit 1` with
`resource.GameState.paused.atSteps` failing, then restored:

| control | change | result |
| --- | --- | --- |
| drop one bridge intent | `Menu.tsx` pause `onClick` no longer calls `send(...)` | scenario fails, `paused` stays `false`; restored → `TN_STARTER_UI_OVERLAY_PASS` |
| disable attachment | `ui.renderer` set to `native` (no overlay) | scenario fails, `paused` stays `false`; restored → `TN_STARTER_UI_OVERLAY_PASS` |

A layout-miss red also occurred on the host: run
[34737563582](https://github.com/ThreeNativeHQ/threenative/actions/runs/34737563582), job
`Windows desktop core`, routed the press correctly (`hit:true, injected:true`) but landed on the
**restart** island because the Menu's buttons sat after a variable-width instruction string
(published pause x 0.455 on Linux vs 0.409 on Windows), so `paused` stayed `false`. The buttons now
lead the row and the press is at x 0.05.

## Narrowed claim (independent-review fix)

The reviewer returned NEEDS CORRECTION because the synthetic route reads the in-process published
list and synthesises a DOM event; it does not cross the Windows `SetWindowRgn` cut. The claim for
this phase is narrowed to what is proved:

- **Proved on Windows (hosted):** the overlay attaches to the real HWND (the wry container), the
  host publishes hit rectangles, a pointer routed through those rectangles reaches the page and
  produces a HUD intent and game-state change, and movement through empty UI space reaches the game.
- **Proved on Linux (local, real OS input):** `desktop-ui-overlay-proof.sh` drives real `xdotool`
  clicks through the actual X11 input shape, 8/8 across window sizes — the OS-cut analog of the
  Windows region.
- **Not independently probed:** the Windows `SetWindowRgn` cut itself (wrong container, pixel
  rounding, resize re-cut). A bug there would not fail the hosted proof. Closing that needs
  OS-level `SendInput` at island and non-island coordinates.

## User verification — owner-delegated

The owner cannot run a Windows/macOS machine and explicitly delegated the human review to an agent
(2026-09-12). The agent inspected the hosted captures and the packaged proof's screenshots, drove
the controls above, and confirmed the HUD attaches, the pause island produces a game-state change,
and empty space passes through to the game. **No human was at a Windows machine**; the owner waived
the human-at-the-machine check. The click/type/resize/minimize/restore sequence itself was not
performed by a person.

## Verdict

Phase 1's required test is green on the hosted Windows runner under the narrowed claim (attach +
bridge + region routing), with the OS cut not independently probed. Closed by owner delegation.
