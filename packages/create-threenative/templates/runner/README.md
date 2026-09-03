# Runner starter kit

Three lanes and a track that builds itself ahead of you. Obstacles end the run; passing one
close shakes the camera. The track is a ring of six chunks that get moved and rebuilt, so a
ten-minute run costs what a ten-second one does.

Nothing here is downloaded. Every shape is a box, capsule or cylinder built in
`src/render/shapes.ts`, and the dust is a TSL particle surface in `src/render/dust.ts` — no
texture, no asset licence, nothing to fetch.

```sh
pnpm dev            # play it
pnpm test           # the committed scenarios, in a real browser
pnpm build          # web
pnpm build --target desktop
```

## Controls

| Input | Does |
| --- | --- |
| `A` / `D`, or arrows | change lane |
| `Space` | jump |
| `R` | run again |

On a touch device two lane buttons and a thumbstick appear; flick the stick up to jump.

## What each piece is

| File | Owns |
| --- | --- |
| `src/track.ts` | the chunk ring — build, recycle, and the obstacle bodies |
| `src/entities/Runner.ts` | the lane snap, the jump arc, and the `Area3D` that detects a hit |
| `src/render/dust.ts` | the trail: a game-authored TSL surface handed to `GPUParticles3D` |
| `src/render/camera.ts` | the chase rig, and where the shake is added |
| `src/render/` | everything that decides how it looks. Yours to rewrite. |

## Where to take it

The track is `RESIDENT_CHUNKS` slices and one `build` method. Add a second obstacle height that
has to be jumped rather than dodged, a pickup lane, a speed gate, or a second seed that swaps the
palette every kilometre. `defineGame({ seed })` is the level — change it and the whole track
changes, deterministically.
