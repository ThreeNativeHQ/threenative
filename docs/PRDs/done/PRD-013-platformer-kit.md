# PRD-013 — The platformer kit: what the fox build wrote by hand

**Complexity: 6 → MEDIUM mode** (new template +2, multi-package +2, complex state +2)

**Depends on:** PRD-009 (shipped: `moveAndSlide`, `AnimationPlayer`, carry).
**Blocks:** PRD-015. **Charter authority:** `CHARTER.md` §11; `AGENTS.md` rules 1, 2, 3, 4.

## 1. Context

**Problem:** an agent was given a reference screenshot and a folder, and shipped a working
3D platformer — `~/projects/fox-game`, 1,850 lines of source. It used **zero framework**.
`package.json` lists exactly two dependencies: `three` and `vite`. Not one
`@threenative/*` import exists in the tree.

That is the measurement this PRD is built on. The framework was not rejected on an API
argument; it was never reached for, because nothing in it was closer to hand than
`new THREE.Mesh(...)`.

**Files analyzed:** `fox-game/src/{main,level,props,entities,fox,sky,palette,hud}.js`,
`packages/physics/src/CharacterBody3D.ts`, `packages/core/src/{scene,input,entities}.ts`,
`packages/create-threenative/templates/starter/**`.

### Where the 1,850 lines went

| File | LOC | What it is | Verdict |
|---|---|---|---|
| `main.js` | 411 | renderer boot, input, AABB collision, pickup loop, enemy loop, camera, hearts, goal | **the target** — most of it is plumbing |
| `level.js` | 427 | ground/island/bridge builders, collider bookkeeping, checkpoints, `updaters[]` | half plumbing, half content |
| `props.js` | 365 | trees, fence, waterfall, castle, windmill, airship, crate, flag | **content — must stay in user space** (rule 3) |
| `entities.js` | 197 | coin/gem/star/mushroom/snail meshes, `burst()`, `coinArc()` | content + one particle primitive |
| `fox.js` | 188 | primitive character rig, procedural run/jump animation | content, but a **repeatable shape** |
| `sky.js` | 113 | sky gradient shader, 4-light rig, cloud field | content — and the starter has none of it |
| `palette.js` | 109 | cached toon material, vertex-colour mottle, `rockBox` | content — and the highest-leverage 109 lines in the repo |
| `hud.js` | 46 | hearts, counters, timer, toast | content |

### The plumbing the agent rewrote, and what already exists

| Hand-written in `fox-game` | Lines | Framework equivalent | Why it was not used |
|---|---|---|---|
| `moveAxis()` + `aabbOverlap()` + `Level.colliders[]` | `main.js:146-176`, `level.js:28-33` | `CharacterBody3D` + `CollisionShape3D` | never seen; the folder had no example of it |
| gravity, terminal velocity, ground clamp | `main.js:250-259` | `moveAndSlide(dt)` (PRD-009) | **the starter itself does not use it** — see PRD-015 |
| keyboard + gamepad read, deadzone, normalise | `main.js:87-118` (32 lines) | `InputMap` + `justPressed` | not seen |
| `level.updaters[]` push/tick | `level.js:22, 424-426` | **nothing** | genuinely absent |
| `effects[]` push/tick/splice | `main.js:204, 367` | **nothing** | genuinely absent — *reimplemented in the same file* |
| `setTimeout` for respawn and toasts | `main.js:194`, `hud.js:41` | **nothing** | fires while the game is paused — a live bug class |
| pickup float + spin + distance test + collect | `main.js:288-313` (26 lines) | `Area3D` | 60 sensor bodies for 60 coins is the wrong shape |
| enemy ping-pong patrol + stomp-vs-hit | `main.js:316-352` (37 lines) | **nothing** | genuinely absent |
| checkpoints + respawn + hearts + i-frames | `main.js:178-201` (25 lines) | **nothing** | genuinely absent |

**The same updater-list pattern was written three times in one codebase.** That is the
single loudest signal in the build, and it is not platformer-specific — it is PRD-014.

## 2. Solution

**The abstraction a platformer needs is a template, not a package.** `AGENTS.md` rule 3
puts everything a screenshot shows in the user's `src/`, and rule 1 deletes anything a
competent developer writes in under 20 lines. Run the fox build's plumbing through both
gates and almost nothing survives into `packages/`:

