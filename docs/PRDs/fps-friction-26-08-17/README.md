# Batch — what the FPS build could not write, 2026-08-17

**Status: PROPOSED, 2026-08-17. Nothing in this folder has run.** Thirteen PRDs, PRD-138 through
PRD-150.

Every item comes from one source: the friction ledger a cold agent kept while building a
first-person shooter against a real game's reference, archived at
[`docs/verification/sweep-fps-2026-08-17.md`](../../verification/sweep-fps-2026-08-17.md) and closed
as [PRD-137](../done/PRD-137-the-agent-test-on-a-real-game.md). Nineteen rows. This folder is those
rows read as engineering work, plus three defects found by reading the source those rows pointed at
that the builder never hit.

**No mobile, iOS or performance-parity claim is made anywhere in it.** Several PRDs require a
desktop native run and say so; none requires a phone, a Mac or a rater.

## What the ledger was actually saying

Two sentences from its own summary:

> Rows 4, 12, 17 and 18 are one defect in four places: the generated `AGENTS.md` and the generated
> `package.json` describe a project that does not behave the way they say.
>
> Rows 1, 3, 9 and 10 are the genre meeting a framework shaped around a third-person platformer.

That is the batch's two lanes. A third thing became visible only when the source behind the rows
was read for this batch:

| Found by reading, not by building | Where |
| --- | --- |
| The collapse pass **removes** the meshes a game picks against, and no test covers a raycast after a collapse | [140](./PRD-140-scene-collapse-breaks-picking.md) |
| `@threenative/physics` has **no joints of any kind**, so nothing can be hinged, pinned or chained | [143](./PRD-143-physics-joints.md) |
| A passing unit test asserts the broken step spelling is **valid**, which is how it survived a year | [146](./PRD-146-playtest-frames-vs-ticks.md) §3 row 1 |

## Shape rules — these bind every PRD in this folder

Every PRD here proposes framework surface, which is the most expensive thing this repository can
add. Each carries a **Shape constraints** section naming its specific risk; these are the general
rules those sections apply, stated once so they are not restated thirteen times.

1. **SRP — one job per thing, and gameplay is never the job.** `InputMap` reports devices and does
   not own sensitivity. `AnimationPlayer` blends clips and does not become a state machine.
   `PhysicalBoneSimulator3D` moves bones and does not decide when a character dies. The second job
   is always the one that turns 300 lines into 3,000.
2. **DRY — compose what exists, never a parallel path.** [144](./PRD-144-ragdoll.md) composes
   [143](./PRD-143-physics-joints.md)'s joints and [142](./PRD-142-bone-sockets-and-attachment.md)'s
   bone resolution; if it grows its own, the layering is wrong and review rejects it.
   [147](./PRD-147-assertion-upper-bound.md) is one key missing from three duplicated lists — the
   fix is deduplicating the list, not adding the key three times.
3. **KISS — ship the smallest surface a real game asked for.** Three joints, not five. `lte`, not
   six comparators. `mode: "once"`, not a transition graph. Every PRD names what it deliberately
   left out so the absence is a decision.
4. **Borrowed vocabulary.** Godot for nodes, Three.js for rendering, Rapier for physics.
   `PinJoint3D`, `HingeJoint3D`, `PhysicalBone3D`, `BoneAttachment3D` are Godot's names.
   `Intersection` stays Three.js's shape and is not re-wrapped.
5. **Never own the look.** [144](./PRD-144-ragdoll.md) is the one at risk and it refuses a humanoid
   preset in advance — a preset system is on the closed list and passing the two questions does not
   reopen it.
6. **The kill switch is executable.** Four PRDs — [139](./PRD-139-raycast-world-ray-or-delete.md),
   [141](./PRD-141-animation-one-shot-clips.md),
   [142](./PRD-142-bone-sockets-and-attachment.md), [144](./PRD-144-ragdoll.md) — have an
   acceptance row that runs `count-loc.ts` against the hand-rolled equivalent and **withdraws the
   PRD if the abstraction is not smaller**. That is not a formality: 139 and 144 are genuine
   coin-flips.

