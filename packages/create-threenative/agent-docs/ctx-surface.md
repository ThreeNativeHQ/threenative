## The `ctx` surface — you already have these, do not rebuild them

`ctx` carries six things that get reimplemented by hand in almost every project, because
they are **properties on `ctx`, never imports** — grepping an existing file's imports will
never surface them. This table is the complete list.

| You already have | Rather than | Signature |
|---|---|---|
| `ctx.goto("<scene-name>")` | a hand-written `#reset()` | `(name: string) => Promise<void>` |
| `ctx.tween(obj, { y: 2 }, 0.4)` | a `Math.sin` / `lerp` accumulator | `(target, props, seconds) => Promise<void>` |
| `ctx.after(0.8, fn)` | `elapsed += dt; if (elapsed > 0.8)` | `(seconds, cb) => ScheduleHandle` |
| `ctx.every(fn)` | a per-frame branch in `update` | `(cb: (dt: number) => void) => ScheduleHandle` |
| `ctx.random.range(-1, 1)` | `Math.random()` | deterministic when `seed` is configured; otherwise `Math.random()` |
| `ctx.raycast()` / `ctx.raycastAll()` | `new Raycaster()` + `intersectObject(s)` | `(options?: { screen?, origin?, direction?, far?, targets?, exclude? }) => Intersection \| undefined` / `readonly Intersection[]` |

**`ctx.raycast()` is how you pick geometry under the pointer.** It defaults to the current
pointer position and the whole scene, returns the nearest `THREE.Intersection`, and stays
under a millisecond on meshes large enough that a plain `Raycaster` visibly stutters — it
keeps an acceleration structure per geometry and rebuilds it when that geometry's positions
change. Pass `{ origin, direction }` for a world ray, `{ far }` to cap its distance, `{ exclude }`
to remove subtrees, and `{ targets }` to narrow it. Use `raycastAll` when occlusion or another
query needs every hit; results are sorted nearest first. `{ screen }` tests a point that is not
the pointer. Skinned, instanced and morphed meshes fall back to the stock Three.js path
automatically, so the result always matches `Raycaster.intersectObject`.

When scene collapse runs on a large static scene, a mesh with non-empty `userData` stays as the
original object in the live graph. Put the target or entity metadata you already use for picking on
the mesh; `ctx.raycast()` then still returns that mesh and its metadata. Meshes without `userData`
may be merged into fewer draws.

**`ctx.goto(name)` rebuilds the scene without resetting game state.** Calling
`ctx.goto("<scene-name>")` from inside the matching scene tears it down and rebuilds it: `exit()` runs,
scheduled callbacks are cleared, registered entities are cleared, the Three scene is emptied,
then a fresh instance runs `load()` and `enter()`. Values in `ctx.state` — health, score,
inventory, or any other game-owned state — survive this scene rebuild. When death-and-retry
should reset gameplay, reset your own state explicitly before calling `ctx.goto()`:

```ts
if (player.dead) {
  ctx.state.set({ /* copy this game's initial-state shape */ });
  ctx.state.flush();
  void ctx.goto("<scene-name>");
  return;
}
```

Do **not** write a `#reset()` that walks your entities putting them back. It is ~15 lines
that look right and quietly miss the scheduler and anything you spawned after `enter()`, so
the second playthrough behaves differently from the first — and no gate in this project will
catch that.

**One rule when calling it from a frame function: `goto` and then `return`, immediately.**

```ts
if (player.dead) {
  void ctx.goto("<scene-name>");
  return;              // ← required. Everything below now runs against a torn-down scene.
}
```

From React, `game.goto("<scene-name>")` also rebuilds the scene, but it resets the game's state to its
declared initial state first. Use `game.goto("<scene-name>")` for a full restart button; use
`ctx.goto("<scene-name>")` only when preserving game state across the scene rebuild is intended.

**`ctx.tween` is for timing, not for looks.** Use it for the *when* — a pickup rising over
0.4s, a door opening, a hit flash — and keep the *what* (colour, shape, easing feel) in
`src/render/`. Motion driven by a persistent `Math.sin(elapsed)` in `update()` is still the
right tool for a continuous idle bob; `tween` is for anything that starts, runs once, and
finishes.

**`ctx.random` is deterministic only when `defineGame({ seed })` is configured.** Check
`src/game.ts`: the templates that declare a seed get replayable values for spawn positions,
patrol offsets, and level variation; without a seed, `ctx.random` falls back to `Math.random()`.
Add a fixed seed when a playtest needs replayable randomness. Never use `Math.random()` for a
value the scenario must reproduce.
