---
prd_contract: v1
---

# PRD-473 — Rain: the storm kit (TEMPEST, rebuilt on engine abstractions)

**Status:** IN PROGRESS (planned; no implementation landed)
**Complexity:** 7 → HIGH; risk override: none
**Owner:** João (visual taste calls and the final PR screenshots)
**Depends on:** None

## Context

`/home/joao/Downloads/tempest.html` (718 lines, single file, no assets) is a complete coastal storm
study: volumetric clouds ray-marched through a 3D noise volume, a procedurally ray-marched shoreline
with conifers, street luminaires, a guardrail and a lit cabin, a wet road and sea with real-time
reflections and rain ripples, 16 000 camera-anchored rain streaks, branching lightning with
distance-delayed synthesized thunder, four quality tiers, a full weather panel and synthesized
rain/wind/thunder audio. Every pixel is generated at runtime; the only imagery in the PR will be
captures of the reference and of the kit.

This PRD absorbs every abstraction the source contains into the engine's public vocabulary and
delivers the starter kit `rain`, which reproduces the complete study — not a narrowed subset — using
engine abstractions. Templates live under `packages/create-threenative/templates/<name>` and register
themselves through `kit.json` (`packages/create-threenative/src/index.ts:251`).

### What the source actually contains (read 2026-09-30, complete inventory)

| Group | Source constructs (all of them) |
| --- | --- |
| A. Simulation | seeded mulberry32 `rng`; `clamp`/`mix`; exponential weather easing (τ≈0.67 s); weather record `{rain, cloud, wind, fog, exposure, wet}`; four presets `drizzle/storm/supercell/clearing`; `sanitizeWeather` clamped validation; sim clock with `dt` clamped to 0.08 s; auto-strike scheduler (`nextStrike = t + 8 + rand·16`, gated on `cloud > 0.35`) |
| B. Camera | free-fly state `{position, yaw, pitch}` + `home`; WASD/arrows planar move with diagonal normalisation; `Q`/`E` altitude; `Shift` sprint 23 m/s vs 6 m/s; position clamps `x −100…220, y 1.65…110, z −350…90`; drag-to-look yaw/pitch with pitch clamp `−0.7…1.25`; cinematic orbit mode cancelled by manual input; FOV 55°, aspect from viewport; `basis(yaw,pitch)` forward/right/up |
| C. Render passes | **sky/cloud** reduced-res pass (0.4–0.75×), 32/48/64/88 steps by tier, blue-noise jitter, sky gradient + sun disc/glow + flash term; cloud density from a multiscale 64³ RGBA noise volume, flattened condensation base 145–815 m; 5-tap light march with ×1.7 step growth; multiple-scattering approximation; strike-position cloud glow. **world** SDF raymarch (148 steps, adaptive epsilon): fbm+ridge heightfield, road curve, coast, island, one bounded procedural conifer per spatial cell, six repeating luminaires (pole/neck/lamp + emissive underside), guardrail with posts, cabin with lit window and antenna; ground/water with puddle mask (fbm × wetness), 3×3 hashed expanding ripple rings, micro-bump and wave motion, road stripes/edge lines with wear, water albedo and roughness, Fresnel-weighted reflection, sky-texture-offset reflection plus a 36-step secondary reflection march with emissive lamp hit; hemisphere ambient + sun + six cone point lights with specular + strike-direction flash lighting; height-dependent aerial perspective with advected fbm rain curtains; custom `gl_FragDepth` write for particle depth. **rain**: 16 000 quads in a 66×30×66 volume wrapped to a 12 m camera cell, velocity `(wind·20, −(14…22), wind·2)`, projected stretched quads, near/far opacity fades, flash-lit. **bolt**: additive ribbons with core+halo from branching geometry. **bloom**: 5×5 threshold bright pass at ¼ res. **post**: 12 animated refractive lens droplets near the screen edges, 5-tap luma-edge AA, bloom add, exposure multiply, ACES, cool-shadow/warm-highlight grade, vignette, gamma 2.2, dither. Targets: sky, world+depth, bloom; HDR when `EXT_color_buffer_float`; resolution scale and particle count per tier; identical GLSL behind a Three.js `RawShaderMaterial` (GLSL3) driver and a raw WebGL2 driver |
| D. Audio | rain hiss loop (noise → highpass 1800 / lowpass 11 000) with gain from rain; wind loop (pink noise, 35–350 band) with gain from wind + slow LFO; thunder: 7 s generated buffer = crack `exp(−22t)` + rumble `low·(1−e^{−4t})·e^{−0.66t}` with 9 Hz tremolo, distance lowpass, distance gain, scheduled at `distance / 343`; master gain + compressor; suspend/resume on pause and hidden; mute; pending-voice tracking and clearing; gesture unlock, no autoplay |
| E. Interface | topbar (brand, status dot, panel toggle, pause, capture, fullscreen, help); panel with 3 presets, 4 sliders (`rain` mm/h, `cloud` %, `wind` km/h, `fog` %) with readouts, auto-lightning switch, cinematic switch, strike button; "Rendering & accessibility" details (disable flashes, lens droplets, exposure, surface wetness, renderer/HDR readout); quality select (Performance/Balanced/High/Ultra); hero title block; sound pill; telemetry footer (precipitation, wind, fps) and compass heading; `aria-live` toast; help dialog with Escape/backdrop close and photosensitivity warning; hide-interface + restore button; staged loading overlay with progress text; keys `L X H P F R Space W A S D Q E Shift`, `blur` clears keys; responsive breakpoints at 900 px / 620 px / 800 px height; `prefers-reduced-motion` |
| F. Automation API | `window.tempest`: `setWeather`, `setPreset`, `triggerLightning`, `setSafe`, `render`, `step(dt)`, `setQuality`, `stop`, `capture`, `frames`/`flash`/`sizes`; URL params `?still`, `?offline`, `?quality` |

