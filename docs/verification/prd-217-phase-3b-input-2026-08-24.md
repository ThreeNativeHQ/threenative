# PRD-217 Phase 3A — the desktop overlay takes input

**Ran 2026-08-24, Linux/X11 only.** Windows and macOS have not been run and nothing here claims
them. Phase 3A's transparency result is in `prd-217-phase-3a-2026-08-24.md`; this is the input half.

## What was measured

`packages/runtime-native/scripts/desktop-ui-overlay-proof.sh`, against the real `mystral` binary
and the `native-smoke` example, on `Xvfb :3`:

| geometry | press inside an island | press outside every island |
| --- | --- | --- |
| 1280x720 | reaches the page | reaches the game |
| 800x500, after a live resize | reaches the page | reaches the game |
| 1600x900, after a live resize | reaches the page | reaches the game |
| 1920x1080, filling the screen | reaches the page | reaches the game |

```
failures: 0
```

Both sides count presses they actually received — the page turns a press on an island into an
intent the game logs, the game logs the pointer downs that reach its canvas — so neither column is
inferred from the other's silence.

## The two defects this found

**The page kept the old viewport after a resize.** The overlay is a *foreign* X window: this
repository creates it and hands it to GTK, so GTK never gets a `ConfigureNotify` for it and never
re-allocates. The web view went on laying the page out at the old size while the input shape, cut
from the real window size, had already moved. The press was inside the shape, so the overlay
consumed it, and outside the island as the page had drawn it, so the page ignored it: delivered to
nobody. `set_bounds` now calls `size_allocate` when the size changed.

Red, with that call removed:

```
after shrinking to 800x500
  FAIL  press inside an island reaches the page: expected ui, got nobody
after growing to 1600x900
  FAIL  press inside an island reaches the page: expected ui, got nobody
filling the screen
  FAIL  press inside an island reaches the page: expected ui, got nobody
failures: 3
```

**`PointerRoot` was read as another application.** `XGetInputFocus` reports `PointerRoot` (1) or
`None` (0) on a session with no window manager or one where focus follows the pointer. Neither is a
window id; walking one as if it were said the game had lost focus, and the overlay unmapped itself
for the whole run. No display this repository can drive reports those values — the sessions here
take focus explicitly — so this is proven by unit test rather than on a display.

Red, with the `0 | 1 => true` arm removed:

```
test argb::tests::shows_the_overlay_when_focus_follows_the_pointer ... FAILED
test argb::tests::shows_the_overlay_when_nothing_holds_focus ... FAILED
test result: FAILED. 2 passed; 2 failed
```

Green: `test result: ok. 4 passed; 0 failed`.

## The measurement that was wrong for longer than either defect

Two false signals cost more than the bugs did, and both are now closed:

- **The lane was the operator's own screen.** Another application sat above the game in the
  stacking order, so every synthetic click landed on it. The overlay was reported as taking no
  input for several rounds while the X server was routing correctly the whole time. The harness now
  runs on `Xvfb` with `native/ui-overlay/tools/xcompmin.c` — the smallest thing that counts as a
  compositing manager, which the overlay requires before it will attach.
- **The observable was a state change.** The example's `slide` is set, not toggled, so watching for
  the page's reaction saw the first press of a run and read every later one as "the press never
  arrived": one permanently green case and three false reds behind it. The example now logs every
  intent it receives.

Nested `kwin_wayland --virtual --xwayland` was tried and rejected for this lane: its XTEST pointer
emulation does not reach X clients, so every press reads as delivered to nobody there.

## Not run

Windows (WebView2) and macOS (WKWebView) desktop hosts, and the frame-rate budget for the desktop
overlay. `pnpm typecheck`, `pnpm lint` and `pnpm test` (2073 tests) are green at this commit.
