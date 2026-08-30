# docs/PRDs/lighting — how close to Lumen this stack can get, and what it costs

**Batch filed 2026-08-29, measured at `7e5a9fe1`.** Read `docs/PRDs/AGENTS.md` for filing rules.
This file is the evaluation; the PRDs are the work.

The prompt behind it: *"I like Unreal's Lumen. Which of these repos should we absorb, and which
abstractions?"* — against a shortlist of `0beqz/realism-effects`, `mrdoob/three.js`,
`gkjohnson/threejs-sandbox`, `Ameobea/three-good-godrays`, `cdrinmatane/SSRT3`,
`Donitzo/three.js-volume-renderer`, `compix/VoxelConeTracingGI`.

## The one constraint that decides every row

The native runtime is **`WebGPURenderer` only**, at the workspace catalog version
(`packages/runtime-native/AGENTS.md`, "a host, not a renderer"). Its post-processing contract is a
TSL node graph installed as `RenderPipeline.outputNode` — conformance case `62-postprocessing-pass`
(`packages/runtime-native/conformance/registry.json`, `required: true`) asserts exactly that, and
`packages/core/src/renderer.ts:310` throws for any renderer whose `kind !== "webgpu"`.

So: **a lighting technique written in GLSL against `WebGLRenderer` cannot reach desktop, Android or
iOS.** The root charter calls a web-only feature unfinished. That is not a stylistic preference
here — it deletes four of the seven shortlisted repos as *code* sources.

## Verdict per repo — measured against the installed tree, not from memory

| Repo | Absorb? | Why, checked |
| --- | --- | --- |
| **`mrdoob/three.js` TSL display nodes** | **Yes — adopt, do not vendor** | `three@0.185.1` is already the catalog dep and already ships `SSGINode`, `SSRNode`, `GTAONode`, `DenoiseNode`, `RecurrentDenoiseNode`, `TemporalReprojectNode`, `TRAANode`, `GodraysNode`, `SSSNode`, `TAAUNode`, `FSR1Node`, `BilateralBlurNode` in `three/addons/tsl/display/`. Every one imports `three/webgpu` + `three/tsl`. MIT, zero new dependency, crosses the native seam. |
| **`cdrinmatane/SSRT3`** | **Already absorbed — by upstream** | `SSGINode.js`'s own docblock cites `https://github.com/cdrinmatane/SSRT3` and the SSILVB slides as its reference, and exposes SSRT3's `sliceCount`/`stepCount` knobs directly. Porting it again is redoing upstream's port from Unity HLSL. |
| **`three.js` `LightProbeGrid`** | **Yes — and this is the real work** | `three/addons/lighting/LightProbeGrid.js` exists (L2 SH irradiance probes, cubemap bake, 3D atlas) but its own docblock says: *"this class can only be used with `WebGLRenderer`. A version for `WebGPURenderer` will be added at a later point."* Unusable here as shipped. Porting the bake + atlas + sample to TSL is **PRD-268** — see below for why it is the highest-value item in the batch. |
| **`three.js` `ClusteredLighting` / `DynamicLighting`** | **Yes — cheap, overlooked** | `three/addons/lighting/`, both WebGPU (`renderer.lighting = …`). Forward+ clustering for many emissive lights; `DynamicLighting` batches lights into uniform arrays so adding a light stops recompiling materials. Not on the original shortlist. |
| **`0beqz/realism-effects`** | **No — mine the ideas, not the code** | Targets `WebGLRenderer`, requires the pmndrs `postprocessing` package, ships `.glsl`. MIT and genuinely good, but it cannot execute on `WebGPURenderer` and therefore cannot execute on desktop/Android/iOS. Its SSGI/SSR/AO/TRAA are all covered by upstream nodes above. Its one contribution upstream does not hand you is **correct motion vectors for skinned and instanced geometry**, which is what its temporal filters are actually built around — re-implemented in TSL as **PRD-269**, not vendored. |
| **`gkjohnson/threejs-sandbox`** | **No** | Same disqualifier: GLSL/`WebGLRenderer` experiments. Read it for technique; nothing lands. |
| **`Ameobea/three-good-godrays`** | **No** | Built on pmndrs `postprocessing`, WebGL. Upstream `GodraysNode` (TSL, WebGPU) covers it, plus a bilateral blur its own docblock recommends pairing. Also avoids the licence question — upstream is MIT and already a dependency. |
| **`compix/VoxelConeTracingGI`** | **No, not now** | C++/OpenGL voxel cone tracing. This *is* the technique Lumen's software path resembles, and it is the only shortlist entry that would beat a probe grid on quality. It is also a multi-month port with a voxelisation pass, clipmap storage and its own cost model. Revisit only after PRD-268 ships and its probe density is measured to be the limiting factor. |
| **`Donitzo/three.js-volume-renderer`** | **No** | Generic volumetric raymarching. `packages/core/src/atmosphere` and `ocean` already own compute-driven volumetric lifetimes here; a second foundation duplicates them. |

