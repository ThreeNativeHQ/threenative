# PRD-251 Phase 0 — reference, floor, and ownership decision

Date: 2026-08-30
Engine baseline: `982625c3`
Worktree: `feature-mining-prd251-phase0-20260830`
Reference: `imsarah/threejs-world` commit `398320e9bcf74bf4c15532fafff4c565f7729b37`
Licence: MIT, copyright 2026 Remi Sebastian Kits

## Outcome

Phase 0 passes after replacing four invalid draft metrics and completing the repository checkpoint.
No product code exists.

- The reference field was exported twice from its final GPU readback. Both 1,024² little-endian
  Float32 artifacts are 4,194,304 bytes with SHA-256
  `922daf19b9d20f43c8ab804550a511c9194df8d71f78b7396932c812c18e3476`.
- The measured target at pinned HEAD is a 1,024 m miniature: 1,024² final height, 512²
  erosion/hydrology, 640 erosion iterations, 2,048 maximum resident CDLOD tiles, 65 vertices per
  tile edge and a 64 m normal minimum tile.
- The implementation location is `@threenative/core/world`, not a new package. PRD-250 exposes
  the standard platform `Worker`; it is not a JavaScript dependency. A package cannot be justified
  by bundle size when rule 5 allows packages only to isolate dependencies. The independent
  side-effect-free subpath must add exactly 0 bytes to a world-free consumer.
- Erosion and hydrology remain conditional. The exported reference is deterministic, but the
  SwiftShader measurement took about two minutes and the inspected reference frame contains severe
  terracing and near-vertical carved walls. Phase 2 must beat synthesis alone on three corrected
  metrics within both browser and native dispatch budgets.

## Detached measurement

Sandbox: `/home/joao/projects/threenative/sandbox-runs/prd251-phase0-20260830`

The pinned source was cloned outside the engine. Its only patch exposes `hf.cpuHeights` after
`Heightfield.generate()` and returns before vegetation, terrain materials, tiles or the frame loop.
`npm run typecheck` passed after instrumentation. The first run exposed an upstream timestamp-query
failure loop on SwiftShader after the field was ready; the measurement path was then stopped before
the frame loop, and the second export completed without that noise.

Adapter reported by the reference launcher: Google SwiftShader, WebGPU, 1,280×720. This is reference
data proof only, not native or discrete-GPU performance proof.

## Metric definitions and measured floor

All field metrics use an identical 1,024 m square at 1 m samples. The incumbent is the exact
`sin(x*0.045)*1.5 + cos(z*0.08)*0.75` function sampled on that grid. Power slope fits wavelengths
8–256 m. Drainage uses D8 and a 2,048 m² channel threshold.

| Gate | Pass condition | PRD-043 | Pinned reference |
| --- | ---: | ---: | ---: |
| derivative isotropy | `abs(log(ratio)) ≤ 0.1` | 0.255 fail | 0.054 pass |
| broadband power β | 2.5–5.0 | 10.190 fail | 3.888 pass |
| relief / field edge | ≥0.1 | 0.0044 fail | 0.4392 pass |
| median 64 m relief / global | ≤0.25 | 0.9136 fail | 0.0576 pass |
| max Strahler order | ≥5 | 3 fail | 7 pass |
| curvature excess kurtosis | ≥5 | −0.385 fail | 65.341 pass |
| effective vertices/km² | ≥500,000 | 19,775 fail | 1,031,494 pass |
| slope fraction above 30° | ≥0.1 | 0 fail | 0.6915 pass |

The draft metrics were tested before replacement:

| Invalid draft claim | PRD-043 | Reference | Why removed |
| --- | ---: | ---: | --- |
| 256-bin entropy should reject the sine | 7.956 bits | 6.411 bits | incumbent scored higher |
| reference should have fewer D8 sinks | 93.8/km² | 4,892.4/km² | final detail field makes many micro-sinks |
| incumbent stream order is 1 | 3 | 7 | claim was false; threshold corrected to ≥5 |
| eroded profile-curvature skew is negative | ~0 | +1.170 | reference contradicted the sign claim |

Green command: `python measure_fields.py`, exit 0, eight checks true.
Seeded red: `PRD251_MUTATE_REFERENCE=incumbent python measure_fields.py`, exit 1, seven checks false.
The density check remained true because the mutation replaced field values, not the declared reference
mesh density; the overall gate still failed closed.

## Visual inspection

Inspected `shots/phase-1/erosion-split.png` from the pinned commit at original resolution. It shows
large-scale mountain, valley and plateau structure plus dense drainage. It also shows conspicuous
terracing, repeated horizontal contour bands, over-steep carved walls and hard-edged pits. The frame
supports mining field/pass structure but vetoes treating upstream appearance as acceptance.

## Ownership and borrow verdict

- Mine: one field owner, ordered pass orchestration, deterministic seed streams, CPU readback from
  the rendered field, explicit error-biased split, morph and skirt invariants.
- Adapt: hydraulic dispatch structure and numeric flow outputs, only after the Phase 2 cost/quality
  kill gate.
- Refuse: every macro anchor/floor, material, colour, displacement choice, named preset, biome/snow
  policy, scatter/species policy, far-shell appearance and render-water policy.
- Core subpath: the standard `Worker` is supplied by the platform seam and creates no exclusive
  npm dependency. Phase 1's world-free bundle check is a zero-byte invariant.

## LOC baseline

```text
platformer template LOC: 1955
generated HUD LOC: 61 (geometry HUD 69)
```

Command: `pnpm tsx scripts/count-loc.ts`, exit 0. The script has no world comparator yet; Phase 1
must add a real repeated-game comparison before the rule-2 kill switch can pass.

## Verification limits

No engine capability, public export, playtest, native result or mobile result exists in Phase 0.
The detached sandbox validates only the reference read, deterministic field export, metric
discrimination, visual provenance and ownership decision. The mandatory automated
`prd-work-reviewer` agent is not exposed in this Codex runtime; the integration ledger was checked
manually and remains unchanged because Phase 0 adds no public surface.

## Repository checkpoint

- `pnpm build`: exit 0.
- `pnpm typecheck`: exit 0 after the build populated fresh-worktree package outputs.
- `pnpm lint`: exit 0 with the repository's existing 455 warning diagnostics.
- `pnpm --filter @threenative/runtime-native test`: exit 0; 88 test files passed, 628 tests passed,
  34 skipped; TypeScript physics parity passed 28/28, Rust library tests 13/13 and Rust parity 2/2.
- `pnpm typecheck && pnpm lint && pnpm test`: exit 0. The final unit stage passed 264 test files
  with one skipped, 2,647 tests with three skipped; package build, publication and native contract
  stages also passed.

Repair attempt 1 ran `pnpm native:build`; it completed and built the shipping V8 host. Repair
attempt 2 built both required V8 test executables, then QuickJS configuration failed because system
CMake could not find Ninja. Repair attempt 3 used the runtime-owned CMake and Ninja, but passed Ninja
as a relative path; CMake's nested try-compile resolved it from the build directory and reported
`no such file or directory`. The successful repair configured QuickJS with absolute paths to the
runtime-owned CMake and Ninja executables and built `threenative-timestamp-query-test`. The runtime
package and the full repository gate then passed.

## Complete pinned command output

The following is the complete output required by Phase 0 gate 0.1. It is read from git objects, not
from the unusable original working tree.

### `README.md`

````text
# threejs-world

*Built on top of **LAAS**, a fully procedural WebGPU world generated almost entirely by an AI from a one-page brief. (laas — Estonian for old-growth forest.)*

![Procedural open world rendered in the browser](docs/readme-hero.jpg)

Unedited engine output. Every mesh, texture, and light in this frame is generated by code at boot — the repository contains no image, model, or audio assets.

threejs-world is a fully procedural open world running in the browser on WebGPU: three.js `WebGPURenderer` with TSL materials and raw WGSL compute, TypeScript strict with zero `any`, no WebGL fallback. The entire world is reproducible from a single URL parameter (`?seed=N`). It builds on the LAAS engine (the original experiment is described below).

## Building on top

This repository takes the LAAS engine (the original experiment is described below) as a foundation and builds on top of it. Work added in this fork:

- **1/4-scale miniature world** — the full composition reproduced at 1024 m instead of 4 km via a single `WORLD_SCALE` knob in `src/world/WorldConst.ts` (a true uniform scale, so it looks the same but boots faster and is a more workable space). Set `WORLD_SCALE = 1` to restore full size; the original is also preserved at the git tag `full-world-4096`. The vegetation/tri counts quoted below describe the full-size upstream world and scale down with it.
- **Lightweight mobile scene** — a separate WebGL2 entry (`mobile.html`) that runs on phones: a compact terrain with instanced low-poly trees and a grass meadow, explored first-person with touch controls. It reuses the engine's pure-three geometry builders but ships none of the WebGPU/compute stack (the main world is WebGPU-only and gated to desktop).
- **Homepage chooser** — the landing page offers a **Desktop** (full WebGPU world) or **Mobile** (WebGL2 scene) entry.
- **Next up** — a model editor layered on the miniature world.

Everything below documents the upstream engine and the experiment that produced it.

## The experiment

The goal of this project is to test the capabilities of Claude Fable 5, Anthropic's newest model. This repository was built roughly 99% by the model, with minimal human steering:

- The human partially wrote one document: [PROJECT_LAAS_v2.md](PROJECT_LAAS_v2.md) — the brief. It sets the visual bar (UE5-class reference frames), hard floors (triangle counts, system list, world size), and banned outcomes (black shadows, cloned trees, fog as cover). It deliberately does not say how to build any of it.
- Everything else was planned and executed by Fable 5 across long autonomous sessions: the architecture, all engine and world systems, the verification tooling, the debugging, the working notes, and this README.
- Human input is limited to rare feedback on the things a model cannot judge well from static output: whether motion effects feel right, whether interactive performance holds up, whether an artifact is visible while moving. Examples from the log: wind sway amplitude, walk-camera bob, cloud motion lagging the camera, water coverage taste.

The model does its own QA. It boots the world headless (Playwright driving Chromium with a WebGPU/Metal adapter), takes screenshots, samples pixels, diffs frames against baselines with frame-aligned determinism, profiles GPU passes per encoder, and writes regression probes for the bugs it finds. The diagnosis logs, measurements, and decisions live in [STATUS.md](STATUS.md), which serves as the model's durable memory between sessions.

Current state: about 21,000 lines of strict TypeScript across 90+ commits, all phases of the brief built, with an ongoing performance pass. Known open issues are tracked at the top of STATUS.md.

## What is in the world

- Terrain: 4096² heightfield synthesis, pipe-model hydraulic plus thermal erosion, flow-accumulation rivers carving real channels into lakes with outlets, moisture and biome classification, slope- and exposure-driven snow. CDLOD quadtree meshing with crack-free skirts and far-shell detail synthesis to a 4 km+ visible range.
- Vegetation: six tree species grown by a procedural branching grammar with per-instance uniqueness (no two trees share a mesh), cluster-card foliage baked from real generated leaf geometry, octahedral impostors, three shrub classes, ferns, flowering plants, deadfall with decay states. Around 190,000 trees and 450,000 understory instances are placed by GPU clustered-Poisson scatter and culled per frame into compacted indirect draws; meadows render roughly a million grass blades.
- Lighting: four-cascade shadow maps with PCSS and screen-space contact shadows, a terrain-relative irradiance-probe field for GI, GTAO, screen-space bounce, foliage translucency. A no-black-shadows rule is enforced by automated pixel sampling.
- Atmosphere: Hillaire LUT atmosphere driving sky, aerial perspective and light color; raymarched volumetric clouds with cloud shadows; froxel volumetrics for canopy light shafts and valley fog.
- Water: stream and lake surfaces on a camera-following clipmap, screen-space reflections with terrain-aware fallbacks, analytic caustics, obstacle foam, wet margins.
- Motion: hierarchical wind through every plant, 131,072 GPU particles (snow, pollen, drifting leaves), drifting and churning cloud fields.
- Post: temporal AA with analytic camera-reprojection velocity, bloom, GPU auto-exposure, per-time-of-day filmic grade.
- Exploration: walk mode with gravity, jumping, sprint and stride-matched camera motion; free-fly mode; nine composed bookmarks; a 90-second flythrough.

## Running it

```
npm install
npm run dev
```

`npm run dev` prints a local URL (the port is chosen dynamically). Opening it shows a chooser:

- **Desktop** — the full WebGPU world. Requires Google Chrome 113 or newer (or another Chromium browser: Edge, Brave, Arc, Opera) on a desktop or laptop. Safari and Firefox are not supported — the engine is built and tested against Chrome's WebGPU implementation, and the page detects this before loading and says so. There is no WebGL fallback by design: if Chrome is present but WebGPU is unavailable, the page fails loudly with diagnostics and the exact things to check (hardware acceleration, `chrome://gpu`, browser version).
- **Mobile** — the lightweight WebGL2 scene at `/mobile.html`, which runs on phones and any modern browser; hold the device in landscape. To open it on a phone, expose the dev server with `npm run dev -- --host` and browse to `http://<your-LAN-IP>:<port>/mobile.html`.

Deep links and the screenshot tooling carry a query string (`?scene=`, `?cam=`, `?shot=`, …) and boot straight into the desktop world, skipping the chooser.

Desktop controls: click to capture the mouse. WASD to move, Shift to sprint, Space to jump, V toggles walk/fly, mouse wheel sets fly speed, E/Q move vertically in fly mode. Keys 1–9 jump to composed bookmarks, F starts the flythrough, F3 opens the debug HUD with per-pass GPU timings, P prints the current camera pose as a `?cam=` string. Mobile controls: left half of the screen moves, right half looks.

Useful URL parameters: `?seed=N` (world seed), `?T=hours` (time of day, 0–24), `?shot=1..9` (boot into a bookmark), `?cam=x,y,z,yaw,pitch[,fov]` (exact pose), `?preset=low|high|ultra`, `?freeze=1` (freeze world motion), `?hud=1` (HUD open at boot).

## Deploying

`npm run build` produces a static site in `dist/`, so any static host works. Asset URLs are served from the domain root — `base` is `/` in [vite.config.ts](vite.config.ts); for a subpath deploy (e.g. GitHub Pages under `/laas/`) set it to that subpath instead.

**Vercel:** import the repo and set Framework Preset **Vite**, Build Command **`npm run build`**, Output Directory **`dist`** (or run `vercel --prod` from the project root). Two static pages ship — `/` (the Desktop/Mobile chooser) and `/mobile.html` (the mobile scene) — so no rewrites are needed. Vercel serves over HTTPS, which satisfies WebGPU's secure-context requirement, so the desktop world runs in desktop Chrome; phone visitors get the mobile scene.

## Repository map

| Path | What it is |
|---|---|
| `PROJECT_LAAS_v2.md` | The brief. The only human-authored document in the repository. |
| `STATUS.md` | The model's working memory: current state, diagnosis logs, measurements, decision history. |
| `docs/THREE-NOTES.md` | Verified three.js/TSL/WebGPU API notes the model accumulated against the pinned version. |
| `docs/DELTA.md`, `docs/DEVIATIONS.md` | Reference-comparison loops per phase, and spec deviations with reasons. |
| `src/` | Engine and world: `core/`, `gpu/`, `world/`, `vegetation/`, `render/`, `sky/`, `debug/`. |
| `mobile.html`, `src/mobile/` | The fork's lightweight WebGL2 mobile scene (separate entry; no WebGPU). |
| `tools/` | The model's verification harness: headless WebGPU screenshots, image comparison, pixel sampling, GPU profiling, bug-specific probes. |
| `reference/` | The reference frames the world is judged against. |
````

### `src/world/Heightfield.ts`

````text
/**
 * Heightfield — owner of all terrain GPU state. Orchestrates the generation
 * passes (synthesis → erosion → hydrology → classification) and exposes
 * buffers/textures + TSL sampling helpers to the rest of the engine.
 *
 * Layout: row-major res×res grids; texel (x,y) ↔ world
 * ((x+0.5)/res − 0.5)·WORLD_SIZE on both axes (x→world x, y→world z).
 */

