# PRD-043 — Terrain and open worlds: what is missing, and how little of it is ours

**Status: COMPLETE — Phases 0–3 and all repository gates verified on 2026-08-08.** Two
framework builds, one sealed open-world pair, and **ten declines each with a stated
reopening trigger**.

**The headline finding, stated before the evidence so it can be checked against it:** a
WoW-like world needs twelve distinct capabilities. Exactly **two** are framework plumbing.
Four are already in `three` or in dependencies this repo already ships. Four are the look,
which `CHARTER.md` §5b makes permanently not-ours. Two are declined for lack of a measured
input, not for lack of size. The instinct that "the framework is missing terrain support"
is correct about the gap and wrong about who should close it.

**Gate:** `ROADMAP.md:146` — Phase 2's start gate is green (passed 2026-08-08). But Phase 2
is scoped to *"capabilities vanilla does not have"*, and **no round ledger names a terrain
gap.** `docs/verification/round-2-2026-08-07.md:11` closed round 2 on exploration with one
gap row, a cost gap, disposition `rejected`. There is no `open-world` genre in
`docs/benchmark/genres/` (four existed before this PRD: `endless-runner`, `exploration`,
`platformer`, `topdown-action`). **The Phase 0 pair now supplies the missing measurement.**
§1 explains why the corpus was silent, §5 records the measurement, and Phase 1's two builds
are justified on the 20-line rule independently of any round.

**Complexity: 3 phases** (one measurement, two ~10-line builds), plus a consumer proof.

**Charter authority:** `CHARTER.md` §11 rule 1 (the 20-line rule — this is what kills eight
of the twelve rows), rule 2 (the kill switch), rule 3 / §5b (**never own the look** — this
is what makes rows 4–7 permanent declines rather than deferrals), rule 4 (vocabulary is
borrowed, never invented — this is what kills row 9, which has no Godot node to borrow
from), rule 5 (**this PRD adds no package**; 7 of 8 are in use and the 8th is reserved for
`physics-native`, `CHARTER.md:426`).

