# Native canvas presentation regression

Wildwood exposed two engine defects on Linux desktop (V8, Dawn Vulkan, RTX 2080):

- The project bundler replaced native `document.createElement('canvas')` with the presentation canvas. Creating a 440×64 loading-status canvas resized the 1280×720 game surface and caused attachment-size validation failures.
- Independently created canvas contexts bypassed the surface-acquisition bookkeeping used by presentation. Their binding destination also needed an owned handle surviving the callback frame.

The bundler now preserves native canvas creation. Created WebGPU contexts use the same acquisition transaction as the host context and retain their binding destination.

## Red → green evidence

The prelude regression failed with `a text canvas must not alias the presentation canvas`, then passed after removing the alias. A raw native two-canvas probe produced no screenshot and exited 1 before the presentation fix; afterward it produced an inspected 1280×720 green frame and exited 0.

The strengthened `90-document-window-stubs` conformance case renders through a newly created canvas while sizing an independent text canvas. Its executed desktop report contains **1 pass, 0 fail, 92 blocked**: only the selected case was run; this is not a full parity result. The inspected output contains the expected green card and blue ring.

The prelude unit is collected by root `pnpm test`. The conformance case is already selected by the existing native desktop-parity CI lane; no new advisory-only workflow is needed to exercise it.

Local detailed evidence: `artifacts/wildwood-native-profile-20260905/` (`probe-before.log`, `probe-green.log`, `probe-green.png`, and `conformance/report.json`). These local artifacts are not a claim of browser, Android, or iOS execution.

Wildwood scene quality, pointer capture, UI attachment, and steady-state performance are separate checks and are not established by this canvas regression.

## Linux loading-status glyphs

The Linux Skia Canvas2D path initialized an empty font manager. The native probe measured `PREPARING TERRAIN` at **0 pixels wide**, explaining the absent loading-status text. Linux desktop now uses Fontconfig with Skia's FreeType scanner; other platform branches are unchanged.

The existing native Canvas2D test now checks both a nonzero text width and visible rasterized glyph pixels. Its rebuilt executable passed all checks. The same `90-document-window-stubs` case now also measures text through the document-created canvas path actually used by Wildwood, and passed on a private X display (**1 pass, 0 fail, 92 unselected/blocked**). An initial diagnostic incorrectly exercised `OffscreenCanvas`, whose stub is a different path; that failed diagnostic is retained in `font-conformance/`, not counted as a passing gate. Corrected evidence is in `font-conformance-fixed/` and `font-green.log`.

## Procedural ellipse drawing

The same game source selected different preload artwork because native Canvas2D did not expose `ellipse`. The native backend now builds rotated elliptical arcs through Skia; no game artwork or DOM UI emulation is added. Geometry, color and timing remain game-owned.

Red: the actual host reported `Canvas2D must draw procedural ellipses` (`ellipse-red-detail.log`). Green: rebuilt C++ tests check rotated axes, clockwise/counterclockwise coverage, and upload dirtiness (`ellipse-unit.log`); the JS conformance checks real pixels and rejected negative radii. `ellipse-green/report.json` records **1 pass, 0 fail, 92 unselected/blocked**, with an inspected nonblank desktop capture. Its cached browser screenshot does not establish fresh browser execution of the added assertions. Gradient support and full preload parity remain open.
