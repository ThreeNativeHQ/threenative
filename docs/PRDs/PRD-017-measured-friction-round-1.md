# PRD-017 — Round 1: the four frictions a real build already hit

**Complexity: 5 → MEDIUM mode** (6-10 files +2, multi-package +2, no new system +1)

**Depends on:** PRD-016 (the ledger format these findings are filed against).
**Blocks:** PRD-018. **Charter authority:** `AGENTS.md` rules 1, 2, 3, 4;
`packages/physics/AGENTS.md`; `CHARTER.md` §11.

## 1. Context

**Problem:** a game built against the shipped tarballs on 2026-08-03 had to work around
four framework behaviours. Every one of them is still in `main` today, and the workarounds
are the kind a user's agent writes silently and never reports.

**Files analyzed:** `packages/physics/src/{CharacterBody3D,RigidBody3D,CollisionShape3D}.ts`,
`packages/core/src/input.ts:86-126`, `packages/create-threenative/templates/*/package.json`,
`templates/{starter,platformer}/src/**`, and the sandbox findings recorded on 2026-08-03.

**Current behavior, each verified against `main` before this PRD was written:**

| # | Friction | Evidence | What the builder wrote instead |
|---|---|---|---|
| 1 | Bodies take `mesh: Mesh`, not `Object3D` | `CharacterBody3D.ts:6`, `RigidBody3D.ts:8` | an invisible root `Mesh` with `material.visible = false` and the real rig parented under it — a `Group` cannot be a body |
| 2 | `minimal` scaffolds without `@types/three` | `templates/minimal/package.json` devDeps — `starter` and `platformer` both have it, `minimal` does not | `pnpm add -D @types/three` before the first line of game code; `pnpm typecheck` fails on a fresh scaffold |
| 3 | No teleport on `CharacterBody3D` | grep `setTranslation` → only internal construction | `body.body.setTranslation(...)` then `syncFromPhysics()`, reaching past the Godot surface into raw Rapier |
| 4 | `input.vector()` returns **+y for "up"**, which is **−z** in world space | `input.ts:90-103` returns a `Vector2` | mapping `move.y` straight to `z` walked the character into the camera; it shipped as a real bug and a playtest caught it |

Only #1 and #3 are package changes. #2 is a scaffold defect and #4 is a documentation and
template defect — the 20-line rule (`AGENTS.md` rule 1) forbids a `vector3()` helper, so
this PRD fixes the convention where it is read, not by adding surface.

## 2. Solution

- **`object: Object3D` replaces `mesh: Mesh`** on `CharacterBody3D` and `RigidBody3D`. The
  classes only ever touch `position`, `quaternion` and `scale`, all of which live on
  `Object3D`. Godot agrees: a `CharacterBody3D` **is** the node, and the visual is a child
  `MeshInstance3D` — so the current name is also the wrong borrowed word (rule 4).
  `CollisionShape3D.fromMesh(mesh)` keeps its `Mesh` parameter, because it reads geometry.
- **`teleport(position)` on `CharacterBody3D`** — sets the Rapier translation, zeroes
  `velocity`, syncs the object, and clears the grounded flag. Every respawn in every
  template does this by hand today, through the raw body.
- **`minimal` gets `@types/three`**, and a scaffold test runs `pnpm typecheck` in each
  template so the next missing dev dependency is red before a user finds it.
- **The input axis becomes impossible to get wrong by reading**: the templates' movement
  code carries the conversion on one line with the sign spelled out, both template
  `AGENTS.md` files state it, and a playtest asserts a forward press moves −z.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| `input.vector3(name)` returning a world-space `Vector3` | Three lines of user code. Rule 1 deletes it, and Godot's `Input.get_vector` is 2D — inventing a 3D variant breaks rule 4 |
| Keep `mesh` as a deprecated alias | Two live names for one property is the additive-migration smell; nothing outside this repo depends on 0.1.0 |
| A `Rig`/`Actor` wrapper that owns body + visuals | Rule 1 and `CHARTER.md` §2 — this is the wrapper the charter closed |
| `respawn()` instead of `teleport()` | Respawn is game logic. Godot's name for the primitive is teleport-shaped (`global_position` assignment on a kinematic body); `teleport` says what it does and nothing about why |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `CharacterBody3DOptions.object` | `templates/starter/src/entities/Player.ts`, `templates/platformer/src/entities/Character.ts` | `options.mesh` | **yes**, deleted | pass a `Group` on the old signature → type error; on the new one → works and is asserted |
| 2 | `RigidBody3DOptions.object` | `templates/starter/src/entities/Crate.ts`, `templates/platformer/src/level/Platform.ts`, `examples/abyss-framework` | `options.mesh` | **yes**, deleted | `grep -rn "mesh:" packages/physics/src` returns only `CollisionShape3D` |
| 3 | `CharacterBody3D.teleport()` | `templates/starter/src/scenes/Play.ts` (kill plane), `templates/platformer/src/level/Checkpoints.ts` | `body.body.setTranslation(...)` + `syncFromPhysics()` | **yes**, deleted from both templates | no-op the method → `respawn.playtest.json` fails |
| 4 | `@types/three` in `minimal` | `templates/minimal/package.json`; scaffold smoke runs `pnpm typecheck` | the manual `pnpm add -D` every builder ran | n/a | remove it again → the new scaffold test goes red |
| 5 | Documented input axis | `templates/{starter,platformer,minimal}/src/entities/*.ts`, both template `AGENTS.md` | undocumented `+y` | n/a | flip the sign → `forward.playtest.json` asserts the wrong direction and fails |