import { FloatType, HalfFloatType, NearestFilter, RedFormat } from 'three';
import type { ComputeNode, Renderer } from 'three/webgpu';
import { StorageTexture } from 'three/webgpu';
import {
  Fn,
  If,
  Return,
  clamp,
  float,
  floor,
  fract,
  instanceIndex,
  instancedArray,
  mix,
  texture,
  textureStore,
  uvec2,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { LaasParams } from '../core/Params';
import type { WorldSeed } from '../core/Seed';
import { bilerpFloatBuffer, uvToGrid } from '../gpu/BufferSample';
import { bakeNoiseTextures } from '../gpu/passes/NoiseBake';
import type { NF, NI, NV2, NV3 } from '../gpu/TSLTypes';
import { runBiomeSnow } from '../gpu/passes/BiomeSnow';
import { runErosion } from '../gpu/passes/Erosion';
import { runFlowRivers, type FlowResult } from '../gpu/passes/FlowRivers';
import {
  runHeightSynthesis,
  type FloatBuffer,
  type SynthesisResult,
} from '../gpu/passes/HeightSynthesis';
import { makeMacroParams, type MacroParams } from './MacroMap';
import { WORLD_SIZE, qualityConfig, type QualityConfig } from './WorldConst';

export type ProgressFn = (p: number, msg: string) => void;

export class Heightfield {
  readonly cfg: QualityConfig;
  readonly mp: MacroParams;
  readonly res: number;

  /** final height (m), res×res storage buffer — single source of truth */
  readonly height: SynthesisResult['height'];
  readonly hardness: SynthesisResult['hardness'];
  /** pre-erosion copy kept for the ?scene=terrain split view */
  preErosion: FloatBuffer | null = null;
  /** erosion by-products at sim res (moisture/soil hints for later passes) */
  simWater: FloatBuffer | null = null;
  simSediment: FloatBuffer | null = null;
  simRes = 0;
  /** hydrology outputs at sim res */
  flow: FlowResult | null = null;
  /** renderable water surface (m) at sim res: carved bed + riverDepth at
   *  water cells; DRY cells hold simBed − 2 so bilinear shorelines cut
   *  below the banks (f32 buffer — f16 textures quantize ~1 m up here) */
  waterY: FloatBuffer | null = null;
  /** min-reduced waterY (simRes/8) for FAR clipmap levels: coarse vertices
   *  sampling the full field stretch one wet texel across a whole 48 m
   *  cell — "mountains half covered in water" from afar. The min makes
   *  distance conservative: narrow channels vanish, lakes survive. */
  waterYFar: FloatBuffer | null = null;
  waterFarRes = 0;
  /** rgba16f at sim res: moisture, flowStrength, riverDepth, waterSurface W */
  fieldsTex: StorageTexture | null = null;
  /** rgba8 at full res: biomeId/8, snow, vegDensity, rockExposure */
  biomeTex: StorageTexture | null = null;
  /** CPU height mirror for camera clamping / tools (filled by readback) */
  cpuHeights: Float32Array | null = null;
  /** CPU waterY mirror (sim res) — underwater camera guard */
  cpuWaterY: Float32Array | null = null;

  /** r32float height texture (nearest-sample / textureLoad only) */
  readonly heightTex: StorageTexture;
  /** rgba16f: xyz = world-space normal, w = slope (rise/run) */
  readonly normalTex: StorageTexture;
  /** baked tileable noise (see NoiseBake channel map) — materials sample these */
  noiseA: StorageTexture | null = null;
  noiseB: StorageTexture | null = null;

  private constructor(
    cfg: QualityConfig,
    mp: MacroParams,
    synth: SynthesisResult,
    heightTex: StorageTexture,
    normalTex: StorageTexture,
  ) {
    this.cfg = cfg;
    this.mp = mp;
    this.res = synth.res;
    this.height = synth.height;
    this.hardness = synth.hardness;
    this.heightTex = heightTex;
    this.normalTex = normalTex;
  }

  static async generate(
    renderer: Renderer,
    params: LaasParams,
    seed: WorldSeed,
    progress: ProgressFn,
  ): Promise<Heightfield> {
    const cfg = qualityConfig(params.preset);
    const mp = makeMacroParams(seed);

    progress(0.04, `terrain: synthesizing ${cfg.heightRes}² heightfield`);
    const synth = await runHeightSynthesis(renderer, cfg.heightRes, mp);

    const heightTex = new StorageTexture(cfg.heightRes, cfg.heightRes);
    heightTex.type = FloatType;
    heightTex.format = RedFormat;
    heightTex.magFilter = NearestFilter;
    heightTex.minFilter = NearestFilter;
    heightTex.generateMipmaps = false;

    const normalTex = new StorageTexture(cfg.heightRes, cfg.heightRes);
    normalTex.type = HalfFloatType;
    normalTex.generateMipmaps = false;

    const hf = new Heightfield(cfg, mp, synth, heightTex, normalTex);

    const noise = await bakeNoiseTextures(renderer);
    hf.noiseA = noise.texA;
    hf.noiseB = noise.texB;

    // --- erosion at sim res, then detail-preserving compose back to full res --
    progress(0.08, `terrain: synthesizing ${cfg.simRes}² erosion grid`);
    const synthSim = await runHeightSynthesis(renderer, cfg.simRes, mp);

    progress(0.1, `terrain: eroding (${cfg.erosionIters} iterations)`);
    const erosion = await runErosion(renderer, synthSim.height, synthSim.hardness, {
      res: cfg.simRes,
      texel: WORLD_SIZE / cfg.simRes,
      iters: cfg.erosionIters,
      onProgress: (d, t) => progress(0.1 + 0.45 * (d / t), `terrain: eroding ${d}/${t}`),
    });
    hf.simWater = erosion.water;
    hf.simSediment = erosion.sediment;
    hf.simRes = cfg.simRes;

    // hydrology BEFORE compose: river carve must reach the full-res field
    hf.flow = await runFlowRivers(renderer, erosion.eroded, erosion.water, {
      res: cfg.simRes,
      texel: WORLD_SIZE / cfg.simRes,
      seed: seed.sub('hydrology'),
      mp,
      hardness: synthSim.hardness,
      onProgress: (msg, frac) => progress(0.55 + frac * 0.12, msg),
    });

    // water render surface from the CARVED sim bed (runFlowRivers mutates
    // erosion.eroded in place: carve + talus relax)
    hf.waterY = await Heightfield.buildWaterY(
      renderer,
      erosion.eroded,
      hf.flow.waterYRaw,
      cfg.simRes,
    );
    hf.waterFarRes = Math.floor(cfg.simRes / 8);
    hf.waterYFar = await Heightfield.reduceWaterY(renderer, hf.waterY, cfg.simRes, 8);

    progress(0.7, 'terrain: composing eroded field');
    await hf.composeEroded(renderer, synthSim.height, erosion.eroded);

    progress(0.82, 'terrain: deriving maps');
    await hf.rebuildDerivedMaps(renderer);
    await hf.buildFieldsTex(renderer);

    progress(0.88, 'terrain: biome + snow classification');
    if (!hf.fieldsTex) throw new Error('fieldsTex missing before biome pass');
    hf.biomeTex = await runBiomeSnow(renderer, hf.height, {
      res: hf.res,
      mp,
      normalTex: hf.normalTex,
      fieldsTex: hf.fieldsTex,
    });

    progress(0.93, 'terrain: height readback for camera');
    const ab = await renderer.getArrayBufferAsync(hf.height.value);
    hf.cpuHeights = new Float32Array(ab);
    const wab = await renderer.getArrayBufferAsync(hf.waterY.value);
    hf.cpuWaterY = new Float32Array(wab);
    return hf;
  }

  /** CPU height lookup (bilinear) — camera clamping, bookmarks, tools */
  heightAtCpu(x: number, z: number): number {
    const hts = this.cpuHeights;
    if (!hts) return 0;
    const res = this.res;
    const gx = Math.min(Math.max(((x / WORLD_SIZE) + 0.5) * res - 0.5, 0), res - 1.001);
    const gz = Math.min(Math.max(((z / WORLD_SIZE) + 0.5) * res - 0.5, 0), res - 1.001);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;
    const i = (xx: number, zz: number): number => hts[Math.min(zz, res - 1) * res + Math.min(xx, res - 1)] ?? 0;
    const a = i(x0, z0) * (1 - fx) + i(x0 + 1, z0) * fx;
    const b = i(x0, z0 + 1) * (1 - fx) + i(x0 + 1, z0 + 1) * fx;
    return a * (1 - fz) + b * fz;
  }

  /** CPU waterY lookup (bilinear, sim res) — dry cells sit ~2 m below the
   *  bed, so `max(ground, waterYAtCpu + ε)` is a safe camera floor */
  waterYAtCpu(x: number, z: number): number {
    const wy = this.cpuWaterY;
    if (!wy) return -1e4;
    const res = this.simRes;
    const gx = Math.min(Math.max(((x / WORLD_SIZE) + 0.5) * res - 0.5, 0), res - 1.001);
    const gz = Math.min(Math.max(((z / WORLD_SIZE) + 0.5) * res - 0.5, 0), res - 1.001);
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const fx = gx - x0;
    const fz = gz - z0;
    const i = (xx: number, zz: number): number => wy[Math.min(zz, res - 1) * res + Math.min(xx, res - 1)] ?? -1e4;
    const a = i(x0, z0) * (1 - fx) + i(x0 + 1, z0) * fx;
    const b = i(x0, z0 + 1) * (1 - fx) + i(x0 + 1, z0 + 1) * fx;
    return a * (1 - fz) + b * fz;
  }

  private static async buildWaterY(
    renderer: Renderer,
    bed: FloatBuffer,
    waterYRaw: FloatBuffer,
    res: number,
  ): Promise<FloatBuffer> {
    const out = instancedArray(res * res, 'float');
    const wet = instancedArray(res * res, 'float');
    const kernel = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(res * res), () => {
        Return();
      });
      // Hydrology already decided where open water exists (waterYRaw: pond
      // fill level / river surface / −1e4 dry sentinel). Here: encode DRY
      // cells as 3×3 NEIGHBORHOOD-MIN bed − 2 — a raised bank texel at
      // bankBed−2 can still sit ABOVE the channel's water level, and the
      // bilinear then builds standing water walls up every bank (user-
      // reported "spikes"). With the min, wet→dry spans always cross under
      // the waterline.
      const x = i.mod(res).toInt();
      const y = i.div(res).toInt();
      const xm = clamp(float(x).sub(1), 0, res - 1).toInt();
      const xp = clamp(float(x).add(1), 0, res - 1).toInt();
      const ym = clamp(float(y).sub(1), 0, res - 1).toInt();
      const yp = clamp(float(y).add(1), 0, res - 1).toInt();
      const b = bed.element(i).toVar();
      const hl = bed.element(y.mul(res).add(xm)).toVar();
      const hr = bed.element(y.mul(res).add(xp)).toVar();
      const hd = bed.element(ym.mul(res).add(x)).toVar();
      const hu = bed.element(yp.mul(res).add(x)).toVar();
      const d00 = bed.element(ym.mul(res).add(xm));
      const d10 = bed.element(ym.mul(res).add(xp));
      const d01 = bed.element(yp.mul(res).add(xm));
      const d11 = bed.element(yp.mul(res).add(xp));
      const bMin = b
        .min(hl).min(hr).min(hd).min(hu)
        .min(d00).min(d10).min(d01).min(d11);
      const raw = waterYRaw.element(i);
      const isWet = raw.greaterThan(-1e3);
      wet.element(i).assign(isWet.select(float(1), float(0)));
      out.element(i).assign(isWet.select(raw, bMin.sub(2)));
    })().compute(res * res);
    kernel.setName('waterY');
    await renderer.computeAsync(kernel);

    // smooth WET cells toward their wet neighbors: steep cascade reaches
    // otherwise render as 2 m staircase shards — real chutes are slides.
    // Dry cells and lake flats are untouched (neighbors equal the mean).
    const tmp = instancedArray(res * res, 'float');
    const mkSmooth = (src: FloatBuffer, dst: FloatBuffer): ComputeNode => {
      const k = Fn(() => {
        const i = instanceIndex;
        If(i.greaterThanEqual(res * res), () => {
          Return();
        });
        const x = i.mod(res).toInt();
        const y = i.div(res).toInt();
        const xm = clamp(float(x).sub(1), 0, res - 1).toInt();
        const xp = clamp(float(x).add(1), 0, res - 1).toInt();
        const ym = clamp(float(y).sub(1), 0, res - 1).toInt();
        const yp = clamp(float(y).add(1), 0, res - 1).toInt();
        const c = src.element(i).toVar();
        const sum = c.toVar();
        const wsum = float(1).toVar();
        for (const [ox, oy] of [[xm, y], [xp, y], [x, ym], [x, yp]] as const) {
          const ni = (oy as NI).mul(res).add(ox as NI);
          const wn = wet.element(ni);
          sum.addAssign(src.element(ni).mul(wn));
          wsum.addAssign(wn);
        }
        const sm = sum.div(wsum);
        dst.element(i).assign(wet.element(i).greaterThan(0.5).select(sm, c));
      })().compute(res * res);
      k.setName('waterYSmooth');
      return k;
    };
    for (let it = 0; it < 2; it++) {
      await renderer.computeAsync([mkSmooth(out, tmp), mkSmooth(tmp, out)]);
    }

    // WET-TO-WET cliff cut: adjacent ponds can legitimately fill at levels
    // a meter+ apart; across their (sub-texel) divide the bilinear+smoothed
    // surface renders a steep dark water RAMP — a hovering slab from afar
    // (user-class artifact found at the twin lake). Water never ramps:
    // where the gradient BETWEEN WET CELLS exceeds ~0.35, sink the cell to
    // dry. Shorelines are untouched (their neighbor is dry, not wet).
    const texel = WORLD_SIZE / res;
    const cliffK = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(res * res), () => {
        Return();
      });
      const x = i.mod(res).toInt();
      const y = i.div(res).toInt();
      const xm = clamp(float(x).sub(1), 0, res - 1).toInt();
      const xp = clamp(float(x).add(1), 0, res - 1).toInt();
      const ym = clamp(float(y).sub(1), 0, res - 1).toInt();
      const yp = clamp(float(y).add(1), 0, res - 1).toInt();
      const c = out.element(i).toVar();
      const dMax = float(0).toVar();
      for (const [ox, oy] of [[xm, y], [xp, y], [x, ym], [x, yp]] as const) {
        const ni = (oy as NI).mul(res).add(ox as NI);
        const wn = wet.element(ni);
        dMax.assign(dMax.max(c.sub(out.element(ni)).abs().mul(wn)));
      }
      const isWet = wet.element(i).greaterThan(0.5);
      const cliff = dMax.div(texel).greaterThan(0.35);
      tmp.element(i).assign(
        isWet.and(cliff).select(bed.element(i).sub(2), c),
      );
    })().compute(res * res);
    cliffK.setName('waterYCliffCut');
    const copyK = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(res * res), () => {
        Return();
      });
      out.element(i).assign(tmp.element(i));
    })().compute(res * res);
    copyK.setName('waterYCopy');
    await renderer.computeAsync([cliffK, copyK]);
    return out;
  }

  private static async reduceWaterY(
    renderer: Renderer,
    src: FloatBuffer,
    res: number,
    factor: number,
  ): Promise<FloatBuffer> {
    const farRes = Math.floor(res / factor);
    const out = instancedArray(farRes * farRes, 'float');
    const kernel = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(farRes * farRes), () => {
        Return();
      });
      const bx = i.mod(farRes).mul(factor).toInt();
      const by = i.div(farRes).mul(factor).toInt();
      // Plain conservative MIN. Known limitation (diagnosed at the twin
      // lake, 2026-06-12): shore-overlapping blocks dip toward the dry
      // sentinel, so a low grazing view across a LARGE lake shows a thin
      // dark band at its far rim. Alternatives tried and rejected:
      // max-of-wet domes over river inlets; min-of-wet lenses where wide
      // inlet rivers meet the lake (two legitimate wet levels bridge
      // across 16 m far-texels). The real fix is a per-water-body far
      // field or the planar-lake pass (logged in STATUS) — at ≥384 m the
      // min's dip is the least-bad behavior and shore ramps fade out in
      // the material on the NEAR levels where they would be obvious.
      const mn = float(1e9).toVar();
      for (let oy = 0; oy < factor; oy++) {
        for (let ox = 0; ox < factor; ox++) {
          const idx = by.add(oy).mul(res).add(bx.add(ox));
          mn.assign(mn.min(src.element(idx)));
        }
      }
      out.element(i).assign(mn);
    })().compute(farRes * farRes);
    kernel.setName('waterYFar');
    await renderer.computeAsync(kernel);
    return out;
  }

  /** bilinear water-surface sample (vertex/fragment safe — buffer reads) */
  sampleWaterY(p: NV2): NF {
    const wy = this.waterY;
    if (!wy) throw new Error('waterY not built');
    const uv = clamp(this.uvFromWorld(p), 0, 1);
    return bilerpFloatBuffer(wy, this.simRes, uvToGrid(uv, this.simRes));
  }

  /** same, from the min-reduced far field (distant clipmap levels) */
  sampleWaterYFar(p: NV2): NF {
    const wy = this.waterYFar;
    if (!wy) throw new Error('waterYFar not built');
    const uv = clamp(this.uvFromWorld(p), 0, 1);
    return bilerpFloatBuffer(wy, this.waterFarRes, uvToGrid(uv, this.waterFarRes));
  }

  /** nearest-texel waterY (compute kernels: veg/debris water gating) */
  sampleWaterYNearest(p: NV2): NF {
    const wy = this.waterY;
    if (!wy) throw new Error('waterY not built');
    const res = this.simRes;
    const g = clamp(this.uvFromWorld(p), 0, 1).mul(res);
    const x = clamp(floor(g.x), 0, res - 1).toInt();
    const y = clamp(floor(g.y), 0, res - 1).toInt();
    return wy.element(y.mul(res).add(x));
  }

  /** pack sim-res hydrology fields into a filterable rgba16f texture */
  private async buildFieldsTex(renderer: Renderer): Promise<void> {
    const flow = this.flow;
    if (!flow) return;
    const res = this.simRes;
    const tex = new StorageTexture(res, res);
    tex.type = HalfFloatType;
    tex.generateMipmaps = false;
    const kernel = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(res * res), () => {
        Return();
      });
      const x = i.mod(res);
      const y = i.div(res);
      textureStore(
        tex,
        uvec2(x.toUint(), y.toUint()),
        vec4(
          flow.moisture.element(i),
          flow.flowStrength.element(i),
          flow.riverDepth.element(i),
          flow.waterSurface.element(i),
        ),
      ).toWriteOnly();
    })().compute(res * res);
    kernel.setName('fieldsTexPack');
    await renderer.computeAsync(kernel);
    this.fieldsTex = tex;
  }

  /**
   * height ← upsample(eroded_sim) + (height_full − upsample(preSim)).
   * Keeps full-res synthesis micro-detail riding on the eroded macro field.
   * Also snapshots the pre-erosion full-res height for the split view.
   */
  private async composeEroded(
    renderer: Renderer,
    preSim: FloatBuffer,
    erodedSim: FloatBuffer,
  ): Promise<void> {
    const res = this.res;
    const simRes = this.simRes;
    const pre = instancedArray(res * res, 'float');
    const kernel = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(res * res), () => {
        Return();
      });
      const x = i.mod(res);
      const y = i.div(res);
      const h = this.height.element(i).toVar();
      pre.element(i).assign(h);
      const uv = vec2(float(x).add(0.5), float(y).add(0.5)).div(res);
      const g = uvToGrid(uv, simRes);
      const macroEroded = bilerpFloatBuffer(erodedSim, simRes, g);
      const macroPre = bilerpFloatBuffer(preSim, simRes, g);
      this.height.element(i).assign(macroEroded.add(h.sub(macroPre)));
    })().compute(res * res);
    kernel.setName('erosionCompose');
    await renderer.computeAsync(kernel);
    this.preErosion = pre;
  }

  /** height buffer → height texture + central-difference normals/slope */
  async rebuildDerivedMaps(renderer: Renderer): Promise<void> {
    const res = this.res;
    const height = this.height;
    const texel = WORLD_SIZE / res;
    const kernel = Fn(() => {
      const i = instanceIndex;
      If(i.greaterThanEqual(res * res), () => {
        Return();
      });
      const x = i.mod(res).toInt();
      const y = i.div(res).toInt();
      const xm = clamp(float(x).sub(1), 0, res - 1).toInt();
      const xp = clamp(float(x).add(1), 0, res - 1).toInt();
      const ym = clamp(float(y).sub(1), 0, res - 1).toInt();
      const yp = clamp(float(y).add(1), 0, res - 1).toInt();
      const h = height.element(i).toVar();
      const hl = height.element(y.mul(res).add(xm)).toVar();
      const hr = height.element(y.mul(res).add(xp)).toVar();
      const hd = height.element(ym.mul(res).add(x)).toVar();
      const hu = height.element(yp.mul(res).add(x)).toVar();
      const n = vec3(hl.sub(hr), float(texel * 2), hd.sub(hu)).normalize();
      const slope = vec2(hl.sub(hr), hd.sub(hu)).length().div(texel * 2);
      textureStore(this.heightTex, uvec2(x.toUint(), y.toUint()), vec4(h, 0, 0, 1)).toWriteOnly();
      textureStore(
        this.normalTex,
        uvec2(x.toUint(), y.toUint()),
        vec4(n, slope),
      ).toWriteOnly();
    })().compute(res * res);
    kernel.setName('terrainDerivedMaps');
    await renderer.computeAsync(kernel);
  }

  /** world xz (m) → uv in [0,1]² over the height grid */
  uvFromWorld(p: NV2): NV2 {
    return p.div(WORLD_SIZE).add(0.5);
  }

  /**
   * Manual-bilinear height sample from the storage buffer (vertex-stage safe;
   * r32float textures are not filterable).
   */
  sampleHeight(p: NV2): NF {
    return this.sampleHeightFrom(this.height, p);
  }

  /** nearest-cell height read — for cost-insensitive paths (shadow casting) */
  sampleHeightNearest(p: NV2): NF {
    const res = this.res;
    const uv = this.uvFromWorld(p);
    const g = clamp(uv, 0, 1).mul(res);
    const x = clamp(floor(g.x), 0, res - 1).toInt();
    const y = clamp(floor(g.y), 0, res - 1).toInt();
    return this.height.element(y.mul(res).add(x));
  }

  /** same, from an arbitrary res×res float buffer (e.g. preErosion) */
  sampleHeightFrom(buf: FloatBuffer, p: NV2): NF {
    const res = this.res;
    const uv = this.uvFromWorld(p);
    const g = clamp(uv, 0, 1).mul(res).sub(0.5);
    const i0 = floor(g);
    const f = fract(g);
    const x0 = clamp(i0.x, 0, res - 1).toInt();
    const y0 = clamp(i0.y, 0, res - 1).toInt();
    const x1 = clamp(i0.x.add(1), 0, res - 1).toInt();
    const y1 = clamp(i0.y.add(1), 0, res - 1).toInt();
    const h00 = buf.element(y0.mul(res).add(x0));
    const h10 = buf.element(y0.mul(res).add(x1));
    const h01 = buf.element(y1.mul(res).add(x0));
    const h11 = buf.element(y1.mul(res).add(x1));
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }

  /** filtered normal+slope sample (fragment stage) */
  sampleNormalSlope(p: NV2): { normal: NV3; slope: NF } {
    const t = texture(this.normalTex, this.uvFromWorld(p));
    return { normal: t.xyz.normalize(), slope: t.w };
  }
}
````

### `src/world/TerrainTiles.ts`

````text
/**
 * Terrain rendering: CDLOD quadtree of instanced grid patches + far vista shell.
 *
 * - One InstancedMesh draws every active tile; per-tile data (origin, size,
 *   lod) lives in a CPU-writable instanced storage buffer, updated only when
 *   the quadtree changes (camera moved) — never per-frame per-instance.
 * - CDLOD vertex morphing: odd vertices slide toward their even-grid
 *   positions across the outer 35% of each LOD ring → no cracks, no pops.
 * - Far shell: radial ring 1.95–14 km, analytic macro height (far branch),
 *   blended to the baked field across the world edge.
 */

