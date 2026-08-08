# PRD-040 — Collision layers, and what the census says about the rest of physics

**Status: OPEN — one phase builds, five candidates are declined with stated triggers.** The
build is `collisionLayer` / `collisionMask` on the three physics nodes, ~45 LOC. Every
other physics abstraction discussed — raycast nodes, contact hit info, collider debug draw,
body-tuning passthrough, `Joint3D`, `VehicleBody3D`, ragdoll — is declined here, each with
the measurement that would reopen it.

**Why this one and not the others:** a census of 70 generated game archives under
`docs/benchmark/sweeps/*/src` found exactly **two** escape-hatch calls into raw Rapier
across all of them, and both are the same call — `collider.setCollisionGroups((N << 16) | 0xffff)`.

**Read that census asymmetrically, and §1d says why.** It is strong *positive* evidence —
one hand-roll reproduced by three independent authors is a measured gap. It is **not**
evidence against anything, because the corpus is 70 short sealed demos, and a short demo
does not build a hinged door whether or not games need hinged doors. So the declines in §4
rest on the 20-line rule applied to each candidate on its own, never on "the census did not
find it."

**Gate:** `ROADMAP.md` Gate 0 — `docs/verification/round-2-2026-08-07.md:11` records
*"round 2 closed; Gate 0 exits on the framework blind-visual win"*. Round 2's gap list holds
one row, it is a **cost** gap, and its disposition is `rejected`. **No ledger row names a
physics gap.** This PRD therefore does not claim ledger authority; it claims a defect
(§2) plus the census (§1), and it declines everything those two do not cover.

**Complexity: 3 phases.**

**Charter authority:** `CHARTER.md` §11 rule 1 (the 20-line rule), rule 2 (the kill switch),
rule 4 (vocabulary is borrowed, never invented), rule 5 (a package exists only for a
dependency others must not inherit — **this PRD adds no package**). `packages/physics/AGENTS.md`
— *"If a wrapper starts growing convenience methods that Rapier already provides, delete them
— the user reaches `body` directly."* That sentence is what kills candidates 3, 5 and 6 in §4.

**Sibling PRDs:** collider debug draw (§4, candidate 4) is deferred **into**
[PRD-033](PRD-033-playtest-semantic-depth.md)'s scope, not built here — its argument is
observability, which is PRD-033's subject, not physics'. This PRD does not edit that file.

---

## 1. The census — what agents actually reach for

Run against every generated archive in the benchmark corpus. `node_modules` excluded by
scoping to `*/src`.

```
cd docs/benchmark/sweeps
ls -d */src | wc -l                                     # 70 archives with generated source
grep -rhoE "\.body\.[a-zA-Z]+"     */src | sort | uniq -c | sort -rn
grep -rhoE "\.collider\.[a-zA-Z]+" */src | sort | uniq -c | sort -rn
```

### 1a. The wrapper surface is heavily reached — physics is not `AnimationPlayer`

| Call | Occurrences |
|---|---:|
| `.body.velocity` | 293 |
| `.body.grounded` | 133 |
| `.body.dispose` | 75 |
| `.body.moveAndSlide` | 58 |
| `.body.teleport` | 57 |

`RigidBody3D` appears in 76 generated files, `Area3D` in 53. This matters because
[PRD-039](PRD-039-animation-state-machine.md) declined animation work partly on a
zero-consumer census. **Physics has the opposite reading.** The rule-2 kill switch is not
in play here; the exports the round-2 ledger lists as unreached
(`round-2-2026-08-07.md:51,59,60,149-151,167-168`) are the *type aliases* —
`Area3DOptions`, `PhysicsPlugin`, `RigidBodyType` — while every runtime class is used. An
unreached `interface` export is a naming artifact, not a dead abstraction.

### 1b. The escape hatch is used exactly twice, for one thing

```
grep -rhoE "\.collider\.[a-zA-Z]+" */src | sort | uniq -c
      2 .collider.setCollisionGroups
```

