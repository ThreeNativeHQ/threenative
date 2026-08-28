---
prd_contract: v1
---

# PRD-243 — `SoftBody3D`, cloth first and tetrahedra later

**Status: PROPOSED, 2026-08-28. Nothing below has been executed. Blocked on
[PRD-242](./PRD-242-gpu-simulation-has-one-lifetime.md) — do not start before it lands.**

Sources read at depth 1 on 2026-08-28, both MIT:
[`bandinopla/three-simplecloth`](https://github.com/bandinopla/three-simplecloth) (1 073 lines,
`src/SimpleCloth.ts`) and [`holtsetio/softbodies`](https://github.com/holtsetio/softbodies)
(`src/FEMPhysics/`, 2 067 lines). **Neither is depended on; both are read.**

Parent batch: [feature-mining](./README.md).

**Complexity:** +2 new subsystem, +2 complex state (a solver inside the fixed step), +2 spans `core`
and `physics`, +1 new public node = **7 → HIGH mode. Mandatory checkpoint every phase.**

## The question

A flag, a cape, a curtain, a rope bridge, a jelly enemy. Today a game gets none of them: `grep -ri
"cloth\|softbody\|soft-body" packages/*/src` returns nothing, and the physics package wraps Rapier's
rigid bodies, characters and joints only. The portable answer available now is "animate it by hand",
which is why no template has one.

Godot names this node `SoftBody3D`, and rule 4 says the vocabulary is borrowed rather than invented.
Godot's covers cloth-like meshes; this PRD takes the same name for the same thing.

Two questions, per the charter:

- **(a) Could the game write this portably itself?** Once PRD-242 lands, a game *can* write a solver
  in TSL — and it must not have to. The solver is generic; the mesh, the material, the stiffness and
  the wind are the game's. This is the same split `GPUParticles3D` already makes.
- **(b) Does it decide how anything looks?** The **geometry and material come from the game**, as
  they do for particles. The framework owns the spring graph, the integrator and the collision
  query. Stiffness, damping, wind and pinning are parameters the game sets, not defaults the
  framework picks for a look — and none of them ship with a value chosen to look good.

## What the sources actually contain

| Claim | Evidence |
| --- | --- |
| simplecloth derives the whole simulation **from an ordinary mesh**: unique vertices, triangle adjacency, a spring graph, pinned masks, GPU storage arrays | `src/SimpleCloth.ts:179-199` (spring construction), `:612-699` (TSL kernels) |
| Its only entry point is **opinionated**: a *skinned* mesh whose simulated region is marked by **red vertex paint** | `src/SimpleCloth.ts:1060-1073` — `SimpleCloth.onSkinnedMesh`, doc comment "Red paint is assumed to be the part of the mesh that should be simulated" |
| It reaches into three's internals | `src/SimpleCloth.ts` imports `three/src/nodes/TSL.js` — a deep path with no stability guarantee across the pinned catalog version |
| softbodies is a real GPU FEM system: tetrahedra, rest volumes, per-tet transforms, vertex influencers, a spatial grid, collisions | `src/FEMPhysics/FEMPhysics.js` (685 lines), `src/FEMPhysics/grid.js` |
| It compiles each kernel once by hand before use | `FEMPhysics.js:341`, `:406`, `:455`, `:485` — `//call once to compile` |
| It pins `three@^0.176.0`; this repository is on `0.185.x` | `softbodies/package.json` |

**Taken:** the derivation (mesh → unique vertices → springs → pinned set), the kernel decomposition,
and the collision approach. **Refused:** the red-vertex-paint convention — an authoring rule
invented by one library is exactly the kind of vocabulary rule 4 forbids inventing; pinning is a
vertex set or a named vertex group the game supplies. Also refused: the deep `three/src/...` import,
and any copied source.

## Design

```ts
// the mesh and the material are the game's; the solver is not
const flag = new SoftBody3D(flagMesh, {
  pinned: flagMesh.userData.pinned,   // indices, or a named group — the game decides
  stiffness: 0.7,
  damping: 0.05,
});
ctx.add(flag);                        // registers through IComputeDriven (PRD-242)
flag.wind.set(4, 0, 2);
```

- `SoftBody3D` implements `IComputeDriven`, so attach, ordered dispatch, scene-change release and
  startup kernel warmup are **already solved** and are not rewritten here. That is the whole reason
  PRD-242 comes first.
- Colliders come from `@threenative/physics` shapes the game already has — no second collision
  vocabulary.
- **Cloth (surface springs) in phases 1–3. FEM tetrahedra is Phase 4 and is explicitly allowed to
  end as "not built".** Cloth is tractable and has callers; FEM is harder to make robust and has
  none yet. A PRD that promised both equally would ship the easy half and call the hard half done.

## Incumbent census

| Existing thing | Relationship |
| --- | --- |
| `IComputeDriven` (PRD-242) | **Depended on.** No lifetime code is written here. |
| `@threenative/physics` — `CollisionShape3D`, `PhysicsDirectSpaceState3D` | **Reused** for collision queries. Rapier's vocabulary, not a new one. |
| `GPUParticles3D` | The shape being followed: buffers ours, TSL-visible parameters theirs, appearance entirely theirs. |
| Nothing else | `grep -ri "cloth\|softbody" packages/*/src` returns nothing. Genuinely new behaviour, and this row says so rather than leaving `Replaces` ambiguous. |

## Which package

`@threenative/core` if the solver needs no Rapier; `@threenative/physics` if collision against the
world is inseparable from it. **Decided in Phase 1 from the code, not now** — and stated in the PRD
before Phase 2 begins. Rule 5 governs: a package exists only when it carries a dependency the others
must not inherit, so the wrong answer here adds a dependency to every game that never uses cloth.

## Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | `SoftBody3D` | a template scene that adds one | nothing (no cloth exists) | n/a | remove the object → the template's cloth playtest reds |
| 2 | Spring-graph derivation from a `BufferGeometry` | `SoftBody3D` constructor | nothing | n/a | feed a mesh with duplicated vertices and assert the unique-vertex count; skip welding → springs double, reds |
| 3 | Collision against physics shapes | `SoftBody3D.process` | nothing | n/a | disable the collider → the cloth passes through the wall, playtest reds |
| 4 | Native proof | conformance case | nothing | n/a | run on native with the solver stubbed → the mesh never moves |

## Execution Phases

### Phase 1 — a flag moves, deterministically, in a unit test

**Proof subject:** a real imported mesh with **welded-duplicate vertices, a non-uniform triangle
layout and a pinned edge** — what a GLTF flag actually is. A regular grid `PlaneGeometry` needs
neither welding nor adjacency and would let every assertion below pass on a build that cannot open a
real asset.

**Files (4):** `<package>/src/softbody.ts` (NEW), the package index (EDIT),
`<package>/__tests__/softbody.spec.ts` (NEW), `packages/core/src/index.ts` or the physics index
(EDIT — export).

- [ ] Unique-vertex welding, spring construction, pinned set: pure, tested without a renderer.
- [ ] The integrator is frame-rate independent and runs on the fixed step, not on wall time.
- [ ] The package decision above is recorded in this file before Phase 2.

| Test file | Test name | Assertion | Negative control (must be observed red) |
| --- | --- | --- | --- |
| `softbody.spec.ts` | `should weld duplicated vertices before building springs` | spring count matches the welded topology | skip welding → count inflates, reds |
| `softbody.spec.ts` | `should never move a pinned vertex` | pinned position exactly unchanged after N steps | drop the pin mask → it drifts, reds |
| `softbody.spec.ts` | `should settle to the same state at 30 and 120 steps per second` | within tolerance | integrate by wall time → diverges, reds |

### Phase 2 — it is on screen, and it survives a scene change

**Files (3):** a template's scene + `src/render/` material (EDIT — the look is the template's), its
playtest (NEW), `softbody.spec.ts` (EDIT).