- patrol — 12 lines → template
- coyote time + jump buffer — 15 lines → template
- checkpoint + respawn + i-frames — 15 lines → template
- pickup float/spin/collect — 12 lines → template
- procedural limb rig — 40 lines, and it is *the look* → template

So this PRD ships **one new scaffold template, `platformer`**, and **one** package change.
The claim is not "fewer concepts"; it is "the concepts arrive as editable source the agent
reads in its first five tool calls instead of inventing in its first fifty."

### The template: `templates/platformer/src/`

| Module | ~LOC | Replaces in `fox-game` | Note |
|---|---|---|---|
| `entities/Character.ts` | 70 | `main.js:120-259` | `moveAndSlide` + coyote + jump buffer + dash + double jump. **Feel constants at the top of the file**, not behind an option. |
| `entities/Patrol.ts` | 30 | `main.js:316-352` | `from`/`to` ping-pong + `onStomp` / `onTouch`. Godot: an `Area3D` child on a `CharacterBody3D`. |
| `entities/Pickup.ts` | 35 | `main.js:288-313`, `entities.js:186-197` | float, spin, radius collect, `coinArc()` placement helper. |
| `level/Checkpoints.ts` | 35 | `main.js:178-201` | ordered respawn points, hearts, i-frame blink. |
| `render/rig.ts` | 60 | `fox.js` | primitive-built character + speed/grounded-driven limb swing. The one piece worth copying wholesale. |
| `render/terrain.ts` | 90 | `level.js:36-255` | grass-capped ground blocks, floating islands, plank bridges — each returning its own collider. |
| `render/sky.ts` | 70 | `sky.js` | gradient sky, 4-light rig, drifting cloud field. |
| `render/palette.ts` | 60 | `palette.js` | cached toon material + `mottle()` vertex-colour noise + `rockBox()`. |

**~450 generated lines standing in for ~1,200 hand-written ones.** The remaining ~650 in
`fox-game` are props and level layout, which is the game, and must stay the agent's job.

### The one package change: drop-through platforms

`CharacterBody3D` cannot express a one-way platform — the character must pass upward
through a collider and land on it coming down. Rapier exposes this through a per-tick
query filter predicate on the character controller, and wiring it correctly against
`computeColliderMovement` is ~35 lines with a real failure mode (a stale predicate leaks
into the next tick). It clears rule 1 on both counts.

`CharacterBody3D` gains `oneWayGroups?: number` — collider groups the controller ignores
while `velocity.y > 0`. Godot's name for the concept is `one_way_collision`; the property
sits on the platform there, so **this needs a spike before Phase 4** to confirm the Rapier
filter can be driven from the rider's side without inverting the borrowed vocabulary.
If the spike says no, Phase 4 is dropped and the template ships without one-way platforms.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| `Platformer` / `defineGame({ genre })` preset | `CHARTER.md` §2 closes preset systems. |
| A `Pickup` / `Enemy` base class in `packages/core` | Rule 1: 12 and 30 lines. Rule 4: neither is a Godot node. |
| Feel constants as `defineGame` options | Rule 3: jump arc is the game. It belongs in `Character.ts`, tunable in one screen. |
| A tile/level format | `CHARTER.md` §2 closes scene formats. `terrain.ts` returns plain meshes. |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `templates/platformer` | `create-threenative` template list + scaffold smoke | — | n/a | scaffold with it and delete `Character.ts` → `jump.playtest.json` fails |
| 2 | `entities/Character.ts` | `platformer/src/scenes/Level.ts` | starter's hand-rolled `#verticalVelocity` | starter fixed in PRD-015 | coyote = 0 → `coyote.playtest.json` fails |
| 3 | `entities/Patrol.ts` | same | — | n/a | freeze `dir` → `patrol.playtest.json` position delta fails |
| 4 | `level/Checkpoints.ts` | same | — | n/a | always respawn at index 0 → `respawn.playtest.json` fails |
| 5 | `render/{sky,palette,terrain,rig}.ts` | same | — | n/a | see PRD-015 for the looks-good gate |
| 6 | `CharacterBody3D.oneWayGroups` | `platformer/src/level/Platform.ts` | — | n/a | ignore the flag → rider bonks the underside, `oneway.playtest.json` fails |

**Reachability:** `npx create-threenative --template platformer` → `pnpm dev` → a character
that runs, jumps, dashes, stomps an enemy, collects a coin, dies and respawns at a
checkpoint. Every one of those is a playtest scenario, not a screenshot.