`packages/core/CLAUDE.md` says its API list is closed and that adding to it needs a PRD and a line
in `CHARTER.md`. PRDs 138, 139, 141 and 142 are that PRD; the charter line goes in with the code.

## The work

Four lanes. A and B are independent. C is strictly sequential. D is docs and lands last.

### Lane A — the framework cannot express the genre

| PRD | What it closes | Complexity |
| --- | --- | --- |
| [138](./PRD-138-relative-pointer-look.md) | No pointer delta and no pointer lock, so first-person look is written against `document` and is **web-only by construction** | 5 |
| [139](./PRD-139-raycast-world-ray-or-delete.md) | `ctx.raycast` cannot cast a world ray, exclude the viewmodel, or return more than one hit — so the shooter used plain `THREE.Raycaster` and never called it | 4 |
| [140](./PRD-140-scene-collapse-breaks-picking.md) | The collapse pass removes picked meshes and their `userData` at 200 meshes, silently, and picking is how the game scores | 6 |
| [141](./PRD-141-animation-one-shot-clips.md) | `AnimationPlayer` hides `LoopOnce`, `clampWhenFinished` and `finished`, so a hard-coded `1.1` in gameplay code stands in for "the clip ended" | 3 |
| [142](./PRD-142-bone-sockets-and-attachment.md) | Holding a rifle is 50 lines of bone-name regex, world-scale undo and a silent fallback that leaves the weapon floating | 4 |
| [145](./PRD-145-rigidbody-position-asymmetry.md) | `RigidBody3D` takes no `position` while `Area3D` does, so every static collider allocates a throwaway `Object3D` | 2 |

**[138] is the one to do first.** Its workaround is a portability violation the framework's own
rules forbid, and the native host already produces the data it needs (`input.cpp:367`,
`data.movementX = event.xrel`) — only the portable API is missing.

### Lane B — the harness and the generated project

| PRD | What it closes | Complexity |
| --- | --- | --- |
| [146](./PRD-146-playtest-frames-vs-ticks.md) | `holdFrames`/`waitFrames` — the documented spelling, and what `cli.js init` writes — pass validation and advance the game by 5% of what they ask | 3 |
| [147](./PRD-147-assertion-upper-bound.md) | No `lte`, so a 60-second countdown can only be asserted to have *changed*; direction was checked by eye | 2 |
| [148](./PRD-148-scaffolded-project-cannot-run-its-own-gate.md) | `pnpm test` is up to 16 clauses on a hard-coded port, three templates ship the headless-WebGPU trap, and deleting a scenario the docs invite you to delete breaks it | 5 |

**Order within B: 146, then 147, then 148.** Fixing the runner that runs the scenarios before the
scenarios are honest wastes the verification.

### Lane C — ragdoll, and it is sequential

| PRD | What it closes | Complexity |
| --- | --- | --- |
| [143](./PRD-143-physics-joints.md) | No joints at all: no door, rope, chain, axle or articulated anything on either backend | 7 |
| [144](./PRD-144-ragdoll.md) | A death is a canned clip plus a hard-coded `1.1` s and a frozen mixer; the 4× headshot the game already computes cannot show on screen | 8 |

**[144] must not be started until [143] has landed and passed on `--target desktop`, and until a
hand-rolled ragdoll has been built in a game and measured.** That ordering is a requirement, stated
in 144 §5: post-143 a game could plausibly assemble one in ~80 lines, which would answer question
(a) with "yes, the game could write this" and end the PRD. Building the abstraction before knowing
is the failure the kill switch exists for.

### Lane D — say what is true

| PRD | What it closes | Complexity |
| --- | --- | --- |
| [149](./PRD-149-generated-docs-describe-a-different-project.md) | Two undocumented resource ids for one object, `moveAndSlide` not moving anything when called, and a prohibition on per-frame React data that names no alternative | 4 |
| [150](./PRD-150-asset-introspection.md) | Nothing reports a model's bounds, units, clips or bones, and the harness hides `console.info` — so both routes to the number are closed | 3 |