That is the **entire** raw-Rapier reach across 70 archives. `ctx.physics.world` is never
touched. Both hits are the identical line, in two independent archives:

- `docs/benchmark/sweeps/platformer-2026-08-05/src/level/Platform.ts:38`
- `docs/benchmark/sweeps/platformer-2026-08-05-2/src/level/Platform.ts:32`

```ts
if (options.oneWay === true) body.collider.setCollisionGroups((ONE_WAY_GROUP << 16) | 0xffff);
```

**It reproduced a third time inside the framework itself.** The shipped template carries the
same line at `packages/create-threenative/templates/platformer/src/level/Platform.ts:32`,
and the framework's own test hand-writes the packing at
`packages/physics/__tests__/character.spec.ts:225` — `platform.collider.setCollisionGroups((2 << 16) | 0xffff)`.
Three independent authors, one of them us, writing the same bit-shift because the framework
offers no other way to say it.

### 1c. What the census found *nothing* of, stated plainly

```
grep -rn "castRay\|castShape\|intersectionsWith\|debugRender" */src            # 0 hits
grep -rn "setFriction\|setRestitution\|setLinearDamping\|setAngularDamping\|\
setGravityScale\|lockRotations\|setCcdEnabled" */src                            # 0 hits
grep -rn "createImpulseJoint\|JointData\|VehicleController" */src               # 0 hits
```

Zero physics raycasts, zero body tuning, zero joints, zero vehicles, in 70 archives.

**Do not read a single one of those zeros as a verdict.** §1d is why.

One near-miss worth recording so nobody re-derives it as support: `topdown-action-2026-08-05-2/src/scenes/Play.ts:233-238`
does construct a `THREE.Raycaster`, but it projects the pointer onto a ground plane with
`ray.intersectPlane`. That is correct vanilla Three.js for pointer picking and has nothing
to do with physics queries. **It is not evidence for a `RayCast3D`.**

### 1d. The corpus is not a representative sample of games, and §4 does not treat it as one

The 70 archives are **sealed benchmark demos**: one brief, four genres, built in a bounded
run and never played, patched or extended. Three structural biases follow, and each one
suppresses exactly the physics features this PRD was asked about:

1. **Scope.** A demo ships one mechanic. Hinged doors, winches, swinging ropes, tow cables
   and destructible joints all belong to the second and third mechanic, which no archive
   has.
2. **Genre.** Platformer, exploration, topdown-action and endless-runner. None of the four
   requires line-of-sight, hitscan fire or a car. A shooter, a stealth game, a racer and a
   physics-puzzle game — the four that would exercise §4 — have never been briefed.
3. **Duration.** Friction that only appears on the tenth entity type, or after the tenth
   edit, cannot appear in a corpus where nothing is edited twice. Collision layers is
   itself the proof: it surfaced here only because *one-way platforms* forced it, and it
   would surface in any real project the moment a second kind of collider exists.

So the census supports one inference and refuses the other:

| Reading | Valid? | Why |
|---|---|---|
| "`setCollisionGroups` is hand-rolled by three independent authors" → build it | **yes** | Presence in a biased sample is still presence. Bias suppresses features, it does not invent them. |
| "no archive used a joint" → do not build joints | **no** | Absence in a sample that structurally cannot contain the thing is zero information. |

**This is why §4 declines on the 20-line rule instead.** That rule is corpus-independent:
`world.createImpulseJoint(JointData.revolute(a1, a2, axis), b1, b2, true)` is one line
whether or not a demo ever wrote it, and one line is not a framework feature. Where a
candidate's cost is genuinely over 20 lines, §4 says so and defers on sequencing rather
than pretending the census settled it.

---

## 2. The defect — layers is not an ergonomics item

Three separate problems, all from the same missing property. This is the part of the PRD
that does not rest on the census.

### 2a. `Area3D` cannot filter what it detects, at all

