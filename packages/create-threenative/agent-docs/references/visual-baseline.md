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