import { InstancedMesh, PlaneGeometry, RingGeometry, Mesh, type PerspectiveCamera } from 'three';
import {
  IrradianceNode,
  MeshPhysicalNodeMaterial,
  type StorageBufferNode,
  type StorageTexture,
} from 'three/webgpu';
import { canopyAt } from '../gpu/passes/Scatter';
import {
  cameraPosition,
  clamp,
  float,
  fract,
  smoothstep,
  instanceIndex,
  instancedArray,
  mix,
  positionLocal,
  positionWorld,
  screenUV,
  texture,
  transformNormalToView,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { ProbeGI } from '../gpu/passes/ProbeGI';
import type { NV4 } from '../gpu/TSLTypes';
import {
  CAUSTIC_TILE,
  causticContext,
  causticDepth,
  causticTint,
  causticTintParts,
} from '../render/Caustics';
import { DISP, buildTerrainShading } from '../render/TerrainMaterial';
import { PERIOD_FBM, PERIOD_RID, PERIOD_VAL } from '../gpu/passes/NoiseBake';
import type { Heightfield } from './Heightfield';
import { macroTerrainMini } from './MacroMap';
import { FAR_RADIUS, WORLD_HALF, WORLD_SCALE, WORLD_SIZE } from './WorldConst';

const MAX_TILES = 2048;
const PATCH_SEGS = 64;
/** split while camDist < size·SPLIT_K */
const SPLIT_K = 2.1;
const MIN_TILE = 64;
/** rough/steep tiles may refine below MIN_TILE (cliff close-ups) */
const MIN_TILE_ROUGH = 32;

export class TerrainTiles {
  readonly mesh: InstancedMesh;
  readonly farShell: Mesh;
  private tileData: Float32Array;
  private tileBuf: StorageBufferNode<'vec4'>;
  private hf: Heightfield;
  private lastCamX = Infinity;
  private lastCamZ = Infinity;
  activeTiles = 0;
  /** per-level height ranges: level 0 = 64×64 grid of 64 m cells, then halves */
  private rangePyr: Float32Array[] = [];

  constructor(
    hf: Heightfield,
    debugView: string | null = null,
    opts: {
      heightBuf?: typeof hf.height;
      neutral?: boolean;
      screenHalf?: 'left' | 'right';
      gi?: ProbeGI;
      /** canopy coverage map — attenuates probe ambient under tree crowns */
      canopyTex?: StorageTexture;
    } = {},
  ) {
    this.hf = hf;
    this.buildRangePyramid();
    // ?ablate=mat → neutral clay (perf attribution for the splat material)
    const ablate = new Set(
      (new URLSearchParams(window.location.search).get('ablate') ?? '').split(','),
    );
    if (ablate.has('mat')) opts = { ...opts, neutral: true };
    // --- per-tile buffer -------------------------------------------------------
    this.tileData = new Float32Array(MAX_TILES * 4);
    this.tileBuf = instancedArray(this.tileData, 'vec4');
    const heightBuf = opts.heightBuf ?? hf.height;

    // --- patch geometry ----------------------------------------------------------
    // one extra quad ring beyond ±0.5 = skirt vertices: the shader clamps
    // them onto the edge then drops them down — hides cracks from the
    // error-biased (non-uniform) quadtree splits
    const s = 1 / PATCH_SEGS;
    const patch = new PlaneGeometry(1 + 2 * s, 1 + 2 * s, PATCH_SEGS + 2, PATCH_SEGS + 2);
    patch.rotateX(-Math.PI / 2); // local xz in [-0.5-s, 0.5+s], +y up

    // --- material ---------------------------------------------------------------
    // physical for specularIntensity: the dielectric F0 0.04 sheen at
    // glancing sun desaturates whole hillsides to silver (user feedback —
    // 'terrain gets too silvery'); rock keeps a modest glint
    const mat = new MeshPhysicalNodeMaterial();
    mat.specularIntensity = 0.35;
    const tile = this.tileBuf.element(instanceIndex);
    const tileOrigin = tile.xy; // world xz of tile center
    const tileSize = tile.z;

    // CDLOD morph: world-space vertex, odd-vertex snap toward even grid.
    // Skirt verts (|local| > 0.5) clamp onto the edge, then drop down.
    const rawLocal = positionLocal.xz;
    const clampedLocal = clamp(rawLocal, -0.5, 0.5);
    const isSkirt = rawLocal
      .abs()
      .x.max(rawLocal.abs().y)
      .greaterThan(0.5001)
      .select(float(1), float(0));
    const local = clampedLocal.mul(tileSize);
    const wpos0 = local.add(tileOrigin).toVar();
    const quad = tileSize.div(PATCH_SEGS); // quad size in meters
    const gridUV = clampedLocal.add(0.5).mul(PATCH_SEGS); // 0..SEGS
    const odd = fract(gridUV.mul(0.5)).mul(2); // 1 where odd, 0 where even
    const snapped = wpos0.sub(odd.mul(quad)); // snap odd verts down-grid
    const camD = wpos0.sub(cameraPosition.xz).length();
    // morph across the outer band of this LOD's range
    const rangeEnd = tileSize.mul(SPLIT_K).mul(2); // parent split distance
    const morphK = clamp(camD.sub(rangeEnd.mul(0.7)).div(rangeEnd.mul(0.24)), 0, 1);
    const wpos = mix(wpos0, snapped, morphK);

    // instance + object matrices are identity → positionNode is world space
    const skirtDrop = isSkirt.mul(tileSize.mul(0.045).add(2.5));
    const hSample = hf.sampleHeightFrom(heightBuf, wpos).sub(skirtDrop);

    // --- micro-displacement (5×-detail / Pillar A): geometric relief ≤85 m.
    // The splat's bump normals imply 10–35 cm of relief the silhouette never
    // had — grazing close-ups read blob-smooth ("bare smooth ground" ban).
    // Crack-free: skirt verts sample the same world-space field at their
    // clamped edge position, and CDLOD morph makes shared-edge verts
    // coincide across LODs. Veg sits on the UNDISPLACED field — amplitude
    // stays ≤9 cm where grass grows (blade sink hides it), full on bare
    // rock/scree; snow smooths it back out.
    const uvV = wpos.div(WORLD_SIZE).add(0.5);
    const nsV = texture(hf.normalTex, uvV, 0);
    const bioV = hf.biomeTex ? texture(hf.biomeTex, uvV, 0) : vec4(0, 0, 0, 0);
    const fldV = hf.fieldsTex ? texture(hf.fieldsTex, uvV, 0) : vec4(0, 0, 0, 0);
    const rockK = smoothstep(DISP.slopeKnee0, DISP.slopeKnee1, nsV.w).max(
      bioV.a.mul(0.85),
    );
    const gravelK = smoothstep(0.32, 0.7, fldV.y)
      .max(smoothstep(0.02, 0.2, fldV.z))
      .mul(float(DISP.gravel));
    const dispAmp = mix(float(DISP.base), float(DISP.rock), rockK)
      .max(gravelK)
      .mul(bioV.g.mul(0.75).oneMinus())
      .mul(clamp(float(DISP.fade1).sub(camD).div(DISP.fade1 - DISP.fade0), 0, 1));
    const noiseA = hf.noiseA as NonNullable<typeof hf.noiseA>;
    const noiseB = hf.noiseB as NonNullable<typeof hf.noiseB>;
    const f1 = texture(noiseA, wpos.div(DISP.sF1 * PERIOD_FBM), 0)
      .y.mul(2)
      .sub(1);
    const f2 = texture(noiseA, wpos.div(DISP.sF2 * PERIOD_VAL).add(vec2(0.31, 0.77)), 0)
      .x.mul(2)
      .sub(1);
    // ridged creases (1−|n| sharp valleys) carry the "rock" read — weighted
    // toward rock faces, soft elsewhere
    const r1 = texture(noiseB, wpos.div(DISP.sRid * PERIOD_RID), 0)
      .z.mul(2)
      .sub(1);
    const disp = f1
      .mul(DISP.wF1)
      .add(f2.mul(DISP.wF2))
      .add(r1.mul(rockK.mul(1 - DISP.ridBase).add(DISP.ridBase)).mul(DISP.wRid))
      .mul(dispAmp);
    mat.positionNode = vec3(wpos.x, hSample.add(disp), wpos.y);
    // shadow casting: skip the morph + bilinear (4 reads → 1); cascade texels
    // are meters wide, normalBias absorbs the nearest-fetch steps
    mat.castShadowPositionNode = vec3(
      wpos0.x,
      hf.sampleHeightNearest(wpos0).sub(skirtDrop),
      wpos0.y,
    );

    const shading = buildTerrainShading({
      normalTex: hf.normalTex,
      biomeTex: hf.biomeTex as NonNullable<typeof hf.biomeTex>,
      fieldsTex: hf.fieldsTex as NonNullable<typeof hf.fieldsTex>,
      noiseA: hf.noiseA as NonNullable<typeof hf.noiseA>,
      noiseB: hf.noiseB as NonNullable<typeof hf.noiseB>,
      mp: hf.mp,
      far: false,
    });
    mat.colorNode = shading.colorNode;
    mat.normalNode = shading.normalNode;
    mat.roughnessNode = shading.roughnessNode;
    mat.metalnessNode = float(0);
    // Phase 6 water response (near tiles only): capillary-wet band hugging
    // the true waterline (the splat's moisture wetness is sim-res blurry)
    // + animated caustics on submerged beds. d = water column above the
    // fragment; the band covers d ∈ (−0.45, 0) and saturates under water.
    const cctx = causticContext();
    if (cctx && !opts.neutral) {
      const d = causticDepth(positionWorld);
      const fringe = smoothstep(-0.45, -0.04, d);
      const caust = causticTint(positionWorld, d);
      // permanently submerged beds grow biofilm/algae: darker and olive —
      // without this the sunlit gravel splat shines straight through the
      // water and the whole stream reads as a pale sheet (vs scene1's dark
      // glassy trickle)
      const biofilm = smoothstep(0.04, 0.5, d);
      let wetCol = shading.colorNode
        .mul(fringe.mul(0.38).oneMinus())
        .mul(biofilm.mul(0.42).oneMinus());
      wetCol = mix(wetCol, wetCol.mul(vec3(0.72, 0.86, 0.55)), biofilm.mul(0.65));
      mat.colorNode = wetCol.mul(caust.mul(1.7).add(1));
      mat.roughnessNode = shading.roughnessNode.sub(fringe.mul(0.42)).clamp(0.18, 1);
      // ?caustlit=1 — paint the lit graph's own caustic chain (triage):
      // r = gated tint×4, g = gate product, b = ungated pattern
      if (new URLSearchParams(window.location.search).get('caustlit') === '1') {
        const parts = causticTintParts(positionWorld, d);
        mat.emissiveNode = vec3(parts.x.mul(4), parts.y, parts.z);
      }
    }
    // ?dispdbg=1 — paint micro-displacement (green=+, red=−, dark=none);
    // must land AFTER the shading assignment or it gets overwritten
    if (new URLSearchParams(window.location.search).get('dispdbg') === '1') {
      const dv = varying(disp);
      mat.colorNode = vec3(0.02);
      mat.emissiveNode = vec3(dv.negate().max(0).mul(2), dv.max(0).mul(2), 0.02);
    }
    if (opts.gi && !ablate.has('gi')) {
      // probe-GI irradiance replaces the hemisphere ambient (Phase 3) —
      // injected through the lighting context like a light map. The probe
      // field is canopy-aware (crown-slab extinction in the gather); this
      // receiver factor only adds the 4 m-texel spatial detail the 16 m
      // probe grid can't resolve.
      let irr = opts.gi.irradiance(positionWorld, shading.worldNormalNode);
      if (opts.canopyTex && !ablate.has('canopy')) {
        irr = irr.mul(
          canopyAt(opts.canopyTex, positionWorld.xz).mul(0.18).oneMinus(),
        ) as typeof irr;
      }
      (mat as unknown as { setupLightMap: () => unknown }).setupLightMap = () =>
        new IrradianceNode(irr as unknown as ConstructorParameters<typeof IrradianceNode>[0]);
    }
    if (debugView === 'probes' && opts.gi) {
      // ambient-only view: probe irradiance × albedo, no sun/shadows
      mat.colorNode = vec3(0.0);
      mat.emissiveNode = opts.gi
        .irradiance(positionWorld, shading.worldNormalNode)
        .mul(shading.colorNode);
    }
    if (debugView === 'lod') {
      // distinct color per LOD level + faint grid along tile edges
      const lod = tile.w;
      const edge = positionLocal.xz.abs().x.max(positionLocal.xz.abs().y);
      const grid = edge.greaterThan(0.492).select(float(0.25), float(1));
      mat.colorNode = vec3(0.02);
      mat.emissiveNode = vec3(
        lod.mul(0.9173).add(0.13).fract(),
        lod.mul(0.3719).add(0.41).fract(),
        lod.mul(0.7177).add(0.79).fract(),
      ).mul(grid);
    }
    if (debugView === 'caust' && cctx) {
      // raw caustic tile painted on the terrain (bake verification);
      // ?caustmip=N forces a mip bias — verifies the auto-generated chain
      // that depth-defocus sampling depends on (black ⇒ mips never built)
      const mip = Number(
        new URLSearchParams(window.location.search).get('caustmip') ?? '0',
      );
      mat.colorNode = vec3(0.0);
      mat.emissiveNode = vec3(
        (
          texture(cctx.bake.tex, positionWorld.xz.div(CAUSTIC_TILE)).bias(
            float(mip),
          ) as unknown as NV4
        ).x,
      );
    }
    if (debugView === 'caust2' && cctx) {
      // tint triage: r = gated tint, g = gate product, b = ungated pattern
      mat.colorNode = vec3(0.0);
      mat.emissiveNode = causticTintParts(positionWorld);
    }
    if ((debugView === 'snow' || debugView === 'bioR' || debugView === 'bioB') && hf.biomeTex) {
      // single-channel classification view: white = channel value
      const b = texture(hf.biomeTex, positionWorld.xz.div(WORLD_SIZE).add(0.5));
      mat.colorNode = vec3(0.02);
      const ch = debugView === 'bioR' ? b.r : debugView === 'bioB' ? b.b : b.g;
      mat.emissiveNode = vec3(ch);
    }
    if (opts.neutral) {
      // neutral clay shading for the erosion split view: fragment-space
      // finite-difference normals from the bound height buffer
      const eH = 1.6;
      const pxz = positionWorld.xz;
      const hC = hf.sampleHeightFrom(heightBuf, pxz);
      const hX = hf.sampleHeightFrom(heightBuf, pxz.add(vec2(eH, 0)));
      const hZ = hf.sampleHeightFrom(heightBuf, pxz.add(vec2(0, eH)));
      const nFD = vec3(hC.sub(hX), float(eH), hC.sub(hZ)).normalize();
      mat.colorNode = vec3(0.55, 0.53, 0.5);
      mat.normalNode = transformNormalToView(nFD);
      mat.roughnessNode = float(0.92);
    }
    if (opts.screenHalf) {
      // split-screen via alpha test: keep only one half of the screen
      const keepLeft = opts.screenHalf === 'left';
      const keep = keepLeft
        ? screenUV.x.lessThanEqual(0.5)
        : screenUV.x.greaterThan(0.5);
      mat.opacityNode = keep.select(float(1), float(0));
      mat.alphaTest = 0.5;
    }

    this.mesh = new InstancedMesh(patch, mat, MAX_TILES);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    // mountain shadows come from the coarse ShadowProxy grid — casting the
    // full CDLOD mesh re-rasterized ~11M tris across the four cascades
    this.mesh.castShadow = false;

    // --- far shell -----------------------------------------------------------------
    const ring = new RingGeometry(WORLD_HALF * 0.952, FAR_RADIUS, 160, 42);
    ring.rotateX(-Math.PI / 2);
    const farMat = new MeshPhysicalNodeMaterial();
    farMat.specularIntensity = 0.35;
    const fxz = positionLocal.xz;
    const farMacro = macroTerrainMini(fxz, hf.mp, 'far');
    const baked = hf.sampleHeight(fxz);
    const edgeBlend = clamp(
      fxz.abs().x.max(fxz.abs().y).sub(WORLD_HALF * 0.95).div(WORLD_HALF * 0.05),
      0,
      1,
    );
    // sit well below the tile mesh inside the world (coarse far tiles deviate
    // several meters — the shell poked through and showed far-mode shading)
    const farH = mix(baked, farMacro.height, edgeBlend).sub(
      mix(float(9 * WORLD_SCALE), float(2.5 * WORLD_SCALE), edgeBlend),
    );
    farMat.positionNode = vec3(fxz.x, farH, fxz.y);
    // analytic per-vertex normal (no baked maps beyond the world edge):
    // finite-difference the far macro height, interpolated via varying.
    // eN is a real (mini) step so the normal matches the full-size world:
    // macroTerrainMini scales height ×WORLD_SCALE, so a step of 60·WORLD_SCALE
    // probes the same design-space distance as the original eN=60.
    const eN = 60 * WORLD_SCALE;
    const hX = macroTerrainMini(fxz.add(vec2(eN, 0)), hf.mp, 'far').height;
    const hZ = macroTerrainMini(fxz.add(vec2(0, eN)), hf.mp, 'far').height;
    const farNormal = vec3(farMacro.height.sub(hX), float(eN), farMacro.height.sub(hZ))
      .normalize();
    const farSlope = vec2(farMacro.height.sub(hX), farMacro.height.sub(hZ))
      .length()
      .div(eN);
    const farNS = varying(vec4(farNormal, farSlope));
    const farShading = buildTerrainShading({
      normalTex: hf.normalTex,
      biomeTex: hf.biomeTex as NonNullable<typeof hf.biomeTex>,
      fieldsTex: hf.fieldsTex as NonNullable<typeof hf.fieldsTex>,
      noiseA: hf.noiseA as NonNullable<typeof hf.noiseA>,
      noiseB: hf.noiseB as NonNullable<typeof hf.noiseB>,
      mp: hf.mp,
      far: true,
      baseNormalSlope: farNS,
    });
    farMat.colorNode = farShading.colorNode;
    farMat.normalNode = farShading.normalNode;
    farMat.roughnessNode = farShading.roughnessNode;
    farMat.metalnessNode = float(0);
    if (opts.gi && !ablate.has('gi')) {
      const farIrr = opts.gi.irradiance(positionWorld, farShading.worldNormalNode);
      (farMat as unknown as { setupLightMap: () => unknown }).setupLightMap = () =>
        new IrradianceNode(farIrr as unknown as ConstructorParameters<typeof IrradianceNode>[0]);
    }
    this.farShell = new Mesh(ring, farMat);
    this.farShell.frustumCulled = false;
    this.farShell.receiveShadow = true;
  }

  /**
   * Height-range mip pyramid from the CPU height mirror — drives error-biased
   * splits (steep/rough tiles refine deeper, flat meadows stay coarse).
   */
  private buildRangePyramid(): void {
    const heights = this.hf.cpuHeights;
    if (!heights) return;
    const res = Math.sqrt(heights.length) | 0;
    const base = 64; // cells per side; one cell = MIN_TILE meters
    const cellPx = res / base;
    const l0 = new Float32Array(base * base);
    for (let cy = 0; cy < base; cy++) {
      for (let cx = 0; cx < base; cx++) {
        let mn = Infinity;
        let mx = -Infinity;
        const x0 = cx * cellPx;
        const y0 = cy * cellPx;
        // 4-px stride: range estimate, not exact min/max (16× cheaper)
        for (let y = y0; y < y0 + cellPx; y += 4) {
          const row = y * res;
          for (let x = x0; x < x0 + cellPx; x += 4) {
            const v = heights[row + x] as number;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
        }
        l0[cy * base + cx] = mx - mn;
      }
    }
    this.rangePyr = [l0];
    for (let side = base >> 1; side >= 1; side >>= 1) {
      const prev = this.rangePyr[this.rangePyr.length - 1] as Float32Array;
      const pSide = side * 2;
      const lvl = new Float32Array(side * side);
      for (let cy = 0; cy < side; cy++) {
        for (let cx = 0; cx < side; cx++) {
          lvl[cy * side + cx] = Math.max(
            prev[cy * 2 * pSide + cx * 2] as number,
            prev[cy * 2 * pSide + cx * 2 + 1] as number,
            prev[(cy * 2 + 1) * pSide + cx * 2] as number,
            prev[(cy * 2 + 1) * pSide + cx * 2 + 1] as number,
          );
        }
      }
      this.rangePyr.push(lvl);
    }
  }

  /** height range (m) within a tile (≥ MIN_TILE sizes use the exact level) */
  private heightRange(ox: number, oz: number, size: number): number {
    if (this.rangePyr.length === 0) return 0;
    const lvl = Math.max(0, Math.min(Math.round(Math.log2(Math.max(size, MIN_TILE) / MIN_TILE)), this.rangePyr.length - 1));
    const side = 64 >> lvl;
    const cell = WORLD_SIZE / side;
    const cx = Math.max(0, Math.min(Math.floor((ox + WORLD_SIZE / 2) / cell), side - 1));
    const cy = Math.max(0, Math.min(Math.floor((oz + WORLD_SIZE / 2) / cell), side - 1));
    return (this.rangePyr[lvl] as Float32Array)[cy * side + cx] as number;
  }

  /** rebuild the quadtree when the camera has moved enough */
  update(camera: PerspectiveCamera): void {
    const cx = camera.position.x;
    const cz = camera.position.z;
    if (Math.hypot(cx - this.lastCamX, cz - this.lastCamZ) < 20 && this.activeTiles > 0) return;
    this.lastCamX = cx;
    this.lastCamZ = cz;

    let n = 0;
    const data = this.tileData;
    const emit = (ox: number, oz: number, size: number, lod: number): void => {
      if (n >= MAX_TILES) return;
      data[n * 4] = ox;
      data[n * 4 + 1] = oz;
      data[n * 4 + 2] = size;
      data[n * 4 + 3] = lod;
      n++;
    };
    const cy = camera.position.y;
    const recurse = (ox: number, oz: number, size: number, lod: number): void => {
      const dx = Math.max(Math.abs(cx - ox) - size / 2, 0);
      const dz = Math.max(Math.abs(cz - oz) - size / 2, 0);
      // 3D distance: from high altitude the ground straight below does not
      // need MIN_TILE resolution (slack absorbs in-tile height spread)
      const groundY = this.hf.heightAtCpu(ox, oz);
      const dy = Math.max(Math.abs(cy - groundY) - 250, 0) * 0.8;
      const dist = Math.hypot(dx, dz, dy);
      // error bias: tiles with big internal relief split earlier AND deeper
      // (cliff close-ups got 1 m quads stretched over ~10 m vertical)
      const range = this.heightRange(ox, oz, size);
      const errBoost = Math.min(1 + (range / size) * 0.8, 1.8);
      const minTile = range > size * 0.85 ? MIN_TILE_ROUGH : MIN_TILE;
      if (size > minTile && dist < size * SPLIT_K * errBoost) {
        const q = size / 4;
        const h = size / 2;
        recurse(ox - q, oz - q, h, lod + 1);
        recurse(ox + q, oz - q, h, lod + 1);
        recurse(ox - q, oz + q, h, lod + 1);
        recurse(ox + q, oz + q, h, lod + 1);
      } else {
        emit(ox, oz, size, lod);
      }
    };
    recurse(0, 0, WORLD_SIZE, 0);

    this.activeTiles = n;
    this.mesh.count = n;
    const attr = this.tileBuf.value;
    attr.needsUpdate = true;
  }
}
````

### `src/world/MacroMap.ts`

````text
/**
 * Macro terrain layout — the art-directed bones of the world, seed-jittered.
 *
 * Geography (per STATUS.md D3, serving the reference frames):
 *  - NE: serrated alpine massif (Witcher vista), ridges anisotropic NE–SW
 *  - a glacial U-valley descending NE→SW into a lake basin (SW corner)
 *  - center-S: karst tower plateau (scene1/3) with a tributary stream ravine
 *    cutting through it — tower cliffs form the ravine walls
 *  - elsewhere: rolling forested hills and meadows
 *
 * All functions are TSL graph builders of world-position (meters, origin at
 * world center) so the same math drives the 4096² bake, the analytic far
 * shell, and any later pass needing macro masks. Seed jitter is applied
 * JS-side (plain numbers baked into the graph) for determinism.
 */

import {
  abs,
  clamp,
  float,
  max,
  min,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_worley_noise_float,
  pow,
  saturate,
  smoothstep,
  vec2,
} from 'three/tsl';
import type { Rng, WorldSeed } from '../core/Seed';
import type { NF, NV2 } from '../gpu/TSLTypes';
import {
  KARST_PLATEAU_DESIGN,
  LAKE_LEVEL_DESIGN,
  MACRO_ZOOM,
  WORLD_HALF_DESIGN,
  WORLD_SCALE,
} from './WorldConst';

export interface MacroParams {
  alpC: [number, number];
  alpR: number;
  lakeC: [number, number];
  lakeR: number;
  karstC: [number, number];
  karstR: number;
  karstRot: number;
  /** main valley polyline NE→SW with floor elevations at each vertex */
  valley: [number, number][];
  valleyFloors: number[];
  valleyWidth: number;
  /** tributary ravine through the karst zone joining the main valley */
  trib: [number, number][];
  tribFloors: number[];
  tribWidth: number;
  /** noise domain offsets (decorrelate fields per seed) */
  off: Record<'warp' | 'ridge' | 'hills' | 'karst' | 'detail' | 'hard' | 'far', [number, number]>;
}

function jit(rng: Rng, base: [number, number], amount: number): [number, number] {
  return [base[0] + rng.range(-amount, amount), base[1] + rng.range(-amount, amount)];
}

export function makeMacroParams(seed: WorldSeed): MacroParams {
  // separate streams per component: adding draws to one never re-rolls others
  const rngAnchor = seed.rng('macro-anchors');
  const rngValley = seed.rng('macro-valley');
  const rngTrib = seed.rng('macro-trib');
  const rngOff = seed.rng('macro-offsets');
  const lakeC = jit(rngAnchor, [-1380, 1290], 130);
  const off = (): [number, number] => [rngOff.range(-500, 500), rngOff.range(-500, 500)];
  // the spline continues THROUGH the lake to the map edge: the lake needs an
  // outlet river or it becomes a closed basin and floods the valley to its
  // spill saddle (discovered the hard way)
  const valley: [number, number][] = [
    jit(rngValley, [1520, -1530], 90),
    jit(rngValley, [830, -770], 150),
    jit(rngValley, [70, -70], 170),
    jit(rngValley, [-630, 520], 150),
    jit(rngValley, [-1120, 1000], 110),
    lakeC,
    jit(rngValley, [-1840, 1700], 90),
    [-2200, 2040],
  ];
  const karstC = jit(rngAnchor, [640, 660], 140);
  // tributary: from deep in the karst zone NW-ward to join the main valley
  const trib: [number, number][] = [
    jit(rngTrib, [karstC[0] + 360, karstC[1] + 290], 80),
    jit(rngTrib, [karstC[0] - 40, karstC[1] - 60], 90),
    jit(rngTrib, [karstC[0] - 420, karstC[1] - 330], 90),
    valley[3] as [number, number],
  ];
  return {
    alpC: jit(rngAnchor, [1460, -1470], 150),
    alpR: 1820 + rngAnchor.range(-120, 120),
    lakeC,
    lakeR: 600 + rngAnchor.range(-60, 60),
    karstC,
    karstR: 900 + rngAnchor.range(-80, 80),
    karstRot: 0.35 + rngAnchor.range(-0.25, 0.25),
    valley,
    // lake sill ≈ 141 at the rim, outlet descends off-map
    valleyFloors: [690, 468, 300, 212, 172, 141, 133, 120],
    valleyWidth: 360,
    trib,
    tribFloors: [318, 286, 246, 213],
    tribWidth: 150,
    off: {
      warp: off(),
      ridge: off(),
      hills: off(),
      karst: off(),
      detail: off(),
      hard: off(),
      far: off(),
    },
  };
}

/** smooth 1→0 radial falloff */
function falloff(d: NF, r: number): NF {
  return smoothstep(r, r * 0.25, d);
}

/** distance from p to segment ab, plus the segment-local parameter t */
function segDist(p: NV2, a: [number, number], b: [number, number]): { d: NF; t: NF } {
  const av = vec2(a[0], a[1]);
  const ab = vec2(b[0] - a[0], b[1] - a[1]);
  const len2 = ab.dot(ab);
  const t = saturate(p.sub(av).dot(ab).div(len2));
  const d = p.sub(av.add(ab.mul(t))).length();
  return { d, t };
}

interface SplineField {
  /** warped distance to the polyline */
  dist: NF;
  /** floor elevation at the nearest point (interpolated along the spline) */
  floor: NF;
}

/**
 * Distance + interpolated floor elevation for a carving spline.
 * Pure expression folding: keeps (best distance, floor at best) via select().
 */
function splineField(p: NV2, pts: [number, number][], floors: number[]): SplineField {
  let bestD: NF = float(1e9);
  let bestF: NF = float(floors[0] ?? 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i] as [number, number];
    const b = pts[i + 1] as [number, number];
    const f0 = floors[i] ?? 0;
    const f1 = floors[i + 1] ?? 0;
    const { d, t } = segDist(p, a, b);
    const f = t.mul(f1 - f0).add(f0);
    const closer = d.lessThan(bestD);
    bestF = closer.select(f, bestF);
    bestD = min(bestD, d);
  }
  return { dist: bestD, floor: bestF };
}

export interface ValleyFields {
  valleyDist: NF;
  valleyFloor: NF;
  tribDist: NF;
  tribFloor: NF;
}

/** Just the carving-spline fields (shared by macroTerrain and the river pass). */
export function valleyFields(p: NV2, mp: MacroParams): ValleyFields {
  const o = mp.off;
  const vWarpV = vec2(
    mx_noise_float(p.div(290).add(vec2(o.warp[0], o.warp[1]))),
    mx_noise_float(p.div(290).add(vec2(o.warp[1] + 53, o.warp[0] - 53))),
  ).mul(85);
  // fine meander octave: spline segments are straight lines — without this
  // the carved trenches read as long ruler-straight scars (user-flagged)
  const vWarpF = vec2(
    mx_noise_float(p.div(61).add(vec2(o.warp[0] + 211, o.warp[1] - 97))),
    mx_noise_float(p.div(61).add(vec2(o.warp[1] - 131, o.warp[0] + 173))),
  ).mul(16);
  const pWarped = p.add(vWarpV).add(vWarpF);
  const valley = splineField(pWarped, mp.valley, mp.valleyFloors);
  const trib = splineField(pWarped, mp.trib, mp.tribFloors);
  return {
    valleyDist: valley.dist,
    valleyFloor: valley.floor,
    tribDist: trib.dist,
    tribFloor: trib.floor,
  };
}

export interface ZoneMasks {
  tAlp: NF;
  tKarst: NF;
  tLake: NF;
}

/** Just the zone falloffs (cheap subset for classification/material passes). */
export function zoneMasks(p: NV2, mp: MacroParams): ZoneMasks {
  const o = mp.off;
  const dAlp = p.sub(vec2(mp.alpC[0], mp.alpC[1])).length();
  const tAlp = pow(falloff(dAlp, mp.alpR), 1.2);
  const dLake = p.sub(vec2(mp.lakeC[0], mp.lakeC[1])).length();
  const tLake = falloff(dLake, mp.lakeR);
  const kw = vec2(
    mx_noise_float(p.div(430).add(vec2(o.karst[0], o.karst[1]))),
    mx_noise_float(p.div(430).add(vec2(o.karst[1], o.karst[0]))),
  ).mul(190);
  const pk = p.add(kw);
  const ca = Math.cos(mp.karstRot);
  const sa = Math.sin(mp.karstRot);
  const pkr = vec2(
    pk.x.sub(mp.karstC[0]).mul(ca).sub(pk.y.sub(mp.karstC[1]).mul(sa)).div(1.3),
    pk.x.sub(mp.karstC[0]).mul(sa).add(pk.y.sub(mp.karstC[1]).mul(ca)).mul(1.15),
  );
  const tKarst = falloff(pkr.length(), mp.karstR);
  return { tAlp, tKarst, tLake };
}

export interface MacroNodes {
  /** pre-erosion terrain height (m) */
  height: NF;
  /** alpine mass falloff 0..1 */
  tAlp: NF;
  /** karst zone falloff 0..1 */
  tKarst: NF;
  /** lake basin falloff 0..1 */
  tLake: NF;
  /** warped distance to main valley spline */
  valleyDist: NF;
  /** warped distance to tributary ravine spline */
  tribDist: NF;
  /** local valley floor elevation */
  valleyFloor: NF;
  /** rock hardness 0..1 (erosion resistance) */
  hardness: NF;
}

/**
 * Build the macro terrain graph at p (world meters).
 * `detail`: 'full' for the bake, 'far' for the analytic vista shell
 * (fewer octaves, no karst interior, adds outer mountain ranges).
 */
export function macroTerrain(p: NV2, mp: MacroParams, detail: 'full' | 'far'): MacroNodes {
  const full = detail === 'full';
  const o = mp.off;

  // --- zone masks (shared with classification passes) ------------------------
  const { tAlp, tKarst, tLake } = zoneMasks(p, mp);
  // karst-warped domain (towers reuse this)
  const kw = vec2(
    mx_noise_float(p.div(430).add(vec2(o.karst[0], o.karst[1]))),
    mx_noise_float(p.div(430).add(vec2(o.karst[1], o.karst[0]))),
  ).mul(190);
  const pk = p.add(kw);

  // --- valley + tributary splines (position-warped; see valleyFields) --------
  const vf = valleyFields(p, mp);
  const valleyDist = vf.valleyDist;
  const tribDist = vf.tribDist;

  // --- base + hills ----------------------------------------------------------
  // NOTE mx_noise/mx_fractal outputs are SIGNED (≈[-1,1]) — remap explicitly.
  const hillsRaw = mx_fractal_noise_float(
    p.div(1350).add(vec2(o.hills[0], o.hills[1])),
    full ? 5 : 4,
    2.1,
    0.52,
    1,
  )
    .mul(0.5)
    .add(0.5)
    .saturate();
  // compress the lows (1−(1−n)^1.7): dales stay shallow → terrain drains
  // instead of pooling in deep fBm bowls
  const hillsN = hillsRaw.oneMinus().pow(1.7).oneMinus();
  const hillsMask = tAlp.oneMinus().mul(tKarst.mul(0.72).oneMinus());
  const base = float(192)
    .add(hillsN.mul(135).mul(hillsMask))
    .add(float(KARST_PLATEAU_DESIGN - 192).mul(tKarst))
    .sub(tLake.pow(1.5).mul(110));

  // --- alpine ridges (anisotropic, serrated) ---------------------------------
  // rotate domain 45° and squash so ridgelines align NE–SW like a real range
  const pr = vec2(
    p.x.add(p.y).mul(0.7071),
    p.y.sub(p.x).mul(0.7071 * 1.65),
  )
    .div(2100)
    .add(vec2(o.ridge[0], o.ridge[1]).div(1000));
  const ridgeOct = full ? 7 : 5;
  let ridge: NF = float(0);
  {
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < ridgeOct; i++) {
      const n = abs(mx_noise_float(pr.mul(freq).add(i * 7.31))).oneMinus();
      ridge = ridge.add(n.mul(n).mul(amp));
      norm += amp;
      amp *= 0.52;
      freq *= 2.13;
    }
    ridge = ridge.div(norm);
  }
  const mountains = tAlp.mul(ridge.pow(1.5).mul(1380).add(tAlp.mul(470)));

  // --- karst towers (full detail only — far shell sees plateau mass) ---------
  let towers: NF = float(0);
  if (full) {
    // two worley scales + wall-line wobble kill the repeating-scallop read
    const f1a = mx_worley_noise_float(pk.div(80), 1.0);
    const f1b = mx_worley_noise_float(pk.div(133).add(31.7), 1.0);
    const wallNoise = mx_noise_float(pk.div(9.5)).mul(0.05);
    const f1 = min(f1a, f1b.add(0.12)).add(wallNoise);
    // plateau cores high, narrow near-vertical walls; F1 small near cell centers
    const towerMask = smoothstep(0.46, 0.31, f1);
    const towerHNoise = mx_noise_float(p.div(310).add(vec2(o.karst[0] + 99, o.karst[1] - 99)))
      .mul(0.5)
      .add(0.5);
    const towerH = towerHNoise.mul(80).add(78);
    // keep the tributary ravine open: towers fade within ~130 m of the stream,
    // so tower cliffs become the ravine walls
    const ravineKeep = smoothstep(55, 150, tribDist);
    towers = towerMask.mul(towerH).mul(tKarst.pow(0.8)).mul(ravineKeep);
    // shallow winding gullies between towers
    const gully = pow(saturate(abs(mx_noise_float(pk.div(210))).mul(2.2).oneMinus()), 3);
    towers = towers.sub(gully.mul(26).mul(tKarst).mul(towerMask.oneMinus()));
  }

  // --- pre-valley height ------------------------------------------------------
  const detailN = full
    ? mx_fractal_noise_float(p.div(62).add(vec2(o.detail[0], o.detail[1])), 4, 2.05, 0.5, 1).mul(7)
    : float(0);
  let h: NF = base.add(mountains).add(towers).add(detailN);

  // --- far shell: outer ranges beyond the world edge --------------------------
  if (!full) {
    const r = max(abs(p.x), abs(p.y));
    const band = smoothstep(WORLD_HALF_DESIGN + 600, 5200, r).mul(smoothstep(13500, 7600, r));
    const pf = p.div(2600).add(vec2(o.far[0], o.far[1]));
    let outer: NF = float(0);
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let i = 0; i < 5; i++) {
      const n = abs(mx_noise_float(pf.mul(freq).add(i * 3.7))).oneMinus();
      outer = outer.add(n.mul(n).mul(amp));
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    outer = outer.div(norm);
    const gaps = smoothstep(0.25, 0.75, mx_noise_float(p.div(3900).add(17.3)).mul(0.5).add(0.5));
    h = h.add(outer.pow(1.5).mul(1750).mul(band).mul(gaps));
  }

  // gentle monotonic tilt toward the valley spine so hill country drains
  // (drainage-by-design: post-hoc erosion cannot carve 30 m through saddles)
  h = h.add(min(valleyDist.mul(0.06), 95).mul(tAlp.oneMinus()).mul(tKarst.oneMinus()));

  // --- carve valley + tributary (U-profiles down to interpolated floors) ------
  // outer U-shape plus a narrower inner trench so the floor isn't an airstrip
  const uMain = pow(smoothstep(0, mp.valleyWidth, valleyDist), 2.2);
  h = vf.valleyFloor.add(h.sub(vf.valleyFloor).mul(uMain));
  // inner trench concentrates the river (floors are tuned so its bottom stays
  // above lake level until the mouth); the trench fades across the lake so the
  // outlet sill stays at the designed lake level
  const trench = smoothstep(120, 18, valleyDist)
    .mul(16)
    .mul(smoothstep(0.5, 0.12, tLake));
  h = h.sub(trench);
  if (full) {
    const uTrib = pow(smoothstep(0, mp.tribWidth, tribDist), 1.6);
    const tribInfl = tKarst.pow(0.5); // tributary only carves inside/near karst
    const carved = vf.tribFloor.add(h.sub(vf.tribFloor).mul(uTrib));
    h = carved.mul(tribInfl).add(h.mul(tribInfl.oneMinus()));
  }

  // keep the lake basin genuinely below lake level (tight to the basin core)
  const lakeBed = float(LAKE_LEVEL_DESIGN - 13);
  h = h.sub(max(0, h.sub(lakeBed)).mul(tLake.pow(3.4).mul(0.95)));

  // --- hardness (erosion resistance + later: strata/talus behavior) -----------
  const strata = mx_noise_float(
    vec2(h.mul(0.016), mx_noise_float(p.div(900)).mul(2)).add(vec2(o.hard[0], o.hard[1])),
  )
    .mul(0.5)
    .add(0.5);
  const hardness = clamp(
    float(0.34)
      .add(strata.mul(0.36))
      .add(tKarst.mul(0.28))
      .add(tAlp.mul(0.18))
      .sub(tLake.mul(0.2)),
    0.08,
    0.97,
  );

  return {
    height: h,
    tAlp,
    tKarst,
    tLake,
    valleyDist,
    tribDist,
    valleyFloor: vf.valleyFloor,
    hardness,
  };
}