**Net: zero repos vendored. One dependency you already have, adopted properly; one WebGL-only
upstream class ported to WebGPU; one idea re-implemented.**

## Where "mini-Lumen" actually breaks, and what closes the gap

Lumen is four things: dynamic diffuse GI with **off-screen** contribution, dynamic reflections,
many emissive lights, and quality that scales down without the artist re-authoring.

| Lumen does | What this stack has after adopting upstream | Gap that needs framework work |
| --- | --- | --- |
| Diffuse GI, on **and** off screen | `ssgi()` — on-screen only. Light from behind the camera or behind a wall does not exist. | **Irradiance probe volume on WebGPU** → PRD-268. This is the single largest visual difference and the reason SSGI alone never reads as Lumen. |
| Reflections | `ssr()` — screen-space only, same blind spot | Probe volume's specular fallback (PRD-268 scope note) |
| Many emissive lights | `ClusteredLighting` | Template wiring → PRD-267 |
| Temporal stability on animated meshes | `TRAANode`/`TemporalReprojectNode` need velocity | **Motion vectors for skinned + instanced** → PRD-269. Without it every character smears. |
| Scales down without re-authoring | `ResolutionScaler` (`packages/core/src/resolution-scaler.ts`) does this for pixels only | **Lighting quality tiers on the same evidence loop** → PRD-266 |
| Runs everywhere the game ships | — | **Native parity per node** → PRD-270 |

## Which abstractions the framework may own — and which it may not

Charter rule 3 is the line. Anything that *decides how it looks* ships as generated source in
`templates/*/src/render/`, at any size. Mechanism is fair game.

**Framework (`packages/core/src/render/`) — mechanism only:**

- Composition and ordering of a node chain, because correct order (AO → GI → SSR → denoise →
  temporal → tonemap) is not a look decision and every game gets it wrong once.
- Capability detection and degradation, because a game cannot portably ask "does this target run
  SSGI" — that is a platform seam, so charter rule 1(a) puts it here at any size.
- Probe volume placement, bake scheduling, atlas storage, GPU upload, sample node. The game
  supplies bounds and density; the framework supplies none of the colour.
- Velocity/motion-vector buffer provisioning for skinned and instanced geometry.
- **Honest reporting**: which tier ran, which effect was dropped and why. A convention turned off
  must not turn its measurement off.

**Templates (`templates/*/src/render/postprocessing.ts`, `lighting.ts`) — the look:**

- Which effects are on, at what strength, in what colour; tonemapping and exposure; godray tint;
  SSGI slice/step counts per template; probe density for that level's scale.

The test, from the charter: **can a game change the appearance completely without editing package
code?** If a knob fails that test it is in the wrong file.

## The PRDs

| PRD | Title | Depends on | Complexity |
| --- | --- | --- | --- |
| [PRD-266](./PRD-266-the-render-chain-names-the-tier-it-actually-ran.md) | the render chain is a seam the game fills, and it names the tier it actually ran | — | MEDIUM |
| [PRD-267](./PRD-267-screen-space-gi-ships-in-the-templates.md) | screen-space GI, reflections and their denoiser ship in the templates | 266 | LOW |
| [PRD-268](./PRD-268-light-that-comes-from-off-screen.md) | light that comes from off-screen: an irradiance probe volume on WebGPU | 266 | HIGH |
| [PRD-269](./PRD-269-motion-vectors-or-the-temporal-filters-lie.md) | motion vectors for skinned and instanced geometry, or the temporal filters lie | 266 | MEDIUM |
| [PRD-270](./PRD-270-no-lighting-node-ships-web-only.md) | no lighting node ships web-only | 266, 267 | MEDIUM |

**Order:** 266 first — nothing else can land safely without the seam and the honest tier report.
Then 267 (visible in a day, and it is what makes the gap in 268 legible on screen). 269 before 268,
because a probe volume judged through smearing temporal filters cannot be judged at all. 268 last
and longest. 270 runs beside 267 onward and gates each of them.
