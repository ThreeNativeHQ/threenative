# Native canvas presentation regression

Wildwood exposed two engine defects on Linux desktop (V8, Dawn Vulkan, RTX 2080):

- The project bundler replaced native `document.createElement('canvas')` with the presentation canvas. Creating a 440×64 loading-status canvas resized the 1280×720 game surface and caused attachment-size validation failures.
- Independently created canvas contexts bypassed the surface-acquisition bookkeeping used by presentation. Their binding destination also needed an owned handle surviving the callback frame.

The bundler now preserves native canvas creation. Created WebGPU contexts use the same acquisition transaction as the host context and retain their binding destination.

## Red → green evidence

The prelude regression failed with `a text canvas must not alias the presentation canvas`, then passed after removing the alias. A raw native two-canvas probe produced no screenshot and exited 1 before the presentation fix; afterward it produced an inspected 1280×720 green frame and exited 0.

The strengthened `90-document-window-stubs` conformance case renders through a newly created canvas while sizing an independent text canvas. Its executed desktop report contains **1 pass, 0 fail, 92 blocked**: only the selected case was run; this is not a full parity result. The inspected output contains the expected green card and blue ring.

The prelude unit is collected by root `pnpm test`. The conformance case is already selected by the existing native desktop-parity CI lane, which is advisory and requires the `native` label on pull requests. Selection does not make that execution a required merge gate.

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

## Stroke caps and matched preload capture

Native previously ignored `lineCap`, leaving the game's round trail end square. The existing Canvas2D state now forwards butt/round/square caps to Skia; its getter reads native state so save/restore and invalid assignments behave consistently. Red: the actual host reported `Canvas2D round caps must extend beyond path endpoints` (`line-cap-red-detail.log`). Green: C++ pixels distinguish round and square corners; JS conformance covers round pixels, state restoration, invalid assignments and the existing GPU upload readback (`line-cap-green/report.json`: 1 pass, 0 fail, 92 unselected).

The inspected `preload-native-final.png` and fresh browser `preload-web.png` both render the original game source at 1280×720 and 70% progress. Mean absolute RGB difference is **3.653/255**; **0.8813%** of pixels differ by more than 16 in any RGB channel. This is close visual agreement, not bit-identical rasterization. No baked artwork or game-specific native codec override remains. Full-game startup/input, performance and non-Linux targets still require separate execution.

## Refreshed-package integration checks

Wildwood installed fresh core, CLI and native-runtime tarballs suffixed `input-window-20260905-191431`. The installed core contains the automatic canvas-click capture for relative-pointer bindings. `pnpm typecheck` exited 0 (`final-typecheck.log`); `pnpm test` exited 0 with **392 passed / 1 skipped files, 4,288 passed / 4 skipped tests** (`final-unit-tests.log`). `pnpm lint` failed on eight unrelated `.linchpin` JSON formatting errors (`final-lint.log`); it is not a green gate.

The actual Linux host executed conformance row `86-pointer-keyboard-events`, including the core `InputMap` automatic click capture: **1 pass, 0 fail, 92 unselected/blocked**, no GPU validation errors, and an inspected nonblank screenshot (`fresh-input-conformance/report.json`). This uses synthetic event dispatch and a cached browser reference; it does not replace the pending real OS input test of the freshly packaged game. The diagnostic profile now requires world/startup readiness and verifies both OS mouse turning and OS keyboard movement. Wildwood's full desktop packaging was still compiling assets when these checks were recorded.

## Full packaged desktop flow

The serialized `pnpm build:desktop` completed successfully (`fresh-default-package.log`). The executable's first 127,600,224 bytes match the rebuilt native host exactly (`cmp` exited 0). The isolated Xvfb/KWin OS-input probe exited 0: startup/world/UI reported ready, heading changed **34 → 42 degrees**, and W increased the odometer **0 → 5.1 metres** (`fresh-native-e2e/profile.json`). The original preload is upright and readable; the world screenshot was inspected. This run did not independently remeasure SDL cursor visibility.

The unchanged `wildwood-flow.playtest.json` initially failed diagnostics despite moving 26.4 metres: the desktop driver classified every stderr line as an error, including explicitly labelled GTK/EGL warnings. It also classified native `[error]` stdout as ordinary logs. Real child-process tests reproduced both mistakes (**5 failed, 16 passed**, `desktop-severity-red.log`), then passed (**21 tests**, `desktop-severity-green.log`). The driver now honors explicit severity, retains all lines, and keeps unclassified stderr as errors. Package build/typecheck passed.

