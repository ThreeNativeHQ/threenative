# Puzzle starter kit

A contraption room. A ball has to reach a ring on the far side of a lip it cannot roll over, and
everything in the room is a way of getting it there: three crates you carry into a ramp, and a
90 kg weight hanging from a hinge that you can set swinging.

Nothing here is downloaded. Every shape is a box, cylinder, sphere or torus built in
`src/render/shapes.ts`, so the kit has no asset licence, no loading wait, and nothing to fetch.

```sh
pnpm dev            # play it
pnpm test           # the committed scenarios, in a real browser
pnpm build          # web
pnpm build --target desktop
```

## Controls

| Input | Does |
| --- | --- |
| `W A S D` / arrows | move the claw |
| `E` or `Space`, or tap a crate | grab and drop the nearest crate |
| `F` | shove the hanging weight |
| `R` | reset the room |

On a touch device a left thumbstick and two buttons appear instead; the same code path runs.

## What each piece is

| File | Owns |
| --- | --- |
| `src/room.ts` | the room's geometry, its static colliders, and the instanced floor grid |
| `src/entities/Crate.ts` | a carried box — steered by velocity, never teleported |
| `src/entities/Pendulum.ts` | the beam, the bob, and the hinge between them |
| `src/entities/Ball.ts` | the ball and the goal volume that notices it |
| `src/entities/Gripper.ts` | the player |
| `src/render/` | everything that decides how it looks. Yours to rewrite. |

## Where to take it

The room is one `buildRoom()` call and three crate spawns. Move the lip, add a second ball, hang
two weights on one beam, or make the goal move. If you want a second room, add a scene beside
`Puzzle` and `goto` it — the state shape and HUD already carry a status.
