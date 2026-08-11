# Gameplay frame rate on the phone, measured while the game is played — 2026-08-11

**Closed: the game now holds 60 fps while it is played.** Two driven launches on a physical
Pixel 8, 253 rolling windows between them, recorded **zero windows below 60 fps** — minimum 83.4,
median 106. Before the fix the same subject ran at **55–71 fps** while driven.

The cause was never the JavaScript engine. It was ~93 HUD draws that `SceneCollapse` skipped
because they are camera-parented; the pass now folds them, 76 overlay meshes to 11 draws. The
investigation that found it is kept below, because what it ruled out matters as much as what it
found.

Device: Pixel 8 (`shiba`, serial `37251FDJH0037Z`, arm64-v8a, Android 17, 1080×2400). Native
runtime built `assembleDebug` with the `-O2` append that `android/app/build.gradle.kts` applies to
the debug variant, profiler **off**, present mode `mailbox` (uncapped). Nothing here is an
emulator or iOS result.

## What the previous record missed

`native-visual-parity-2026-08-11.md` reports "55.7 / 72.9 / 73.5 fps" and reads that as clearing
60. Two things were wrong with the subject it measured, both live in the game tree at the time:

- **The game rendered at half resolution.** `PROBE_RENDER_SCALE = 0.5` in `src/scenes/Play.ts`
  resized the renderer to 1200×540 on every launch. It is a leftover probe, not a setting.
- **The frame-rate marker fired once**, 300 frames after a 120-frame warmup, so a single window
  stood in for the whole session. It reported whichever phase it happened to land in, which is
  why three launches disagreed by 18 fps.

Both are fixed in the subject used here: full resolution, and a rolling window that reports every
30 frames with the worst frame in each.

## The measurement

Frame rate across one launch, 30-frame windows, driven with the on-screen stick and jump button
from t≈13 s:

| Phase | fps | worst frame |
|---|---|---|
| First window | 9.5 | 275 ms |
| Collapse bake | 5.4 | **3 907 ms** |
| Settling | 49–79 | 22–25 ms |
| **At rest** | **100–110** | 9.8–11.4 ms |
| **Driven** | **50–67** | 17–26 ms |

Two defects, separately caused:

1. **A 3.9-second freeze at startup.** `SceneCollapse` observes for 45 frames and then bakes
   2,282 meshes in one frame. The user-visible symptom is "started a little bit laggy then
   stabilised". PRD-070 owns cold start and hitches; this is a measurement for it, not a fix.
2. **Gameplay sits below the 60 fps budget.** Attributed below.

## Where the gameplay frame goes

Timed inside the frame loop on device, 120-frame windows:

| Component | At rest | Driven |
|---|---|---|
| Game's own update (`Play.ts` frame callback) | 0.45 ms | **0.45 ms** |
| `SceneCollapse` per-frame transform refresh | 1.85 ms | 2.01 ms |
| `renderer.render` | 8.5 ms | **15.0 ms** |
| Native (bindings + submit + present) | ~1 ms | ~1 ms |
| **Frame total** | ~11 ms | **~17.5 ms — 57 fps** |

The game's own logic is 0.45 ms and never moves. `renderer.render` is the whole cost.

### It is the HUD, and it is ~93 draws

Draw calls read from the real `WebGPURenderer`, and the same run with the HUD hidden:

| | Draws | Triangles | `renderer.render` | fps driven |
|---|---|---|---|---|
| As the game ships | **105–119** | 199,767 | 15.0 ms | **55–71** |
| HUD hidden, nothing else changed | **17** | 199,115 | **3.6 ms** | **146–174** |

`SceneCollapse` reports `mergedMeshes: 14`, and that is true of the scene it collapses — but the
scene actually draws ~110 objects, because the pass excludes every camera-parented subtree by
construction, and that is where the HUD lives. Hiding the HUD removes ~93 draws, 11.4 ms and
takes the game from 57 fps to 170.

At ~110 draws costing 11.4 ms, a draw costs roughly **118 µs of interpreted JavaScript**. That is
the per-draw figure PRD-069 and PRD-072 exist to attack, now measured on hardware against a real
game rather than a synthetic subject.

### What was ruled out, each by a run

Every one of these was tested on the device and refuted, and none of them is the cause:

- **The JS engine.** With 17 draws the same QuickJS build runs the same scene at 170 fps.
- **The GPU.** `SDLThread` sits at 103–107 % CPU through the slow phase while every `mali-*`
  thread reads under 8 %. Triangle count is identical in both configurations.