The rebuilt harness reran the same packaged game and unchanged scenario with all **5 assertions passing**, distance **26.4476 metres**, odometer **26.7 metres**, world/UI ready, and zero error diagnostics (`fresh-native-flow-green-console.log`). Its `console.json` retains **7 warnings and 2,548 log entries**. Private-display frame rates are not performance evidence. Full-scene web parity, real-display steady-state performance, touch input and non-Linux execution remain open; the earlier full repository gate results predate this harness change.

## Touch-safe automatic mouse capture

The automatic click handler also requested pointer lock for touch and pen clicks. Two behavioral tests reproduced the unwanted request (**2 failed, 5 passed**, `touch-capture-red.log`). The handler now ignores explicitly non-mouse pointer types while retaining legacy mouse events without a pointer type. Both regression cases also verify that a subsequent mouse click still captures. All **7 tests passed** (`touch-capture-green.log`).

A Chromium probe generated a real touchscreen tap followed by a mouse click, using the current core source and the browser's actual pointer-lock implementation. The tap produced `pointerType: touch`, **0 lock requests**, and no capture; the mouse click produced **1 request** and successful capture, with no page errors (`touch-capture-browser.log`). This is browser touch emulation, not Android/iOS device evidence. Older compatibility mouse events without pointer metadata remain unverified on touch devices. The packaged Wildwood executable predates this guard and must be refreshed before attributing this behavior to that executable.

The real-desktop KWin/Spectacle capture (`real-desktop-presentation/world-compositor.png`) also shows the forest, rather than the black backdrop observed with private-display X11 root capture. This establishes world presentation in that captured run; it does not establish HUD composition or steady-state performance.

The current source subsequently passed native row `86-pointer-keyboard-events`, now rejecting synthetic touch/pen clicks before capturing a mouse click: **1 pass, 0 fail, 92 unselected**, no GPU validation errors, inspected nonblank capture (`touch-input-conformance/report.json`). This row is included by the existing desktop-parity CI command, without a new workflow. The browser reference used for pixel comparison is cached; the separate Chromium input probe above supplies fresh browser interaction evidence.

After these changes, the full `pnpm test` process exited 0: **392 passed / 1 skipped files, 4,299 passed / 4 skipped tests**, followed by successful package checks (`post-input-tests.log`). Lint still exits 1 on eight unrelated `.linchpin` formatting errors (`post-input-lint.log`). A concurrent typecheck failed while the test command rebuilt declarations; the serialized rerun exited 0 (`post-input-typecheck-serial.log`).

## Blocking Linux Canvas2D regression gate

An Opus medium read-only CI audit found that the required Linux native test job built the Canvas2D contract executable but did not execute it. The desktop verification matrix executes it on macOS/Windows, where the Linux font assertions are compiled out. `runtime-next-contract.test.mjs` now executes the existing binary in the Linux native suite, requires its success marker, rejects a nonzero process exit, and fails closed when it is missing. No workflow or new runner is needed.

Red: temporarily withholding the built executable made the selected test fail with the missing-build instruction (`canvas-ci-missing-red.log`); the binary was restored immediately. Green: the restored real executable passed (`canvas-ci-green.log`), followed by the runtime-next/frame-stream suites (`canvas-ci-suite.log`). The C++ pixel assertions themselves retain their earlier defect-specific red/green receipts above. These checks do not turn the advisory GPU conformance lane into a required gate, or establish mobile Canvas2D support.

## Shared-game preload color transition

Wildwood created its preload during `load()` but selected its authored ACES curve later in `enter()`. A hardware browser probe reproduced the color transition with the original loading source (`preload-tone-probe.log`). Changing the material's `toneMapped` flag did not isolate it from this WebGPU output conversion. This is shared game render initialization, not a native texture-wrap defect.

The game now prepares the selected quality tier's tone curve before creating the loading view; world passes are still installed at their existing time. All three tier tests first failed on missing preparation, then passed with the full 14-test rendering suite and game typecheck (`preload-output-{red,green,typecheck}.log`). Browser captures before/after applying the world curve are pixel-identical at 1280×720 (`preload-prepared-{initial,world-aces}.png`, NVIDIA/Turing). The isolated native preload also produced an inspected nonblank capture (`preload-prepared-native.png`). These source probes do not establish that the older packaged Wildwood executable contains this change. The artwork's bottom tree-band seam remains unchanged.

Artwork follow-up: the foreground triangles now continue beyond the canvas edge instead of ending at an in-frame shared baseline. Inspected `preload-seam-initial.png` (browser) and `preload-seam-native.png` remove the bottom strip without a native branch. A browser Canvas2D raster test fails against the old foreground (horizontal row jump 3.189 RGB levels), passes the new foreground, and runs in the game's `test:render` suite: 15 tests passed, followed by game typecheck (`loading-seam-test-red.log`, `loading-art-suite.log`, `loading-art-typecheck.log`). This is a shared artwork adjustment, not a runtime texture-wrap change; package refresh remains necessary.

