# PRD-393 — The native UI composites into the game's own frame

**Status:** PARTIAL — Phase 1 done (backend: WPE WebKit); phases 2–6 open
**POST-DEVICE-EVALUATION-REQUIRED**
**Complexity:** 10 (HIGH); risk override: none — the score already lands HIGH
**Owner:** unassigned
**Depends on:** None

## Context

On Linux the native desktop runtime draws the **entire** UI — loading screen, briefing, HUD —
in a WebKitGTK web view living in a *separate X11 window*: an override-redirect depth-32 ARGB
top-level placed over the SDL/WebGPU game window and blended by whatever X compositing manager
happens to be running. The game's own frame never contains a UI pixel.

Two independent defects follow from that design, both measured on 2026-09-17 against
`sandbox/midway-open-pacific` (a real game, `ui: { renderer: "web" }`, ~380k triangles):

**1. Nothing is painted on a KDE Wayland session.** On XWayland (`DISPLAY=:0`) the overlay window
is created, sized, positioned and mapped correctly and stays empty. Captured directly,
`import -window <id>` returns a 250-byte solid image; the same binary on a private
`Xvfb +extension COMPOSITE +extension SHAPE` with `xcompmgr -n` returns 78 KB of real UI.
`TN_UI_OVERLAY:{"attached":true}` is logged, the page loads and publishes `TN_UI_HIT_REGIONS`, so
the web view is alive and unpainted. Already excluded as causes: `GDK_BACKEND=x11`, unsetting
`WAYLAND_DISPLAY`, `WEBKIT_DISABLE_DMABUF_RENDERER`, `WEBKIT_DISABLE_COMPOSITING_MODE`,
`LIBGL_ALWAYS_SOFTWARE`, focus, stacking and geometry. The player sees a dark window and no UI.

The leading suspect is the foreign-window realization path rather than a missing X extension: the
code negotiates a depth-32 TrueColor visual itself, then hands GTK a *foreign* `GdkWindow`
(`packages/runtime-native/native/ui-overlay/src/argb.rs:1250`) and substitutes it at realize time
(`argb.rs:1280`), so WebKit's accelerated-compositing output may never target the window the X
server is showing. **Unverified** — no tracing has been done, and this PRD does not depend on it
being the cause.

**2. The overlay is serviced only by the game loop, so it starves.** `platform::pumpUiOverlay()`
(`packages/runtime-native/src/runtime.cpp:1294`) is its only service point and runs once per
main-loop iteration; `tn_ui_overlay_pump()` then drains *all* pending GTK work with no time budget
(`packages/runtime-native/native/ui-overlay/src/abi.rs:137`). Measured startup: first presented
frame at 8.9 s, `first_playable` at 47.2 s, and **three** presented frames in between — so the web
view received about three turns in thirty-eight seconds and its page finished mounting *after* the
game had already hidden its loading screen. The starvation runs both ways: an unbudgeted GTK drain
inside `pollEvents()` also delays the game's own frame.

Attempted repairs and what they proved (all on `sandbox/midway-open-pacific`):

| Attempt | Result |
|---|---|
| Throttled 8 ms pump from the two asset-read paths in `runtime.cpp` | Loading screen appeared in roughly 2 runs of 3 — not reliable |
| Same pump from the JS module-compile path (`v8_engine.cpp` `evalScript`) | **Broke rendering**: `native-playtests/ui-parity` went from clean to four `CreateBindGroup` validation errors against a 1×1 `Depth24Plus` placeholder. Proven by A/B on one engine revision. GTK iterations must never run inside JS evaluation. |
| Bounded startup hold in `packages/core/src/game.ts` on the `ui-ready` intent | Still inconsistent across repeat runs. `ui-ready` proves the page's script ran, **not** that a pixel reached the screen, so no amount of waiting can close this race. |
| `bootSplash.backgroundColor` wired to the X window background | Works — `#102a37` on screen at ~4 s. But from ~4 s until the world appears the frame is `gray(0)`: the WebGPU surface presenting black, because this game's only loading surface *is* the web overlay. |

The loading screen and the UI are the same component, so "wait for the UI before hiding the
loading screen" is circular. Codex reviewed the seam at xhigh on 2026-09-17 and called the
architecture indefensible for a 60 fps runtime independently of the paint bug: a manually pumped
external UI window sharing an unbounded game thread and presented outside the game's own swapchain
has structural starvation and reentrancy hazards. The current shipping answer is a nested
`Xephyr` + `xcompmgr` wrapper (`sandbox/midway-open-pacific/tools/run-native.sh`), which is a
diagnostic, not a product.

