# Visual baseline — what each `src/render/` file ships, and the traps

Companion to the `Visuals` section in this project's `AGENTS.md`. Everything here is ordinary
Three.js source in this project, yours to rewrite or delete.

## What is already there, so you do not rebuild it

- `shapes.ts` — `roundedBox`, `block`, `ball`, `tube`, `spike`. **Build props out of these,
  not raw `BoxGeometry`.** A sharp box reads as Minecraft; the same box with a 0.14 corner
  radius reads as a toy, and that is most of the difference between a scene that looks
  designed and one that looks like a test harness. For the seeded randomness that varies a
  run of meshes, the scene builds `createRandom(seed)` and passes it down — nothing in
  `src/render/` may import a framework package, which is what keeps this folder portable.
- `lighting.ts` — key, sky/ground bounce, **rim**, ambient, with soft shadows and a
  `normalBias` tuned for rounded geometry. The rim is what stops silhouettes reading as
  flat cut-outs; do not delete it while "simplifying".
- `camera.ts` — `createSpringArm`, a frame-rate-independent follow camera. Its offset and its
  **lead** are the framing: the default aims ahead of the character rather than centring it,
  because a level that runs one way puts half the picture behind the player otherwise.
- `postprocessing.ts` — the editable presets and `setupPost` delegation.
- `worldEnvironment.ts` — the editable Godot-named render chain: tone mapping/exposure and
  optional TSL stages, with `createRenderChain` reporting applied or refused stages.
- `scenery.ts` — `createScenery`, the collider-free half of the world: columns under ledges,
  spires in the middle distance, an unlit ridge on the horizon. **Keep something in all three
  bands.** A lit floor alone in black reads as a test fixture no matter how good the floor
  is, and it is the single cheapest thing to fix in a first screenshot.

## Traps

Each of these has cost real debugging time. All of them fail *silently* — nothing in
typecheck, lint, or a playtest catches one, and several look exactly like "the effect is on
and does nothing".

1. **`CanvasTexture` samples black under `WebGPURenderer`.** Procedurally painting a canvas
   and using it as a `map` produces a black surface, silently. Get variety from alternating
   material colours across a run of meshes instead, or from `softCircleDataTexture`, which
   writes sprite pixels straight into a `DataTexture` and is the framework's way around this.
2. **`flatShading` fights `roundedBox`,** which welds its seams precisely so normals
   interpolate across them. Do not set both.
3. **Import a render module and then call it.** `setupPost` and `setupLighting` are inert
   if the scene only imports them.

### TSL post-processing stages that install and then do nothing

4. **`SSRNode.maxDistance` defaults to `1` — one world unit.** On any scene larger than a
   tabletop every reflection ray dies after a metre and returns nothing, on every pixel. This
   reads as "screen-space reflections are on and have no effect". Set it to the distance across
   the scene you actually want reflected.
5. **`reflectNonMetals` defaults to `false`.** A polished stone, wood, or painted floor is not
   metal, so by default it never reflects — only metals do. A polished floor is the usual
   reason to reach for SSR at all, so this default silently removes the effect you wanted.
   `roughnessNode` left `null` is the mirror-image mistake: every surface is then treated as a
   perfect mirror.
6. **Do not swizzle the normal you hand a pass.** `ssr()` calls `.sample()` on that node, so it
   needs the whole `TextureNode` from the MRT target; `normal.xyz` produces a plain vec3 and the
   pass dies at shader build with `this.normalNode.sample is not a function`. `@types/three`
   declares the parameter as `Node<"vec3">`, which is exactly what makes the swizzle look
   correct — the types are wrong here and the runtime is right.