- **Panel refresh rate.** Forcing the panel to 60 Hz and to 120 Hz leaves the game at ~105 fps
  either way; `mailbox` does not gate the loop.
- **`adb` contention from the harness.** Spawning `input keyevent` at the same cadence with no
  touch delivered leaves the frame rate at 100–110 fps.
- **Touch event dispatch.** Slow windows recorded `touchEvents=0` and `pointers=0`.
- **The shadow map.** Freezing the sun that follows the player changed nothing (55.9 vs 56.8 fps),
  and disabling `castShadow` outright changed nothing (56.5 fps).
- **The game's own code.** 0.45 ms per frame, flat across every phase.

## The fix, and what it measured afterwards

`SceneCollapse` gained a second pass, `#collapseCameras`, which folds each camera's own subtree in
**camera space** and attaches the result to the camera. Three properties of a HUD, and none of
them optional:

- **Nothing is classified static.** A seven-segment counter hides segments rather than moving
  them, and a 45-frame observation window will not see a clock tick. Every overlay mesh gets a
  transform slot; an invisible one is pushed out of the frustum exactly as a hidden moving part is.
- **Groups are keyed by material identity, never merged by look.** The hearts recolour their own
  materials, and look-merging would fuse two hearts into one draw that recoloured both.
- **The game's material instance is mutated, not cloned.** `heart.material.color.setHex()` writes
  to that object; a clone would keep showing the colour it was copied at. `restore()` puts the
  original nodes back.
- **The source meshes stay in the graph**, parked on a render layer nothing draws, so Three.js
  keeps refreshing their world matrices and the game's own `visible` writes still mean what they
  say.

Measured on the same device, same subject, driven with the on-screen controls:

| | Overlay draws | `renderer.render` | fps driven | Windows below 60 |
|---|---|---|---|---|
| Before | 76 meshes, 76 draws | 15.0 ms | 55–71 | many |
| **After** | 76 meshes, **11 draws** | — | **83–116, median 106** | **0 of 253** |

`TN_SCENE_COLLAPSE` now reports
`{"collapsed":true,"sourceMeshes":2282,"mergedMeshes":14,"movingParts":141,"overlayMeshes":76,"overlayDraws":11}`.

**The picture is unchanged.** Hue-histogram distance from the pre-fix screenshot is **0.0074** at
spawn and **0.0056** after play, against a 0.18 threshold for "same picture". The timer advances
`00:08 → 00:22` with both digits changing, which is the seven-segment visibility path working
through a merged draw; hearts, coin and gem counters, the stick and the buttons all render.

Worst single frames of 47.2 ms and 37.0 ms still occur occasionally within a launch. Sustained
frame rate holds; those spikes belong to PRD-070 with the collapse bake.

## Which layer owns this

**Engine, not game.** The game builds an ordinary HUD out of ordinary meshes; it annotates
nothing and branches on nothing. Every Three.js game shipping to Android has a HUD, and the
framework's one performance pass declines to touch it — `#excluded` walks up from each object and
skips anything under a camera, because baking a camera-parented subtree in world space would
strand it wherever the camera stood when the pass ran.

The fix therefore landed in `packages/core/src/collapse.ts`, not in the game. The game still
declares nothing.

## Not claimed

Mobile readiness — one game, one device, one level. That the startup freeze is fixed; it is not,
and PRD-070 owns it. iOS: no Apple hardware is attached, and nothing here is a simulator result.
Blend ordering inside a merged transparent group is still unsorted, and an overlay whose material
count approaches its mesh count gains nothing from this pass.

## Reproduce

The subject is `~/projects/fox-native`, which is not tracked by this repository. With it built
against this core and the device attached:

```sh
# full-resolution rolling frame rate, driven with the on-screen controls
THREENATIVE_JS_PROFILE_WARMUP_FRAMES=0 THREENATIVE_JS_PROFILE_FRAME_WINDOW=30 \
  ./play-fox.sh gameplay 1 30
```

Read `TN_FOX_NATIVE_FRAME_RATE` (per-window fps and worst frame), `TN_FOX_NATIVE_GAME_UPDATE`
(game cost, pointer counts, draw calls) and `TN_SCENE_COLLAPSE` from logcat.

`pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm budgets` all exit 0. The camera pass is
covered by four cases in `packages/core/__tests__/collapse.spec.ts`: the fold itself, that a
material instance stays live and `restore()` reverses the mutation, and that an overlay under the
12-mesh floor is left alone.