Files inspected: `packages/runtime-native/native/ui-overlay/src/{argb.rs,abi.rs}`,
`packages/runtime-native/src/platform/ui_overlay.cpp`,
`packages/runtime-native/src/{runtime.cpp,cli/main.cpp,platform/window.cpp}`,
`packages/runtime-native/src/webgpu/{bindings_presentation.cpp,bindings_canvas2d_composite.cpp}`,
`packages/runtime-native/CMakeLists.txt`, `packages/runtime-native/scripts/package-desktop.mjs`,
`packages/core/src/{game.ts,ui-bridge.ts,ui-layer.ts}`.

## Solution

**The UI becomes a texture in the game's own frame.** Render the web view offscreen, hand its
completed frames to the renderer, and composite them as a premultiplied-alpha quad inside the
existing present path. No second window, no override-redirect, no dependency on an external
compositing manager, and the UI is presented by the same swapchain as the world — so it cannot be
half a frame ahead, cannot be hidden by a compositor, and cannot be stacked wrong.

Consumer flow, unchanged from the game's side:

```
game src/ui/ (React)  →  offscreen web view  →  frame mailbox  →  wgpuQueueWriteTexture
        ↑                                                              ↓
   intents / state  ←── existing @threenative/core ui-bridge      UI quad drawn before
                                                                   presentPendingSurface()
```

Reused rather than invented:

- **The upload path already exists.** `bindings_canvas2d_composite.cpp:90` already does
  `wgpuQueueWriteTexture` for the canvas2d layer; the UI is the same shape of problem.
- **The present seam already exists.** `presentPendingSurface()` is called from
  `bindings.cpp:2892` and defined in `bindings_presentation.cpp:614`. The UI quad goes before it.
- **The protocol does not change.** `@threenative/core`'s `ui-bridge` message contract, the
  `ui-ready` intent, `TN_UI_HIT_REGIONS` and `uiOverlayInjectPointer` stay as they are. Games see
  no API change; `src/ui/` is untouched.
- **Dependency bundling already exists.** `package-desktop.mjs` discovers and bundles runtime
  dependencies, which is how a new web-engine shared library reaches an end user.

**Backend decision is Phase 1's output, not an assumption.** Two candidates, both real:

| Candidate | For | Against |
|---|---|---|
| **WPE WebKit** (`wpewebkit` 2.52.6, packaged on Arch; `libwpe` + `wpebackend-fdo` also packaged) | Designed for exactly this — embedders get buffers, not windows. SHM path gives CPU-readable frames; DMA-BUF path available later. | New system dependency to bundle; no GTK, so the existing `wry`/webkit2gtk code is replaced rather than adapted. Version parity with the installed `webkit2gtk-4.1` (2.52.6) is a coincidence to verify, not a guarantee. |
| **webkit2gtk offscreen** (already a dependency, 2.52.6 installed) | Zero new dependencies. Keeps `wry`. | Offscreen GTK rendering is not a supported embedding path; frame readback is a CPU copy of a cairo surface with no completion signal, and accelerated compositing in an offscreen window is the same murky area suspected of causing defect 1. |

Phase 1 picks one on measured evidence and records the rejected option and why, per the repository's
adoption rule. The rest of the PRD is written to be backend-agnostic behind one seam. **Phase 1
chose WPE WebKit** (measured 2026-09-17); the numbers and the rejected webkit2gtk-offscreen option
are recorded in Phase 1 below.

**Service the web engine off the game loop.** Whatever backend wins runs on its own thread or
process, continuously serviced, never gated by `pollEvents()`. The game loop only ever *takes the
latest completed frame* from a mailbox — a non-blocking read of at most one buffer. This is what
removes both starvation directions and the reentrancy hazard that broke rendering above; the
existing "pump from the game loop" contract is deleted, not tuned.

**Cost and its control.** A full 1080p60 RGBA copy is ~0.5 GB/s of bandwidth. Mitigations, in
order: upload only damaged regions (WPE reports damage), skip upload entirely on an unchanged
frame, and keep DMA-BUF import as the escape hatch if the SHM path misses the budget. Phase 3
measures this against `TN_FRAME_BUDGET` rather than assuming it.

**Risks**