`Area3DOptions` (`packages/physics/src/Area3D.ts:16-22`) has no layer or mask field, the
collider is created with only `.setSensor(true).setActiveEvents(...)`
(`Area3D.ts:49-52`), and the plugin's reconciliation query passes `filterGroups` as
`undefined`:

```ts
// packages/physics/src/plugin.ts:110-122
physics.world.intersectionsWithShape(
  area.collider.translation(), area.collider.rotation(), area.collider.shape,
  (collider) => { /* ... */ return true; },
  RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
  undefined,          // <-- filterGroups
  area.collider,
);
```

So **every `Area3D` fires on every non-sensor body in the world.** A damage zone triggers on
the shooter's own projectiles; a pickup trigger fires on enemies; a checkpoint fires on
debris. The user's only recourse today is to filter inside the handler by identity, which
is per-callback game code re-written for every area in the game.

### 2b. The one-way-platform encoding is ambiguous, and the framework guesses

`CharacterBody3D.ts:129`:

```ts
const groups = this.oneWayGroups > 0xffff ? this.oneWayGroups >>> 16 : this.oneWayGroups;
```

This line exists because the caller may pass either the layer bits or the packed
`InteractionGroups`, and the framework cannot tell which. The heuristic is *wrong* for a
legitimate input: a caller meaning "the layer whose bit is 16" passes `0x10000`, which is
`> 0xffff`, so it is silently reinterpreted as layer bit 1. The test at
`character.spec.ts:225-231` passes only because it happens to sit on the safe side of the
branch — it hand-packs `(2 << 16) | 0xffff` for the platform and passes the unpacked `2` for
the character, in the same test, and neither spelling is documented as the right one.

A guess in a physics filter is `AGENTS.md`'s "fail closed" rule inverted. Naming the two
halves removes the branch instead of fixing it.

### 2c. The packing itself has a sign bug that will bite at layer 16

`(0x8000 << 16)` is `0x80000000`, which in JavaScript's int32 bitwise domain is **negative**.
Rapier's `InteractionGroups` is a `u32`. Every hand-rolled site in §1b — including ours —
inherits this, and it only misfires once a project uses the sixteenth layer, which is
exactly when a project is large enough that debugging it is expensive. A single
`>>> 0` in one place fixes it everywhere; sixteen copy-pasted call sites do not.

---

## 3. What ships

### 3a. Vocabulary

| Name | Borrowed from | Note |
|---|---|---|
| `collisionLayer` | Godot `CollisionObject3D.collision_layer` | camelCase per rule 4. "Which layers I am on." |
| `collisionMask` | Godot `CollisionObject3D.collision_mask` | "Which layers I scan." |
| `interactionGroups()` | Rapier's own `InteractionGroups` type | The encoder. Rapier vocabulary for a Rapier concept — not invented. |

No third name. Godot's semantics are copied exactly, including the asymmetry that two
bodies interact when **either** one's mask includes the other's layer — Rapier's rule is the
same, so no translation layer is needed.

### 3b. The encoder — `packages/physics/src/collision.ts`

```ts
/** Rapier packs membership in the high 16 bits and the filter in the low 16. */
export function interactionGroups(layer: number, mask: number): number {
  if (!Number.isInteger(layer) || layer < 0 || layer > 0xffff)
    throw new Error("interactionGroups: layer must be an integer in 0..0xffff.");
  if (!Number.isInteger(mask) || mask < 0 || mask > 0xffff)
    throw new Error("interactionGroups: mask must be an integer in 0..0xffff.");
  return (((layer << 16) | mask) >>> 0);
}
```

Fails closed on malformed input, per `AGENTS.md`. The `>>> 0` is §2c.

This is exported so that runtime changes stay on the Rapier surface rather than growing
wrapper methods:

```ts
crate.collider.setCollisionGroups(interactionGroups(LAYER_DEBRIS, LAYER_WORLD));
```

No `setCollisionLayer()` convenience method ships. That is the package's own rule.

### 3c. The options, on all three nodes