### Reference captures (root lane, 2026-09-30)

The unchanged `/home/joao/Downloads/tempest.html` was loaded in a headless Chromium via Playwright with
`?still&offline&quality=high` and captured at three viewports: [reference desktop](../../verification/visuals/rain/reference-desktop.png)
(1440×900), [reference tablet](../../verification/visuals/rain/reference-tablet.png) (1024×768) and
[reference mobile](../../verification/visuals/rain/reference-mobile.png) (390×844). These are the **reference only** — no Rain output
has been rendered yet, so no parity, match or gap between them and the kit is claimed anywhere in this
PRD. Phase 3 copies them into the PR beside the kit's own captures taken at the same three viewports.

### Capability lookups actually run (2026-09-30, `threenative-engine-mcp` over `packages/core/capabilities.json`)

Launched from this lane as a stdio MCP server (`node_modules/.bin/tsx packages/engine-mcp/src/index.ts`,
the same entry `threenative-engine-mcp` installs); 1 request-scope search plus 20 mechanic-scope
searches, then `engine_capability_detail` on 20 hits.

| Query (scope) | Result actually returned |
| --- | --- |
| the whole TEMPEST study (`request`) | `RenderChain`, `readRenderChainReport`, `readRenderChainObservation`, `useUiIntent`, `sendUiIntent`, `connectUiBridge`, `publishUiState`, `UiLayer`, `advanceFixedStep`, `assertCaptureNotBlank`, `InstancedBatch` |
| emit GPU particles for falling rain, spray, impact bursts (`mechanic`) | `GPUParticles3D` |
| wet ground, puddle mask, ripple normals, sky reflections (`mechanic`) | `Heightfield`, `WaterSurface3D`, `RippleField`, `ssr` (three addon), `loadTerrainSplat` |
| post chain with bloom, exposure, tone mapping (`mechanic`) | `RenderChain`, `Daylight`, the generated `worldEnvironment` file entry |
| free-fly camera, WASD, drag look, altitude keys (`mechanic`) | `InputMap`, `captureMouse`, `PointerEvents3D`, `defineGame` |
| weather sliders and presets driving render parameters (`mechanic`) | `UiLayer`, `sendUiIntent`, `publishUiState`, `useUiState` |
| ripple rings from impacts on water (`mechanic`) | `RippleField`, `WaterSurface3D` |
| sky, sun and weather (`mechanic`) | `Atmosphere`, `Daylight` |
| quality tiers scaling resolution and step counts (`mechanic`) | `readRenderChainReport`, `readRenderChainObservation`, `Atmosphere` |
| **ray march a 3D noise volume for volumetric clouds** (`mechanic`) | **no results** |
| **upload a 3D data texture and sample it in a shader** (`mechanic`) | **no results** |
| **generate branching lightning ribbon geometry** (`mechanic`) | **no results** (only `UAssetError`, `getPlatform`, `softCircleDataTexture` by lexical accident) |
| **synthesize rain/wind/thunder audio instead of loading files** (`mechanic`) | **no synthesis capability** — `AudioBus` plays buffers, `@threenative/assets` has file passes |
| **honour a reduced-motion preference / reduce flashing** (`mechanic`) | **no results** |
| capture a screenshot as PNG (`mechanic`) | `CanvasLayer`, `GameCanvas` — no download/capture capability |