**[149] lands last**, after 146 and 148 have changed what is true.

## Cost

Lane A ≈ 24 complexity, lane B ≈ 10, lane C ≈ 15, lane D ≈ 7. **Lane C is over a third of the batch
in two PRDs and it is the one most likely to be cut** — 144 may withdraw itself at its own
acceptance row 6. Lanes A and B together are the majority of the ledger's rows for less than half
the cost, and if only part of this folder ships, they are the part.

## Judgement, not mechanics

Six decisions are the owner's. They are recorded here so they are made once rather than argued
inside each PRD:

1. **[139] widen or delete `ctx.raycast`.** Recommendation: widen. The BVH is the only part a game
   should not write. Row 5 decides it with `count-loc`.
2. **[140] decline-on-`userData` or warn-and-opt-out.** Recommendation: decline. It contradicts a
   sentence in `collapse.ts` that must be corrected in the same commit.
3. **[146] fix `holdFrames` or reject it.** Recommendation: reject. Two names for one concept is the
   discovery cost the vocabulary rule exists to prevent.
4. **[148] artifacts outside the project root, or watch-ignored inside it.** The first removes the
   collision; the second hides it. The first changes where users look for artifacts.
5. **[149] which resource id is canonical.** Recommendation: `state` — it matches `ctx.state`, the
   API the game calls.
6. **[144] whether the class exists at all**, after 143 lands and the hand-rolled version is
   measured.

## Deliberately left out

Recorded so the next round does not rediscover them, and so their absence is a decision.

1. **A "static level collision" helper.** Asked for by the ledger, **refused** in
   [145 §3](./PRD-145-rigidbody-position-asymmetry.md): the game wrote it portably in nine lines and
   the same array did double duty as the enemy's blocker test, which a framework helper would have
   taken away. Question (a) is a gate, not a preference.
2. **An unthrottled scene→HUD channel.** Refused in
   [149 §1.3](./PRD-149-generated-docs-describe-a-different-project.md): it would exist only to let
   games do what the same document tells them not to do. The build's answer — per-frame feedback as
   Three.js objects in the scene — is right, and the framework should say so instead of shipping an
   escape hatch.
3. **`model.bounds` on `ctx.assets`.** Refused in [150 §2](./PRD-150-asset-introspection.md):
   `new Box3().setFromObject()` is portable plain Three.js and the game already does it. The gap is
   at the terminal, before code is written, so the fix is a CLI.
4. **`SliderJoint3D` and `Generic6DOFJoint3D`.** Out of [143 §2](./PRD-143-physics-joints.md). No
   game here needs them and a generic 6-DOF joint is a configuration surface, not a constraint.
5. **The `mixamorig`/`RightHand`/`hand_r` naming guess.** Out of
   [142 §2](./PRD-142-bone-sockets-and-attachment.md). A framework mapping "right hand" onto an
   exporter's convention is inventing vocabulary and picking sides. `skeletonBones()` returns the
   real names; the game picks.
6. **The `tools/capture.mjs` row (ledger row 13).** It scores against the PRD-137 experiment's own
   supplied harness, not the framework, and the ledger says so. Only the playtest runner's console
   artifact is in scope — [150 §3](./PRD-150-asset-introspection.md).
7. **Re-running the agent test.** This batch is downstream of one n=1 build. Whether these fixes
   reduce friction rows on the next cold build is a round with a budget, not a day of local work,
   and it is the only thing that will actually confirm any of it.

## What this batch does not claim

**Not that the framework is now shaped for first-person games** — one build, one genre, one agent,
and the visual column of that experiment came back *unresolved* against a 1-point noise floor.
**Not that the thirteen items are the thirteen most valuable things in the repository**; they are
the ones one real build tripped over, which is a different and narrower claim. **Not that any
platform beyond desktop is proved** — several PRDs require a `--target desktop` row and none
requires a phone, so nothing here may be described as mobile-ready. Each PRD repeats the limit that
binds it.