Added to `RigidBody3DOptions`, `Area3DOptions` and `CharacterBody3DOptions`:

```ts
/** Godot's collision_layer — which layers this body occupies. Default 1. */
readonly collisionLayer?: number;
/** Godot's collision_mask — which layers this body scans. Default 0xffff. */
readonly collisionMask?: number;
```

Defaults reproduce Rapier's current all-on behaviour, so **every existing call site keeps
its behaviour unchanged**. Each constructor applies one line:

```ts
options.shape.setCollisionGroups(
  interactionGroups(options.collisionLayer ?? 1, options.collisionMask ?? 0xffff),
);
```

And `plugin.ts:110-122` passes the area's own groups where it currently passes `undefined`,
which is the §2a fix:

```ts
area.collider.collisionGroups(),   // was: undefined
```

### 3d. `oneWayGroups` becomes unambiguous

Renamed to `oneWayLayers`, typed as **layer bits only** — never packed. `CharacterBody3D.ts:129`'s
heuristic branch is deleted outright. Two call sites migrate:
`templates/platformer/src/entities/Character.ts:80` and
`templates/platformer/src/level/Platform.ts:32`, the latter losing its hand-packed shift in
favour of `collisionLayer: ONE_WAY_LAYER`.

This is a **breaking option rename** on a template-only consumer. It is in scope because
leaving `oneWayGroups` alongside `collisionLayer` would ship two spellings of one concept,
which is rule 4's failure mode.

### 3e. Cost

| | |
|---|---:|
| New file `collision.ts` | ~14 |
| Options + one line each on 3 nodes | ~18 |
| `plugin.ts` filter pass-through | ~2 |
| Deleted from `CharacterBody3D.ts` | −4 |
| **Net framework LOC** | **~+30** |
| New packages | **0** |
| New PRD files | **1** (8 → 9 of 10) |

Current: `budgets ok: 7 packages, 2988 framework LOC, 8 PRD files` — run 2026-08-07.

---

## 4. The declined candidates, scored one at a time

Per rule 1, each is judged on its own cost in user space, not as a group. **The census is
not load-bearing in this section** — every verdict below would read the same if the
benchmark corpus did not exist, because the question is "how many lines does the user write
without us", and §1d establishes that the corpus cannot answer that question in either
direction.

| # | Candidate | Godot name | Cost to the user today | Verdict |
|---|---|---|---|---|
| 1 | Raycast / shapecast node | `RayCast3D`, `ShapeCast3D` | `world.castRay(new Ray(o, d), 50, true, undefined, undefined, undefined, self.body)` — **1 line**, plus ~3 to convert the hit to a `THREE.Vector3` | **DEFER** — see 4a |
| 2 | Contact hit info (point, normal, force) | `body_shape_entered` + `get_contact_impulse` | `world.contactPair(a, b, (m) => …)` and `eventQueue.drainContactForceEvents(…)`, both already reachable — **~6 lines** | **DEFER** — see 4a |
| 3 | Body tuning passthrough | `physics_material`, `gravity_scale`, `linear_damp`, `axis_lock_*` | `crate.collider.setFriction(0.1)` — **1 line each**, and every one is a method Rapier already provides | **KILL** — `packages/physics/AGENTS.md` names this exact anti-pattern |
| 4 | Collider debug draw | Visible Collision Shapes | `world.debugRender()` → `LineSegments` with `vertices`/`colors` — **~12 lines**, and the buffers must be rebuilt per frame | **DEFER to PRD-033** — see 4b |
| 5 | `Joint3D` (pin/hinge/slider/6DOF) | `PinJoint3D` etc. | `world.createImpulseJoint(JointData.revolute(a1, a2, axis), b1, b2, true)` — **1 line per joint**; the >20-line part is only lifetime and disposal | **DEFER** — see 4a |
| 6 | `VehicleBody3D`, ragdoll | `VehicleBody3D`, `PhysicalBone3D` | Genuinely >100 lines each | **DEFER** — see 4c |