`GPUParticles3D` constraint: "geometry, color, and timing remain supplied by the game".
`RenderChain` constraint: "stage factories own colour, strength, and all other appearance choices",
"authored stages declare exactly one before or after anchor". `Atmosphere`: "deliberately creates no
mesh, material, or scene light". `AudioBus`: "create buses before playing clips and dispose them
with the game".

## Solution

**Framework owns (packages/):** nothing new. The three empty searches above (ray-march a 3D noise
volume, upload a 3D data texture and sample it, generate branching ribbon geometry) are answered by
**generated kit source**, not by an engine export: `templates/rain/src/render/noise-volume.ts` is a
pure seeded generator — `createRandom` (`random.ts:8`) plus Three's `Data3DTexture` and fBm
accumulation — producing a tiling 64³ volume the kit's own raymarch samples. It is app maths a game
could write portably, it decides a look (root rule 1(b) vetoes 1(a)), and root rule 2 deletes an
abstraction that costs more than plain Three.js. An engine gap is only recorded later, and only if the
rendered kit demonstrates one; until then there is nothing for `packages/core` to own here.
Everything else the study needs already exists: `defineGame` (`game.ts:2124`),
`InputMap` (`input.ts:177`), `createRandom` (`random.ts:8`), `GPUParticles3D` (`particles.ts:12`),
`RenderChain` + `readRenderChainReport` (`render/chain.ts:13`), `Atmosphere`
(`atmosphere/index.ts:93`), `Daylight` (`render/daylight.ts:76`), `Heightfield`
(`world.ts:94`), `WaterSurface3D` (`water-surface.ts:131`), `RippleField` (`ripple-field.ts:50`), `AudioBus`
(`audio.ts:195`, `play` 369, `playAt` 389, `resetAudioCueLedger` 139), `UiLayer`/`useUiState`/
`useUiIntent`, and a WebGL2 fallback renderer the source's own raw driver is superseded by.

**The kit owns (generated source, `templates/rain/src/`):** every appearance decision, as the root
rules require — the seeded 3D noise volume and cloud density and lighting maths, presets and easing,
terrain/props SDF or heightfield
recipe, wetness/puddle/ripple look, rain streak material, bolt geometry and flash envelope, bloom/exposure/
ACES/lens-droplet grade, palette, camera rig, audio DSP baked offline into committed WAV assets, and the
whole interface in `src/ui/` React + Tailwind.

**Not admitted to the framework** (recorded so a later reader does not re-argue): the seeded 3D noise
volume generator (generated render source, app maths — see above), weather presets
(a preset system is outranking rule 5), the flash envelope and bolt generation (pure game maths and
geometry), the quality table (each template already owns one), runtime audio synthesis (native has no
`AudioContext`; the same DSP runs offline into committed assets), lens droplets and the grade (an
authored `RenderChain` stage), and the source's second render backend (the engine already ships one).

### Abstraction map (source → disposition)

