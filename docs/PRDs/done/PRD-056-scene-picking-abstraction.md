# PRD-056 — Scene picking behind `ctx.raycast`

**Status: COMPLETE, 2026-08-09.** Gates run on this change: `pnpm typecheck`, `pnpm lint`,
`pnpm test` (84 files, 619 tests), `pnpm test:templates` (minimal, starter, platformer, exit
0), `pnpm budgets`.

**What this owns:** where the acceleration structure behind mesh ray queries lives, and what
a game's agent has to know about it.

**What this does not own:** physics ray queries (`ctx.physics.world.castRay`, unchanged),
plane projection (`Viewport.projectPosition`, unchanged), and anything a screenshot shows.

**Charter authority:** `CHARTER.md` §11 rule 1 (the 20-line rule), rule 4 (borrowed
vocabulary), rule 5 (package count), §10 (budgets). `packages/core/AGENTS.md` closed-scope
list, now amended to name accelerated scene ray queries.

## 1. What this reopens, and why

PRD-038 §6 shipped `three-mesh-bvh` as four lines of generated source in
`templates/starter/src/pick.ts` and **rejected** putting it behind the framework. Its own
statement of the problem is the reason to revisit:

> there is no error. Raycasting a 100k-triangle mesh with the stock `Mesh.raycast` does not
> throw, warn, or fail — it just walks every triangle, every pointer event, forever.

Two things the template route did not deliver:

1. **Coverage.** `pick.ts` existed in one of three templates. `minimal` and `platformer` had
   no picking at all, and a game written from scratch against `@threenative/core` got
   nothing. The silent failure PRD-038 named was avoided only for agents that happened to
   scaffold `starter` and happened to keep that file.
2. **Correctness beyond the first pick.** The template built the tree once per geometry and
   never invalidated it. A geometry whose positions change afterwards keeps stale bounds and
   silently returns wrong hits — reproduced as a failing test in
   `packages/core/__tests__/picking.spec.ts`.

## 2. Why PRD-038's three objections no longer apply

All three were against one specific implementation — prototype patching plus build-at-load.
`ScenePicker` uses `MeshBVH` as an ordinary object instead.

| PRD-038 §6 objection | What changed |
|---|---|
| "Prototype patching is a global side effect from a package import" | No prototype is patched. `MeshBVH.raycastObject3D(object, raycaster, hits)` is called directly, so `Mesh.prototype.raycast` is untouched and core stays consumable from R3F. Asserted by a test. |
| "Building a BVH is 100–300 ms per 100k-triangle geometry … by default on every loaded mesh" | Nothing is built at load. A tree is built on the first `ctx.raycast` that reaches that geometry. A game that never calls `ctx.raycast` never builds one. |
| "An opt-in `defineGame` option buys nothing" | Agreed, and none was added. There is no flag and no option. |

The objection that survives is bundle cost, measured in §4.

## 3. The surface

One property on `Ctx`, borrowing the Three.js name (`CHARTER.md` §11 rule 4 — Godot has no
mesh-level pick, so Three.js is the next source):

```ts
ctx.raycast(): Intersection | undefined
ctx.raycast({ screen, targets }): Intersection | undefined
```

Defaults are the current pointer position and the whole scene. The return value is a real
`THREE.Intersection` — there is no wrapper to unwrap.

`ScenePicker` and its option types are exported from `@threenative/core` for games that want
a second picker with a different camera; `ctx.raycast` is the one an agent will find.

**Result parity is the contract.** Skinned, instanced, batched and morphed meshes fall back
to the stock `three` path, because a hierarchy over their rest positions reports hits in the
wrong place. Layers are honoured the way `Raycaster.intersectObject` honours them.

## 4. Measurements

- **Tree-shaken bundle cost of `MeshBVH`**, which PRD-038 §6 left unmeasured
  (`esbuild --bundle --minify --format=esm --external:three`): **46.5 KB minified, 15.7 KB
  gzipped**. Paid by every game, because `game.ts` constructs the picker in `start()`.
- **`pnpm budgets`**: 5,990 / 15,000 framework LOC. The pre-existing native runtime trigger
  (60,433 / 50,000) is unrelated to this change. Largest template 1,200 LOC — this change
  removes lines from `starter` rather than adding them.
- **`starter-pick` playtest, unchanged from PRD-038**: `fastPicks >= 50` still passes against
  the 100k-triangle sculpture, now with no `three-mesh-bvh` in the generated project.

## 5. What was decided against

- **A `@threenative/picking` package.** `CHARTER.md` §11 rule 5 would permit it, and it would
  tree-shake to zero for games that never pick. Rejected because the goal is that an agent
  finds this without knowing to look: a module it must import costs the same discovery as the
  four lines PRD-038 shipped, which is the objection PRD-038 itself raised against a flag.
  46.5 KB is the price of that. If the number grows, this is the fallback.
- **A `defineGame` option.** See §2.
- **Building trees at load.** See §2.
- **Emitting a `render.sceneRayQuery` effect-log entry.** `packages/playtest/src/assertions.ts`
  already reads that service name and nothing in the repository emits it, so the branch is
  dead. Out of scope here; it is a playtest-side gap, not a picking one.

## 6. Proof

`packages/core/__tests__/picking.spec.ts`, six tests:

- nearest hit under the pointer, and `undefined` on a miss
- the accelerated path is taken and `Mesh.prototype.raycast !== acceleratedRaycast`
- a morphed mesh falls back to the stock raycast
- the hierarchy is rebuilt when the geometry's positions change
- `dispose()` drops cached hierarchies and the next query rebuilds
- a non-finite screen point throws rather than returning a silent miss

**Mutation-checked.** The invalidation test was first written against a two-triangle plane
and passed with invalidation deliberately disabled — three-mesh-bvh skips the bounds test on
a single-leaf root, so the assertion proved nothing. It was rewritten against a subdivided
plane (2,048 triangles) and now fails when the version check is removed.

`packages/create-threenative/templates/starter/playtests/pick.playtest.json` proves it in a
real browser and is unchanged, so the gate that PRD-038 built to prove acceleration is the
same gate proving it here.