// --- miniature wrappers -----------------------------------------------------
// The macro graph above is authored in a ±WORLD_HALF_DESIGN design space. To
// reproduce the WHOLE composition inside the shrunken world we sample it at a
// zoomed position (×MACRO_ZOOM) and scale the returned HEIGHTS/DISTANCES by
// WORLD_SCALE — i.e. H_mini(p) = WORLD_SCALE·H(MACRO_ZOOM·p). This is a true
// uniform scale (slopes preserved). Dimensionless outputs (the 0..1 zone masks
// and hardness) are left untouched. Callers operating in real (mini) world
// meters should use these instead of the raw functions.

export function macroTerrainMini(p: NV2, mp: MacroParams, detail: 'full' | 'far'): MacroNodes {
  const m = macroTerrain(p.mul(MACRO_ZOOM), mp, detail);
  return {
    ...m,
    height: m.height.mul(WORLD_SCALE),
    valleyDist: m.valleyDist.mul(WORLD_SCALE),
    tribDist: m.tribDist.mul(WORLD_SCALE),
    valleyFloor: m.valleyFloor.mul(WORLD_SCALE),
  };
}

export function zoneMasksMini(p: NV2, mp: MacroParams): ZoneMasks {
  // masks are 0..1 falloffs — only the sample position needs zooming
  return zoneMasks(p.mul(MACRO_ZOOM), mp);
}

export function valleyFieldsMini(p: NV2, mp: MacroParams): ValleyFields {
  const v = valleyFields(p.mul(MACRO_ZOOM), mp);
  return {
    valleyDist: v.valleyDist.mul(WORLD_SCALE),
    valleyFloor: v.valleyFloor.mul(WORLD_SCALE),
    tribDist: v.tribDist.mul(WORLD_SCALE),
    tribFloor: v.tribFloor.mul(WORLD_SCALE),
  };
}
````

### `src/gpu/passes/HeightSynthesis.ts`

````text
/**
 * Heightfield synthesis — bakes the macro terrain function into storage
 * buffers (height + hardness) at a given resolution. Used at HEIGHT_RES for
 * the final field and SIM_RES for the erosion working grid.
 */

import type { Renderer, StorageBufferNode } from 'three/webgpu';
import { Fn, If, Return, float, instanceIndex, instancedArray, vec2 } from 'three/tsl';
import type { MacroParams } from '../../world/MacroMap';
import { macroTerrainMini } from '../../world/MacroMap';
import { WORLD_SIZE } from '../../world/WorldConst';

export type FloatBuffer = StorageBufferNode<'float'>;

export interface SynthesisResult {
  /** height meters, res×res row-major */
  height: FloatBuffer;
  /** rock hardness 0..1 */
  hardness: FloatBuffer;
  res: number;
}

export async function runHeightSynthesis(
  renderer: Renderer,
  res: number,
  mp: MacroParams,
): Promise<SynthesisResult> {
  const height = instancedArray(res * res, 'float');
  const hardness = instancedArray(res * res, 'float');

  const kernel = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(res * res), () => {
      Return();
    });
    const x = i.mod(res);
    const y = i.div(res);
    const wpos = vec2(float(x).add(0.5), float(y).add(0.5))
      .div(res)
      .sub(0.5)
      .mul(WORLD_SIZE);
    const m = macroTerrainMini(wpos, mp, 'full');
    height.element(i).assign(m.height);
    hardness.element(i).assign(m.hardness);
  })().compute(res * res);
  kernel.setName(`heightSynthesis_${res}`);

  await renderer.computeAsync(kernel);
  return { height, hardness, res };
}
````

### `src/gpu/passes/Erosion.ts`

````text
/**
 * Hydraulic (pipe-model, Mei et al. 2007) + thermal erosion on storage buffers.
 *
 * Grid: res² cells, texel size l = WORLD_SIZE/res (2 m default).
 * State: terrain h, water w, sediment s, outflow flux f (vec4 L,R,D,U),
 * velocity v (vec2), hardness (static), depo (deposition accumulator).
 *
 * Per iteration (each box = one dispatch; WebGPU orders dispatches):
 *   1. flux:    f' from hydraulic head differences
 *   2. water:   w' from flux divergence + rain − evaporation; velocity
 *   3. erode:   capacity C = Kc·sin(slope)·|v| → dissolve/deposit (vs hardness)
 *   4. advect:  s' = s sampled at x − v·dt (semi-Lagrangian, bilinear)
 *   5. thermal: talus relaxation (gather form, symmetric pair transfers)
 *
 * Buffer rotation (height is in hA at every iteration boundary):
 *   even iter: hydra(hA,wA,sA → hB,wB,sB), thermal(hB→hA)
 *   odd  iter: hydra(hA,wB,sB → hB,wA,sA), thermal(hB→hA)
 *
 * Borders: neighbor indices clamp; border cells drain water to zero.
 */

import type { ComputeNode, Renderer } from 'three/webgpu';
import {
  Fn,
  If,
  Return,
  clamp,
  float,
  instanceIndex,
  instancedArray,
  max,
  min,
  vec2,
  vec4,
} from 'three/tsl';
import type { NB, NF, NI } from '../TSLTypes';
import type { FloatBuffer } from './HeightSynthesis';

export interface ErosionResult {
  /** eroded height (res²) — alias of an internal buffer, do not write */
  eroded: FloatBuffer;
  /** water depth at end of simulation (moisture hint) */
  water: FloatBuffer;
  /** accumulated deposition (soil-depth hint) */
  sediment: FloatBuffer;
}

export interface ErosionOpts {
  res: number;
  texel: number;
  iters: number;
  onProgress?: (done: number, total: number) => void;
}

// tuning constants, calibrated for l≈2 m, dt 0.03.
// Conservative rates + per-iter caps: erosion should carve drainage detail
// into the synthesized macro forms, not re-landscape them.
const DT = 0.03;
const RAIN = 0.01;
const EVAP = 0.02;
const KC = 0.55; // transport capacity
const KS = 0.28; // dissolve rate
const KD = 0.5; // deposit rate
const G = 9.81;
const THERMAL_RATE = 0.14;
const MAX_VEL = 6;
const MAX_ERODE_PER_ITER = 0.06;
const MAX_DEPOSIT_PER_ITER = 0.1;

