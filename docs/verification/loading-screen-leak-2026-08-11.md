# Loading-screen leak — 2026-08-11

**Status:** Phase 0 detector proven red on the physical Pixel 8 and the committed in-tree repro.
Phase 1 is green in Chromium and on the Android emulator with the unchanged scenario. Phase 2 is
closed RECOMMEND-AGAINST from measured asset timings. Repository unit, build, lint, typecheck,
budget, and desktop-native gates are green; the scaffolded-template aggregate is recorded below.

## Unfixed device baseline

Subject: the existing `fox-native` APK built against core commit `8c5fc40`, installed on the
physical Pixel 8 `shiba` (`37251FDJH0037Z`). The first eight-second attempt ended while the
loading screen was still present and was rejected as an incomplete observation. The valid run
covered loading and reveal:

```sh
node packages/runtime-native/scripts/inspect-launch.mjs \
  --device 37251FDJH0037Z \
  --package com.threenative.game \
  --seconds 15 \
  --out packages/runtime-native/.runtime/prd-075-unfixed-phone \
  --keep-frames
```

```text
923 frames, 1080x488 content after recorder-letterbox crop
loading frames: 89-296 (208 frames)
reveal window: 87-302
first violations: frame indexes 247 and 248
changed grid cells: 138
worst cell delta: 224
exit: 1
```

The CLI's legacy area formatter printed `NaN%` for these flicker findings because flicker rows
carry `changedCells` and `worstDelta`, not `foreign` and `backdrop`. The JSON above is the detector's
authoritative output. The playtest-integrated detector added by this PRD records one shared shape
for both channels: frame index, complete RGB sample grid, and screenshot path.

![Waterfall geometry visible through the loading backdrop](./loading-screen-leak-2026-08-11-frame-0248.png)

## Browser control

The committed `abyss-framework` repro uses 218 world meshes, one moving collapsed waterfall part,
and the same loading-screen graph shape. Chromium did **not** reproduce the device leak:

```text
framebufferCoverage: PASS
covered frames: 10
first violation: none
collapse: sourceMeshes=218, movingParts=1, overlayMeshes=13, overlayDraws=2
```

That result narrows the current defect to the native path; it is not used as evidence that the
device issue is fixed.

## Committed Android repro

The same `examples/abyss-framework/playtests/loading-leak.playtest.json` scenario ran against
the native-portable `?loading-leak` game on Pixel 8 `37251FDJH0037Z`. The first attempt was
rejected because Android's per-package compatibility dialog covered the recording. After that
OS dialog was dismissed, the unchanged assertion failed as required:

```text
TN_PLAYTEST_FRAMEBUFFER_COVERAGE_FAILED
boundary source: video-backdrop-dominance
covered frames: 14
first violation: frame 7
window started: true
window completed: true
diagnostics: pass
exit: 1
```

![Committed repro leaking moving waterfall geometry at frame 7](./loading-screen-leak-2026-08-11-repro-frame-7.png)

## Fail-closed controls

- Headless Chromium without a usable WebGPU readback failed
  `TN_PLAYTEST_FRAMEBUFFER_PIXELS_UNREADABLE` and named `xvfb-run`.
- A coverage window with zero observed frames fails instead of passing.
- A run that never enters or never completes the coverage window exits `2`.
- Android video analysis reports `video-backdrop-dominance`; it does not claim bridge-aligned
  frame boundaries.

## Phase 1 browser result

The unchanged scenario passed after the world and loading screen moved to independent render
surfaces. While `CanvasLayer.opaque` is true, the engine skips the world renderer and scene frame
entirely and draws only the canvas layer:

```text
framebufferCoverage: PASS
covered frames: 10
first violation: none
collapse: sourceMeshes=218, mergedMeshes=3, movingParts=1
overlayMeshes=12, overlayDraws=1
exit: 0
```

The overlay call bypasses the world's output pipeline and preserves the raw renderer's clear
state. Focused core verification passed 45 CanvasLayer, renderer, game-loop, and collapse tests.

## Android emulator boundary finding and result