- [ ] The flag moves in a real build, asserted by a scenario, not by a screenshot alone.
- [ ] `goto` away and back releases buffers and rebuilds — inherited from PRD-242 and asserted here
      because inheritance is not proof.
- [ ] Frame cost is recorded. A cloth that costs 4 ms on a Pixel 8 is a fact the docs must carry.

### Phase 3 — it collides with the world

**Files (3):** `softbody.ts` (EDIT), the template (EDIT), the playtest (EDIT).

- [ ] Collision against the game's existing physics shapes; no new shape vocabulary.
- [ ] A scenario asserts the cloth does not pass through a wall it is pushed into.

### Phase 4 — tetrahedra, or a recorded refusal

**Files (2):** `softbody.ts` (EDIT), verification record (EDIT).

- [ ] Entered only if a caller exists — a template or a sandbox game that needs volume, not a
      hypothetical one.
- [ ] **"Not built, and here is why" is an acceptable and expected outcome**, recorded in this file
      rather than left as an unchecked box.

## Acceptance criteria (consumer-scoped)

- [ ] A shipped template has a flag or cape that visibly moves, on web **and** on a physical Android
      device, from a mesh the template authored — screenshots and scenario output pasted.
- [ ] The cloth does not pass through a wall it is pushed into.
- [ ] Pinned vertices never move; the simulation settles identically at 30 and 120 steps per second.
- [ ] Scene change releases every buffer, shown by a counter.
- [ ] `packages/` contains no stiffness, damping or wind value chosen to look good — every parameter
      is required from the game or documented as physical, and the diff shows it.
- [ ] Per-frame cost on a Pixel 8 is measured and written into the capability docs.
- [ ] Deleting `softbody.ts` breaks the template playtest — pasted.

## Kill switch

`count-loc.ts` against a game that writes the same cloth in TSL on top of PRD-242. If a competent
author's hand-written version is not meaningfully larger across a flag, a cape and a curtain, this
is deleted and the templates keep the hand-written one as generated source.