- The chosen backend cannot produce CPU-readable frames without an X server at all → Phase 1 is
  explicitly a go/no-go with a named fallback, and it runs headless.
- Bandwidth exceeds the frame budget on the hero scene → damage-region upload, then DMA-BUF.
- Native popups (`<select>`) have no window to open into once the overlay window is gone. The
  existing implementation already treats them as a special case, and the game's own dropdown was
  observed unmapping the whole overlay before that was fixed. In-frame compositing means popups
  must be rendered *by the page*, which is a behaviour change for every game using a bare
  `<select>` — Phase 4 owns it and must not paper over it.
- Windows and macOS keep their existing child-window paths. This PRD is Linux-only and must not
  claim otherwise.

## Acceptance Criteria

- [ ] AC-1 [local; actor: agent]: On a display with **no compositing manager at all**
      (`Xvfb` without `xcompmgr`), launching `sandbox/midway-open-pacific` shows the briefing UI in
      the game's own frame — captured from the game window, not the root. The current build cannot
      do this: the overlay refuses to attach without a compositor. — Evidence: pending.
- [ ] AC-2 [local; actor: agent]: The game process creates **no override-redirect top-level
      window** on Linux. Asserted by walking the X tree for the game's pid and finding only the SDL
      window. — Evidence: pending.
- [ ] AC-3 [local; actor: agent]: The loading screen is visible in **10 consecutive launches** of
      `sandbox/midway-open-pacific`, sampled from the game window before `first_playable`, with the
      `#loading` markup's own background colour present in every one. Today this is ~2 in 3. —
      Evidence: pending.
- [ ] AC-4 [local; actor: agent]: Web-view frames keep advancing while the game loop is blocked —
      assert the mailbox's frame counter increases across a deliberate ≥2 s stall in the game
      thread. This is the defect that starved the page to three turns in thirty-eight seconds. —
      Evidence: pending.
- [ ] AC-5 [local; actor: agent]: `native-playtests/ui-parity.playtest.json` passes with **zero**
      runtime diagnostics on the artifact built from this PRD, including the dropdown, the command
      overlay and the map — the same scenario that caught the `CreateBindGroup` regression. —
      Evidence: pending.
- [ ] AC-6 [local; actor: agent]: UI compositing costs **≤ 2.0 ms/frame at p95** on the hero scene
      at 1280×720, measured as a named phase in `TN_FRAME_BUDGET` over ≥300 frames, interleaved
      against a build with the UI quad disabled (this host drifts wider than small effects, so
      alternate the pairs). — Evidence: pending.
- [ ] AC-7 [local; actor: agent]: A game with `ui: { renderer: "native" }` still starts and renders
      with no web engine initialised at all — no regression for games that never asked for a web UI.
      — Evidence: pending.
- [ ] AC-8 [local; actor: agent]: The X11 overlay implementation is **deleted**, not left beside the
      new path: no `Placement::Overlay`, no `tn_ui_overlay_pump` call from the frame loop, and
      `sandbox/midway-open-pacific/tools/run-native.sh` removed with its reason recorded. —
      Evidence: pending.
- [ ] AC-9 [local; actor: agent]: Windows and macOS builds are unchanged by this PRD — their UI
      paths still compile and their existing native gates pass. — Evidence: pending.
- [ ] AC-10 [owner; actor: João]: On João's own KDE Wayland session, an ordinary launch of the
      packaged `midway-open-pacific` shows the loading screen and then the interactive briefing,
      with no nested X server and no wrapper script. This is the acceptance the whole PRD exists
      for and no `local` result substitutes for it. — Evidence: pending.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
|---|---|---|---|
| Web UI presented to the player on Linux | Game launch → `attachDesktopUiOverlay` call site `packages/runtime-native/src/cli/main.cpp:1168` → new offscreen backend → UI quad before `presentPendingSurface()` (`packages/runtime-native/src/webgpu/bindings.cpp:2892`) | **Replaces** the X11 override-redirect overlay in `native/ui-overlay/src/argb.rs`; that path is deleted for Linux (AC-8) | AC-1, AC-2, AC-8 |
| Web-view servicing | Own continuously-serviced thread/process | **Replaces** `platform::pumpUiOverlay()` from the frame loop (`packages/runtime-native/src/runtime.cpp:1294`); the game loop only takes the latest mailbox frame | AC-4 |
| Pointer input into the page | Existing `uiOverlayInjectPointer` / `TN_UI_HIT_REGIONS` contract, unchanged signature | Re-pointed at the offscreen view; hit regions still published by the page | AC-5 |
| Loading screen visibility | `ctx.startup` cover → UI quad composited while startup is held | **Replaces** the `framework:ui-ready` hold added in `packages/core/src/game.ts` during investigation, which cannot work: `ui-ready` proves script execution, not presentation. Remove it in Phase 6. | AC-3 |
| `bootSplash.backgroundColor` on desktop | `applyEmbeddedBootSplash()` in `packages/runtime-native/src/platform/window.cpp` | Keep — independently correct and already verified on screen. Extend to the held-startup clear colour so the gap after it is not `gray(0)`. | AC-3 |