export async function runErosion(
  renderer: Renderer,
  heightIn: FloatBuffer,
  hardness: FloatBuffer,
  opts: ErosionOpts,
): Promise<ErosionResult> {
  const { res, texel, iters } = opts;
  const N = res * res;

  const hA = instancedArray(N, 'float');
  const hB = instancedArray(N, 'float');
  const wA = instancedArray(N, 'float');
  const wB = instancedArray(N, 'float');
  const sA = instancedArray(N, 'float');
  const sB = instancedArray(N, 'float');
  const sTmp = instancedArray(N, 'float');
  const flux = instancedArray(N, 'vec4');
  const vel = instancedArray(N, 'vec2');
  const depo = instancedArray(N, 'float');

  const guard = (body: () => void) =>
    Fn<void>(() => {
      If(instanceIndex.greaterThanEqual(N), () => {
        Return();
      });
      body();
    });

  const cellXY = (): { x: NI; y: NI; i: NI } => {
    const i = instanceIndex.toInt();
    return { x: i.mod(res), y: i.div(res), i };
  };
  /** clamped neighbor index */
  const at = (x: NI, y: NI, ox: number, oy: number): NI => {
    const cx = clamp(float(x).add(ox), 0, res - 1).toInt();
    const cy = clamp(float(y).add(oy), 0, res - 1).toInt();
    return cy.mul(res).add(cx);
  };
  const isBorder = (x: NI, y: NI): NB =>
    float(x)
      .lessThan(1)
      .or(float(x).greaterThan(res - 2))
      .or(float(y).lessThan(1))
      .or(float(y).greaterThan(res - 2));

  // --- init (split: ≤8 storage buffers per compute stage) ----------------------
  const initK1 = guard(() => {
    const { i } = cellXY();
    hA.element(i).assign(heightIn.element(i));
    hB.element(i).assign(heightIn.element(i));
    wA.element(i).assign(0);
    wB.element(i).assign(0);
  })().compute(N);
  initK1.setName('erosionInit1');
  const initK2 = guard(() => {
    const { i } = cellXY();
    sA.element(i).assign(0);
    sB.element(i).assign(0);
    flux.element(i).assign(vec4(0));
    vel.element(i).assign(vec2(0));
    depo.element(i).assign(0);
  })().compute(N);
  initK2.setName('erosionInit2');

  // --- hydraulic kernels, parameterized by buffer roles ------------------------
  interface Roles {
    wSrc: FloatBuffer;
    sSrc: FloatBuffer;
    wDst: FloatBuffer;
    sDst: FloatBuffer;
  }

  const makeHydra = (r: Roles): ComputeNode[] => {
    // 1. flux (reads hA + wSrc → writes flux)
    const fluxK = guard(() => {
      const { x, y, i } = cellXY();
      const head = hA.element(i).add(r.wSrc.element(i)).toVar();
      const headOf = (ox: number, oy: number): NF => {
        const j = at(x, y, ox, oy);
        return hA.element(j).add(r.wSrc.element(j));
      };
      const fOld = flux.element(i).toVar();
      const k = float((DT * G) / texel);
      const f = vec4(
        max(0, fOld.x.add(head.sub(headOf(-1, 0)).mul(k))),
        max(0, fOld.y.add(head.sub(headOf(1, 0)).mul(k))),
        max(0, fOld.z.add(head.sub(headOf(0, -1)).mul(k))),
        max(0, fOld.w.add(head.sub(headOf(0, 1)).mul(k))),
      ).toVar();
      const total = f.x.add(f.y).add(f.z).add(f.w).max(1e-6);
      const scale = min(1, r.wSrc.element(i).div(total.mul(DT)));
      flux.element(i).assign(f.mul(scale));
    })().compute(N);
    fluxK.setName('eroFlux');

    // 2. water + velocity (reads flux, wSrc → writes wDst, vel)
    const waterK = guard(() => {
      const { x, y, i } = cellXY();
      const f = flux.element(i).toVar();
      const fL = flux.element(at(x, y, -1, 0)).toVar();
      const fR = flux.element(at(x, y, 1, 0)).toVar();
      const fD = flux.element(at(x, y, 0, -1)).toVar();
      const fU = flux.element(at(x, y, 0, 1)).toVar();
      const inflow = fL.y.add(fR.x).add(fD.w).add(fU.z);
      const outflow = f.x.add(f.y).add(f.z).add(f.w);
      const w0 = r.wSrc.element(i).toVar();
      const w1 = max(0, w0.add(inflow.sub(outflow).mul(DT))).toVar();
      const w2 = w1.mul(1 - EVAP * DT).add(RAIN * DT).toVar();
      If(isBorder(x, y), () => {
        w2.assign(0);
      });
      r.wDst.element(i).assign(w2);
      const wAvg = w0.add(w1).mul(0.5).max(1e-4);
      const vx = fL.y.sub(f.x).add(f.y).sub(fR.x).mul(0.5).div(wAvg.mul(texel));
      const vy = fD.w.sub(f.z).add(f.w).sub(fU.z).mul(0.5).div(wAvg.mul(texel));
      const v = vec2(vx, vy).toVar();
      const speed = v.length().max(1e-5);
      vel.element(i).assign(v.mul(min(1, float(MAX_VEL).div(speed))));
    })().compute(N);
    waterK.setName('eroWater');

    // 3. erode/deposit (reads hA, sSrc, vel, wDst, hardness → writes hB, sTmp)
    const erodeK = guard(() => {
      const { x, y, i } = cellXY();
      const h0 = hA.element(i).toVar();
      const hL = hA.element(at(x, y, -1, 0));
      const hR = hA.element(at(x, y, 1, 0));
      const hD = hA.element(at(x, y, 0, -1));
      const hU = hA.element(at(x, y, 0, 1));
      const grad = vec2(hR.sub(hL), hU.sub(hD)).div(2 * texel);
      const slope = grad.length();
      const sinA = slope.div(slope.mul(slope).add(1).sqrt()).max(0.012);
      const speed = vel.element(i).length();
      const shallowFade = clamp(r.wDst.element(i).mul(4), 0, 1);
      const cap = float(KC).mul(sinA).mul(speed).mul(shallowFade);
      const s0 = r.sSrc.element(i).toVar();
      const hard = hardness.element(i);
      const erodedAmt = min(
        MAX_ERODE_PER_ITER,
        max(0, cap.sub(s0))
          .mul(KS * DT)
          .mul(float(1).sub(hard.mul(0.92))),
      );
      const depositedAmt = min(MAX_DEPOSIT_PER_ITER, max(0, s0.sub(cap)).mul(KD * DT));
      hB.element(i).assign(h0.add(depositedAmt).sub(erodedAmt));
      sTmp.element(i).assign(s0.add(erodedAmt).sub(depositedAmt));
      depo.element(i).assign(depo.element(i).add(depositedAmt));
    })().compute(N);
    erodeK.setName('eroErode');

    // 4. advect sediment (reads sTmp, vel → writes sDst)
    const advectK = guard(() => {
      const { x, y, i } = cellXY();
      const back = vec2(float(x), float(y)).sub(vel.element(i).mul(DT / texel));
      const bx = clamp(back.x, 0, res - 1);
      const by = clamp(back.y, 0, res - 1);
      const x0f = bx.floor();
      const y0f = by.floor();
      const x1f = min(x0f.add(1), res - 1);
      const y1f = min(y0f.add(1), res - 1);
      const fx = bx.sub(x0f);
      const fy = by.sub(y0f);
      const x0 = x0f.toInt();
      const y0 = y0f.toInt();
      const x1 = x1f.toInt();
      const y1 = y1f.toInt();
      const s00 = sTmp.element(y0.mul(res).add(x0));
      const s10 = sTmp.element(y0.mul(res).add(x1));
      const s01 = sTmp.element(y1.mul(res).add(x0));
      const s11 = sTmp.element(y1.mul(res).add(x1));
      const top = s00.mul(fx.oneMinus()).add(s10.mul(fx));
      const bot = s01.mul(fx.oneMinus()).add(s11.mul(fx));
      r.sDst.element(i).assign(top.mul(fy.oneMinus()).add(bot.mul(fy)));
    })().compute(N);
    advectK.setName('eroAdvect');

    return [fluxK, waterK, erodeK, advectK];
  };

  // 5. thermal talus relaxation hB → hA (gather form; symmetric pair terms)
  const thermalK = ((): ComputeNode => {
    const k = guard(() => {
      const { x, y, i } = cellXY();
      const h0 = hB.element(i).toVar();
      const hard0 = hardness.element(i).toVar();
      // hard rock holds near-cliff angles (tan up to ~3.1 ≈ 72°) and sheds
      // material far slower; soft soil relaxes to ~29°
      const talus0 = float(0.55).add(hard0.mul(hard0).mul(2.6));
      const rate0 = float(1).sub(hard0).pow(1.5).mul(THERMAL_RATE * DT * texel);
      let net: NF = float(0);
      const offs: [number, number][] = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
      ];
      for (const [ox, oy] of offs) {
        const dist = texel * Math.hypot(ox, oy);
        const j = at(x, y, ox, oy);
        const hn = hB.element(j);
        const hardN = hardness.element(j);
        const talusN = float(0.55).add(hardN.mul(hardN).mul(2.6));
        const rateN = float(1).sub(hardN).pow(1.5).mul(THERMAL_RATE * DT * texel);
        const out = max(0, h0.sub(hn).div(dist).sub(talus0)).mul(rate0);
        const inn = max(0, hn.sub(h0).div(dist).sub(talusN)).mul(rateN);
        net = net.add(inn).sub(out);
      }
      hA.element(i).assign(h0.add(clamp(net, -0.22, 0.22)));
    })().compute(N);
    k.setName('eroThermal');
    return k;
  })();

  const hydraEven = makeHydra({ wSrc: wA, sSrc: sA, wDst: wB, sDst: sB });
  const hydraOdd = makeHydra({ wSrc: wB, sSrc: sB, wDst: wA, sDst: sA });

  await renderer.computeAsync([initK1, initK2]);

  const BATCH = 8;
  let done = 0;
  while (done < iters) {
    const nodes: ComputeNode[] = [];
    const n = Math.min(BATCH, iters - done);
    for (let k = 0; k < n; k++) {
      nodes.push(...((done + k) % 2 === 0 ? hydraEven : hydraOdd), thermalK);
    }
    await renderer.computeAsync(nodes);
    done += n;
    opts.onProgress?.(done, iters);
  }

  // height ends in hA every iteration; water/sediment end in the last wDst/sDst
  const finalW = iters % 2 === 1 ? wB : wA;
  return { eroded: hA, water: finalW, sediment: depo };
}
````

### `src/gpu/passes/FlowRivers.ts`

````text
/**
 * Hydrology pass: depression fill → flow accumulation → river carve → lakes
 * → moisture field. Runs on the sim grid after erosion.
 *
 * 1. FILL: iterative priority-flood relaxation — W converges to the filled
 *    DEM (every cell drains to the border via an ε-sloped path). Lakes are
 *    where W − H > δ.
 * 2. ACCUMULATION: particle tracing — rain particles descend the filled DEM
 *    via steepest descent, atomicAdd into a u32 accumulation grid.
 * 3. RIVERS: cells with accumulation above a threshold form the river
 *    network; carve a channel into H proportional to log(accum) and record
 *    water surface + flow direction for rendering/Phase-6 streams.
 * 4. MOISTURE: separable blur of (water presence + erosion wetness),
 *    distance-faded — drives biome classification and vegetation density.
 */

import type { ComputeNode, Renderer, StorageBufferNode } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  Return,
  atomicAdd,
  atomicLoad,
  atomicStore,
  clamp,
  float,
  instanceIndex,
  instancedArray,
  max,
  min,
  smoothstep,
  uint,
  vec2,
} from 'three/tsl';
import { valleyFieldsMini, type MacroParams } from '../../world/MacroMap';
import { MACRO_ZOOM, WORLD_SIZE } from '../../world/WorldConst';
import { bilerpFloatBuffer } from '../BufferSample';
import { hash12 } from '../noise/NoiseTSL';
import type { NB, NF, NI, NU } from '../TSLTypes';
import type { FloatBuffer } from './HeightSynthesis';

export type Vec2Buffer = StorageBufferNode<'vec2'>;

export interface FlowResult {
  /** filled water surface W (≥ H); lakes where W−H > δ */
  waterSurface: FloatBuffer;
  /** log-scaled flow accumulation 0..~1 */
  flowStrength: FloatBuffer;
  /** river water depth (m) at river cells, 0 elsewhere */
  riverDepth: FloatBuffer;
  /** flow direction × speed (|v| = log-flow strength 0..1; ZERO in lakes) */
  flowDir: Vec2Buffer;
  /** moisture 0..1 */
  moisture: FloatBuffer;
  /** renderable water surface: fill level W in lakes/ponds (FLAT per pond —
   *  bed+blurredDepth built 30 m water towers where deep pots abut high
   *  ground), carved bed + gated depth on rivers, −1e4 sentinel when dry */
  waterYRaw: FloatBuffer;
}

export interface FlowOpts {
  res: number;
  texel: number;
  seed: number;
  /** designed carving splines — enforced through erosion-deposited dams */
  mp: MacroParams;
  /** rock hardness 0..1 — post-carve talus relax respects it (protects towers) */
  hardness: FloatBuffer;
  fillIters?: number;
  particles?: number;
  onProgress?: (msg: string, frac: number) => void;
}

/** open water requires real depth — shallow filled bowls become marsh, not ponds */
const LAKE_DELTA = 2.2;
const MARSH_DELTA = 0.15;

export async function runFlowRivers(
  renderer: Renderer,
  height: FloatBuffer,
  erosionWater: FloatBuffer,
  opts: FlowOpts,
): Promise<FlowResult> {
  const { res, seed } = opts;
  const N = res * res;
  const fillIters = opts.fillIters ?? 700;
  const particles = opts.particles ?? 3_000_000;

  const wA = instancedArray(N, 'float');
  const wB = instancedArray(N, 'float');
  const accumU = instancedArray(N, 'uint').toAtomic();
  const flowStrength = instancedArray(N, 'float');
  const riverDepth = instancedArray(N, 'float');
  const waterYRaw = instancedArray(N, 'float');
  const flowDir = instancedArray(N, 'vec2');
  const moistA = instancedArray(N, 'float');
  const moistB = instancedArray(N, 'float');

  const guard = (body: () => void) =>
    Fn<void>(() => {
      If(instanceIndex.greaterThanEqual(N), () => {
        Return();
      });
      body();
    });
  const cellXY = (): { x: NI; y: NI; i: NI } => {
    const i = instanceIndex.toInt();
    return { x: i.mod(res), y: i.div(res), i };
  };
  const at = (x: NI, y: NI, ox: number, oy: number): NI => {
    const cx = clamp(float(x).add(ox), 0, res - 1).toInt();
    const cy = clamp(float(y).add(oy), 0, res - 1).toInt();
    return cy.mul(res).add(cx);
  };
  const OFFS: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
  ];

  // --- 1. depression fill (multigrid: relaxation propagates ~1 cell/iter,
  //        so converge coarse first, then refine) -----------------------------
  const initMisc = guard(() => {
    const { i } = cellXY();
    moistA.element(i).assign(0);
    atomicStore(accumU.element(i), uint(0));
    flowStrength.element(i).assign(0);
    riverDepth.element(i).assign(0);
    flowDir.element(i).assign(vec2(0));
  })().compute(N);
  initMisc.setName('flowInitMisc');

  // ENFORCE the designed channels BEFORE the fill: erosion deposits bars/dams
  // across the trench (real rivers keep their channels open by continuous
  // flow we don't simulate). The macro spline floor is authoritative.
  const enforceK = guard(() => {
    const { x, y, i } = cellXY();
    const wpos = vec2(float(x).add(0.5), float(y).add(0.5))
      .div(res)
      .sub(0.5)
      .mul(WORLD_SIZE);
    const vf = valleyFieldsMini(wpos, opts.mp);
    // fade enforcement across the lake exactly like the synthesis trench,
    // otherwise we'd cut the outlet sill and drain the lake. lakeC/lakeR are in
    // design space, so compare against the zoomed (design-space) position.
    const dLake = wpos.mul(MACRO_ZOOM).sub(vec2(opts.mp.lakeC[0], opts.mp.lakeC[1])).length();
    const tLake = smoothstep(opts.mp.lakeR, opts.mp.lakeR * 0.25, dLake);
    const trenchFade = smoothstep(0.5, 0.12, tLake);
    // V-profile: deepest at the centerline, rim allowance rises smoothly —
    // a hard select() at fixed distance cut razor-walled rectangular canyons.
    // Beyond the rim the ceiling exceeds local terrain → constraint inactive.
    const mainProf = smoothstep(34, 4, vf.valleyDist);
    const tribProf = smoothstep(14, 1.5, vf.tribDist);
    const enforced = min(
      vf.valleyFloor
        .sub(float(15.2).mul(trenchFade).mul(mainProf))
        .add(mainProf.oneMinus().mul(46))
        .add(max(vf.valleyDist.sub(30), 0).mul(3)),
      vf.tribFloor
        .add(0.4)
        .add(tribProf.oneMinus().mul(30))
        .add(max(vf.tribDist.sub(12), 0).mul(3)),
    );
    height.element(i).assign(min(height.element(i), enforced));
  })().compute(N);
  enforceK.setName('channelEnforce');
  await renderer.computeAsync([initMisc, enforceK]);

  interface FillLevel {
    res: number;
    iters: number;
    h: FloatBuffer;
    wA: FloatBuffer;
    wB: FloatBuffer;
  }
  const levels: FillLevel[] = [];
  {
    // coarse levels are nearly free — converge hard there so only local
    // refinement remains at fine levels (relaxation moves ~1 cell/iter)
    const specs = [
      { res: res >> 3, iters: 3000 },
      { res: res >> 2, iters: 1300 },
      { res: res >> 1, iters: 700 },
      { res, iters: Math.max(700, fillIters) },
    ];
    for (const s of specs) {
      levels.push({
        res: s.res,
        iters: s.iters,
        h: s.res === res ? height : instancedArray(s.res * s.res, 'float'),
        wA: s.res === res ? wA : instancedArray(s.res * s.res, 'float'),
        wB: s.res === res ? wB : instancedArray(s.res * s.res, 'float'),
      });
    }
  }

  const lvlHelpers = (lres: number) => ({
    xy: () => {
      const i = instanceIndex.toInt();
      return { x: i.mod(lres), y: i.div(lres), i };
    },
    at: (x: NI, y: NI, ox: number, oy: number): NI => {
      const cx = clamp(float(x).add(ox), 0, lres - 1).toInt();
      const cy = clamp(float(y).add(oy), 0, lres - 1).toInt();
      return cy.mul(lres).add(cx);
    },
    border: (x: NI, y: NI): NB =>
      float(x)
        .lessThan(1)
        .or(float(x).greaterThan(lres - 2))
        .or(float(y).lessThan(1))
        .or(float(y).greaterThan(lres - 2)),
    guard: (body: () => void) =>
      Fn<void>(() => {
        If(instanceIndex.greaterThanEqual(lres * lres), () => {
          Return();
        });
        body();
      }),
  });

  // min-downsample height pyramid (min preserves drainage channels)
  for (let li = levels.length - 2; li >= 0; li--) {
    const fine = levels[li + 1] as FillLevel;
    const coarse = levels[li] as FillLevel;
    const H = lvlHelpers(coarse.res);
    const k = H.guard(() => {
      const { x, y, i } = H.xy();
      const fx = float(x).mul(2).toInt();
      const fy = float(y).mul(2).toInt();
      const fres = fine.res;
      const i00 = fy.mul(fres).add(fx);
      const i10 = fy.mul(fres).add(clamp(float(fx).add(1), 0, fres - 1).toInt());
      const i01 = clamp(float(fy).add(1), 0, fres - 1).toInt().mul(fres).add(fx);
      const i11 = clamp(float(fy).add(1), 0, fres - 1)
        .toInt()
        .mul(fres)
        .add(clamp(float(fx).add(1), 0, fres - 1).toInt());
      coarse.h
        .element(i)
        .assign(
          min(min(fine.h.element(i00), fine.h.element(i10)), min(fine.h.element(i01), fine.h.element(i11))),
        );
    })().compute(coarse.res * coarse.res);
    k.setName(`fillDown_${coarse.res}`);
    await renderer.computeAsync(k);
  }

  // relax each level, seeding W from the coarser solution
  for (let li = 0; li < levels.length; li++) {
    const lvl = levels[li] as FillLevel;
    const H = lvlHelpers(lvl.res);
    const coarser = li > 0 ? (levels[li - 1] as FillLevel) : null;

    const initW = H.guard(() => {
      const { x, y, i } = H.xy();
      const h = lvl.h.element(i).toVar();
      let start: NF;
      if (coarser) {
        const g = vec2(float(x).add(0.5), float(y).add(0.5))
          .div(lvl.res)
          .mul(coarser.res)
          .sub(0.5);
        start = max(h, bilerpFloatBuffer(coarser.wA, coarser.res, g));
      } else {
        start = h.add(4000);
      }
      const w0 = H.border(x, y).select(h, start);
      lvl.wA.element(i).assign(w0);
      lvl.wB.element(i).assign(w0);
    })().compute(lvl.res * lvl.res);
    initW.setName(`fillInit_${lvl.res}`);
    await renderer.computeAsync(initW);

    const mkStep = (src: FloatBuffer, dst: FloatBuffer): ComputeNode => {
      const k = H.guard(() => {
        const { x, y, i } = H.xy();
        const h = lvl.h.element(i).toVar();
        If(H.border(x, y), () => {
          dst.element(i).assign(h);
          Return();
        });
        let lowest: NF = float(1e9);
        for (const [ox, oy] of OFFS) {
          // small ε keeps flats draining; large ε visibly tilts lake surfaces
          const eps = 0.0045 * Math.hypot(ox, oy);
          lowest = min(lowest, src.element(H.at(x, y, ox, oy)).add(eps));
        }
        dst.element(i).assign(max(h, min(src.element(i), lowest)));
      })().compute(lvl.res * lvl.res);
      k.setName(`fillStep_${lvl.res}`);
      return k;
    };
    const stepAB = mkStep(lvl.wA, lvl.wB);
    const stepBA = mkStep(lvl.wB, lvl.wA);

    const BATCH = 32;
    for (let it = 0; it < lvl.iters; it += BATCH) {
      const nodes: ComputeNode[] = [];
      for (let k = 0; k < Math.min(BATCH, lvl.iters - it); k++) {
        nodes.push((it + k) % 2 === 0 ? stepAB : stepBA);
      }
      await renderer.computeAsync(nodes);
      opts.onProgress?.(
        `hydrology: filling depressions (${lvl.res}²)`,
        (li + it / lvl.iters) / levels.length,
      );
    }
    // ensure result is in wA for the next level's seed
    if (lvl.iters % 2 === 1) {
      const copyK = H.guard(() => {
        const { i } = H.xy();
        lvl.wA.element(i).assign(lvl.wB.element(i));
      })().compute(lvl.res * lvl.res);
      await renderer.computeAsync(copyK);
    }
  }
  const W = wA;

  // --- 2. flow accumulation by particle tracing -------------------------------
  const STEPS = 260;
  const traceK = Fn<void>(() => {
    If(instanceIndex.greaterThanEqual(particles), () => {
      Return();
    });
    const pid = instanceIndex.toFloat();
    // jittered-grid spawn (decorrelated, full coverage)
    const cells = float(N);
    const spawn = pid.mul(cells.div(particles)).floor().toVar();
    const jx = hash12(vec2(pid, seed % 1000)).toVar();
    const jy = hash12(vec2(pid.add(0.5), (seed >> 8) % 1000)).toVar();
    const px = spawn.mod(res).add(jx).toVar();
    const py = spawn.div(res).floor().add(jy).toVar();

    // continuous gradient descent on the filled DEM with directional inertia.
    // Discrete 8-neighbor steepest descent locked every path onto axis/45°
    // polylines — the carved rivers read as straight grid scars (user-flagged).
    const dirX = float(0).toVar();
    const dirY = float(0).toVar();
    Loop(STEPS, () => {
      const xi = clamp(px, 1, res - 2).toInt();
      const yi = clamp(py, 1, res - 2).toInt();
      const i = yi.mul(res).add(xi);
      atomicAdd(accumU.element(i), uint(1));
      // sediment settles where the water column is deep — stop in lakes
      If(W.element(i).sub(height.element(i)).greaterThan(LAKE_DELTA), () => {
        Break();
      });
      // central differences of bilinear W around the continuous position
      const gp = vec2(px, py);
      const e = 0.65;
      const gx = bilerpFloatBuffer(W, res, gp.add(vec2(e, 0))).sub(
        bilerpFloatBuffer(W, res, gp.sub(vec2(e, 0))),
      );
      const gy = bilerpFloatBuffer(W, res, gp.add(vec2(0, e))).sub(
        bilerpFloatBuffer(W, res, gp.sub(vec2(0, e))),
      );
      // flatness cutoff well above the fill's ε-tilt (~0.006/cell): on filled
      // flats the tilt is uniform, so surviving particles all walk the same
      // direction and print parallel straight lines across the marsh
      const gLen = vec2(gx, gy).length();
      If(gLen.lessThan(0.012), () => {
        Break();
      });
      // inertia keeps channels coherent through grid noise (gentle meanders)
      const nx = gx.div(gLen).negate();
      const ny = gy.div(gLen).negate();
      dirX.assign(dirX.mul(0.45).add(nx.mul(0.55)));
      dirY.assign(dirY.mul(0.45).add(ny.mul(0.55)));
      const dLen = vec2(dirX, dirY).length().max(1e-6);
      px.addAssign(dirX.div(dLen));
      py.addAssign(dirY.div(dLen));
      If(
        px.lessThan(1).or(px.greaterThan(res - 2)).or(py.lessThan(1)).or(py.greaterThan(res - 2)),
        () => {
          Break();
        },
      );
    });
  })().compute(particles);
  traceK.setName('flowTrace');
  opts.onProgress?.('hydrology: tracing flow', 0.55);
  await renderer.computeAsync(traceK);

  // shared separable triangle blur builder
  const makeBlur = (
    src: FloatBuffer,
    dst: FloatBuffer,
    dx: number,
    dy: number,
    R: number,
  ): ComputeNode => {
    const k = guard(() => {
      const { x, y, i } = cellXY();
      let sum: NF = float(0);
      let wsum = 0;
      for (let o = -R; o <= R; o++) {
        const wgt = 1 - Math.abs(o) / (R + 1);
        sum = sum.add(src.element(at(x, y, o * dx, o * dy)).mul(wgt));
        wsum += wgt;
      }
      dst.element(i).assign(sum.div(wsum));
    })().compute(N);
    k.setName('sepBlur');
    return k;
  };

  // --- 3a. flow strength from accumulation ------------------------------------
  // TWO thresholds with very different jobs (user: "40-60% of cliff sides
  // end up being rivers"):
  //  - RIVER_T (low) → flowStrength: drives CARVING, moisture, splat beds,
  //    boulder affinity. The dense drainage texture is good terrain.
  //  - WATER_T (≈15× stricter) → waterStrength: drives VISIBLE open water
  //    only. Small gullies stay dry cobbled scars; the main river, big
  //    tributaries and ravine runs keep their streams.
  const RIVER_T = particles / N + 14;
  // raised 220 → 320 with the stricter rSurf curve (user: "A TON of water
  // absolutely everywhere") — only genuine collectors render open water
  const WATER_T = particles / N + 320;
  const waterStrength = instancedArray(N, 'float');
  const strengthK = guard(() => {
    const { i } = cellXY();
    // @types/three models AtomicFunctionNode without value semantics; at
    // runtime atomicLoad yields a u32 expression — cast for the converter
    const acc = float(atomicLoad(accumU.element(i)) as unknown as NU).toVar();
    const t = clamp(acc.div(RIVER_T), 1e-5, 60);
    const s = clamp(t.log2().mul(0.18), 0, 1).mul(t.greaterThan(1).select(1, 0));
    flowStrength.element(i).assign(s);
    const tw = clamp(acc.div(WATER_T), 1e-5, 60);
    const sw = clamp(tw.log2().mul(0.21), 0, 1).mul(tw.greaterThan(1).select(1, 0));
    waterStrength.element(i).assign(sw);
  })().compute(N);
  strengthK.setName('flowStrength');

  // --- 3b. widen: blur the strength field (channels get real width — the
  //         raw particle lines are one cell wide and carve grid scars) --------
  opts.onProgress?.('hydrology: widening channels', 0.68);
  await renderer.computeAsync([
    strengthK,
    makeBlur(flowStrength, moistB, 1, 0, 2),
    makeBlur(moistB, flowStrength, 0, 1, 2),
    makeBlur(waterStrength, moistB, 1, 0, 2),
    makeBlur(moistB, waterStrength, 0, 1, 2),
  ]);

  // lake-depth field, blurred: post-erosion hummocks leave 2–6 m potholes
  // everywhere in the wetland — per-cell W−H painted them as dotted ponds.
  // Blur kills isolated pits; the real lake's interior depth is unaffected.
  const lakeDepthB = instancedArray(N, 'float');
  const lakeDepthK = guard(() => {
    const { i } = cellXY();
    lakeDepthB.element(i).assign(W.element(i).sub(height.element(i)));
  })().compute(N);
  lakeDepthK.setName('lakeDepth');
  await renderer.computeAsync([
    lakeDepthK,
    makeBlur(lakeDepthB, moistB, 1, 0, 3),
    makeBlur(moistB, lakeDepthB, 0, 1, 3),
  ]);

  // --- 3c. carve from the blurred field, fade out inside lakes ----------------
  const carveK = guard(() => {
    const { x, y, i } = cellXY();
    const lakeD = lakeDepthB.element(i).toVar();
    const isLake = lakeD.greaterThan(LAKE_DELTA);
    // ×2.1 recovers the pre-blur peak so big rivers still reach full depth
    const sB = clamp(flowStrength.element(i).mul(2.1), 0, 1).toVar();
    flowStrength.element(i).assign(isLake.select(float(1), sB));
    // lakebeds keep their filled profile — carving there printed the particle
    // wander pattern into the basin floor (user-flagged artifact)
    const lakeFade = smoothstep(LAKE_DELTA * 0.7, 0.12, lakeD);
    const depth = sB.pow(1.35).mul(7.5).mul(lakeFade);
    const hNew = height.element(i).sub(depth).toVar();
    height.element(i).assign(hNew);
    const wl = W.element(at(x, y, -1, 0));
    const wr = W.element(at(x, y, 1, 0));
    const wd = W.element(at(x, y, 0, -1));
    const wu = W.element(at(x, y, 0, 1));
    const g = vec2(wl.sub(wr), wd.sub(wu));
    // open water only where the run is gentle: steep reaches are whitewater
    // chutes/falls, not standing sheets — they carve but render dry
    const slopeW = g.length().div(2 * opts.texel);
    const rdGate = smoothstep(0.5, 0.24, slopeW);
    const rdRiver = depth.mul(0.45).add(0.12).mul(rdGate);
    riverDepth.element(i).assign(
      isLake.select(lakeD, sB.greaterThan(0.02).select(rdRiver, float(0))),
    );
    // render surface: ponds sit at their FILL level W (flat, meets terrain
    // at the true shoreline — bed+blurredDepth towers over pot rims); rivers
    // at carved bed + a depth from the STRICT water threshold, minus the
    // widen-blur's 0.12 m apron floor. Carve-only gullies stay dry.
    // USER MANDATE (post water-shader): much stricter visible water — the
    // old curve (sat ×2.1, ^1.35, peak 3.4 m) flooded gorge floors wall-to-
    // wall. Slower saturation + sharper power keep water to the channel
    // CORE; peak ~1.5 m is wading depth, headwaters become trickles in a
    // cobbled bed. Lakes (fill level) and flowStrength consumers untouched.
    const wB = clamp(waterStrength.element(i).mul(1.5), 0, 1);
    const rSurf = wB.pow(2.2).mul(3.3).mul(lakeFade).mul(0.45).add(0.12)
      .mul(rdGate).sub(0.12).max(0);
    const riverWet = wB.greaterThan(0.05).and(rSurf.greaterThan(0.05));
    waterYRaw.element(i).assign(
      isLake.select(W.element(i), riverWet.select(hNew.add(rSurf), float(-1e4))),
    );
    // flow direction × speed: downhill gradient of W scaled by strength.
    // Lakes get ZERO — their filled W is flat so the raw gradient is noise,
    // and Phase-6 water reads |flowDir| as the ripple-advection speed
    // (still lakes vs streaming rivers).
    const spd = isLake.select(float(0), sB);
    flowDir.element(i).assign(g.div(g.length().max(1e-5)).mul(spd));
    // moisture source: lakes + marshes + rivers + residual erosion water
    const marsh = lakeD.greaterThan(MARSH_DELTA).select(float(0.8), float(0));
    const src = isLake
      .select(float(1), max(sB.mul(0.85), marsh))
      .add(clamp(erosionWater.element(i).mul(2), 0, 0.35));
    moistA.element(i).assign(clamp(src, 0, 1));
  })().compute(N);
  carveK.setName('riverCarve');
  opts.onProgress?.('hydrology: carving rivers', 0.72);
  await renderer.computeAsync(carveK);

  // --- 3d. talus relax: carved walls collapse to angle of repose --------------
  // The carve (and any residual erosion notching) leaves near-vertical cell
  // walls; real channels are flanked by talus. Hardness raises the stable
  // angle so karst towers and hard strata keep their cliffs.
  const hT = instancedArray(N, 'float');
  const hardness = opts.hardness;
  const texel = opts.texel;
  const mkRelax = (src: FloatBuffer, dst: FloatBuffer): ComputeNode => {
    const k = guard(() => {
      const { x, y, i } = cellXY();
      const hC = src.element(i).toVar();
      const hardC = hardness.element(i).toVar();
      const talusC = float(texel).mul(hardC.mul(hardC).mul(2.8).add(0.62));
      let delta: NF = float(0);
      for (const [ox, oy] of OFFS.slice(0, 4)) {
        const ni = at(x, y, ox, oy);
        const hN = src.element(ni);
        const hardN = hardness.element(ni);
        const talusN = float(texel).mul(hardN.mul(hardN).mul(2.8).add(0.62));
        const dOut = hC.sub(hN).sub(talusC).max(0); // we shed downhill
        const dIn = hN.sub(hC).sub(talusN).max(0); // neighbor sheds onto us
        delta = delta.add(dIn.sub(dOut));
      }
      dst.element(i).assign(hC.add(delta.mul(0.12)));
    })().compute(N);
    k.setName('talusRelax');
    return k;
  };
  const relaxAB = mkRelax(height, hT);
  const relaxBA = mkRelax(hT, height);
  opts.onProgress?.('hydrology: talus relax', 0.78);
  for (let it = 0; it < 13; it++) {
    await renderer.computeAsync([relaxAB, relaxBA]);
  }

  // --- 4. moisture: separable blur --------------------------------------------
  opts.onProgress?.('hydrology: moisture field', 0.85);
  await renderer.computeAsync([
    makeBlur(moistA, moistB, 1, 0, 10),
    makeBlur(moistB, moistA, 0, 1, 10),
    makeBlur(moistA, moistB, 1, 0, 10),
    makeBlur(moistB, moistA, 0, 1, 10),
  ]);

  return {
    waterSurface: W,
    flowStrength,
    riverDepth,
    flowDir,
    moisture: moistA,
    waterYRaw,
  };
}
````

