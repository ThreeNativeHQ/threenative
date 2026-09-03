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

## Streaming a second asset tier with `ctx.startup.hold()`

`ctx.startup.whenReady()` covers **the framework's** launch work — first-use compilation and a
sustained in-budget frame window — and nothing after it. If your game loads a cheap tier, enters,
and then streams the rest, readiness resolves in the middle of that and you get one of two bugs.

Show the world at `whenReady()` and the player watches it build itself. Measured in a forest game:
the loading screen lifted on one tree and a black sky, and the wood, the undergrowth, the animals
and the sky arrived over the next several seconds.

Hold your own curtain past `whenReady()` instead and the picture is right, but every
framework-owned observation of startup now describes a moment nobody experienced:
`startup.progress` sits pinned at `1`, `startup.phase` reads `ready`, `timeline.readyMs` reports
the framework's 1.5 s rather than the player's 8.8 s, and `assert.startup`'s `maxReadyMs` passes a
game that takes nearly nine seconds to show anything.

So register the tier instead, in `load()`, before the framework's gate can resolve:

```ts
override async load(ctx: GameCtx): Promise<void> {
  const detail = this.#loadDetailTier(ctx); // not awaited: enter() runs on the critical tier
  ctx.startup.hold("detail-tier", detail);
  await this.#loadCriticalTier(ctx);
}
```

`whenReady()`, `progress`, `phase` and `timeline.readyMs` now all wait for `detail`, so a loading
screen written the obvious way — hide it when `whenReady()` resolves — is correct again, and the
proof of startup time is a proof about the player.

Three things to know:

- **It fails open, twice.** A hold that rejects counts as settled, and the third argument bounds
  how long it may delay the world (45 s by default). A launch slower than it could be is a
  disappointment; a launch that never finishes because one texture 404'd is a bug.
  `timeline.frameworkReadyMs` still reports the framework's own cost, so a slow tier of yours
  cannot hide a framework regression inside it.
- **It fails closed on your mistakes.** An empty or duplicate label throws, and so does a hold
  registered after startup already resolved — each means you believe you are gating something you
  are not.
- **Do the loading, then hold, then enter.** Registering the hold is not what starts the work;
  pass a promise that is already running. And register it in `load()`: a hold added from `enter()`
  races the framework's gate on a warm cache.

### The one trap: never start held work from `whenReady()`

A hold makes readiness wait for your work. So work *started* from `whenReady()` is waiting for a
gate that is waiting for it:

```ts
// DEADLOCK. Only the hold's budget breaks it, and it presents as a very slow load.
void ctx.startup.whenReady().then(() => this.#loadDetailTier(ctx));
```

Measured, when exactly this was written: the valley sat on its loading screen for the full 45 s
budget and then revealed the critical tier, `TN_VALLEY_REVEAL trees=1`. Nothing errored. It reads
like a slow network, not like a cycle.

There is a real reason to want that shape — the framework's first-use compilation is competing for
the main thread, and streaming into it makes both slower. So wait on the framework's own gate
instead, which resolves before the holds:

```ts
void ctx.startup.whenFrameworkReady().then(() => this.#loadDetailTier(ctx));
```

`timeline.frameworkReadyMs` is when that fires; `timeline.readyMs` is when the player got the
world.