## Execution Phases

#### Phase 1: Pick the backend on evidence
**Status:** DONE — backend chosen: **WPE WebKit** (rejected: webkit2gtk-offscreen)
**ACs:** none directly — this phase de-risks AC-1 and AC-4
**Files:** `packages/runtime-native/native/ui-overlay/src/bin/probe-wpe.c` and
`probe-gtk-offscreen.c` (throwaway probes beside the crate's existing `bin/probe.rs`; each carries
its own build/run recipe in the header); notes below
**Implementation:** Both candidates were driven headlessly to produce a CPU-readable 1280×720 frame
of the same fixture: four opaque solid quadrants (`#ff0000`, `#00ff00`, `#0000ff`, `#ffff00`) plus a
`requestAnimationFrame` tick, so a blank, stale or wrongly-ordered buffer fails on pixel values.
**Verification:** E1 — the known-rectangle assertion runs in-process on the raw CPU buffer (no
encoder in the loop): a missing/blank/misformatted frame fails `rects_ok`. Both candidates returned
`rects_ok:true` with identical expected values, so neither backend is the go/no-go failure this
phase existed to catch.
**Measured results (2026-09-17, this host):**
- **WPE WebKit 2.52.6** (`probe-wpe.c`, no X server at all, no compositor): `WPEBufferSHM`,
  ARGB8888, 1280×720, stride 5120, **3 686 400 bytes/frame**; **234 frames / 3.70 s = 63.2 fps**
  (the headless view commits at its internal 60 Hz timer); completion signal `WPEView::buffer-rendered`
  fires per committed frame (`n_params=1`, the buffer) with `buffers-changed` reporting 2 buffers.
  Damage is passed to `WPEViewClass::render_buffer(damage_rects, n_damage_rects)` but the headless
  display drops it; the signal exposes no damage — **not observed end-to-end**.