### `src/gpu/passes/BiomeSnow.ts`

````text
/**
 * Biome + snow classification at full height resolution.
 * temperature(altitude, aspect) × moisture × slope × exposure → biome id,
 * snow coverage, vegetation density, rock exposure. Written as rgba8:
 *   r = biomeId / 8, g = snow 0..1, b = vegetation density, a = rock exposure
 *
 * Snow rules (Pillar/floors): altitude+temperature driven, fades on steep
 * slopes, bonus on sheltered north faces and on low-slope ledges (curvature),
 * dithered at the EDGE in the material (classification stores the smooth field).
 */

import { NearestFilter } from 'three';
import type { Renderer } from 'three/webgpu';
import { StorageTexture } from 'three/webgpu';
import {
  Fn,
  If,
  Return,
  clamp,
  float,
  instanceIndex,
  mix,
  mx_noise_float,
  smoothstep,
  texture,
  textureStore,
  uvec2,
  vec2,
  vec4,
} from 'three/tsl';
import { zoneMasksMini, type MacroParams } from '../../world/MacroMap';
import {
  Biome,
  LAKE_LEVEL,
  MACRO_ZOOM,
  TREELINE,
  WORLD_SCALE,
  WORLD_SIZE,
} from '../../world/WorldConst';
import type { FloatBuffer } from './HeightSynthesis';

export interface BiomeSnowOpts {
  res: number;
  mp: MacroParams;
  /** rgba16f normal+slope texture (filtered) */
  normalTex: StorageTexture;
  /** rgba16f fields texture: moisture, flowStrength, riverDepth, W */
  fieldsTex: StorageTexture;
}

export async function runBiomeSnow(
  renderer: Renderer,
  height: FloatBuffer,
  opts: BiomeSnowOpts,
): Promise<StorageTexture> {
  const { res, mp } = opts;
  const out = new StorageTexture(res, res);
  out.magFilter = NearestFilter;
  out.minFilter = NearestFilter;
  out.generateMipmaps = false;

  const kernel = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(res * res), () => {
      Return();
    });
    const x = i.mod(res);
    const y = i.div(res);
    const uv = vec2(float(x).add(0.5), float(y).add(0.5)).div(res);
    const wpos = uv.sub(0.5).mul(WORLD_SIZE);
    // design-space position: macro-correlated noise wavelengths are authored
    // for the ±2048 design space, so sample them at the zoomed position to keep
    // the miniature looking identical to the full-size world.
    const wposD = wpos.mul(MACRO_ZOOM);
    const h = height.element(i).toVar();
    const ns = texture(opts.normalTex, uv);
    const n = ns.xyz;
    const slope = ns.w;
    const fields = texture(opts.fieldsTex, uv);
    const moisture = fields.x;
    const water = fields.z;
    const zm = zoneMasksMini(wpos, mp);

    // temperature: lapse with altitude; north faces colder; noise breakup.
    // "north" is −z; aspect cooling scales with slope.
    const northness = n.z.negate().mul(clamp(slope, 0, 1)).clamp(0, 1);
    const tNoise = mx_noise_float(wposD.div(420).add(vec2(mp.off.hard[0], mp.off.hard[1])));
    // calibrated for the full world: onset ≈ 750 m, full ≈ ~1150 m (design m).
    // heights are scaled by WORLD_SCALE, so the lapse rate scales by MACRO_ZOOM
    // to keep the same snow band on the (now shorter) massif.
    const temp = float(11.8)
      .sub(h.mul(0.0125 * MACRO_ZOOM))
      .sub(northness.mul(2.0))
      .add(tNoise.mul(1.2));

    // local curvature from height buffer (ledge detection for snow/scree)
    const texel = WORLD_SIZE / res;
    const stepT = 3;
    const idx = (xx: typeof x, yy: typeof y) =>
      clamp(float(yy), 0, res - 1)
        .toInt()
        .mul(res)
        .add(clamp(float(xx), 0, res - 1).toInt());
    const hl = height.element(idx(x.sub(stepT), y));
    const hr = height.element(idx(x.add(stepT), y));
    const hd = height.element(idx(x, y.sub(stepT)));
    const hu = height.element(idx(x, y.add(stepT)));
    const lap = hl.add(hr).add(hd).add(hu).sub(h.mul(4)).div(stepT * stepT); // concave > 0
    // curvature (1/length) scales by MACRO_ZOOM under uniform shrink, so the
    // lap thresholds scale to match; slope is invariant → its thresholds stay.
    const ledge = smoothstep(0.08 * MACRO_ZOOM, 0.5 * MACRO_ZOOM, lap).mul(
      smoothstep(0.9, 0.35, slope),
    );

    // COARSE slope (16 m support): texel-scale crags make the 1 m slope ≥2.7
    // everywhere on the massif — snow holds on the landform, not the micro-relief
    const s8 = 14;
    const cl = height.element(idx(x.sub(s8), y));
    const cr = height.element(idx(x.add(s8), y));
    const cd = height.element(idx(x, y.sub(s8)));
    const cu = height.element(idx(x, y.add(s8)));
    const slopeCoarse = vec2(cr.sub(cl), cu.sub(cd)).length().div(2 * s8 * texel);
    // coarse concavity: couloirs/gullies between rock ribs accumulate snow —
    // this is what makes very steep massifs read snowy (white veins in crags)
    const lapCoarse = cl.add(cr).add(cd).add(cu).sub(h.mul(4)).div(s8 * s8 * texel);
    const couloir = smoothstep(0.015 * MACRO_ZOOM, 0.16 * MACRO_ZOOM, lapCoarse);

    // --- snow coverage ---------------------------------------------------------
    const snowTemp = smoothstep(2.6, -2.2, temp); // cold → 1
    const slopeHold = smoothstep(2.6, 0.8, slopeCoarse); // landform-scale cliffs shed
    const snow = clamp(
      snowTemp.mul(slopeHold).add(ledge.mul(snowTemp).mul(0.45)).add(couloir.mul(snowTemp).mul(0.9)),
      0,
      1,
    )
      .pow(0.78) // perceptual boost: partial coverage reads as snow, not gray
      .mul(smoothstep(0.02, 0.0, water)) // not on water
      .toVar();

    // --- rock exposure -----------------------------------------------------------
    const rockSlope = smoothstep(0.75, 1.45, slope);
    const rockExposure = clamp(
      rockSlope.add(zm.tKarst.mul(smoothstep(0.55, 1.0, slope)).mul(0.7)).add(zm.tAlp.mul(0.18)),
      0,
      1,
    );

    // --- biome decision tree -----------------------------------------------------
    const isAlpine = h.greaterThan(float(TREELINE).add(tNoise.mul(60 * WORLD_SCALE)));
    const isSubalpine = h.greaterThan(
      float(TREELINE - 170 * WORLD_SCALE).add(tNoise.mul(70 * WORLD_SCALE)),
    );
    const lowFlat = slope.lessThan(0.35);
    const isWetland = moisture
      .greaterThan(0.72)
      .and(lowFlat)
      .and(h.lessThan(LAKE_LEVEL + 70 * WORLD_SCALE));
    const meadowNoise = mx_noise_float(wposD.div(560).add(vec2(mp.off.hills[0], mp.off.hills[1])));
    const isMeadow = meadowNoise
      .greaterThan(0.22)
      .and(slope.lessThan(0.42))
      .and(moisture.lessThan(0.72))
      .and(h.lessThan(520 * WORLD_SCALE))
      .and(zm.tKarst.lessThan(0.4));
    const isKarst = zm.tKarst.greaterThan(0.42);

    const biome = isAlpine
      .select(
        float(Biome.Alpine),
        isSubalpine.select(
          float(Biome.Subalpine),
          isWetland.select(
            float(Biome.Wetland),
            isKarst.select(
              float(Biome.KarstForest),
              isMeadow.select(float(Biome.Meadow), float(Biome.Conifer)),
            ),
          ),
        ),
      )
      .toVar();

    // --- vegetation density --------------------------------------------------------
    const densBase = mix(float(0.85), float(0.25), rockExposure)
      .mul(smoothstep(-2.5, 1.5, temp))
      .mul(smoothstep(0.05, 0.25, moisture.add(0.15)))
      .mul(smoothstep(1.9, 1.1, slope));
    const dens = clamp(densBase.sub(snow.mul(0.7)), 0, 1);

    const DIAG_COMPONENTS = false; // temp bisect: write snow components
    textureStore(
      out,
      uvec2(x.toUint(), y.toUint()),
      DIAG_COMPONENTS
        ? vec4(snowTemp, slopeHold, ledge, temp.div(20).add(0.5))
        : vec4(biome.div(8), snow, dens, rockExposure),
    ).toWriteOnly();
  })().compute(res * res);
  kernel.setName('biomeSnowClassify');
  await renderer.computeAsync(kernel);
  return out;
}
````

### `src/gpu/passes/Scatter.ts`

````text
/**
 * Scatter — GPU vegetation/rock placement (spec §3.5), boot-time.
 *
 * Clustered Poisson, fully parallel: a jittered child grid (one thread per
 * candidate cell) is gated by per-class density functions (biome, slope,
 * altitude/treeline, moisture, snow, rock exposure, water) × a parent clump
 * field (hashed parent points per coarse cell → light-competition clumping;
 * the SAME parent field feeds the understory pass as a canopy proxy: ferns
 * gather under tree clumps, flowers in gaps, pink shrubs at clump edges).
 * Ecotones: the biome id is read through a low-frequency warp so boundaries
 * interdigitate instead of tracing classification isolines.
 *
 * Accepted instances are atomically appended into storage buffers — instance
 * data never touches the CPU (only the final counts are read back once for
 * HUD/draw bookkeeping). Deterministic: all randomness is pcg2d(cell, salt),
 * an integer hash — sin-based hashes band at 4-digit cell coordinates.
 *
 * Instance layout (two vec4 buffers):
 *   A = (x, y, z, scale)
 *   B = (yaw, leanX, leanZ, idF)   idF = class·8 + variant  (exact in f32)
 */