7. **A dangling graph branch renders a blank frame.** When a pass needs a *texture* rather than
   an expression, materialise the chain **once** with `convertToTexture` and reuse that texture
   on both sides of the composite. Passing `convertToTexture(lit)` into the pass while adding
   its result back onto the unconverted `lit` builds two parallel copies of the same graph, one
   rendered into a target and one not — and whether the frame appears then depends on whether
   some *other* stage happens to re-materialise the second copy. Measured on a real scene: it
   rendered with bloom on, rendered with SSR off, rendered with godrays off, and came back as
   the bare background colour only when all three conditions lined up. That is what a dangling
   branch looks like from the outside, and it is not a driver bug.

Nothing in the toolchain can see your game. `pnpm test` proves behaviour, never the look —
so when you change something visual, actually look at it before reporting it done.

## The chain, in order — and what each stage costs

`postprocessing.ts` builds a `WorldEnvironment` and hands its stages to the engine's render
chain, which sorts them into one canonical order. The order is not a preference:

1. **ambient occlusion** and **SSGI** gather, because both read the depth and normal buffers the
   scene pass wrote and neither can read a composited image.
2. **denoise** runs inside the gather stage on its AO and GI terms, before they are added to the
   beauty pass — denoising the composite instead smears the geometry it was meant to preserve.
3. **godrays**, then **SSR**, which add light rather than remove it, so they see the frame the
   gather has already occluded and lit.
4. **sharpen**, because RCAS is defined on the finished picture and sharpening before bloom
   sharpens edges that bloom then spreads back out.
5. **bloom**, then **vignette**, then the tone curve — the last thing the frame meets.

Exposure is applied as a multiply on the scene pass, ahead of every stage, so the gather, the
reflections and the bloom threshold all see the same exposed image. `renderer.toneMappingExposure`
is live too and reaches the frame at the same point, but only when no output node is installed;
with any stage running, the multiply is the shutter.

### Cost

Measured on a dense interior (a sandbox cathedral, not one of these templates) at 1600x900 on a
desktop RTX 2080, browser WebGPU, as GPU time per frame — `gpuMs` in `TN_FRAME_BUDGET`, not the
CPU `render` phase, which reads ~5.5 ms while the GPU frame is 14.7 ms and therefore cannot see
this at all:

| configuration | gpuMs | fps |
| --- | --- | --- |
| every stage on | 14.7 | 56.8 |
| minus SSGI + denoise | 5.5 | 126.3 |
| minus SSR | 10.6 | 77.0 |
| minus bloom | 10.1 | 72.4 |
| minus denoise only | 12.8 | 60.3 |
| every stage off | 2.2 | 333.3 |

The scene, its shadow map and the overlay together cost 2.2 ms of that frame; the chain costs the
other 12.5. **SSGI is the expensive one by a wide margin** — the gather is ~7.3 ms and its two
full-resolution denoise passes ~1.9 ms at `medium` — which is why `ssgiQuality: "high"` (3 slices
x 16 steps) and full-resolution SSR are the two knobs to reach for first when a frame is late.
Godrays measured ~0.0 ms here and are off by default for a different reason: a shaft needs a sun,
an occluder and interior air to read at all, and none of these templates is an interior.

Your scene is not this one. Read your own numbers out of `TN_FRAME_BUDGET` before believing any
row above applies to it.

### Turning a stage on

Every stage that ships off is one property in the preset object in `postprocessing.ts`:

```ts
gtaoEnabled: true,      // contact occlusion in the crevices SSGI's room-scale gather misses
godraysEnabled: true,   // needs the shadow-casting light setupLighting returns; interiors only
vignetteAmount: 0.25,   // corner darkening, as the fraction removed at the extreme corner
ssgiEnabled: true,      // also for mobile: add it to mobilePreset and measure the result
```

`TN_WORLD_ENVIRONMENT` prints every run and names each stage as applied, or refused **with a
reason** — `godraysEnabled is false`, `light 'sun' does not cast shadows`, `renderer:webgl2`. A
stage you turned on that is not in that line as `applied: true` did not run, and the reason says
why. An unknown `ssgiQuality` or `tonemapMode` throws at construction rather than quietly
becoming the default.
