# Probe — a real game across web, desktop and Android, 2026-08-09

**Result:** the same game source renders and takes input on all three executed platforms.
Two framework defects were found and fixed; one product gap was found and is not fixed. iOS
was not attempted — no Apple hardware is available here.

## Subject

`~/projects/fox-game`, a 1,950-line plain Three.js WebGL platformer written on 2026-08-03,
ported into a project scaffolded by `create-threenative --template minimal` from locally
packed tarballs — a consumer install shape, not a workspace link. The port lives at
`~/projects/fox-native`; the original was never modified.

Of the original source, `level.js`, `props.js`, `entities.js`, `fox.js` and `palette.js`
(≈1,600 lines) were copied **unchanged** and ran on all three platforms. Two things did not
port, both covered below.

## What executed

| | Web (Chrome, WebGPU) | Linux desktop native | Android emulator, API 35 x86_64 |
| --- | --- | --- | --- |
| World renders | yes | yes | yes |
| HUD renders | yes | yes | yes |
| Keyboard / DPAD drives the fox | yes | yes | yes |
| On-screen stick drives the fox | n/a | n/a | yes |
| Two simultaneous fingers | not verified | — | not verified |

Evidence: `~/projects/fox-native/artifacts/probe/` — `22-web-hud.jpg`,
`21-desktop-hud.png`, `18-android-final.png`, `20-android-after-touch.png`.

Playtest on web: `movement.axisDelta` +6.67 on x, `GameState.coins` 1 → 10, zero console,
network and runtime diagnostics.

## Defect 1 — Android aborted on any toon material with a gradient map

The game reached `TN_NATIVE_SMOKE_FIRST_FRAME` and died with `signal 6 (Aborted)` about half
a second later, with no logcat output, no tombstone and no `TN_NATIVE_START_FAILED`.

Bisected on device, one variable per run. Alive: `MeshStandardMaterial`; `MeshToonMaterial`
with a `gradientMap`; the vertex-coloured sky dome; the full 40-mesh fox rig; an unlit
`MeshBasicMaterial` with a `DirectionalLight` present. Aborted: `MeshToonMaterial` **with** a
`gradientMap` **and** any punctual light. Removing the `gradientMap` from that material made
it survive.

Rebuilding the Linux host against wgpu-native instead of Dawn printed what Android swallowed:

```
Shader validation error: Entry point main at Fragment is invalid
120 │ nodeVar7 = textureLoad( nodeUniform10, vec2<u32>( ... ), u32( 0 ) );
    = Image sample or level-of-detail index's type of [153] is not an integer scalar
thread '<unnamed>' panicked at src/lib.rs:598:5:
Error in wgpuQueueSubmit: Validation Error
```

The naga inside wgpu-native **v24.0.3.1** (March 2025) rejects the toon ramp lookup Three.js
0.185.1 emits. Dawn accepts it, which is why desktop stayed green.

**Fixed in `0d0495c`:** wgpu-native pinned to v25.0.2.2 for desktop, Android and iOS. It
compiles with no source changes. The failing scene goes from four validation errors plus an
abort to 300 clean frames on the Linux wgpu host, and the whole platformer now renders on the
emulator.

**This was one stale dependency, not a per-API porting problem.** The standing exposure is
version drift: any WGSL construct newer than the pinned naga fails the same way, silently.
`conformance/registry.json` rows `10-mesh-basic-material` through `24-spot-light` are all
still `planned`; an implemented toon-with-gradient-map row would have caught this before a
game did.

## Defect 2 — native WebGPU errors were invisible

The modern-wgpu `onDeviceError` wrote only to `std::cerr`, which goes nowhere on Android, so
a validation error aborted the process in complete silence. Adapter and device request
failures were equally invisible.

**Fixed in `0d0495c`:** all three paths now log through `__android_log_print`.
`packages/runtime-native/tests/webgpu-error-visibility.test.mjs` fails if either backend
callback shape loses its platform log again.

## Gap — every native game must hand-author its HUD and its controls

Not a defect; the consequence of PRD-051, which decided the framework ships no native HUD.
The DOM HUD in `src/main.ts` is web-only, so desktop and Android rendered the world with no
hearts, no coin count and no clock until the HUD was rebuilt as Three.js geometry parented to
the camera — 330 lines in the game's own `src/render/hud.ts`, including seven-segment digits
because there is no text on canvas, and a thumbstick because there are no touch controls.

That file is what a player sees on every platform now. It is also what every other native
game in this framework will have to write. PRD-054 reopens the decision with this evidence.

## Not claimed

iOS: never executed, no Apple hardware. Physical Android hardware: never executed. Two
simultaneous touches: written, not proven on any platform. Performance: the emulator and
`xvfb` are software rasterisers, so no frame timing here means anything.

## Friction worth recording

- `pnpm install` in a scaffolded project prints
  `Prebuilt release manifest fetch failed for 'linux-x64': HTTP 404`, then succeeds, because
  the runtime is an `optionalDependency`. Both native targets then fail closed at build time.
  Desktop has `THREENATIVE_RUNTIME_BINARY` as an escape hatch; Android has none.
- `packages/runtime-native/android` regenerates its own JS asset from
  `examples/native-smoke`, so a user's game has no route through the APK lane. The first APK
  built here silently shipped the smoke example.
- The Android Gradle build needs JDK 17. Under JDK 26 it fails with the message `26.0.2` and
  nothing else.
- A raw GLSL `ShaderMaterial` renders under `WebGLRenderer` and produces nothing under
  `WebGPURenderer` — the same on web and native, so this is a Three.js fact rather than a
  native break, but it is the kind of thing worth a line beside the existing `CanvasTexture`
  warning in the template `AGENTS.md`.
- A `movement` playtest assertion reports `rawDelta: null` unless the registered entity is an
  `Object3D` or carries `.mesh` / `.object`. It fails closed, which is right; the report does
  not say why.
