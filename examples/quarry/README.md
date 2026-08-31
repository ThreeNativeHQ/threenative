# quarry

A first-person walk through geometry far denser than the screen can resolve. It is the instrument
[PRD-280](../../docs/PRDs/done/nanite-like/PRD-280-the-quarry-is-the-instrument.md) asks for — the thing
that prices the problem the [virtual geometry batch](../../docs/PRDs/nanite-like/README.md) opens or
closes on — and it is graded as a measurement rather than as a game.

It is still walkable, and that matters: popping and cracks are found by eye at eye height long
before a test finds them.

## Walk it

```sh
pnpm --filter quarry bake                     # ~20 s, writes an ignored public/assets/
pnpm --filter quarry dev --host 127.0.0.1
```

Then open one of:

| URL | What it does |
| --- | --- |
| `/?mode=free` | **WASD** or the arrow keys to walk, mouse to look. This is the crack detector. |
| `/?arm=dense` | The route, on the geometry as imported. Press **Space** to start walking. |
| `/?arm=decimated` | The route, on the same scene through the pipeline's `simplify` at 5%. |
| `/?mode=control` | The pit floor, alone, from the pose the arms are diffed at. |

The route does not start until Space is pressed. A 14 MB arm loads hundreds of frames slower than a
2 MB one, and a walk that began on the first frame would have each arm measured on a different
stretch of the same route.

## What is in it

| Body | Triangles | Role |
| --- | --- | --- |
| One carved cliff face | 1,999,200 | the hero, approached to 0.4 m at the end of the route |
| Six boulder sources, 396 instances | 151,380 – 397,620 each | many instances of few sources |
| A heightfield quarry floor | 524,288 | the control surface, never simplified, identical in every arm |
| A collapsed gantry and its grating | 314 | thin and alpha-cut: the hazard case |

Nothing above is committed. `src/quarry/bodies.ts` generates all of it from a seed, and
`scripts/__tests__/quarry-instrument.spec.ts` holds each body's `positionHash` against a constant,
so two machines can prove they are measuring the same triangles before they compare frame times.

## Measure it

```sh
pnpm --filter @threenative/playtest build
pnpm --filter quarry measure -- --arm dense --url http://127.0.0.1:5191
pnpm --filter quarry measure -- --arm decimated --url http://127.0.0.1:5191
pnpm --filter quarry compare -- \
  --reference artifacts/quarry/dense --candidate artifacts/quarry/decimated
```

On native:

```sh
pnpm native:build                             # once
pnpm --filter quarry build:desktop && pnpm --filter quarry pack:native
pnpm --filter quarry measure -- --arm dense --target desktop
```

**Read `gpuMs`, not `render.p50` and not `fps`.** The quarry is bound on vertex and raster work, not
on submission: it draws ten times a frame and spends half a millisecond of CPU doing it, so the
frame budget's `render` phase reports the same number in every arm. And under the playtest runner's
private Xvfb the browser's presentation is throttled to a floor of roughly 66 ms, which swamps the
difference in `fps` and `presented`. `gpuMs` is a GPU timestamp query and is the only meter on
either lane that reads what the arms actually differ by. The measured numbers, and the gate they
were evaluated against, are in
[`docs/verification/prd-280-the-quarry-is-the-instrument-2026-08-30.md`](../../docs/verification/prd-280-the-quarry-is-the-instrument-2026-08-30.md).
