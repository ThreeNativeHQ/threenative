# Visual baseline — what each `src/render/` file ships, and the traps

Companion to the `Visuals` section in this project's `AGENTS.md`. Everything here is ordinary
Three.js source in this project, yours to rewrite or delete.

## What is already there, so you do not rebuild it

- `shapes.ts` — `roundedBox`, `block`, `ball`, `tube`, `spike`, `makeRandom`. **Build props
  out of these, not raw `BoxGeometry`.** A sharp box reads as Minecraft; the same box with
  a 0.14 corner radius reads as a toy, and that is most of the difference between a scene
  that looks designed and one that looks like a test harness. `makeRandom` is a seeded RNG
  for alternating material colours across a run of meshes.
- `lighting.ts` — key, sky/ground bounce, **rim**, ambient, with soft shadows and a
  `normalBias` tuned for rounded geometry. The rim is what stops silhouettes reading as
  flat cut-outs; do not delete it while "simplifying".
- `camera.ts` — `createSpringArm`, a frame-rate-independent follow camera. Its offset and its
  **lead** are the framing: the default aims ahead of the character rather than centring it,
  because a level that runs one way puts half the picture behind the player otherwise.
- `postprocessing.ts` — ACES tone mapping and the WebGPU render pipeline.
- `scenery.ts` — `createScenery`, the collider-free half of the world: columns under ledges,
  spires in the middle distance, an unlit ridge on the horizon. **Keep something in all three
  bands.** A lit floor alone in black reads as a test fixture no matter how good the floor
  is, and it is the single cheapest thing to fix in a first screenshot.

## Three traps

1. **`CanvasTexture` samples black under `WebGPURenderer`.** Procedurally painting a canvas
   and using it as a `map` produces a black surface, silently. Get variety from alternating
   material colours across a run of meshes instead — that is what `makeRandom` is for.
2. **`flatShading` fights `roundedBox`,** which welds its seams precisely so normals
   interpolate across them. Do not set both.
3. **Import a render module and then call it.** `setupPost` and `setupLighting` are inert
   if the scene only imports them, and nothing in typecheck, lint, or a playtest will fail.

Nothing in the toolchain can see your game. `pnpm test` proves behaviour, never the look —
so when you change something visual, actually look at it before reporting it done.