import type { Renderer } from 'three/webgpu';
import { StorageTexture, type StorageBufferNode } from 'three/webgpu';
import {
  Fn,
  If,
  Return,
  atomicAdd,
  atomicLoad,
  float,
  instanceIndex,
  instancedArray,
  int,
  smoothstep,
  texture,
  textureStore,
  uint,
  uvec2,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { WorldSeed } from '../../core/Seed';
import type { Heightfield } from '../../world/Heightfield';
import { LAKE_LEVEL, TREELINE, WORLD_SIZE } from '../../world/WorldConst';
import { fbm3 } from '../noise/NoiseTSL';
import type { NF, NI, NU, NV2, NV4 } from '../TSLTypes';

/** geometry-pool class ids (variant index lives in the low 3 bits of idF) */
export const enum VegClass {
  // trees — order matches TREE_SPECIES
  Spruce = 0,
  Pine = 1,
  Beech = 2,
  Birch = 3,
  KarstGnarl = 4,
  Snag = 5,
  // understory
  BushHazel = 8,
  BushPink = 9,
  Juniper = 10,
  Fern = 11,
  FlowerUmbel = 12,
  FlowerBell = 13,
  FlowerDaisy = 14,
  // ground extras
  Log = 16,
  Stump = 17,
  Boulder = 18,
  Slab = 19,
  // size-stratified ground solids (the "no bare ground" layer): each class
  // draws to the range where it still covers >~2 px — constant screen-space
  // granularity, the aggregate equivalent of nanite cluster selection
  StoneL = 20, // 0.6–2.2 m → 900 m
  StoneM = 21, // 0.2–0.6 m → 280 m
  StoneS = 22, // 6–20 cm → 90 m
  Branch = 23, // fallen branches on forest floors → 230 m
}

/** structural variants baked per tree species (geometry reuse, D5) */
export const TREE_VARIANTS = 4;

export interface ScatterLayer {
  bufA: StorageBufferNode<'vec4'>;
  bufB: StorageBufferNode<'vec4'>;
  cap: number;
  /** accepted instances (clamped to cap) — read back once at boot */
  count: number;
}

export interface ScatterResult {
  trees: ScatterLayer;
  understory: ScatterLayer;
  extras: ScatterLayer;
  /** stones (3 size classes) + fallen branches — ground-solid coverage */
  stones: ScatterLayer;
}

// child-grid cell sizes (m) — jitter spans the full cell, so no grid reads
const TREE_CELL = 3.4;
const UNDER_CELL = 2.4;
const EXTRA_CELL = 5.5;
const STONE_CELL = 2.1;
const TREE_CAP = 600_000;
const UNDER_CAP = 700_000;
const EXTRA_CAP = 180_000;
const STONE_CAP = 1_500_000;

// parent clump field (shared by trees + understory — canopy correlation)
const PARENT_CELL = 26;
const PARENT_PROB = 0.62;

const TAU = 6.2831853;

// ---------------------------------------------------------------------------
// integer hash: pcg2d over (cell + salt) — stable at any cell magnitude
// ---------------------------------------------------------------------------

function pcg2d(p: NV2, salt: number): NV2 {
  // PURE expression chain — no toVar/assign, so it works in material node
  // graphs too (assign needs a Fn() stack). +40000 keeps negative ring cell
  // coords positive before the uint cast (world cells span ±~10k).
  const M = uint(1664525);
  const C = uint(1013904223);
  const a0 = p.x.add(40000 + (salt & 0x3fff)).toUint();
  const b0 = p.y.add(40000 + ((salt >> 14) & 0x3fff)).toUint();
  const a1 = a0.mul(M).add(C);
  const b1 = b0.mul(M).add(C);
  const a2 = a1.add(b1.mul(M));
  const b2 = b1.add(a2.mul(M));
  const a3 = a2.bitXor(a2.shiftRight(uint(16)));
  const b3 = b2.bitXor(b2.shiftRight(uint(16)));
  const a4 = a3.add(b3.mul(M));
  const b4 = b3.add(a4.mul(M));
  const a5 = a4.bitXor(a4.shiftRight(uint(16)));
  const b5 = b4.bitXor(b4.shiftRight(uint(16)));
  const inv = 1 / 16777216;
  return vec2(
    float(a5.bitAnd(uint(0xffffff))).mul(inv),
    float(b5.bitAnd(uint(0xffffff))).mul(inv),
  );
}

export function cellHash2(cell: NV2, salt: number): NV2 {
  return pcg2d(cell, salt);
}

export function cellHash(cell: NV2, salt: number): NF {
  return pcg2d(cell, salt).x;
}

// ---------------------------------------------------------------------------

/** per-biome value tables → TSL select chain (biome ids 0..5) */
function byBiome(bioId: NI, vals: readonly number[]): NF {
  let e: NF = float(vals[5] ?? 0);
  for (let b = 4; b >= 0; b--) {
    e = bioId.equal(int(b)).select(float(vals[b] ?? 0), e) as NF;
  }
  return e;
}

/**
 * Parent clump field: hashed parent points on a coarse grid; weight = max
 * kernel over the 3×3 neighborhood. ~1 at clump hearts, 0 in gaps.
 */
function clumpField(wpos: NV2, salt: number): NF {
  const base = wpos.div(PARENT_CELL).floor();
  const w = float(0).toVar();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = base.add(vec2(dx, dy)).add(8192); // parents span negatives
      const h2 = cellHash2(c, salt);
      const exists = cellHash(c, salt ^ 0x9e3779).lessThan(PARENT_PROB);
      const ppos = c.sub(8192).add(0.15).add(h2.mul(0.7)).mul(PARENT_CELL);
      const r = float(PARENT_CELL).mul(h2.x.mul(0.55).add(0.5));
      const d = wpos.sub(ppos).length();
      const k = float(1)
        .sub(smoothstep(r.mul(0.22), r, d))
        .mul(exists.select(float(1), float(0)));
      w.assign(w.max(k));
    }
  }
  return w;
}

interface SiteSamples {
  h: NF;
  slope: NF;
  bioId: NI; // ecotone-warped biome id
  snow: NF;
  vegDens: NF;
  rockExp: NF;
  moisture: NF;
  riverDepth: NF;
  standing: NF; // W − h (standing-water depth)
  nrmXZ: NV2;
}

function sampleSite(hf: Heightfield, wpos: NV2): SiteSamples {
  const uv = wpos.div(WORLD_SIZE).add(0.5);
  const h = hf.sampleHeight(wpos);
  const ns = texture(hf.normalTex, uv, 0) as unknown as NV4;
  // ecotone warp: read the biome classification through a ±26 m wobble
  const warp = vec2(
    fbm3(vec3(wpos.x.mul(0.011), 3.7, wpos.y.mul(0.011)), 2),
    fbm3(vec3(wpos.x.mul(0.011), 91.2, wpos.y.mul(0.011)), 2),
  ).mul(26);
  const uvW = wpos.add(warp).div(WORLD_SIZE).add(0.5);
  const bio = texture(
    hf.biomeTex as NonNullable<typeof hf.biomeTex>,
    uvW,
    0,
  ) as unknown as NV4;
  const bioExact = texture(
    hf.biomeTex as NonNullable<typeof hf.biomeTex>,
    uv,
    0,
  ) as unknown as NV4;
  const fields = texture(
    hf.fieldsTex as NonNullable<typeof hf.fieldsTex>,
    uv,
    0,
  ) as unknown as NV4;
  return {
    h,
    slope: ns.w,
    bioId: bio.x.mul(8).add(0.5).floor().toInt(),
    snow: bioExact.y, // snow/veg-density/rock read unwarped (physical fields)
    vegDens: bioExact.z,
    rockExp: bioExact.w,
    moisture: fields.x,
    riverDepth: fields.z,
    standing: fields.w.sub(h),
    nrmXZ: vec2(ns.x, ns.z),
  };
}

type AtomicCounter = ReturnType<StorageBufferNode<'uint'>['toAtomic']>;

/** append helper: idx = old counter value; write when under cap */
function append(
  counter: AtomicCounter,
  cap: number,
  bufA: StorageBufferNode<'vec4'>,
  bufB: StorageBufferNode<'vec4'>,
  a: NV4,
  b: NV4,
): void {
  const idx = atomicAdd(counter.element(0), uint(1)) as unknown as NU;
  If(idx.lessThan(uint(cap)), () => {
    bufA.element(idx).assign(a);
    bufB.element(idx).assign(b);
  });
}

async function readCount(
  renderer: Renderer,
  counter: AtomicCounter,
  cap: number,
): Promise<number> {
  const attr = (counter as unknown as { value: unknown }).value;
  const ab = await renderer.getArrayBufferAsync(
    attr as Parameters<Renderer['getArrayBufferAsync']>[0],
  );
  const n = new Uint32Array(ab)[0] ?? 0;
  return Math.min(n, cap);
}

/**
 * Canopy occlusion map: tree crowns splatted into a world-space coverage
 * texture (4 m/texel). Lighting uses it to pull probe ambient DOWN under
 * canopy (probes ray-march only the heightfield, so without this the forest
 * interior glows with full open-sky irradiance and every sun shadow washes
 * out to an AO-like smudge). Doubles as the spec's canopy-shadow density
 * field for later passes.
 */
export const CANOPY_RES = 1024;

export async function buildCanopyMap(
  renderer: Renderer,
  trees: ScatterLayer,
): Promise<StorageTexture> {
  const accum = instancedArray(CANOPY_RES * CANOPY_RES, 'uint').toAtomic();
  const texel = WORLD_SIZE / CANOPY_RES; // 4 m

  // crown radius (m at scale 1) and skylight opacity per tree class
  const crownR = [2.9, 2.7, 3.8, 2.7, 3.2, 0.9];
  const opacity = [0.85, 0.7, 0.9, 0.65, 0.8, 0.12];

  const splatK = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(uint(Math.max(trees.count, 1))), () => {
      Return();
    });
    const A = trees.bufA.element(i) as unknown as NV4;
    const B = trees.bufB.element(i) as unknown as NV4;
    const cls = B.w.div(8).floor().toInt();
    const r = byBiome(cls, crownR).mul(A.w).clamp(1, 11);
    const op = byBiome(cls, opacity);
    const gx = A.x.div(WORLD_SIZE).add(0.5).mul(CANOPY_RES);
    const gy = A.z.div(WORLD_SIZE).add(0.5).mul(CANOPY_RES);
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const tx = gx.add(dx).floor();
        const ty = gy.add(dy).floor();
        const inB = tx.greaterThanEqual(0)
          .and(tx.lessThan(CANOPY_RES))
          .and(ty.greaterThanEqual(0))
          .and(ty.lessThan(CANOPY_RES));
        const d = vec2(tx.add(0.5).sub(gx), ty.add(0.5).sub(gy)).length().mul(texel);
        const w = float(1).sub(d.div(r)).max(0).pow(1.5).mul(op).mul(255);
        If(inB.and(w.greaterThan(1)), () => {
          atomicAdd(
            accum.element(ty.toInt().mul(CANOPY_RES).add(tx.toInt())),
            w.toUint(),
          );
        });
      }
    }
  })().compute(Math.max(trees.count, 1));
  splatK.setName('canopySplat');
  await renderer.computeAsync(splatK);

  const tex = new StorageTexture(CANOPY_RES, CANOPY_RES);
  tex.generateMipmaps = false;
  const packK = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(CANOPY_RES * CANOPY_RES), () => {
      Return();
    });
    const x = i.mod(CANOPY_RES);
    const y = i.div(CANOPY_RES);
    // 3×3 box blur of the fixed-point accumulation → soft canopy field
    const sum = float(0).toVar();
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = float(x).add(dx).clamp(0, CANOPY_RES - 1).toInt();
        const yy = float(y).add(dy).clamp(0, CANOPY_RES - 1).toInt();
        sum.addAssign(
          float(
            atomicLoad(
              accum.element(yy.mul(CANOPY_RES).add(xx)),
            ) as unknown as NU,
          ),
        );
      }
    }
    const cov = sum.div(9 * 255).div(1.6).clamp(0, 1).pow(0.75);
    textureStore(tex, uvec2(x.toUint(), y.toUint()), vec4(cov, cov, cov, 1)).toWriteOnly();
  })().compute(CANOPY_RES * CANOPY_RES);
  packK.setName('canopyPack');
  await renderer.computeAsync(packK);
  return tex;
}

/** sample the canopy coverage field at a world xz (filtered) */
export function canopyAt(tex: StorageTexture, wxz: NV2): NF {
  const uv = wxz.div(WORLD_SIZE).add(0.5);
  return (texture(tex, uv) as unknown as NV4).x;
}

export async function runScatter(
  renderer: Renderer,
  hf: Heightfield,
  seed: WorldSeed,
): Promise<ScatterResult> {
  const sT = seed.sub('scatter/trees') & 0x7fffffff;
  const sU = seed.sub('scatter/understory') & 0x7fffffff;
  const sE = seed.sub('scatter/extras') & 0x7fffffff;

  // ---------------------------------------------------------------- trees --
  const treeG = Math.round(WORLD_SIZE / TREE_CELL);
  const treeA = instancedArray(TREE_CAP, 'vec4');
  const treeB = instancedArray(TREE_CAP, 'vec4');
  const treeCount = instancedArray(1, 'uint').toAtomic();

  const treeK = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(treeG * treeG), () => {
      Return();
    });
    const cell = vec2(float(i.mod(treeG)), float(i.div(treeG)));
    const jit = cellHash2(cell, sT);
    const wpos = cell.add(jit).div(treeG).sub(0.5).mul(WORLD_SIZE);
    const s = sampleSite(hf, wpos);

    // hard exclusions: open/standing water, river channels, lake shelf
    If(s.h.lessThan(LAKE_LEVEL + 0.4), () => {
      Return();
    });
    If(s.riverDepth.greaterThan(0.22).or(s.standing.greaterThan(0.3)), () => {
      Return();
    });

    const clump = clumpField(wpos, sT ^ 0x51f3);
    const dens = byBiome(s.bioId, [0, 0.22, 0.8, 0.85, 0.06, 0.26]);
    const clumpFloor = byBiome(s.bioId, [0, 0.15, 0.3, 0.35, 0.04, 0.12]);
    const slopeFade = float(1).sub(smoothstep(0.5, 0.95, s.slope));
    const treelineFade = float(1).sub(
      smoothstep(TREELINE - 110, TREELINE + 50, s.h),
    );
    const snowFade = float(1).sub(s.snow.mul(0.85));
    const accept = dens
      .mul(clumpFloor.add(float(1).sub(clumpFloor).mul(clump)))
      .mul(slopeFade)
      .mul(treelineFade)
      .mul(snowFade)
      .mul(s.vegDens.mul(0.85).add(0.15))
      .mul(float(1).sub(s.rockExp.mul(0.65)));
    If(cellHash(cell, sT ^ 0x1234f).greaterThanEqual(accept), () => {
      Return();
    });

    // species weights: per-biome table × moisture response
    const m = s.moisture;
    const w0 = byBiome(s.bioId, [0, 0.6, 0.58, 0.07, 0.05, 0.12]) // spruce
      .mul(m.mul(0.5).add(0.75));
    const w1 = byBiome(s.bioId, [0, 0.22, 0.27, 0.02, 0.15, 0]) // pine
      .mul(float(1.45).sub(m.mul(0.9)));
    const w2 = byBiome(s.bioId, [0, 0, 0.02, 0.5, 0.42, 0.05]) // beech
      .mul(m.mul(0.9).add(0.55));
    const w3 = byBiome(s.bioId, [0, 0.03, 0.08, 0.16, 0.3, 0.55]) // birch
      .mul(m.mul(0.6).add(0.7));
    const w4 = byBiome(s.bioId, [0, 0, 0, 0.2, 0, 0]) // karst gnarl
      .mul(s.rockExp.mul(1.6).add(0.4));
    const w5 = byBiome(s.bioId, [0, 0.15, 0.05, 0.05, 0.08, 0.28]); // snag

    const r = cellHash(cell, sT ^ 0x77e1).mul(
      w0.add(w1).add(w2).add(w3).add(w4).add(w5),
    );
    const sp = int(0).toVar();
    const acc = w0.toVar();
    If(r.greaterThan(acc), () => {
      sp.assign(1);
      acc.addAssign(w1);
      If(r.greaterThan(acc), () => {
        sp.assign(2);
        acc.addAssign(w2);
        If(r.greaterThan(acc), () => {
          sp.assign(3);
          acc.addAssign(w3);
          If(r.greaterThan(acc), () => {
            sp.assign(4);
            acc.addAssign(w4);
            If(r.greaterThan(acc), () => {
              sp.assign(5);
            });
          });
        });
      });
    });

    // size: power-biased jitter; krummholz shrink toward the treeline;
    // subalpine biome additionally stunted
    const h2 = cellHash2(cell, sT ^ 0x3b8d);
    const krumm = smoothstep(TREELINE - 170, TREELINE + 10, s.h);
    const stunt = s.bioId.equal(int(1)).select(float(0.72), float(1));
    const scale = h2.x
      .pow(1.6)
      .mul(0.85)
      .add(0.62)
      .mul(float(1).sub(krumm.mul(0.55)))
      .mul(stunt);

    const yaw = h2.y.mul(TAU);
    const leanR = cellHash2(cell, sT ^ 0x6c2f).sub(0.5).mul(0.12);
    const lean = s.nrmXZ.mul(0.18).add(leanR);
    const variant = cellHash(cell, sT ^ 0x49a1)
      .mul(TREE_VARIANTS)
      .floor()
      .min(TREE_VARIANTS - 1);
    const idF = float(sp).mul(8).add(variant);
    const y = s.h.sub(scale.mul(0.12)); // sink — root flare covers the seam

    append(
      treeCount,
      TREE_CAP,
      treeA,
      treeB,
      vec4(wpos.x, y, wpos.y, scale) as unknown as NV4,
      vec4(yaw, lean.x, lean.y, idF) as unknown as NV4,
    );
  })().compute(treeG * treeG);
  treeK.setName('scatterTrees');
  await renderer.computeAsync(treeK);

  // ----------------------------------------------------------- understory --
  const underG = Math.round(WORLD_SIZE / UNDER_CELL);
  const underA = instancedArray(UNDER_CAP, 'vec4');
  const underB = instancedArray(UNDER_CAP, 'vec4');
  const underCount = instancedArray(1, 'uint').toAtomic();

  const underK = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(underG * underG), () => {
      Return();
    });
    const cell = vec2(float(i.mod(underG)), float(i.div(underG)));
    const jit = cellHash2(cell, sU);
    const wpos = cell.add(jit).div(underG).sub(0.5).mul(WORLD_SIZE);
    const s = sampleSite(hf, wpos);

    If(s.h.lessThan(LAKE_LEVEL + 0.35), () => {
      Return();
    });
    If(s.riverDepth.greaterThan(0.2).or(s.standing.greaterThan(0.3)), () => {
      Return();
    });

    // canopy proxy = the TREE clump field (same salt → same parents)
    const canopy = clumpField(wpos, sT ^ 0x51f3);
    const dens = byBiome(s.bioId, [0, 0.25, 0.55, 0.6, 0.55, 0.45]);
    const slopeFade = float(1).sub(smoothstep(0.55, 0.9, s.slope));
    const treelineFade = float(1).sub(
      smoothstep(TREELINE - 40, TREELINE + 140, s.h),
    );
    const accept = dens
      .mul(slopeFade)
      .mul(treelineFade)
      .mul(float(1).sub(s.snow.mul(0.9)))
      .mul(s.vegDens.mul(0.9).add(0.1))
      .mul(float(1).sub(s.rockExp.mul(0.85)));
    If(cellHash(cell, sU ^ 0x2477).greaterThanEqual(accept), () => {
      Return();
    });

    const m = s.moisture;
    const edge = canopy.mul(float(1).sub(canopy)).mul(4); // 1 at clump rims
    const w0 = byBiome(s.bioId, [0, 0.05, 0.15, 0.3, 0.04, 0.1]); // hazel
    const w1 = byBiome(s.bioId, [0, 0, 0.02, 0.12, 0.1, 0.02]) // pink shrub
      .mul(edge.mul(1.3).add(0.2));
    const w2 = byBiome(s.bioId, [0, 0.55, 0.3, 0.02, 0.03, 0]) // juniper
      .mul(float(1.3).sub(m.mul(0.8)));
    const w3 = byBiome(s.bioId, [0, 0.1, 0.4, 0.38, 0.03, 0.5]) // fern
      .mul(m.mul(1.1).add(0.3))
      .mul(canopy.mul(1.1).add(0.35));
    const gapK = float(1.25).sub(canopy.mul(0.9));
    const w4 = byBiome(s.bioId, [0, 0.1, 0.05, 0.06, 0.3, 0.2]).mul(gapK); // umbel
    const w5 = byBiome(s.bioId, [0, 0.08, 0.04, 0.06, 0.22, 0.1]).mul(gapK); // bell
    const w6 = byBiome(s.bioId, [0, 0.12, 0.04, 0.06, 0.28, 0.08]).mul(gapK); // daisy

    const r = cellHash(cell, sU ^ 0x59d3).mul(
      w0.add(w1).add(w2).add(w3).add(w4).add(w5).add(w6),
    );
    const cls = int(VegClass.BushHazel).toVar();
    const acc = w0.toVar();
    If(r.greaterThan(acc), () => {
      cls.assign(int(VegClass.BushPink));
      acc.addAssign(w1);
      If(r.greaterThan(acc), () => {
        cls.assign(int(VegClass.Juniper));
        acc.addAssign(w2);
        If(r.greaterThan(acc), () => {
          cls.assign(int(VegClass.Fern));
          acc.addAssign(w3);
          If(r.greaterThan(acc), () => {
            cls.assign(int(VegClass.FlowerUmbel));
            acc.addAssign(w4);
            If(r.greaterThan(acc), () => {
              cls.assign(int(VegClass.FlowerBell));
              acc.addAssign(w5);
              If(r.greaterThan(acc), () => {
                cls.assign(int(VegClass.FlowerDaisy));
              });
            });
          });
        });
      });
    });

    const h2 = cellHash2(cell, sU ^ 0x71c9);
    const scale = h2.x.pow(1.4).mul(0.7).add(0.6);
    const yaw = h2.y.mul(TAU);
    const variant = cellHash(cell, sU ^ 0x1ee7).mul(4).floor().min(3);
    const idF = float(cls).mul(8).add(variant);

    append(
      underCount,
      UNDER_CAP,
      underA,
      underB,
      vec4(wpos.x, s.h.sub(0.03), wpos.y, scale) as unknown as NV4,
      vec4(yaw, 0, 0, idF) as unknown as NV4,
    );
  })().compute(underG * underG);
  underK.setName('scatterUnderstory');
  await renderer.computeAsync(underK);

  // --------------------------------------------------------------- extras --
  const extraG = Math.round(WORLD_SIZE / EXTRA_CELL);
  const extraA = instancedArray(EXTRA_CAP, 'vec4');
  const extraB = instancedArray(EXTRA_CAP, 'vec4');
  const extraCount = instancedArray(1, 'uint').toAtomic();

  const extraK = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(extraG * extraG), () => {
      Return();
    });
    const cell = vec2(float(i.mod(extraG)), float(i.div(extraG)));
    const jit = cellHash2(cell, sE);
    const wpos = cell.add(jit).div(extraG).sub(0.5).mul(WORLD_SIZE);
    const s = sampleSite(hf, wpos);

    If(s.h.lessThan(LAKE_LEVEL + 0.3), () => {
      Return();
    });
    If(s.riverDepth.greaterThan(0.3).or(s.standing.greaterThan(0.35)), () => {
      Return();
    });

    const canopy = clumpField(wpos, sT ^ 0x51f3);
    const forestK = byBiome(s.bioId, [0, 0.3, 1, 1, 0.25, 0.6]).mul(
      canopy.mul(0.7).add(0.3),
    );
    const m = s.moisture;
    const w0 = forestK.mul(0.3).mul(m.mul(0.6).add(0.4)); // log
    const w1 = forestK.mul(0.12); // stump
    const w2 = s.rockExp.mul(1.1).add(0.12).mul(0.42); // boulder
    const w3 = s.rockExp.mul(0.9).mul(0.2); // slab

    const dens = byBiome(s.bioId, [0.08, 0.25, 0.62, 0.65, 0.22, 0.5]);
    const slopeFade = float(1).sub(smoothstep(0.55, 1.1, s.slope));
    const wSum = w0.add(w1).add(w2).add(w3);
    const accept = dens.mul(slopeFade).mul(wSum.min(1));
    If(cellHash(cell, sE ^ 0x3f21).greaterThanEqual(accept), () => {
      Return();
    });

    const r = cellHash(cell, sE ^ 0x6d05).mul(wSum);
    const cls = int(VegClass.Log).toVar();
    const acc = w0.toVar();
    If(r.greaterThan(acc), () => {
      cls.assign(int(VegClass.Stump));
      acc.addAssign(w1);
      If(r.greaterThan(acc), () => {
        cls.assign(int(VegClass.Boulder));
        acc.addAssign(w2);
        If(r.greaterThan(acc), () => {
          cls.assign(int(VegClass.Slab));
        });
      });
    });

    // logs slide off steep ground; decay class follows moisture
    If(cls.equal(int(VegClass.Log)).and(s.slope.greaterThan(0.5)), () => {
      Return();
    });
    const h2 = cellHash2(cell, sE ^ 0x15bd);
    const mJit = m.add(h2.x.mul(0.3).sub(0.15));
    const decay = mJit
      .greaterThan(0.62)
      .select(float(2), mJit.greaterThan(0.35).select(float(1), float(0)));
    const isRock = cls.greaterThanEqual(int(VegClass.Boulder));
    // boulder/slab variants are context-keyed like StoneL: 0/1 pale bedrock
    // blocks on exposed rock, scree slopes, or dry pale soil (everywhere
    // the splat is pale — they must match the ground), 2/3 dark mossy
    // forest rocks
    const paleCtx = s.rockExp
      .greaterThan(0.35)
      .or(s.slope.greaterThan(0.42))
      .or(s.moisture.lessThan(0.32));
    const rockV = cellHash(cell, sE ^ 0x44d7)
      .mul(2)
      .floor()
      .min(1)
      .add(paleCtx.select(float(0), float(2)));
    const variant = cls
      .equal(int(VegClass.Log))
      .select(
        decay,
        isRock.select(rockV, cellHash(cell, sE ^ 0x44d7).mul(4).floor().min(3)),
      );

    const scale = isRock.select(
      h2.y.pow(2).mul(1.9).add(0.5),
      h2.y.mul(0.6).add(0.7),
    );
    // rocks bed deeper on slopes — a perched block on an incline floats
    const bed = s.slope.mul(0.9).add(1);
    const sink = isRock.select(scale.mul(0.28).mul(bed), float(0.08));
    const yaw = cellHash(cell, sE ^ 0x2a6b).mul(TAU);
    const idF = float(cls).mul(8).add(variant);

    append(
      extraCount,
      EXTRA_CAP,
      extraA,
      extraB,
      vec4(wpos.x, s.h.sub(sink), wpos.y, scale) as unknown as NV4,
      vec4(yaw, s.nrmXZ.x.mul(0.3), s.nrmXZ.y.mul(0.3), idF) as unknown as NV4,
    );
  })().compute(extraG * extraG);
  extraK.setName('scatterExtras');
  await renderer.computeAsync(extraK);

  // ------------------------------------------------- stones + branches --
  // size-stratified ground solids: stones everywhere geology says so
  // (scree slopes, rock exposure, streambeds, talus under cliffs) plus a
  // light scatter on all soil; fallen branches on forest floors. This is
  // the "no bare ground" layer — references show ground GEOMETRY at every
  // distance, never naked splat.
  const stoneG = Math.round(WORLD_SIZE / STONE_CELL);
  const stoneA = instancedArray(STONE_CAP, 'vec4');
  const stoneB = instancedArray(STONE_CAP, 'vec4');
  const stoneCount = instancedArray(1, 'uint').toAtomic();
  const sS = seed.sub('scatter/stones') & 0x7fffffff;

  const stoneK = Fn(() => {
    const i = instanceIndex;
    If(i.greaterThanEqual(stoneG * stoneG), () => {
      Return();
    });
    const cell = vec2(float(i.mod(stoneG)), float(i.div(stoneG)));
    const jit = cellHash2(cell, sS);
    const wpos = cell.add(jit).div(stoneG).sub(0.5).mul(WORLD_SIZE);
    const s = sampleSite(hf, wpos);
    If(s.h.lessThan(LAKE_LEVEL + 0.25), () => {
      Return();
    });
    If(s.standing.greaterThan(0.5), () => {
      Return();
    });

    const canopy = clumpField(wpos, sT ^ 0x51f3);
    const streamK = smoothstep(0.05, 0.3, s.riverDepth);
    // angle of repose: loose rock can't rest above ~42° — anything clinging
    // to steeper faces reads as stuck-on blobs (user feedback: "random
    // protruding circles along cliffs")
    const repose = float(1).sub(smoothstep(0.72, 0.98, s.slope));
    // talus: march uphill — steep ground above sheds rock onto this site,
    // so stones concentrate in fans BELOW cliffs rather than on them
    const upLen = s.nrmXZ.length().max(0.02);
    const up = s.nrmXZ.div(upLen).negate();
    const h8 = hf.sampleHeight(wpos.add(up.mul(8)));
    const h18 = hf.sampleHeight(wpos.add(up.mul(18)));
    const riseNear = h8.sub(s.h).div(8);
    const riseFar = h18.sub(h8).div(10);
    const cliffAbove = smoothstep(0.7, 1.3, riseNear.max(riseFar));
    // shared rockiness clumps: one field gates ALL size classes, so big
    // blocks sit inside aprons of smaller fragments with bare gaps between
    // (real scree is patchy and size-mixed, never uniform speckle)
    const patch = clumpField(wpos, sS ^ 0x77aa).mul(0.78).add(0.22);
    const scree = smoothstep(0.42, 0.8, s.slope);
    const stoneBase = byBiome(s.bioId, [0.55, 0.4, 0.26, 0.32, 0.14, 0.18])
      .mul(
        s.rockExp
          .mul(0.85)
          .add(scree.mul(0.85))
          .add(streamK.mul(1.5))
          .add(cliffAbove.mul(1.15))
          .add(0.16),
      )
      .mul(patch)
      .mul(repose)
      .mul(float(1).sub(s.snow.mul(0.85)));
    // branches need ground that holds them — steep bare slopes grew
    // floating white sticks (user-visible artifact)
    const branchFlat = float(1).sub(smoothstep(0.45, 0.75, s.slope));
    const branchW = canopy.mul(0.6).mul(
      byBiome(s.bioId, [0, 0.2, 1, 1, 0.3, 0.7]),
    ).mul(branchFlat);
    const accept = stoneBase.add(branchW).min(1);
    If(cellHash(cell, sS ^ 0x71f1).greaterThanEqual(accept), () => {
      Return();
    });

    // class pick: branch vs stone, stones split L/M/S by size budget.
    // Stones embed deeper on slopes (a perched sphere on an incline reads
    // as a stuck-on blob; a bedded one reads as an outcrop).
    const bed = s.slope.mul(0.9).add(1);
    const r = cellHash(cell, sS ^ 0x2e2e).mul(stoneBase.add(branchW));
    const h2 = cellHash2(cell, sS ^ 0x6b6b);
    const cls = int(VegClass.Branch).toVar();
    const scale = float(1).toVar();
    const sink = float(0.05).toVar();
    const variant = cellHash(cell, sS ^ 0x5c5c).mul(4).floor().min(3).toVar();
    If(r.lessThan(stoneBase), () => {
      // streambeds skew LARGE: scene1 beds are built from rounded boulders
      const sr = h2.x.sub(streamK.mul(0.16));
      If(sr.lessThan(0.13), () => {
        cls.assign(int(VegClass.StoneL));
        scale.assign(h2.y.pow(1.7).mul(1.6).add(0.6)); // 0.6–2.2 m
        sink.assign(scale.mul(0.3).mul(bed));
        // variant by context: 0/1 pale faceted talus on scree/exposed rock/
        // dry pale soil (matches the pale splat), 2/3 dark rounded stones
        // in streambeds and on moist mossy forest floor
        const paleCtx = s.rockExp
          .greaterThan(0.35)
          .or(s.slope.greaterThan(0.42))
          .or(s.moisture.lessThan(0.32))
          .and(streamK.lessThan(0.35));
        const vr = cellHash(cell, sS ^ 0x1d2d).mul(2).floor().min(1);
        variant.assign(vr.add(paleCtx.select(float(0), float(2))));
      }).Else(() => {
        If(sr.lessThan(0.45), () => {
          cls.assign(int(VegClass.StoneM));
          scale.assign(h2.y.mul(0.4).add(0.2)); // 0.2–0.6 m
          sink.assign(scale.mul(0.26).mul(bed));
        }).Else(() => {
          cls.assign(int(VegClass.StoneS));
          scale.assign(h2.y.mul(0.14).add(0.06)); // 6–20 cm
          sink.assign(scale.mul(0.22).mul(bed));
        });
      });
    }).Else(() => {
      scale.assign(h2.y.mul(0.8).add(0.6));
      sink.assign(0.04);
    });

    const yaw = cellHash(cell, sS ^ 0x3d3d).mul(TAU);
    const idF = float(cls).mul(8).add(variant);
    append(
      stoneCount,
      STONE_CAP,
      stoneA,
      stoneB,
      vec4(wpos.x, s.h.sub(sink), wpos.y, scale) as unknown as NV4,
      vec4(yaw, s.nrmXZ.x.mul(0.4), s.nrmXZ.y.mul(0.4), idF) as unknown as NV4,
    );
  })().compute(stoneG * stoneG);
  stoneK.setName('scatterStones');
  await renderer.computeAsync(stoneK);

  // ---- counts (single boot-time readback; instance data stays on GPU) ----
  const [tc, uc, ec, sc] = await Promise.all([
    readCount(renderer, treeCount, TREE_CAP),
    readCount(renderer, underCount, UNDER_CAP),
    readCount(renderer, extraCount, EXTRA_CAP),
    readCount(renderer, stoneCount, STONE_CAP),
  ]);

  return {
    trees: { bufA: treeA, bufB: treeB, cap: TREE_CAP, count: tc },
    understory: { bufA: underA, bufB: underB, cap: UNDER_CAP, count: uc },
    extras: { bufA: extraA, bufB: extraB, cap: EXTRA_CAP, count: ec },
    stones: { bufA: stoneA, bufB: stoneB, cap: STONE_CAP, count: sc },
  };
}
````