## Refreshed executable handoff

The final desktop rebuild completed (`wrap-desktop-build.log`), producing a 3,165,320,187-byte executable at `sandbox/wildwood/dist-native/wildwood`. Its 127,600,224-byte host prefix matches the newly rebuilt Linux host. The installed core's `dist/index.js` matches the current workspace build and includes touch-safe capture; the package override is aligned with that same tarball.

The unchanged gameplay scenario passed all five assertions against this executable: world/UI ready, movement **26.4476 m**, odometer **26.7 m**, and zero game error diagnostics (`wrap-native-flow-console.log`). The inspected world capture is nonblank. The separate real OS input probe passed: heading **34 → 42°**, odometer **3.7 m**, SDL cursor state **1,0,1** (relative mode with relative cursor hidden), and startup ready with compilation settled (`wrap-native-os-input/profile.json`). Its inspected loading capture includes the corrected foreground seam.

Performance is not certified. The real-display blank control measured 301 intervals in 5,009.5 ms (p50 16.7 ms, p95 16.8 ms), but the subsequent real-time game probe lost OS foreground before obtaining a clean 1,200-frame window and correctly failed (`display-control.log`, `native-realtime.json`). Its startup/compiling windows must not be quoted as steady-state FPS. The physical Android device is online, cool, and discharging, but at 39% battery, below the measurement preflight floor; no fresh Android execution is claimed. Android/iOS presets still disable Canvas2D, and iOS tooling is unavailable on this Linux machine (`wrap-device-doctor.log`). Those remain broader platform gaps, not passed checks.

## Cooperative scheduling probe — remaining engine bottleneck

A subsequent 75-second real-time run on private X11 reproduced `surface.compiling: true`
in all three completed 300-frame windows (`compile-settle.log`). The process was deliberately
terminated by the probe's timeout (exit 124), not by a runtime crash. This is diagnostic evidence,
not presented-FPS evidence. Startup readiness's `compileSettled` observation above means its
bounded warm-up gate completed; it does **not** prove that the underlying compile promise ended.

The installed Three.js `Renderer.compileAsync` awaits `yieldToMain` between objects, and the
native scheduler maps that yield to `setTimeout(0)`. The host executes timers once per render
loop. A direct current-host probe confirms the coupling: **120 sequential no-op yields crossed
119 animation frames**. With an empty frame callback they took 1.314 ms in the uncapped hidden
window; with a controlled 8 ms main-thread workload per frame they took **957.291 ms**, still
119 frames (`scheduler-probe.log`, `scheduler-probe-loaded.log`). Both bounded probes exit 124
after printing their result; that exit is not a test pass. The loaded fixture is preserved as
`scheduler-probe.js` in the same local artifact directory.

The existing scheduler unit tests prove API installation and macrotask ordering, but run their
timers on Node's event loop. They do not catch this native frame coupling. This identifies an
engine scheduling bottleneck to address without game-specific workarounds. It does not yet prove
that coupling alone explains Wildwood's entire pending compile, and no scheduling fix or new
performance claim is included in this record.

## Subsequent Android dependency and visual-capture probes

Scheduler fixes and later Linux evidence are recorded in `packages/runtime-native/docs/G5-profiling.md`.
The Android Skia source probe subsequently produced an arm64 `libskia.a` (18,977,932 bytes)
with font support. A raster/text shared-library link probe passed `--no-undefined`; NDK
`llvm-readelf` reports AArch64 and 0x4000 alignment for every LOAD segment. Source pin,
options and logs live under `artifacts/android-skia-probe-20260905/`. This establishes build/link
feasibility only: shipping dependency reconstruction, Android font-manager wiring and physical
device execution remain open. ADB was unreachable; no mobile-ready claim follows from this link.

The equal-buffer visual comparison is **not accepted as parity proof**. Browser capture includes
the HUD; native GPU readback excludes it and shows visibly noisier foliage. Temporal states differ.
See `artifacts/wildwood-quality-parity-20260905/parent-review.md`. Three private-compositor capture
attempts did not produce a usable game screenshot: initial tool failure, success exit without a
file, and a hardened retry failing on a missing complete PNG. An empty private-X11 control did save
a PNG. The assumption that this private KWin/Spectacle lane captures the composed game is doubtful;
further blind retries stopped. These capture failures do not prove the game's presented window is
black. Full HUD/scene parity and real-display steady-state FPS remain unverified.