## 4. Phases

#### Phase 1: the template exists and a character moves well

**Files:** `templates/platformer/**` NEW · `create-threenative/src/index.ts` EDIT ·
`create-threenative/__tests__/scaffold.spec.ts` EDIT.

| Test | Assertion | Negative control (observe red) |
|---|---|---|
| `should scaffold the platformer template with no catalog: versions` | no `catalog:` survives | leave one in → fails |
| `jump.playtest.json` | `assert.movement.minAxisDelta {axis:'+y', min: 1.5}` | remove impulse → fails |
| `coyote.playtest.json` | jump lands after leaving the ledge, exactly once | coyote = 0 → fails; coyote unbounded → double jump, count assertion fails |
| `should buffer a jump pressed before landing` | fires on the landing tick | buffer = 0 → fails |

#### Phase 2: enemies, pickups, and the collect loop

**Files:** `platformer/src/entities/{Patrol,Pickup}.ts` NEW · `src/scenes/Level.ts` EDIT ·
`playtests/{patrol,collect,stomp}.playtest.json` NEW.

| Test | Assertion | Negative control |
|---|---|---|
| `patrol.playtest.json` | enemy `+x` then `-x` within the run | pin `dir = 1` → enemy leaves the level, fails |
| `collect.playtest.json` | `state.coins` increments; the mesh leaves the scene | skip `remove` → entity count assertion fails |
| `stomp.playtest.json` | landing on the enemy from above removes it and bounces the player | drop the `vel.y < 0` guard → walking into it kills it, fails |
| `should not stomp when rising into the enemy` | player takes damage instead | remove the guard → fails |

#### Phase 3: death, checkpoints, respawn

**Files:** `platformer/src/level/Checkpoints.ts` NEW · `src/state.ts` EDIT ·
`playtests/respawn.playtest.json` NEW.

| Test | Assertion | Negative control |
|---|---|---|
| `respawn.playtest.json` | falling below the kill plane returns the player to the **last passed** checkpoint | always index 0 → position assertion fails |
| `should decrement hearts once per hit during i-frames` | one decrement across 60 ticks of contact | i-frames = 0 → hearts drain, fails |
| `should fail closed on an empty checkpoint list` | throws at construction | return `undefined` → silent respawn at origin |

#### Phase 4: one-way platforms *(gated on the spike)*

**Files:** `physics/src/CharacterBody3D.ts` EDIT · `physics/src/index.ts` EDIT ·
`platformer/src/level/Platform.ts` NEW · `physics/__tests__/character.spec.ts` EDIT ·
`playtests/oneway.playtest.json` NEW.

**Spike first, written up in `docs/verification/PRD-013-spike.md`:** can the Rapier
character controller's filter be set per-tick from the rider without contradicting Godot's
`one_way_collision`, which sits on the platform? If not, **cut this phase.**

| Test | Assertion | Negative control |
|---|---|---|
| `oneway.playtest.json` | rising through the platform, then landing on it | ignore `oneWayGroups` → bonk, `+y` delta fails |
| `should clear the filter predicate after step()` | tick N+1 collides normally | leave it set → the player falls through the world |

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets
pnpm tsx scripts/count-loc.ts    # kill switch: the platformer row must beat fox-game's 1,850

# scaffold + run the real thing
node packages/create-threenative/dist/index.js my-game --template platformer
cd my-game && pnpm install && pnpm test    # runs the playtest scenarios above

# Revert check — comment out the jump impulse in Character.ts
# Expected: jump.playtest.json fails on minAxisDelta, NOT "0 assertions, pass"
```

## 6. Acceptance (consumer-scoped)

- [ ] `--template platformer` produces a game where a character runs, jumps, dashes,
      stomps an enemy, collects a coin, and respawns at a checkpoint — each asserted by a
      scenario, none by a screenshot.
- [ ] Rebuilding `fox-game` on this template needs **fewer** total lines than 1,850, shown
      by `scripts/count-loc.ts`. If it does not, the template is deleted (rule 2).
- [ ] No feel constant is a `defineGame` option; all of them are in `Character.ts`.
- [ ] `packages/` grows by at most `oneWayGroups`, or by nothing if the spike says no.
- [ ] `pnpm budgets` still passes: 7 packages, framework LOC under 15,000.
- [ ] Every gate observed red once, recorded in `docs/verification/PRD-013.md`.