### `src/world/WorldConst.ts`

````text
/**
 * World constants — the single place defining world dimensions, grid sizes,
 * vertical scale, and biome identifiers. The macro layout (where the massif,
 * valley, karst zone, and lake live) is in MacroMap.ts.
 */

/**
 * Miniature world scale. The world was authored at 4096 m; everything is
 * uniformly scaled by WORLD_SCALE so it looks identical but is physically
 * smaller and boots faster. MACRO_ZOOM (=1/WORLD_SCALE) is how much to zoom
 * the macro-field sampling so the full ±2048 design composition is reproduced
 * across the shrunken world (see macroTerrainMini in MacroMap.ts).
 * To restore the full-size world, set WORLD_SCALE = 1.
 */
export const WORLD_SCALE = 0.25;
export const MACRO_ZOOM = 1 / WORLD_SCALE;

/** world edge length in meters; world spans [-WORLD_HALF, +WORLD_HALF]² */
export const WORLD_SIZE = 4096 * WORLD_SCALE;
export const WORLD_HALF = WORLD_SIZE / 2;
/** design-space half-width (the ±2048 coordinate space MacroMap is authored in) */
export const WORLD_HALF_DESIGN = 2048;

/** final composed heightfield resolution (~1 m/texel at the scaled world size) */
export const HEIGHT_RES = Math.round(4096 * WORLD_SCALE);
/** erosion / hydrology simulation grid (~2 m/texel) — was spec floor ≥2048 at full scale */
export const SIM_RES = Math.round(2048 * WORLD_SCALE);

/**
 * Vertical range: heights are meters above sea/datum 0.
 * The public constants are SCALED (compared against the final scaled height
 * texture by biome/material/scatter passes). The *_DESIGN variants are the
 * FULL authored values used INSIDE MacroMap's graph (whose height output is
 * scaled at the call boundary), so they must not be pre-scaled.
 */
export const LAKE_LEVEL_DESIGN = 142;
export const KARST_PLATEAU_DESIGN = 380;
export const LAKE_LEVEL = LAKE_LEVEL_DESIGN * WORLD_SCALE;
export const VALLEY_FLOOR = 165 * WORLD_SCALE;
export const KARST_PLATEAU = KARST_PLATEAU_DESIGN * WORLD_SCALE;
export const TREELINE = 950 * WORLD_SCALE;
export const SNOWLINE_BASE = 1050 * WORLD_SCALE;
export const SUMMIT_MAX = 1620 * WORLD_SCALE;

/** far-shell vista ring: analytic terrain from WORLD_HALF out to FAR_RADIUS */
export const FAR_RADIUS = 14000 * WORLD_SCALE;

/** biome ids (stored quantized in classification texture r-channel) */
export const enum Biome {
  Alpine = 0, // rock, scree, snow above treeline
  Subalpine = 1, // krummholz, sparse stunted conifers, heath
  Conifer = 2, // montane spruce/pine forest
  KarstForest = 3, // broadleaf forest among karst towers & ravines (refs 1–3)
  Meadow = 4, // grassland with flowers
  Wetland = 5, // lake margins, sedges, moisture-lovers
  COUNT = 6,
}

export const BIOME_NAMES: readonly string[] = [
  'alpine',
  'subalpine',
  'conifer',
  'karst-forest',
  'meadow',
  'wetland',
];

/** quality presets — smaller grids, never fewer systems */
export interface QualityConfig {
  heightRes: number;
  simRes: number;
  erosionIters: number;
  tileVerts: number; // vertices per tile edge
}

export function qualityConfig(preset: 'low' | 'high' | 'ultra'): QualityConfig {
  // heightRes/simRes scale with the world; erosionIters/tileVerts do not.
  switch (preset) {
    case 'low':
      return {
        heightRes: Math.round(2048 * WORLD_SCALE),
        simRes: Math.round(1024 * WORLD_SCALE),
        erosionIters: 500,
        tileVerts: 49,
      };
    case 'ultra':
      return {
        heightRes: Math.round(4096 * WORLD_SCALE),
        simRes: Math.round(2048 * WORLD_SCALE),
        erosionIters: 900,
        tileVerts: 81,
      };
    case 'high':
      return { heightRes: HEIGHT_RES, simRes: SIM_RES, erosionIters: 640, tileVerts: 65 };
  }
}
````

### `LICENSE`

````text
MIT License

Copyright (c) 2026 Remi Sebastian Kits

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OF OR IN CONNECTION WITH
THE SOFTWARE OR OTHER DEALINGS IN THE SOFTWARE.
````

### `git ls-tree -r --long HEAD | awk '{print $4, $5}' | sort -rn`

````text
9729198 shots/phase-5/cmp-gorge-scene1.png
9444468 shots/phase-6/cmp-gate-scene1.png
9280136 shots/phase-2/golden-vs-witcher.png
7017995 shots/phase-0/cmp_sanity_vs_scene1.png
5029361 shots/phase-5/strip-5.png
4857036 shots/phase-5/floor-hero-19.5Mtris.png
4729829 shots/phase-5/strip-4.png
4704098 shots/phase-6/frox-shafts2.png
4631096 shots/phase-6/gate-c1.png
4543980 shots/phase-5/strip-3.png
4420849 shots/phase-5/floor-vista-6.8Mtris.png
4356092 shots/phase-6/aerial-strict.png
4349124 shots/phase-5/aerial-shadow-casters.png
4129033 shots/phase-5/strip-2.png
3971171 shots/phase-5/gorge-vs-scene1.png
3863230 shots/phase-5/strip-1.png
3782995 shots/phase-5/golden-crown-shadows.png
3761931 reference/02_Silver_Demo_Wallpaper_3840x2160_EN.png
3725844 shots/phase-5/floor-grass-1.0Mblades.png
3685150 shots/phase-2/ground-low-sun.png
3668172 shots/phase-1/top-down.png
3537713 shots/phase-6/gate-c2.png
3507525 shots/phase-2/golden-cumulus.png
3271354 shots/phase-2/edge-fallback.png
3236197 shots/phase-3/gi-vista.png
3216590 shots/phase-3/gi-ground.png
2989499 shots/phase-2/golden-vista.png
2928126 shots/phase-3/gi-golden.png
2864001 shots/phase-3/probes-only.png
2816540 shots/phase-6/caustics-stream1.png
2745611 reference/scene1.png
2664842 shots/phase-2/cloud-sea.png
2660917 shots/phase-6/frox-dawnfog.png
2609639 shots/phase-4/ground-cover.png
2505678 shots/phase-4/broadleaf.png
2397052 shots/phase-4/hero-beech.png
2374057 shots/phase-4/hero-spruce.png
2287505 shots/phase-4/rocks.png
2287170 shots/phase-4/conifers.png
2282709 shots/phase-1/vista-massif.png
2275122 shots/phase-4/impostor-compare.png
2253467 shots/phase-4/pink-shrub.png
2117809 shots/phase-4/cliff-dressed.png
2066537 shots/phase-4/deadfall.png
2062226 shots/phase-4/trees-golden.png
1994874 shots/phase-4/overview.png
1653683 shots/phase-6/wind-diff.png
1464061 shots/phase-1/erosion-split.png
1450352 reference/scene2.png
1373107 shots/phase-0/sanity.png
985314 reference/scene3.png
660858 docs/readme-hero.jpg
74768 package-lock.json
70026 STATUS.md
38981 src/vegetation/Forests.ts
37325 src/vegetation/GroundRing.ts
31413 src/render/PostStack.ts
30194 src/gpu/passes/Scatter.ts
23606 src/debug/GalleryScene.ts
22801 src/gpu/passes/FlowRivers.ts
22346 src/world/Heightfield.ts
21496 src/world/TerrainTiles.ts
18853 src/vegetation/VegLibrary.ts
17066 src/render/TerrainMaterial.ts
16785 src/core/FlyCamera.ts
16368 src/sky/Atmosphere.ts
16301 PROJECT_LAAS_v2.md
16193 src/render/WaterMaterial.ts
16092 src/world/MacroMap.ts
15021 src/gpu/passes/ProbeGI.ts
14962 src/sky/Clouds.ts
14605 docs/DELTA.md
14301 src/vegetation/Understory.ts
13296 src/render/VegMaterials.ts
13057 src/render/Gtao.ts
13037 src/debug/TerrainScene.ts
13027 src/vegetation/TubeMesh.ts
12044 src/vegetation/Skeleton.ts
11562 src/vegetation/GroundCover.ts
11465 src/vegetation/FoliageCards.ts
11212 src/gpu/passes/Erosion.ts
10861 src/render/Caustics.ts
10688 src/vegetation/Impostors.ts
10645 src/gpu/passes/Particles.ts
10533 src/vegetation/Species.ts
10168 src/gpu/passes/Froxels.ts
10113 src/render/VegInstance.ts
9777 tools/probe-horizon.ts
9134 docs/THREE-NOTES.md
9109 src/gpu/passes/BarkSynth.ts
9010 README.md
9004 src/vegetation/RockBuilder.ts
8810 tools/probe-cloudlag.ts
8415 src/render/Wind.ts
7893 src/core/Engine.ts
7890 src/render/ShadowSetup.ts
7721 src/vegetation/LeafMesh.ts
7643 src/gpu/passes/BiomeSnow.ts
7170 src/mobile/WalkControls.ts
6745 src/vegetation/Dressing.ts
6719 src/mobile/MobileScene.ts
6672 tools/shoot.ts
6422 src/render/CsmCached.ts
6063 src/debug/SanityScene.ts
6022 src/debug/Bookmarks.ts
5881 src/vegetation/VegTypes.ts
5793 src/vegetation/TreeBuilder.ts
5730 src/core/GpuProfiler.ts
5379 src/main.ts
5332 docs/DEVIATIONS.md
5176 src/sky/SunSky.ts
5121 src/render/HalfResMrt.ts
4955 src/debug/ShadowTestScene.ts
4919 tools/probe-csm3.ts
4907 tools/find-water.ts
4695 src/core/Diagnostics.ts
4592 src/render/ImpostorRuntime.ts
4558 src/world/CanopyShell.ts
4300 tools/probe-wetmargin.ts
4162 src/render/VegPrepass.ts
4154 src/core/BrowserGate.ts
4138 src/render/ThreePatches.ts
4032 src/debug/HUD.ts
3991 src/world/WaterSurface.ts
3950 tools/probe-pointerlock.ts
3947 src/gpu/noise/NoiseTSL.ts
3919 tools/launch.ts
3846 src/gpu/passes/NoiseBake.ts
3749 src/render/ColorScript.ts
3660 src/world/WorldConst.ts
3627 src/mobile/main-mobile.ts
3486 src/debug/ScatterDebug.ts
3484 tools/compare.ts
3378 src/mobile/grass.ts
3361 src/core/Seed.ts
3346 src/vegetation/Deadfall.ts
2963 src/mobile/terrain.ts
2922 tools/probe-csm.ts
2779 src/core/Hooks.ts
2701 tools/probe-state.ts
2527 src/mobile/buildMobileTree.ts
2493 src/mobile/mobile.css
2446 src/core/NoiseJS.ts
2368 src/core/Params.ts
2286 tools/probe-csm2.ts
2281 src/world/ShadowProxy.ts
2223 src/desktop.css
2157 tools/probe-line.ts
2079 tools/diff.ts
1921 src/gpu/BufferSample.ts
1747 tools/probe-moving.ts
1585 src/gpu/passes/HeightSynthesis.ts
1447 tools/probe-sunfx.ts
1300 tools/herotris.ts
1114 LICENSE
1095 index.html
1081 src/debug/Scenes.ts
1056 vite.config.ts
1056 tools/vegtris.ts
997 src/gpu/TSLTypes.ts
996 src/gpu/RenderUniform.ts
963 src/core/BootUI.ts
956 tools/probe-sun.ts
797 mobile.html
759 package.json
657 tsconfig.json
555 shots/phase-5/floor-grass.json
552 shots/phase-5/floor-hero.json
499 shots/phase-5/floor-vista.json
108 .gitignore
````
