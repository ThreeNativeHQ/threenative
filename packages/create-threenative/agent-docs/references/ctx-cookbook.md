# The ctx cookbook — recipes behind the `ctx` surface table

Companion to the `The ctx surface` section in this project's `AGENTS.md`. The table there is
the contract; this page is the how and the why.

## Pointer picking with `ctx.raycast()`

It defaults to the current pointer position and the whole scene, returns the nearest
`THREE.Intersection`, and stays under a millisecond on meshes large enough that a plain
`Raycaster` visibly stutters — it keeps an acceleration structure per geometry and rebuilds it
when that geometry's positions change. Pass `{ origin, direction }` for a world ray, `{ far }`
to cap its distance, `{ exclude }` to remove subtrees, and `{ targets }` to narrow it. Use
`raycastAll` when occlusion or another query needs every hit; results are sorted nearest first.
`{ screen }` tests a point that is not the pointer. Skinned, instanced and morphed meshes fall
back to the stock Three.js path automatically, so the result always matches
`Raycaster.intersectObject`.

When scene collapse runs on a large static scene, a mesh with non-empty `userData` stays as the
original object in the live graph. Put the target or entity metadata you already use for picking
on the mesh; `ctx.raycast()` then still returns that mesh and its metadata. Meshes without
`userData` may be merged into fewer draws.

## Scene rebuild semantics

Calling `ctx.goto("<scene-name>")` from inside the matching scene tears it down and rebuilds
it: `exit()` runs, scheduled callbacks are cleared, registered entities are cleared, the Three
scene is emptied, then a fresh instance runs `load()` and `enter()`. Values in `ctx.state` —
health, score, inventory, or any other game-owned state — survive this scene rebuild. When
death-and-retry should reset gameplay, reset your own state explicitly before calling
`ctx.goto()`.

Do **not** write a `#reset()` that walks your entities putting them back. It is ~15 lines that
look right and quietly miss the scheduler and anything you spawned after `enter()`, so the
second playthrough behaves differently from the first — and no gate in this project will catch
that.

## Timing with `ctx.tween` and `ctx.after`

**`ctx.tween` is for timing, not for looks.** Use it for the *when* — a pickup rising over
0.4s, a door opening, a hit flash — and keep the *what* (colour, shape, easing feel) in
`src/render/`. Motion driven by a persistent `Math.sin(elapsed)` in `update()` is still the
right tool for a continuous idle bob; `tween` is for anything that starts, runs once, and
finishes. `ctx.after(seconds, fn)` and `ctx.every(fn)` schedule on the same clock the scene
runs on; both handles are cleared when the scene exits.

## Seeded randomness

**`ctx.random` is deterministic only when `defineGame({ seed })` is configured.** Check
`src/game.ts`: a declared seed gives replayable values for spawn positions, patrol offsets,
and level variation; without one, `ctx.random` falls back to `Math.random()`. Add a fixed
seed when a playtest needs replayable randomness.