| Source abstraction | Disposition |
| --- | --- |
| seeded RNG, clamp/mix easing | `createRandom` + game easing (`state.ts`) |
| camera state, free-fly, drag look, cinematic orbit, FOV | `InputMap` (named actions, `pointerRelative` look, `captureMouse`) + game rig in `src/render/camera.ts` |
| pause / hide UI / fullscreen / capture / toast / help dialog | `game.pause()` + `UiLayer` DOM (`src/ui/`); canvas PNG capture stays web-gated, `playtest` captures everywhere |
| weather state, presets, sliders, readouts, telemetry, compass | game state published through `publishUiState`, UI reads `useUiState`, writes `sendUiIntent` |
| cloud volume + density + light march | generated source `src/render/noise-volume.ts` (seeded fBm into a `Data3DTexture`) + authored raymarch/lighting in `src/render/clouds.ts` over `Atmosphere`/`Daylight`; no engine export |
| sky gradient, sun, haze | `Daylight` + `Atmosphere` parameters authored by the kit |
| terrain height, road, coast, island, trees, luminaires, rail, cabin | `Heightfield` (+ `InstancedBatch` for props) with the kit's recipe |
| wet road, puddles, ripples, reflections | `RippleField` (rings) + `WaterSurface3D` (sea) + authored wetness mask and Fresnel |
| rain streaks | `GPUParticles3D` with a kit-authored sprite material and wrapping volume |
| lightning bolt + flash + strike glow | kit geometry (`src/render/lightning.ts`), flash envelope in kit maths, `CameraShake`/`Daylight` intensity for the scene response |
| bloom, vignette, AA, exposure, ACES, lens droplets, grade | `RenderChain` built-ins (`bloom`, `vignette`, `taa`) + one authored stage anchored after `vignette` |
| quality tiers (resolution, steps, particles, reflections off) | kit `src/render/quality.ts` + `createAdaptiveQuality`, reported by `readRenderChainReport` |
| render targets, depth write, HDR | engine renderer + `RenderChain`; no kit code |
| rain hiss, wind, thunder with distance delay | `AudioBus` + `ctx.assets.audio`, delay computed in kit code as `distance / 343` |
| reduced motion / photosensitivity | kit state read from `matchMedia`, published to the UI switches |

### Repo registration a new kit must make (each one is a gate, not a chore)

`kit.json` (auto-discovery), `src/render/{palette,camera,sky,lighting,materials,postprocessing}.ts`
(`scripts/visual-gate.ts:29`), cost comments beside every tier-enabled stage and no preset literals in
the render layer (`scripts/check-template-quality.ts`), a row in the applicability table at
`docs/verification/PRD-289-conventions-2026-08-31.md` (`scripts/check-template-conventions.ts:14`), a
`rain` brief in `scripts/capability-recall.ts:120`, `.github/workflows/ci.yml` matrices
(`template-nonvisual`, `golden-path-template`), a README/docs row (`primary-docs`), a committed frame
and score in `docs/verification/visuals/`, and `native-playtests/*.playtest.json`.

## Acceptance Criteria

- [ ] AC-1 [local]: a project scaffolded from `--template rain` boots into the storm and one panel intent changes the rendered frame, not only the readout. proof: `node packages/playtest/dist/runner/cli.js
  packages/create-threenative/templates/rain/playtests/storm.playtest.json --url http://127.0.0.1:5173
  --server-command "pnpm --filter rain dev" --browser-recipe webgpu`
- [ ] AC-2 [local]: a strike raises the flash value, brightens the scene and lands a `thunder` cue in the audio ledger at the source delay, while `safe` and `prefers-reduced-motion` suppress every flash. proof: the same runner on `playtests/lightning.playtest.json`
- [ ] AC-3 [local]: rain is registered everywhere a template must be registered — CI matrices, capability-recall brief, applicability row, docs, visual score. proof: `pnpm budgets && pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts
  scripts/__tests__/primary-docs.spec.ts scripts/__tests__/check-template-conventions.spec.ts`