The post-fix APK runs on the local API 35 x86_64 emulator. Three recorder attempts were rejected,
not counted as product failures:

1. Android's immersive-mode tutorial covered the first recording.
2. The recording ended before a revealed frame, so the detector correctly reported an incomplete
   window.
3. After adding one deliberate revealed tail frame, Android's launch/orientation fade was
   backdrop-dominant and was misclassified as the start of coverage.

The doubtful assumption was correct: offline backdrop dominance alone cannot distinguish an
Android compositor transition from the bridge-declared loading window. The correction does not
weaken the pixel assertion:

- recording starts and stops around the declared scenario-step labels after the bridge attaches;
- opt-in device coverage advances one logical frame at a time at the recorder's measured cadence;
- backdrop dominance trims only the encoder's queued full-world reveal tail; every
  backdrop-dominant covered frame remains subject to the same 32×18 grid, `[13, 27, 42]` colour,
  and tolerance 14.

A unit fixture with a one-frame sampled leak followed by a full-world reveal fails on the leak and
trims only the reveal. The unchanged emulator scenario then passed:

```text
boundary source: scenario-steps
covered frames: 40
first violation: none
window started: true
window completed: true
diagnostics: pass
exit: 0
```

This final run used only `emulator-5554`; the physical Pixel remained disconnected. Its native
first-frame marker was 898.983 ms. That is recorded as emulator evidence only and is not compared
to PRD-070's 1,051 ms physical-device baseline.

## Deterministic generated-project playtests

The first full template run exposed an existing timing-sensitive route in `platformer-stomp`: the
same 16-tick approach alternated between a stomp and player damage under Xvfb. The scenario now
uses 28 bounded approach ticks before its existing jump, which reaches the patrol consistently
without changing framework or gameplay code.

## D6 asset-load measurement

The pre-Phase-3 starter template was built and run on the same emulator with temporary timing
markers around the real asset calls:

```text
TN_D6_BOOT_LOAD_MS:0.508
TN_D6_PLAY_LOAD_MS:2.738
TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb
```

Boot's texture plus Play's texture and GLB totalled 3.246 ms. That is not a meaningful
player-visible blank asset-loading interval, so PRD-075 Phase 2 is closed RECOMMEND-AGAINST. The
longer launch work is Android surface startup, JavaScript evaluation, shader compilation, and
scene collapse; this PRD does not turn those into a speculative per-scene lifecycle.

## Repository and native gates

```text
pnpm typecheck: PASS
pnpm lint: PASS (166 existing warn-level complexity diagnostics)
pnpm test: PASS (95 files, 768 tests; package builds, publint, native runtime, physics parity)
pnpm test:templates: PASS (minimal, starter, and platformer scaffolded playtests)
pnpm budgets: PASS (existing native-runtime review trigger reported)
git diff --check: PASS
pnpm native:verify:desktop: PASS (300 frames, 1280x720, non-blank screenshot)
```

The Android functional proof above and the desktop gate prove native execution. They do not satisfy
the remaining same-physical-Pixel performance comparison, because the owner needed the phone and it
was disconnected before post-fix measurement.

## Completion audit

The final defect-table audit settled the four rows that were still labelled `TO REPRODUCE`:

- D7 is resolved by the raw overlay draw bypassing the world's output pipeline.
- D8 does not reproduce when readiness and compilation are already settled: the overlay is removed
  within the same microtask turn. A pending compilation intentionally keeps the screen covered.
- D9 was real: the settled collapse retained a per-frame updater for the old scene. `goto` now
  restores it before `clearScene`; a 200-mesh moving-part integration test proves that updater does
  not run on the destination frame.
- D10 is confirmed but separate: browser DOM siblings paint above the canvas, while the reported
  native defect and the framebuffer detector have no DOM. It remains outside this PRD's runnable
  success criteria and is not represented as fixed.

Focused audit gates:

```text
packages/create-threenative/__tests__/loading-screen.spec.ts: PASS (10 tests)
packages/core/__tests__/game.spec.ts: PASS (23 tests)
```