**Candidate 3 is the only outright kill,** and it is killed by this package's own written
rule rather than by the census. The rest are deferred, which means the evidence to decide
them does not exist yet.

### 4a. What reopens candidates 1, 2 and 5 — a brief that can actually contain them

Each of the three is one Rapier line *today*, which is why none is built. What would change
that is not popularity, it is **lifetime and integration cost** — the code around the one
line, which only appears once a game is big enough to have it. Per §1d, no existing archive
is big enough, so this needs a brief built for the purpose rather than a re-read of the
corpus.

**The measurement:** run one sealed pair on a genre whose brief requires all three —
a **first-person shooter or stealth** brief naming hitscan weapons, enemy line-of-sight, and
a physically-hinged door. Then read the two arms:

1. **Reopen candidate 1** if the framework arm reaches `world.castRay` in **more than two
   files**, or reaches `THREE.Raycaster` for a *physics* query — which would be a silently
   wrong answer, and the strongest possible signal that the right one was undiscoverable.
2. **Reopen candidate 2** if either arm hand-rolls a contact point (a `Vector3` lerped
   between two body positions to place an effect) instead of reading the manifold.
3. **Reopen candidate 5** if the joint lifetime code — create, hold the handle, remove on
   either body's `dispose()` — exceeds 20 lines in the framework arm, which is the part
   Rapier's one-liner does not cover.

A tie between arms is a KILL, per the precedent in PRD-039 §1c.

### 4b. Why debug draw is not this PRD's to build

Its value is not that a user writes fewer lines — it is that a **screenshot shows whether
the colliders are where the meshes are**, and that a playtest can assert on it. That is an
observability argument, and `PRD-033` owns observability. Building it here would put a
render-adjacent surface in the physics package on a physics rationale it does not have.
Recorded for PRD-033's author, not fixed here.

### 4c. Vehicles and ragdoll are features, not abstractions

Both are real >100-line builds and both are genuinely absent from Three.js. Neither is
deferred for lack of size — they are deferred because **they depend on candidate 5**. A
vehicle without joint lifetime management and a ragdoll without limited spherical joints are
each a second implementation of the thing 4a is still deciding whether to build. Sequence
them behind it or build the same lifetime code twice.

---

## 5. Phases

### Phase 1 — `interactionGroups()` and the three option pairs

- Add `packages/physics/src/collision.ts` (§3b) and export it from `index.ts`.
- Add `collisionLayer` / `collisionMask` to the three option interfaces; apply in each
  constructor before `world.createCollider`.
- `plugin.ts:117` passes `area.collider.collisionGroups()` instead of `undefined`.

**Tests** — `packages/physics/__tests__/collision.spec.ts`:

- `interactionGroups(1, 0xffff)` is `0x0001ffff`.
- `interactionGroups(0x8000, 1)` is `0x80000001` and is **`> 0`** — the §2c regression.
- `interactionGroups(-1, 0)`, `interactionGroups(0x10000, 0)` and `interactionGroups(1.5, 0)`
  each throw.
- Two `RigidBody3D`s on disjoint layer/mask pairs do not collide after 60 fixed steps;
  the same two with default options do.

**Negative control:** delete the `>>> 0` and the `0x8000` case must go red. Delete the
`plugin.ts` `filterGroups` argument and the Area3D filtering test below must go red.

### Phase 2 — `Area3D` filtering and the `oneWayLayers` rename

- `Area3D` respects its mask: a sensor with `collisionMask: LAYER_PLAYER` does **not** fire
  `bodyEntered` for a body on `LAYER_DEBRIS`. This is the §2a defect and gets its own test,
  written to fail against today's `undefined`.
- Delete `CharacterBody3D.ts:129`'s heuristic; rename `oneWayGroups` → `oneWayLayers`,
  layer-bits only.
- Migrate `templates/platformer/src/level/Platform.ts:32` and
  `templates/platformer/src/entities/Character.ts:80`; update
  `__tests__/character.spec.ts:225,231` so neither file hand-packs a shift.

