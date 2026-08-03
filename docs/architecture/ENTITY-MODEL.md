# Entity model — the ECS question, closed

**Status:** decided and shipped. **Design authority:** `DESIGN.md` §2, §11.1.
**Implements:** `docs/PRDs/PRD-006-entity-registry.md`.

## The decision

> **Do not market or expose ThreeNative as an ECS-first engine. Keep an addressable,
> data-shaped view of the world, and expose it only where something needs to read it.**

"Comes with an ECS" is not a user benefit. It is an implementation choice, and in v1 it
was a costly one: a JSON/structured-source ECS measured **14x vanilla Three.js** on
greenfield work (8.27x cost-weighted) *and* scored lower on playability and visuals.

## What entities actually are here

Plain TypeScript classes. This is `templates/starter/src/entities/Player.ts`, verbatim
in shape:

```ts
export class Player {
  readonly mesh = new Mesh(new BoxGeometry(0.6, 1, 0.6), new MeshNormalMaterial());
  readonly body: CharacterBody3D;

  update(ctx: GameCtx, dt: number): void {
    const move = ctx.input.vector("move");
    this.body.move({ x: move.x * dt * 2, y: 0, z: move.y * dt * 2 });
  }

  debug(): Record<string, unknown> {
    return { grounded: this.body.grounded, position: this.mesh.position.toArray() };
  }
}
```

No component registration, no system ordering, no archetypes, no query DSL. A model
already knows how to write this file. That is the entire argument — `DESIGN.md` §2's
founding constraint: *models are worst at discovering novel API surfaces.*

## What we kept from ECS, and only that

The one thing plain classes lack is **addressability**: nothing can enumerate the world
or resolve a name to state. Four consumers need exactly that, and none of them needs
archetypes.

| Consumer | Needs | Provided by |
|---|---|---|
| Playtest scenarios | resolve `entity: "player"` to state | `Registry.get` / `snapshot` |
| Debug overlay | live table of entity values | `DebugOverlay` |
| An agent, mid-debug | one call instead of a breakpoint hunt | `window.__THREENATIVE__.snapshot()` |
| Save data, later | a serializable view of the world | `snapshot()` shape |

The whole registry is ~45 lines in `packages/core/src/entities.ts`:

```ts
ctx.entities.add("player", new Player(ctx));   // throws on duplicate name
ctx.entities.get<Player>("player");
ctx.entities.remove("player");
ctx.entities.snapshot();   // { player: { grounded: true, position: [0, 0.5, 0] } }
```

`snapshot()` calls `debug()` when an entity defines one, and falls back to `autoFields()`
— numbers, strings, booleans and anything with `.toArray()`, capped at 24 fields so a
`Mesh` cannot explode the output. Registry is cleared on scene exit. The global is
dev-only and stripped from `dist/`.

## The three API levels, and where we stopped

| Level | Shape | Status |
|---|---|---|
| 1. Prefabs and behaviours (`definePrefab`, `chasePlayer()`) | Declarative genre vocabulary | **Rejected.** `DESIGN.md` §2: 0 of 7 presets ever reproduced their genre. Prefabs are template *code*, in `src/entities/` |
| 2. Plain classes + named registry | `new Player(ctx)`, `ctx.entities.add(...)` | **Shipped.** The default and only taught surface |
| 3. Queries and systems (`game.query(Transform, Health)`) | Opt-in data-oriented processing | **Not built.** No demand has been measured; §11.1's 20-line rule blocks speculative construction |

Level 3 stays unbuilt until a real game profiles as bottlenecked on per-entity iteration.
A game that wants one today runs `pnpm add miniplex` — the framework neither ships nor
fights it.

## Three.js is the renderer, not the world

The rule worth keeping from the ECS argument, independent of ECS:

> Three.js objects represent **what gets rendered**. They are not obliged to be the
> authoritative representation of the whole game.

Today that separation is cheap and informal: an entity owns its `mesh` and its Rapier
body, and the registry indexes the entity, not the `Object3D`. That is enough to make
rendering optimizations (batching, instancing) or a native physics step possible later
without changing the game's conceptual model — which is the actual payoff people reach
for ECS to get.

What we do **not** do is build the extraction pipeline before a game needs it. `DESIGN.md`
§11.2's kill switch applies: an abstraction that costs more code than vanilla gets
deleted, no matter how much work it took.

## Direct Three.js access is never removed

```ts
ctx.renderer        // RendererLike — .raw is the THREE.WebGPURenderer
ctx.scene           // THREE.Scene
ctx.camera          // THREE.PerspectiveCamera
ctx.physics.world   // Rapier World
crate.body.body     // Rapier RigidBody
crate.mesh          // THREE.Mesh
```

There is no wrapper type to unwrap. Every Three.js tutorial, StackOverflow answer and
model completion from the last decade applies unchanged inside a ThreeNative scene, and
an entity that ignores the registry entirely still gets the loop, input, assets and
playtest for free.