- [ ] AC-4 [local]: every row of the source inventory above (A simulation, B camera, C render passes, D audio, E interface, F automation API) is present in the rendered kit, checked one row at a time rather than by assertion. proof: a line per inventory row in the PR body naming where the kit realises it, each paired with the playtest observation or capture that shows it
- [ ] AC-5 [local]: the kit is captured at the same three viewports as the reference and the PR embeds both sets side by side, stating the comparison the owner actually sees — including any row where it differs, with nothing inferred. proof: the three `docs/verification/visuals/rain/reference-*.png` files and the kit's own desktop/tablet/mobile captures uploaded in the PR body at 1440×900, 1024×768 and 390×844

## Blocked on

Nothing is blocked. The earlier claim that `pnpm native:build` could not reach `api.github.com` was
unproven — GitHub is reachable from the root checkout — so it is recorded as a decision below rather
than as a blocker. The desktop-native proof stays **required and unrun**: no `--target desktop` result
exists for `native-playtests/lightning.playtest.json`, and Phase 3 does not close until that run is
green.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Kit registration | `npx threenative create --template rain` → `packages/create-threenative/src/index.ts:251` | new kit, no incumbent | AC-1 |
| Weather control surface | UI slider/preset → `sendUiIntent` → `game.ui.onIntent` in `src/game.ts` → `Atmosphere`/`RippleField`/`GPUParticles3D` uniforms | replaces the source's inline DOM handlers | AC-1, AC-3 |
| Volumetric noise volume | generated source `templates/rain/src/render/noise-volume.ts` (`createRandom` + `Data3DTexture`) consumed by `src/render/clouds.ts` | generated kit source; generated-source capability entries point to the kit files | Phase 2 box |
| Storm post chain | `src/render/postprocessing.ts` → `RenderChain` built-ins + one authored stage | replaces the source's single POST pass | Phase 1 box |
| Storm audio | `src/audio/storm.ts` → `AudioBus.play`/`playAt` over `ctx.assets.audio` | replaces the source's `StormAudio` Web Audio graph | AC-2 |
| Capture proof | playtest `capture` assertions and PR screenshots | replaces the source's `window.tempest.capture` | AC-1, Phase 3 box |

## Decisions

- 2026-09-30 (agent, this PRD): the seeded 3D noise volume generator is **generated kit source**, not a
  `packages/core` export. A previous pass proposed `createNoiseVolume3D` plus a core unit test; that is
  deleted here — it is app maths a game could write portably, it decides a look, and it costs more as an
  export than as a template file. Capability discovery moves to the kit's own brief in
  `scripts/capability-recall.ts:120`, and the proof of it is a full rendered scene, not a texture unit
  test. Any real platform gap that the rendered kit demonstrates later gets its own PRD line then.
- 2026-09-30 (agent): the earlier `## Blocked on` entry claiming `api.github.com` was unreachable is
  withdrawn as unproven — GitHub is reachable from the root checkout. The desktop-native run is therefore
  simply not attempted yet: required, **unrun**, and not a blocker.
- 2026-09-30 (agent, this PRD): runtime audio synthesis is not portable — the native host stubs
  `window`, and `AudioContext` does not exist there. The same DSP is therefore baked offline by
  `templates/rain/tools/` into committed WAV assets and played through `AudioBus`; the distance delay
  is kit code, because the bus schedules no delay.
- 2026-09-30 (agent): the source's raw-WebGL2 second driver is withdrawn. `packages/core/src/renderer.ts:16`
  already models `RendererKind = "webgpu" | "webgl2"`, so a second driver would be re-implementing an
  engine capability.
- 2026-09-30 (agent): the source's `canvas.toDataURL` screenshot button is kept web-gated; every target's
  still image comes from the playtest capture path, which already runs on device targets.

## Execution Phases

### Phase 1 — The kit exists and the storm answers the player