**Exit:** `grep -rn "<< 16" packages/ templates/` returns only `collision.ts`.

### Phase 3 — the playtest scenario

Per `AGENTS.md`, runtime behaviour gets a scenario, not just a unit test. Against the
platformer template:

1. The player passes upward through a one-way platform and lands on it from above —
   the existing behaviour, proving the rename did not regress it.
2. A body on a debris layer falls through the pickup `Area3D` **without** firing it, while
   the player entering the same area **does** fire it.

Asserted through the framework bridge with `console` + `diagnostics` assertions; the pickup
count is game state the template already exposes. If the assertion cannot see it, widen the
bridge — do not narrow the assertion.

**Known environment constraint:** headless Chromium renders WebGPU as a blank canvas on this
machine, so screenshot assertions in this scenario must run under `xvfb` or be omitted. Use
console/diagnostics assertions, which do not depend on the canvas.

---

## 6. Acceptance criteria

Consumer-scoped. The consumer is an agent building a game with more than one kind of thing
in it.

- [ ] An agent asked for "enemies that damage the player but not each other" writes
      `collisionLayer` / `collisionMask` on the constructors it is already calling, and
      imports nothing new beyond `interactionGroups` if it needs a runtime change.
- [ ] `grep -rn "<< 16" packages/ templates/` returns exactly one file, `collision.ts`.
      Today it returns three (`Platform.ts` template, `character.spec.ts`, and the
      heuristic's mirror in `CharacterBody3D.ts:129,134`).
- [ ] An `Area3D` with a mask does not fire for bodies outside it. **Written to fail first**
      against the current `undefined` at `plugin.ts:117`; a test that passes before the fix
      is asserting nothing and must be rewritten.
- [ ] `interactionGroups(0x8000, 1) > 0`. This is the sign bug and it is the one assertion
      that catches a class of failure no existing test covers.
- [ ] `packages/physics/__tests__/determinism.spec.ts` still passes — collision groups must
      not perturb the fixed-step result for bodies that were interacting before.
- [ ] Phase 3's scenario passes against the real build, and the one-way platform still works.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green, then `pnpm budgets` under
      `7 packages, 15000 LOC, 10 PRD files`. Expected reading after this PRD:
      `7 packages, ~3018 framework LOC, 9 PRD files`.

**Verification status: UNVERIFIED.** This PRD writes no code, so none of the above has been
run. The only commands executed for this document are the census in §1, the file reads
cited in §2, and `pnpm budgets` (`budgets ok: 7 packages, 2988 framework LOC, 8 PRD files`).

### Budget note

`docs/PRDs/` caps at 10 files and holds 8. This file makes 9. On completion it moves to
`docs/PRDs/done/`, which does not count against the cap.

---

## 7. Integration Ledger

| # | New thing | Live caller | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `interactionGroups()` | `RigidBody3D`, `Area3D`, `CharacterBody3D` constructors; `templates/platformer/src/level/Platform.ts` | hand-written `(N << 16) \| 0xffff` at 3 sites | **yes** — Phase 2 exit greps for it | drop `>>> 0`; the `0x8000` test goes red |
| 2 | `collisionLayer` / `collisionMask` options | all three nodes; platformer template | nothing — new capability | n/a | two disjoint-layer bodies collide again if the constructor line is removed |
| 3 | `Area3D` filter pass-through | `plugin.ts:117` | `undefined` filterGroups | **yes** — the argument is replaced, not added beside | restore `undefined`; the Phase 2 Area3D test goes red |
| 4 | `oneWayLayers` | `templates/platformer/src/entities/Character.ts:80` | `oneWayGroups` + its heuristic branch | **yes** — option and branch both deleted | pass a packed value; it must now behave as the layer bits it literally is, and the platformer scenario catches the difference |

No row is left dangling: every new export has a named live caller inside this PRD, and
every replaced path is deleted in the same phase that replaces it.
