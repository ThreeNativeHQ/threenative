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

## Gradients and CanvasTexture uploads

Native gradients now interpolate game-authored color stops through Skia. Mutable stops remain shared when assigned to a fill or reused on another canvas. Native pixel checks cover endpoints, interpolation, mutation, solid-style replacement and malformed stops. The selected JS conformance case passed with real canvas pixels and cross-canvas reuse (`gradient-green/report.json`).

The first capture of Wildwood's original preload then exposed a separate upload defect: the frame-op stream only accepted `data`/`_data` image bytes, rejecting live canvases with `external image has no eager-copy RGBA data`. Three.js catches upload errors, leaving a black texture. The CPU canvas contained `[19,39,28,255]`, while the scene capture was black (`preload-upload.log`, `preload-native.png`).

The stream now eagerly snapshots Canvas2D pixels before recording the upload, preserving enqueue-time contents if the canvas changes later. The new behavioral unit reproduced that exact error, then passed with all **14 frame-stream tests** (`canvas-upload-red.log`, `canvas-upload-green.log`). The conformance case now also uploads the canvas, maps a GPU readback buffer, and checks actual texture pixels: **1 pass, 0 fail, 92 unselected/blocked** (`canvas-upload-conformance/report.json`).

Wildwood's baked PNG copies, bake tool, loading-image override and codec override were removed from the sandbox. A diagnostic imports the actual unchanged procedural loading renderer and holds progress at 70%, without loading world assets. Fresh browser and native captures at 1280×720 show the same forest orientation, colors and layout (`preload-web.png`, `preload-native-upload-fixed.png`); browser reports NVIDIA/Turing. Native font selection/weight and line caps still differ visibly. This proves the isolated preload path, not the full game's startup, input, steady-state performance or mobile behavior.

## CSS font fallback and weight

The native parser treated `ui-monospace, monospace` as a single family and reduced numeric weights to a normal/bold flag. The real game title consequently used proportional, lighter glyphs. Font selection now walks the family list, resolves UI generic aliases, and retains the numeric weight. It also recognizes `normal` without passing that word to `stoi`.

Red: the C++ test failed `CSS ui-monospace fallback preserves equal glyph advances`. Green: all native Canvas2D checks passed (`font-style-green.log`); JS conformance passed with the same CSS declaration and GPU upload/readback checks (`font-style-conformance/report.json`: 1 pass, 0 fail, 92 unselected). The inspected `preload-native-font-fixed.png` now has the browser's monospace title styling. Stroke-cap parity remains open; these are still isolated preload captures, not a full-game performance receipt.