**Status:** NOT STARTED
**Files:** `packages/create-threenative/templates/rain/{kit.json,package.json,tsconfig.json,vite.config.ts,threenative.config.ts,index.html,gitignore,AGENTS.md}` ·
`src/{main.tsx,game.ts,state.ts,conventions.ts,scenes/Storm.ts}` ·
`src/render/{palette,camera,sky,lighting,materials,postprocessing,quality}.ts` ·
`src/ui/{App,GameUi,StormPanel,Telemetry,HelpDialog,LoadingOverlay}.tsx` ·
`playtests/storm.playtest.json` · `.github/workflows/ci.yml` matrices ·
`scripts/capability-recall.ts` · `docs/verification/PRD-289-conventions-2026-08-31.md` · `README.md`
**Implementation:** `defineGame` with a published weather record, a named input map (move/altitude/
sprint/strike/pause/reset/hide/capture), the free-fly rig with the source's clamps and cinematic orbit,
`RenderChain` with bloom+vignette and the authored exposure/ACES/lens-droplet stage anchored after
`vignette`, the panel/sliders/presets/switches/telemetry/help/loading in `src/ui/`, and the four quality
tiers with a measured cost comment per stage.
**Verification:** the AC-1 command — the playtest asserts clean diagnostics, a weather resource that
changed after an intent, a non-blank capture, and fps/draw-call bounds.

- [ ] Phase 1: the scaffolded rain kit boots into a storm whose panel, presets and fly camera change the rendered frame. proof: AC-1 command above, plus `pnpm exec tsx scripts/visual-gate.ts --structural-only` and
  `pnpm exec tsx scripts/check-template-quality.ts`

### Phase 2 — Sky, sea and rain: the look, built from generated source

**Status:** NOT STARTED
**Files:** `templates/rain/src/render/{noise-volume,clouds,sea,wetRoad,rain}.ts` ·
`templates/rain/playtests/tiers.playtest.json` · `scripts/capability-recall.ts` (`rain` brief) ·
`docs/verification/visuals/rain.png` + `scores.json` · regenerated capability manifests
**Implementation:** the seeded fBm noise volume in generated source, the volumetric cloud pass ray-marched
through it over `Atmosphere`/`Daylight`; the coast and sea through `Heightfield` + `WaterSurface3D` with
the kit's wetness and Fresnel look; rain ripples through `RippleField`; rain streaks through
`GPUParticles3D` with a kit-authored stretched-sprite material; per-tier step counts, particle counts and
reflection on/off, matching the source's table. No `packages/core` file changes in this phase.
**Verification:** the tier scenario at the high and low ends (bounds inside the source's ratios) with
its captures read as one full scene, not a texture unit test — the volume is only proven by the image it
produces.

- [ ] Phase 2: the cloud volume, sea, wet road and rain streaks render at every tier inside the declared bounds, from generated source rather than a new engine export. proof: `pnpm exec tsx scripts/check-template-quality.ts`; `pnpm build` regenerates the manifests; `engine_search_capabilities` and `engine_capability_detail` find the extracted Rain abstractions at valid generated-source paths, exercised by the `rain` brief in `scripts/capability-recall.ts`; and
  node packages/playtest/dist/runner/cli.js
  packages/create-threenative/templates/rain/playtests/tiers.playtest.json --url http://127.0.0.1:5173
  --server-command "pnpm --filter rain dev" --browser-recipe webgpu
  captured at the low and high tiers

### Phase 3 — Lightning, thunder, and the finished study

**Status:** NOT STARTED
**Files:** `templates/rain/src/render/lightning.ts` · `src/audio/storm.ts` ·
`tools/make-storm-audio.mjs` + `assets/{rain,wind,thunder}.wav` · `src/ui/` accessibility switches ·
`native-playtests/lightning.playtest.json` · PR body with the reference and kit captures
**Implementation:** bolt geometry and the flash envelope from the source; the strike's scene light,
cloud glow and `distance / 343` thunder cue; auto-strike scheduling gated on cloud cover; the safety
switches and reduced-motion default; the offline audio bake running the source's own DSP.
**Verification:** the lightning scenario on the browser recipe, the desktop-native parity run for the
same scenario (**unrun — no `--target desktop` result exists yet**), and the two capture sets embedded
in the PR.

- [ ] Phase 3: a strike flashes the sky, lights the scene and schedules its thunder, the safety switches suppress it, and the same scenario passes natively. proof: the `--target browser` and `--target desktop` runs of
  `packages/create-threenative/templates/rain/playtests/lightning.playtest.json` (both currently UNRUN)