- **webkit2gtk-4.1 offscreen 2.52.6** (`probe-gtk-offscreen.c`, `Xvfb` with no xcompmgr,
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` because GDK cannot create a GL context on a bare Xvfb):
  cairo ARGB32, 1280×720, stride 5120, **3 686 400 bytes/frame**; **2850 snapshot completions /
  6.00 s = 475.3/s** readback, but content actually changed only 374 times in 6 s (~62 fresh/s,
  matching the page's rAF) — the rest re-read an unchanged surface. Completion is the async
  `webkit_web_view_get_snapshot` callback **per request**: pull-only, no autonomous frame emission,
  and no damage regions (full-surface snapshots).
**Decision:** WPE WebKit. Both meet the CPU-frame/completion/headless bar at identical bytes/frame
and ~60 fresh fps, so the pick turns on the phase-2 shape: WPE is push-with-completion (a completed
frame arrives whether or not the game loop is looking, which is exactly the mailbox AC-4 needs),
runs with **no display server**, and WebKit passes damage to the view for Phase 3's damaged-region
upload. webkit2gtk-offscreen is rejected despite its zero dependency cost: its frames are pull-only
snapshots that each force a full render, it needs an X server, and offscreen GTK is not a supported
embedding path upstream — the same murky accelerated-compositing area suspected in defect 1.
**Named fallback:** webkit2gtk-offscreen stays viable if bundling WPE is rejected; it delivers the
same pixels and bytes at ~60 fresh frames/s with `wry` and no new dependency.
**Caveat / obstacle:** the WPE CPU frames were obtained through the surfaceless path
(`LIBGL_ALWAYS_SOFTWARE=1`, so `wpe_display_get_drm_device()` is null). With a DRM device the
headless display emits DMA-BUF buffers and CPU readback fails on this host's NVIDIA proprietary
driver (`gbm_bo_map failed`, reproduced directly with `libgbm`); Phase 3's DMA-BUF import path
remains unverified here.
**Licence and bundled-library obligations:** wpewebkit is **LGPL-2.1-only / LGPL-2.1-or-later** plus
bundled AFL-2.0/GPL/Apache-2.0/BSD/MIT/MPL-1.1/MPL-2.0/OFL-1.1 files (Arch `license` field), installed
138.6 MiB, `libWPEWebKit-2.0.so` 128 MiB, 112 shared objects via `ldd`; `libwpe` and
`wpebackend-fdo` are **BSD-2-Clause**. webkit2gtk-4.1 carries the same WebKit source set and is
already installed (90 MiB `.so`, 143 `ldd` objects) as a `wry` dependency. WPE must be bundled or
declared a prerequisite in Phase 5; its LGPL requires the licence text and relink option to ship.
**Checkpoint:** Phase 1 complete — both probes built and run, numbers above recorded from the
actual runs, decision and rejected option recorded, licence/bundled-library obligations recorded.
- [x] WPE candidate probed, numbers recorded — 63.2 fps, 3 686 400 B/frame, SHM ARGB8888,
      `buffer-rendered` completion, no X server (`probe-wpe.c`)
- [x] webkit2gtk-offscreen candidate probed, numbers recorded — 475.3 snapshot/s (374 content
      changes in 6 s), 3 686 400 B/frame, pull-only completion, Xvfb required
      (`probe-gtk-offscreen.c`)
- [x] decision recorded in this PRD with the rejected option and the reason — WPE chosen;
      webkit2gtk-offscreen rejected (pull-only snapshot, needs X, no damage, unsupported path)
- [x] licence and bundled-library obligations recorded — WPE LGPL-2.1 + bundled set, libwpe/
      wpebackend-fdo BSD-2-Clause; webkit2gtk already present

#### Phase 2: Frame transport off the game loop
**Status:** NOT STARTED
**ACs:** AC-4
**Files:** `packages/runtime-native/native/ui-overlay/src/` (new backend module + `abi.rs` surface),
`packages/runtime-native/src/platform/ui_overlay.cpp`
**Implementation:** Run the web engine on its own continuously-serviced thread or process. Publish
completed frames into a mailbox holding at most one buffer plus a monotonic frame counter; the game
side only ever takes the latest. No GTK/WebKit call may run on the thread that owns JavaScript —
that is the hazard that produced the `CreateBindGroup` regression. Keep the existing inbound message
queue semantics (`queueUiMessage`/`takeUiMessage`) so the bridge contract is untouched.
**Verification:** E1 — a test stalls the game thread ≥2 s and asserts the mailbox counter advanced
and exactly one buffer is retained. Negative control: the same assertion against a mailbox fed from
the frame loop MUST fail, which is the pre-change baseline.
**Checkpoint:** pending
- [ ] backend serviced off the game loop
- [ ] mailbox holds one frame, latest wins, counter monotonic
- [ ] stall test green; baseline red observed
- [ ] no GTK/WebKit call reachable from the JS thread (inspected, not assumed)

#### Phase 3: Composite the UI into the frame
**Status:** NOT STARTED
**ACs:** AC-1, AC-6
**Files:** `packages/runtime-native/src/webgpu/` (new UI composite unit beside
`bindings_canvas2d_composite.cpp`), `packages/runtime-native/src/webgpu/bindings_presentation.cpp`
**Implementation:** Upload the mailbox frame with `wgpuQueueWriteTexture` — same mechanism as
`bindings_canvas2d_composite.cpp:90` — and draw a premultiplied-alpha quad before
`presentPendingSurface()`. Skip the upload when the frame counter has not advanced. Upload only
damaged regions if the chosen backend reports them. Add a named `ui` phase to `TN_FRAME_BUDGET`;
do not reuse the existing `overlay` phase, which is the canvas2d layer and has misled a reader once
already.
**Verification:** E1 — launch under `Xvfb` with **no** compositing manager, capture the game window,
assert the briefing's known UI pixels are present (AC-1). E2 — interleaved frame-budget pairs with
the quad enabled/disabled, 3 pairs, ≥300 frames each, p95 delta ≤ 2.0 ms (AC-6).
**Checkpoint:** pending
- [ ] UI pixels present in the game's own frame with no compositor running
- [ ] unchanged frames skip the upload (asserted, not assumed)
- [ ] `ui` frame-budget phase reported separately from `overlay`
- [ ] p95 cost within AC-6, interleaved measurement

#### Phase 4: Input, hit regions and popups
**Status:** NOT STARTED
**ACs:** AC-5
**Files:** `packages/runtime-native/src/platform/ui_overlay.cpp`,
`packages/runtime-native/native/ui-overlay/src/`
**Implementation:** Route OS pointer and keyboard events into the offscreen view against the
published hit regions, keeping `uiOverlayHitTest` and `uiOverlayInjectPointer` signatures. Decide
and document the native-popup answer: with no overlay window, a bare `<select>` must render its list
*in the page*. If that requires games to stop relying on native popup chrome, say so in the template
`AGENTS.md` and the UI docs — a capability the template docs omit does not exist.
**Verification:** E1 — `native-playtests/ui-parity.playtest.json`, which already exercises the
loadout buttons, the assignment dropdown, the command overlay and the map, with zero runtime
diagnostics.
**Checkpoint:** pending
- [ ] pointer and keyboard reach the page through the existing contract
- [ ] `ui-parity` green with zero diagnostics
- [ ] popup behaviour decided, implemented and documented in the template docs

#### Phase 5: Delete the X11 overlay and ship the dependency
**Status:** NOT STARTED
**ACs:** AC-2, AC-7, AC-8, AC-9
**Files:** `packages/runtime-native/native/ui-overlay/src/argb.rs` (delete the overlay window path),
`packages/runtime-native/src/runtime.cpp` (remove the frame-loop pump),
`packages/runtime-native/CMakeLists.txt`, `packages/runtime-native/scripts/package-desktop.mjs`,
`sandbox/midway-open-pacific/tools/run-native.sh` (remove)
**Implementation:** Remove `Placement::Overlay`, the self-compositor, the compositing-manager probe
and the frame-loop pump. Bundle the chosen web engine's libraries through the existing dependency
discovery, or declare them prerequisites — whichever the licence and size analysis from Phase 1
supports. Leave the Windows and macOS child-window paths alone.
**Verification:** E1 — walk the X tree for the game's pid and assert only the SDL window exists
(AC-2). E2 — a `ui.renderer: "native"` fixture starts and renders with no web engine initialised
(AC-7). E3 — Windows and macOS builds compile and their existing native gates pass (AC-9). E4 —
`grep` proves the deleted symbols are gone, and no code path re-enables them (AC-8).
**Checkpoint:** pending
- [ ] no override-redirect window in the X tree
- [ ] `ui.renderer: "native"` unaffected, no web engine started
- [ ] Windows and macOS unchanged and green
- [ ] overlay code deleted; `run-native.sh` removed with its reason recorded

#### Phase 6: The loading screen is deterministic
**Status:** NOT STARTED
**ACs:** AC-3
**Files:** `packages/core/src/game.ts`, `packages/runtime-native/src/platform/window.cpp`
**Implementation:** Remove the `framework:ui-ready` hold — it waits on script execution, not
presentation, and once the UI is in the frame the cover and the world share one swapchain, so the
race it was guarding cannot occur. Clear the held-startup frame to `bootSplash.backgroundColor`
instead of black, so the window is the game's own colour from creation until the UI's first frame
rather than `#102a37` for four seconds and then `gray(0)`.
**Verification:** E1 — 10 consecutive launches, each sampled from the game window before
`first_playable`, asserting the `#loading` background colour is present in all 10 (AC-3). A single
green run is explicitly not sufficient here: the defect being closed is a 1-in-3 race.
**Checkpoint:** pending
- [ ] `framework:ui-ready` hold removed
- [ ] held-startup clear colour is the game's `bootSplash` colour, no black gap
- [ ] 10/10 launches show the loading screen

## Out of scope

- The ~34 s `first_playable` on this game against 6.6 s on web. Real and worth its own PRD, but it
  is dominated by the game's own module compiles and asset loads, not by the UI seam. Phase 3's
  frame-budget numbers will say how much of the *frame* cost belongs here; startup cost needs its
  own profile.
- Diagnosing why the X11 overlay is blank under kwin/XWayland. Deleting it settles the symptom, and
  the suspected foreign-`GdkWindow` realization path is recorded above for anyone who needs the
  answer for another reason.
- Android and iOS, which attach their own web views from their own hosts and are untouched.