**Reachability:** `npx create-threenative my-game --template minimal` → `pnpm typecheck`
passes with no edits → a character assembled from a `Group` is its own `CharacterBody3D` →
pressing forward moves −z → falling past the kill plane calls `teleport` and the player is
back at spawn.

## 4. Phases

#### Phase 1: a Group can be a body

**Files:** `packages/physics/src/CharacterBody3D.ts` EDIT · `src/RigidBody3D.ts` EDIT ·
`packages/physics/__tests__/character.spec.ts` EDIT · `templates/starter/src/entities/{Player,Crate}.ts` EDIT ·
`templates/platformer/src/entities/Character.ts` EDIT.

Rename the option and the readonly property to `object: Object3D`. `examples/abyss-framework`
and `templates/platformer/src/level/Platform.ts` are updated in the same phase — two live
names for one property is not allowed to exist even for a commit.

| Test | Assertion | Negative control |
|---|---|---|
| `should drive a Group as a character body` | a `Group` with two child meshes moves and its children follow | revert to `Mesh` → does not compile, which is the finding |
| `should keep CollisionShape3D.fromMesh taking a Mesh` | geometry-reading path unchanged | widen it too → `fromMesh` throws at runtime on a `Group`, silently, which is worse than a type error |
| `grep` gate | `mesh` appears in `packages/physics/src` only inside `CollisionShape3D.ts` | leave one → gate red |

#### Phase 2: respawn without reaching into Rapier

**Files:** `packages/physics/src/CharacterBody3D.ts` EDIT · `__tests__/character.spec.ts` EDIT ·
`templates/starter/src/scenes/Play.ts` EDIT · `templates/platformer/src/level/Checkpoints.ts` EDIT ·
`packages/physics/AGENTS.md` EDIT.

| Test | Assertion | Negative control |
|---|---|---|
| `should place the body and zero its velocity when teleported` | position equals the target, `velocity.lengthSq() === 0`, `grounded === false` | keep the falling velocity → the player re-dies on the tick after respawn; assertion catches it |
| `should throw when teleported after dispose` | throws (fail closed) | return silently → a disposed body reports a successful respawn |
| `respawn.playtest.json` (existing, both templates) | still passes through the new path | no-op `teleport` → red, proving the scenario runs the new code and not the old one |
| `grep` gate | `setTranslation` appears 0 times under `templates/` | leave one → gate red |

#### Phase 3: a fresh scaffold typechecks

**Files:** `templates/minimal/package.json` EDIT · `packages/create-threenative/__tests__/template.spec.ts` EDIT ·
`packages/create-threenative/src/index.ts` EDIT (only if the dependency set is filtered there).

| Test | Assertion | Negative control |
|---|---|---|
| `should list @types/three in every template that runs tsc` | each template with a `typecheck` script has the dev dependency | drop it from `starter` → red |
| `should typecheck a scaffolded project with no manual installs` | scaffold smoke runs `pnpm typecheck` in the generated project, exit 0 | remove `@types/three` from `minimal` → red, which is today's behaviour |
| `should ship no catalog: version into a template` | existing CI assertion still holds | — |

#### Phase 4: forward is −z, and it is written down

**Files:** `templates/{starter,minimal}/src/entities/Player.ts` EDIT ·
`templates/platformer/src/entities/Character.ts` EDIT ·
`templates/starter/AGENTS.md` EDIT · `templates/minimal/AGENTS.md` EDIT ·
`templates/starter/playtests/forward.playtest.json` NEW.

`input.vector()` is unchanged — this phase changes what the reader sees at the call site.

| Test | Assertion | Negative control |
|---|---|---|
| `forward.playtest.json` | holding forward decreases world z by more than 0.5 over 60 ticks | map `move.y` to `+z` → the assertion fails, which is the bug that shipped |
| `should state the axis conversion in every template AGENTS.md` | grep for the `-move.y` line and the sentence naming it | — |
| `should convert the input vector on exactly one line per template` | one conversion site per template, not scattered | inline it twice → the grep count fails |

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets

grep -rn "mesh" packages/physics/src            # expect: CollisionShape3D.ts only
grep -rn "setTranslation" packages/create-threenative/templates  # expect: nothing
grep -rn "@types/three" packages/create-threenative/templates/*/package.json  # expect: 3 hits

# the scaffold a user gets, with no manual repair
node packages/create-threenative/dist/index.js /tmp/m --template minimal
cd /tmp/m && pnpm install && pnpm typecheck && pnpm test

# negative control, observed red before the pass is recorded
# 1. no-op CharacterBody3D.teleport → respawn.playtest.json must fail
# 2. flip the input sign in Player.ts → forward.playtest.json must fail
```

Playtest capture runs against real Chrome or headed Chromium under
`xvfb-run -a -s "-screen 0 1600x900x24"`; headless renders WebGPU blank and a blank frame
is not evidence of anything.

## 6. Acceptance (consumer-scoped)

- [ ] A character assembled from a `Group` of parts is its own `CharacterBody3D`, with no
      invisible-mesh workaround anywhere in the templates.
- [ ] A freshly scaffolded `minimal` project passes `pnpm typecheck` before a line is edited.
- [ ] Falling past the kill plane returns the player to spawn through `teleport`, and no
      template reaches into `body.body`.
- [ ] Holding forward in a scaffolded game moves the player away from the camera, asserted
      by a playtest that goes red when the sign is flipped.
- [ ] All four frictions are marked closed in the sweep ledgers that reported them, each
      with the commit that closed it.
