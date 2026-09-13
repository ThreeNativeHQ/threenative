# PRD-217 Phase 4 readiness — Linux session selection (Wayland/Xwayland)

**Date:** 2026-09-12
**Candidate:** `79a78df0f` (`prd217/native-desktop-hud`, develop merged in); the fix lands in this commit.
**Platform:** Linux desktop, KWin Wayland session — `WAYLAND_DISPLAY=wayland-0`, `DISPLAY=:0` (Xwayland).
**Scope:** Phase 4 of [`PRD-217-webview-ui-layer.md`](../PRDs/production-readiness/PRD-217-webview-ui-layer.md).

## What this records

The Phase 4 subject is a Linux session where the game window is X11 and the display server is
Wayland. On this session the desktop overlay was reported unusable. The measurement below names
the real cause, proves the engine already carries the fix, and corrects the doctor that reported
the false failure. It does not claim the remaining Phase 4 boxes (live input, human verification).

## Reproduction — engine attach path

The overlay's GTK/GDK context was initialised with GDK defaulting to the Wayland backend while the
game window is Xwayland, so `argb::create` had no X11 container to attach to:

```sh
# packages/runtime-native/native/ui-overlay
cargo build --release --bin tn-ui-overlay-probe
DISPLAY=:0 ./target/release/tn-ui-overlay-probe <parent-window-id> 5
```

Observed red (no `GDK_BACKEND`):

```
TN_SPIKE:{"row":"compositor-present","ok":true,...}
TN_SPIKE:{"row":"game-frame-readable","ok":true,...}
TN_SPIKE:{"row":"transparency-visual","ok":false,"detail":"the GDK display is not X11; wry's Linux backend needs XWayland here"}
```

The engine already selects the supported backend before the overlay initialises
(`packages/runtime-native/src/cli/main.cpp:1086-1093`: `SDL_SetHintWithPriority(... "x11" ...)`
plus `setenv("GDK_BACKEND", "x11", 1)`), and `window.cpp:93` prefers SDL's X11 driver. Re-running
the same probe with the engine's selection applied is green for attach and transparency:

```
TN_SPIKE:{"row":"compositor-present","ok":true,...}
TN_SPIKE:{"row":"transparency-visual","ok":true,"detail":"our ARGB container has depth 32; 32 is needed for alpha"}
TN_SPIKE:{"row":"attach-as-child","ok":true,"detail":"wry built a web view into an ARGB child of the SDL window"}
TN_SPIKE:{"row":"host-to-page","ok":true,"detail":"Ok(())"}
```

The probe then exits on `BadMatch` from X request 73 (`XGetImage`) while it samples the redirected
window — the maintainer probe's own readback, not the attach or the bridge. Live input/resize on
this session remains unproven and is not claimed here.

## Doctor — false "transparent container" failure

`probeDesktopOverlay` failed every Wayland session before probing anything, including the
Xwayland one the engine supports. On this live session it returned:

```
{"detail":"the transparent container could not be created on this Wayland/Xwayland session","status":"fail"}
```

After the fix it measures the session it actually has:

```
$ cd packages/create-threenative && pnpm exec tsx probe-doctor.mts
{"detail":"the runtime selects Xwayland (SDL x11, GDK_BACKEND=x11) and the Wayland compositor blends the overlay's alpha","fix":"","status":"ok"}
```

Red/green:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/doctor.spec.ts   # 95/95 pass
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-build-ui-overlay.test.mjs  # 2/2 pass
```

## Linux overlay input regression (this branch's runtime)

The branch's runtime was built with the overlay and driven through the existing desktop overlay
input proof on `Xvfb :3` with the `tools/xcompmin.c` compositor fixture and the `native-smoke`
bundles:

```sh
pnpm --filter @threenative/runtime-native native:build          # build/tn-linux/mystral, overlay ON
node packages/runtime-native/scripts/bundle.mjs --project examples/native-smoke \
  --entry src/game.ts --target desktop --output /tmp/opencode/proof-work/desktop-game.js
pnpm --dir examples/native-smoke exec esbuild ui/main.ts --bundle --format=esm \
  --outfile=/tmp/opencode/proof-work/desktop-ui/main.js
TN_PROOF_WORK=/tmp/opencode/proof-work bash packages/runtime-native/scripts/desktop-ui-overlay-proof.sh
```

Result — 8/8, `failures: 0`, across the starting size, a shrink to 800x500, a grow to 1600x900 and
fullscreen 1920x1080:

```
  PASS  press inside an island reaches the page (ui)
  PASS  press outside every island reaches the game (game)
```

The shape published for each geometry is live (`TN_UI_SHAPE` names the two islands at the current
window size), so a stale hit region would fail the "inside an island" row rather than pass by
silence. This is Xvfb (a bare X server), not a Wayland session hosting Xwayland, so it does not
satisfy the phase's Wayland row and it does not attach the starter's React HUD — `native-smoke` is
the subject here.

## The X11 compositor probe read the wrong thing — fixed

`detectX11Compositor` ran `xprop -root _NET_WM_CM_S0`, which reads a root *property*, while EWMH
defines `_NET_WM_CM_S0` as the *selection* the compositing manager owns — the thing the runtime's
own overlay guard reads with `XGetSelectionOwner`. On the `tools/xcompmin.c` fixture the selection
is owned (`0x200001`) while `xprop -root _NET_WM_CM_S0` reports `not found`, so the probe would have
vetoed X11 builds that actually work. It now queries the selection owner through a short
`python3`/ctypes shim, and prints `unknown` rather than guessing when it cannot measure. Verified
three ways:

| display | compositor | `detectX11Compositor` |
| --- | --- | --- |
| `:0` (KWin Wayland/Xwayland) | KWin owns `_NET_WM_CM_S0` | `true` |
| `:98` (Xvfb, no compositor) | none | `false` |
| `:98` (Xvfb + `xcompmin`) | fixture owns the selection | `true` |

`doctor.spec.ts` 95/95. This is a real measurement, not a warn: a compositor-less X11 still fails.

## Not run, and not claimed

- Live HUD input/teardown under Xwayland: the probe's `XGetImage` sampling aborts before the
  input rows; the Phase 4 required-test rows are not satisfied.
- Human click/type/resize/minimise verification on the session: still open.