**Sibling PRDs:** world persistence is [PRD-036](./PRD-036-save-load-and-deterministic-replay.md)'s
subject, not this one's — row 12 defers to it rather than restating it. Row 6 restates,
without contradicting, `OPPORTUNITY-AREAS.md:158` (area #9, score 48: *"`InstancedMesh` and
`LOD` both ship. Owning batching caps what the user can render. Ship as template source,
not package code."*). This PRD does not edit either file.

---

## 1. The census — 83 archives, zero terrain, and why that is not the argument

Run against every generated archive in the benchmark corpus.

```
cd docs/benchmark/sweeps
ls -d */src | wc -l                                              # 83
for t in PlaneGeometry InstancedMesh 'new LOD' heightfield noise simplex perlin fbm chunk trimesh convexHull; do
  printf "%-16s %s\n" "$t" "$(grep -rhoiE "$t" */src | wc -l)"
done
```

### 1a. What agents building 3D worlds actually reached for

| Token | Occurrences across 83 archives |
|---|---:|
| `PlaneGeometry` | 89 |
| `frustum` (all cases) | 30 |
| `InstancedMesh` | **0** |
| `new LOD` | **0** |
| `heightfield` | **0** |
| `noise` / `simplex` / `perlin` / `fbm` | **0** |
| `chunk` (all cases) | **0** |
| `trimesh` / `convexHull` | **0** |

Two of those rows are traps and are recorded here so nobody reads them the easy way:

- **The 30 `frustum` hits are not culling.** Every one is
  `dome.frustumCulled = false` in a `render/sky.ts` — an agent switching culling *off* on a
  skydome (e.g. `exploration-2026-08-07-3/src/render/sky.ts:41`). Zero archives implement
  visibility logic.
- **The only `terrain` hits are the framework's own file.** Four matches, all in two
  platformer archives, all the copied
  `templates/platformer/src/render/terrain.ts` — 29 lines exporting `platform()` and
  `bridge()`, which build rounded slabs. It is named `terrain.ts` and it is not terrain.

### 1b. What an "exploration" arm builds when asked for a world

`docs/benchmark/sweeps/exploration-2026-08-07-3/src/scenes/Play.ts:81-101`, the world floor
in a 556-line scene:

```ts
function addStaticFloor(ctx, width, depth, x, z, materials) {
  const floor = block(width, 0.38, depth, materials.floor, { radius: 0.24 });
  floor.position.set(x, -0.19, z);
  ctx.add(floor);
  new RigidBody3D({ object: floor, physics: ctx.physics, shape: CollisionShape3D.fromMesh(floor), type: "fixed" });
  ...
}
```

A flat rounded box with a box collider, repeated. Trees are hand-placed `Group`s of
`tube` + `ball` (`Play.ts:104-125`). This is a competent answer **to the brief it was
given**, and the brief is the point.

### 1c. Read the census asymmetrically — it is a missing input, not a rejection

This borrows [PRD-040](PRD-040-physics-collision-layers.md) §1d's rule verbatim,
because the same failure mode is available here in a stronger form.

`docs/benchmark/genres/exploration/brief.md:5` asks for *"a compact hub that leads to at
least two distinct areas."* **A compact hub is the opposite of an open world.** No brief in
the corpus asks for a world larger than a few hundred metres, none asks for anything to
load while the player moves, and none runs longer than a sealed demo. An archive cannot
hand-roll chunk streaming for a world that fits on one screen.

So the census supports exactly one inference, and it is a negative one:

> **No agent in this corpus has ever been asked to build terrain, so the corpus says
> nothing about whether they can.** It is the `AnimationPlayer` situation from
> [PRD-039](./PRD-039-animation-state-machine.md) §4b — a missing input, not a rejected
> abstraction — and the correct response is §5's measurement, not a build.

Phase 1's two builds do **not** rest on this census. They rest on the 20-line rule and on a
capability gap that is checkable by reading two files, which §2 does.

---

## 2. The complete missing list — twelve rows, each scored on its own

Vocabulary in column 3 is borrowed: Godot's node/class names in camelCase where Godot has
one, Three.js's or Rapier's own names where it does not. **No name below is invented**, and
row 9 is declined precisely because inventing one would be the only option.

| # | Capability | Borrowed name | Cost in user space | Verdict |
|---|---|---|---|---|
| 1 | Heightfield collider | Godot `HeightMapShape3D` → `CollisionShape3D.heightfield` | Not expressible: `CollisionShapeKind` is `"box" \| "sphere" \| "capsule" \| "trimesh" \| "convexHull"` (`CollisionShape3D.ts:5`) and nothing reaches `RAPIER.ColliderDesc.heightfield`. The escape hatch is raw Rapier | **BUILD** — §3 Phase 1 |
| 2 | Per-asset cache eviction | Godot `ResourceLoader` / Three `.dispose()` → `AssetLoader.release` | Not expressible: the cache is a private `Map` (`assets.ts:40`) and the only exit is `clear()` (`assets.ts:59`), which drops *every* asset including the ones still on screen | **BUILD** — §3 Phase 2 |
| 3 | Heightmap → mesh (noise, displacement) | Three `PlaneGeometry` + `setXYZ` on the position attribute | ~40 lines, and every line of it decides how the ground *looks* | **DECLINE** — rule 3 first, rule 1 second |
| 4 | Terrain material / splat blending | Three `NodeMaterial`, TSL | Any amount. It is the single most screenshot-visible surface in the genre | **DECLINE — permanent.** §5b. This is the measured negative that scored v1 *worse* than vanilla (`OPPORTUNITY-AREAS.md`, Tier 3, score 8) |
| 5 | Biome / prop / foliage scattering | `ctx.random` (`scene.ts:67`) + Three `InstancedMesh` | ~25 lines, seeded and reproducible for free because `ctx.random` already ships | **DECLINE** — rule 1 |
| 6 | LOD and instancing | Three `LOD`, `InstancedMesh` | `new LOD(); lod.addLevel(mesh, 50)` — 2 lines, both classes already in `three` | **DECLINE** — rule 1, and `OPPORTUNITY-AREAS.md:158` already ruled: *template source, not package code* |
| 7 | Frustum / occlusion culling | Three `Object3D.frustumCulled` | Zero lines — Three.js frustum-culls by default. The corpus's only 30 uses **turn it off** (§1a). Proof is already available: the `occluded` playtest assertion (`assertions.ts:346`) and `visibility` (`assertions.ts:280`) | **DECLINE** — nothing to build |
| 8 | Chunk load / unload lifecycle | Godot `Node.queue_free` → scene lifecycle + `Registry.remove` | `Registry.remove(name)` (`entities.ts:48`), `scene.remove(obj)`, `geometry.dispose()`, `body.dispose()` — ~30 lines in a `Chunk` class. **Blocked today only by row 2**, and unblocked by it | **DECLINE** — rule 1 once row 2 ships. Reopening trigger in §6 |
| 9 | Floating origin / large-world coordinates | **none exists** | Genuinely >20 lines, and it must rebase the camera, every `Object3D`, and every Rapier body together | **DECLINE — for vocabulary and for evidence, not for size.** See below |
| 10 | Navmesh across streamed chunks | recast `generateTiledNavMesh` / `generateTileCache` | `NavigationRegion3D.ts:2` imports `generateSoloNavMesh` — a single bake over a fixed mesh list. Both tiled generators exist in `recast-navigation@0.43.1`, already a dependency | **DECLINE with trigger** — §6 |
| 11 | Terrain height / ground query | Rapier `world.castRay` | 3 lines against the row-1 collider once it exists | **DECLINE** — rule 1 |
| 12 | Persistent world state | — | [PRD-036](./PRD-036-save-load-and-deterministic-replay.md)'s subject | **OUT OF SCOPE** — deferred, not declined |

**Row 9 deserves its own paragraph, because it is the row most likely to be rebuilt later
by someone who skims this table.** Float32 loses sub-centimetre precision past roughly
10 km from the origin, and the result is visible jitter — a real problem in a real WoW-like
world. It is declined here for three independent reasons, any one of which is sufficient:

1. **Rule 4 has nothing to borrow.** Godot has no floating-origin *node*. It ships "Large
   World Coordinates" as a compile-time double-precision build flag, which has no runtime
   API to copy. Building this means inventing a name, and inventing a name is what killed
   v1.
2. **It contests ownership of the scene graph.** A rebase must move `ctx.scene`'s children
   out from under user code that holds references to them. `AGENTS.md` is explicit that the
   user owns `src/entities/` and `src/scenes/`, and the framework reads neither.
3. **Zero measured demand.** Not one archive in 83 places anything past ~100 units from the
   origin.

Its trigger is in §6, and it is a number, not an argument.

---

## 3. What ships

Total new framework LOC: **~20**. Both builds are in existing files, both are additive, and
neither has a caller in the repository until Phase 3 supplies one.

### Phase 1 — `CollisionShape3D.heightfield` (~12 LOC, `packages/physics/src/CollisionShape3D.ts`)

Rapier 0.19.3 already exposes the shape
(`@dimforge/rapier3d-compat/geometry/collider.d.ts:667`):

```ts
static heightfield(nrows: number, ncols: number, heights: Float32Array,
                   scale: Vector, flags?: HeightFieldFlags): ColliderDesc;
```

The addition mirrors the existing statics at `CollisionShape3D.ts:31-43` and adds
`"heightfield"` to the `CollisionShapeKind` union at `:5`. It validates fail-closed like
its neighbours do — `heights.length !== rows * cols` throws, matching the style of
`geometryVertices`'s existing throw at `:11`.

```ts
static heightfield(rows: number, columns: number, heights: Float32Array,
                   scale: { x: number; y: number; z: number }): RAPIER.ColliderDesc {
  if (!Number.isInteger(rows) || rows < 2)
    throw new Error("CollisionShape3D.heightfield requires at least 2 rows.");
  if (!Number.isInteger(columns) || columns < 2)
    throw new Error("CollisionShape3D.heightfield requires at least 2 columns.");
  if (heights.length !== rows * columns)
    throw new Error(
      `CollisionShape3D.heightfield expected ${rows * columns} heights, received ${heights.length}.`,
    );
  return RAPIER.ColliderDesc.heightfield(rows - 1, columns - 1, heights, scale);
}
```

**Why this is not rule 1.** A user *can* reach `RAPIER.ColliderDesc.heightfield` directly —
it is one call. What they cannot do in under 20 lines is get the `rows - 1` / `columns - 1`
segment-vs-vertex convention right on the first try, and a wrong one produces terrain
whose collision is silently offset from its mesh. That is exactly the class of defect
[PRD-040](PRD-040-physics-collision-layers.md) built `collisionLayer` for: a
one-call escape hatch that three independent authors got wrong the same way. **This claim
is currently an argument, not a measurement — §5 turns it into one, and §6 states the
number that would retract it.**

### Phase 2 — `AssetLoader.release` (~8 LOC, `packages/core/src/assets.ts`)

`AssetLoader` (`assets.ts:10-15`) is `model`, `texture`, `audio`, `clear`. The cache is
keyed `` `${kind}:${url}` `` at `:42-51` and never deletes a single entry. A session that
streams 500 chunk models holds all 500 forever; `clear()` is the only exit and it also
drops the assets currently on screen.

```ts
release(kind: "audio" | "model" | "texture", path: string): boolean {
  return cache.delete(`${kind}:${resolvePath(basePath, path)}`);
}
```

Godot's name for this is `ResourceLoader`'s cache eviction; `release` is the Three.js-side
verb and is what the return value means — the loader stops *holding* it. **It does not call
`.dispose()` on GPU resources, and it must not**: the user may still have the texture bound
to a live material, and the framework does not read `src/render/`. The scenario in §4 shows
`release` paired with the user's own `dispose()`, in that order.

### Phase 3 — the consumer proof

Nothing in Phases 1–2 has a caller, and an export with no caller is a rule-2 deletion
candidate the moment it lands. The proof is one streaming-terrain scene under
`examples/`, plus a committed playtest scenario asserting, at minimum:

- `movement` — the player walks 300+ units across at least three chunk boundaries;
- `visibility` (`assertions.ts:280`) — a chunk behind the player is gone, and one ahead is
  present;
- `diagnostics` — zero, across the whole traversal.

**The scenario must fail closed on the thing being built.** The negative control is stated
with the assertion in §7, and it must be observed red before this PRD is claimed done.

---

## 4. What the user writes instead — the whole terrain stack, in user space

This is rows 3, 5, 6, 8 and 11 together. It goes in the user's `src/`, and it is the
answer to "does the framework support terrain?" — yes, like this, and the framework
contributes six identifiers to it.

```ts
// src/world/Chunk.ts
import { CollisionShape3D, RigidBody3D } from "@threenative/physics";
import { Mesh, PlaneGeometry } from "three";
import type { GameCtx } from "../types.js";
import { terrainMaterial } from "../render/materials.js";   // rule 3: yours, always

const SIZE = 64;      // world units per chunk
const RES = 64;       // vertices per side

export class Chunk {
  readonly mesh: Mesh;
  readonly #body: RigidBody3D;

  constructor(ctx: GameCtx, cx: number, cz: number, height: (x: number, z: number) => number) {
    const geometry = new PlaneGeometry(SIZE, SIZE, RES - 1, RES - 1);
    geometry.rotateX(-Math.PI / 2);
    const position = geometry.getAttribute("position");
    const heights = new Float32Array(RES * RES);
    for (let i = 0; i < position.count; i++) {
      const y = height(position.getX(i) + cx * SIZE, position.getZ(i) + cz * SIZE);
      position.setY(i, y);
      heights[i] = y;
    }
    geometry.computeVertexNormals();

    this.mesh = new Mesh(geometry, terrainMaterial());
    this.mesh.position.set(cx * SIZE, 0, cz * SIZE);
    this.mesh.receiveShadow = true;
    ctx.add(this.mesh);

    this.#body = new RigidBody3D({
      object: this.mesh,
      physics: ctx.physics,
      shape: CollisionShape3D.heightfield(RES, RES, heights, { x: SIZE, y: 1, z: SIZE }),
      type: "fixed",
    });
  }

  dispose(): void {
    this.#body.dispose();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
  }
}
```

```ts
// src/scenes/Play.ts — the streaming loop, inside update()
const key = (x: number, z: number) => `${x}:${z}`;
const wanted = new Set<string>();
for (let dx = -2; dx <= 2; dx++)
  for (let dz = -2; dz <= 2; dz++) wanted.add(key(cx + dx, cz + dz));

for (const [id, chunk] of this.#chunks)
  if (!wanted.has(id)) { chunk.dispose(); ctx.entities.remove(`chunk.${id}`); this.#chunks.delete(id); }

for (const id of wanted)
  if (!this.#chunks.has(id)) {
    const chunk = new Chunk(ctx, ...);
    this.#chunks.set(id, chunk);
    ctx.entities.add(`chunk.${id}`, chunk);   // registered → visible to the visibility assertion
  }
```

Roughly **55 lines for a streaming heightmap world with collision**, of which the framework
supplies `ctx.add`, `ctx.entities.add`/`.remove` (`entities.ts:38,48`), `ctx.random`,
`RigidBody3D`, and one new `CollisionShape3D.heightfield`. The noise function, the
material, the LOD ladder, the foliage and the biome rules are all the user's, and every one
of them is something a screenshot shows.

**Height query (row 11), for completeness:**

```ts
const hit = ctx.physics.world.castRay(new RAPIER.Ray({ x, y: 500, z }, { x: 0, y: -1, z: 0 }), 1000, true);
const groundY = hit === null ? 0 : 500 - hit.timeOfImpact;
```

---

## 5. Phase 0 — the measurement that gives §1 a voice

Phase 1 and 2 do not wait on this; they stand on §2 rows 1 and 2. Phase 0 exists to decide
everything else, and to test the one claim in §3 that is currently an argument.

| # | Measurement | Instrument | Reopens |
|---|---|---|---|
| 0.1 | Add an `open-world` genre: a brief asking for a walkable world of at least 500×500 units with terrain relief and content that appears as the player travels | `docs/benchmark/genres/open-world/brief.md` + `reference.png`, mirroring `exploration/` | — |
| 0.2 | Run one sealed pair on it | headed `pnpm sweep:capture` for both arms, then `pnpm sweep:pair` | — |
| 0.3 | Count how each arm built its ground, and whether either got the heightfield segment convention wrong on the first attempt | archived framework and vanilla `src/` trees | Row 1's justification (§3) — neither arm used the raw heightfield escape hatch |
| 0.4 | Count turns spent on streaming and on cache growth | pair transcripts and proof resources | Rows 8 and 9 — both arms kept three chunks live; no memory API was exposed |
| 0.5 | Record reach rate for `heightfield` and `release` in the next round ledger | pair measurement and `docs/verification/PRD-043.md` | Framework consumer reaches the terrain surface; the pair's archived framework export list is recorded |

**One trap to record in advance.** 0.5 will report both new exports as unreached unless
0.1 lands first — the same self-justifying deletion described in
[PRD-039](./PRD-039-animation-state-machine.md) §4b. Neither export may be deleted under rule 2
until an `open-world` brief has existed for two full rounds. Record that stay in the ledger
with this reason attached.

---

## 6. Reopening triggers, stated before the measurement

Each is a number or an observation, not an argument. Anything short of these, the row stays
closed — "an agent might want chunk streaming" is not a trigger; that is how v1 reached
790k lines.

1. **Row 8 (chunk lifecycle).** In 0.4, the framework arm's chunk load/unload code exceeds
   **40 lines** *and* the vanilla arm's is materially shorter, on the same brief. A tie is a
   decline, per rule 2.
2. **Row 9 (floating origin).** An arm produces observable positional jitter in a committed
   playtest — a `movement` assertion that passes near the origin and fails at distance on
   the same input — **and** the fix in user space contests `ctx.scene` ownership. Both
   halves, or it stays closed. Note that satisfying this still leaves rule 4 unsatisfied: a
   reopening PRD must name the abstraction from Godot, Three.js or Rapier, or say plainly
   that it is inventing one and why that is worth it.
3. **Row 10 (tiled navmesh).** An arm bakes `NavigationRegion3D` per chunk and the bake
   cost produces a visible hitch, **or** an agent hand-rolls `generateTiledNavMesh` around
   the wrapper. The second is the `collisionLayer` signature from PRD-040 §1 and is the
   stronger evidence of the two.
4. **Row 1, in reverse — the retraction trigger.** If 0.3 shows both arms reaching
   `RAPIER.ColliderDesc.heightfield` directly and getting `rows - 1` right first time, §3's
   justification is falsified and `CollisionShape3D.heightfield` should be **deleted** under
   rule 2, not kept because it was built. Written down here so that outcome is a result
   rather than an embarrassment.

---

## 7. Acceptance criteria

Consumer-scoped. Every gate below is a command, and none may be reported green without its
output pasted (`AGENTS.md`, "Verification honesty").

- [x] An agent asked to add terrain to a scaffolded project writes §4's `Chunk.ts` and the
      only unfamiliar identifier is `CollisionShape3D.heightfield`, which sits beside
      `.box`, `.sphere` and `.capsule` in the same class it already imports. Verified by the
      scaffolded framework arm and [TerrainProbe.ts](../../../examples/abyss-framework/src/scenes/TerrainProbe.ts).
- [x] `CollisionShape3D.heightfield` fails closed on a heights buffer whose length is not
      `rows * columns`, and the unit test asserts the throw — not `toBeDefined()`.
      **Negative control, must be observed red before this is claimed:** delete the length
      check and the test goes red rather than silently building a collider that is offset
      from its mesh.
- [x] `AssetLoader.release(kind, path)` returns `true` on a cached entry and `false` on an
      absent one, and a subsequent load of the same path calls the underlying loader again.
      **Negative control:** stub the loader with a call counter; if `release` no-ops, the
      counter stays at 1 and the test goes red.
- [x] The Phase 3 scenario asserts a chunk behind the player is **absent** and one ahead is
      **present**, and both are `visibility` assertions on registered entities
      (`assertions.ts:280`). **Negative control:** disable the unload branch in the
      streaming loop; the "absent" assertion must go red. A scenario that passes with
      unloading disabled is asserting nothing, which is the exact v1 failure `AGENTS.md`
      names.
- [x] `pnpm typecheck && pnpm lint && pnpm test` green; the exact chain passed on
      2026-08-08. See [verification/PRD-043.md](../../verification/PRD-043.md).
- [x] `pnpm budgets` green. Result on 2026-08-08:
      ```
      $ pnpm budgets
      budgets ok: 5 framework packages, 3 example workspaces, 4280 framework LOC, 2 PRD files, largest template 1200 LOC
      ```
      This PRD adds no workspace package and remains within the 15,000 framework-LOC and
      10-PRD caps.

### Budget note — the template cap is the binding constraint, not the LOC cap

`scripts/check-budgets.ts:5-15` caps each template at 1,200 LOC. Measured today:

| Template | LOC | Headroom |
|---|---:|---:|
| `minimal` | 343 | 857 |
| `starter` | 951 | 249 |
| `platformer` | **1200** | **0** |

**`platformer` is exactly at its cap.** §4's terrain sample cannot go there without cutting
something first. It fits in `starter` (249 lines of headroom) or `minimal`, and the third
option — a new `open-world` template — costs nothing against the package cap but adds a
fourth template to keep in sync with `scaffold.spec.ts` (`STARTER_PATHS`), `looks.spec.ts`
and `playtest.spec.ts` forever. **Recommendation: `examples/`, not `templates/`, until
Phase 0 says a genre exists.** An example carries the proof without adding a shipped
surface, and `examples/AGENTS.md` exempts it from both this file and `CHARTER.md`.

---

## 8. Integration Ledger

| # | New thing | Live caller | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `CollisionShape3D.heightfield` | Phase 3 example `src/world/Chunk.ts` | raw `RAPIER.ColliderDesc.heightfield` with hand-computed `rows - 1` | n/a — no prior path in the repo to remove; the raw call remains available and documented as the escape hatch | delete the length check → unit test red |
| 2 | `AssetLoader.release` | Phase 3 example streaming loop | `AssetLoader.clear()` used as a blunt eviction | **No.** `clear()` stays — it is the scene-teardown path (`game.ts:150-151, 234-237`) and is correct there | stub loader + call counter → red if `release` no-ops |
| 3 | Phase 3 example + scenario | headed WebGPU playtest with `terrain.playtest.json` | n/a | n/a | disable the unload branch → `visibility` "absent" assertion red |
| 4 | `open-world` genre brief | `pnpm sweep:pair` on the two archived arms | n/a | n/a | n/a — a brief is an input, not code |

Rows 1 and 2 are the only framework changes. Row 3 is what stops them from being dead
exports on the day they land, and it is not optional: without it, `pnpm round:deletions`
correctly reports both as rule-2 candidates in two rounds, and correctly would be right.
