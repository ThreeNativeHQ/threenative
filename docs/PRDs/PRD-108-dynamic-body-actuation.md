---
prd_contract: v1
---

# PRD-108 — A game can move a dynamic body, and a character can push one

**Status: DONE, written and executed 2026-08-14.** Every gate below was run; commands and results
are in §4.

**Complexity: 4 → SMALL mode.** One capability, five files, both backends, no new module.

---

## 1. Context

**Problem.** `@threenative/physics` shipped no portable way to move a dynamic body. `RigidBody3D`
had exactly six public methods — `writeKinematic`, `kinematicMotion`, `syncToPhysics`,
`syncFromPhysics`, `applyTransform`, `dispose` — and a grep for
`impulse|applyForce|setLinvel|addForce|torque` across `packages/physics/src` returned nothing.
`IPhysicsSimulation` offered only `setBodyTransform`, documented "cold-path repositioning", and a
transform write to a dynamic body is discarded by the next step.

`body.raw` is a Rapier `RigidBody` on web and opaque on native, typed `unknown` and non-portable
by contract, so reaching through it forks the game by platform. That is the case `AGENTS.md`
names directly: when a game must branch on platform to make native match web, it is an engine bug
wearing a game-code costume.

Separately, Rapier's character controller has `setApplyImpulsesToDynamicBodies`, off by default,
and `CharacterBody3D` never called it. A character therefore collided with crates and never moved
them, which reads as a physics bug rather than a default.

**How it was found.** Round 5's sandbox build (`docs/verification/round-5-2026-08-14.md`) was a
physics puzzle whose core verb is shoving a crate. Measured in that build: driving the player into
crates for 2.5 s moved zero crates while the player travelled 10.4 units; nudging a dynamic crate
+2.0 on x reverted to its prior position within 600 ms. The game shipped an invisible kinematic
paddle body driven by per-frame transform writes, a third collision layer to stop the paddle
pinning its own player, and a load limiter parking the paddle at `y = -80` when more than two
crates were in contact — roughly 90 lines of user code standing in for one engine call.

That build scored 7/20 on the gameplay-plumbing axis, its largest single loss
(`docs/verification/score-physics-puzzle-2026-08-14.md`).

**Files analyzed.**

- `packages/physics/src/RigidBody3D.ts` — the six-method public surface
- `packages/physics/src/simulation.ts:143-184` — `IPhysicsSimulation`, and `configureCharacter`
- `packages/physics/src/CharacterBody3D.ts` — character options and `moveAndSlide`
- `packages/physics/src/native/host.ts` — the native ABI and its too-old-ABI throw pattern
- `packages/physics/src/handles.ts:1-14` — `raw`, and why it is not the answer

## 2. What changed

Four methods on the backend seam — `applyBodyImpulse`, `applyBodyForce`, `setBodyLinearVelocity`,
`readBodyLinearVelocity` — implemented for Rapier on web and forwarded through the native ABI,
which throws `TN_NATIVE_PHYSICS_ACTUATION_MISSING` when the runtime is too old rather than
accepting the call and dropping it.

On `RigidBody3D`, the Godot-named surface: `applyImpulse`, `applyForce`, and a `linearVelocity`
accessor. These are not convenience wrappers over something a game could already call — they are
the portable seam for an operation that had none.

On `CharacterBody3D`, a `pushesDynamicBodies` option, default `false` to match Rapier, threaded
through `IPhysicsCharacterOptions` into `setApplyImpulsesToDynamicBodies`.

Fails closed at the seam:

- Actuating a `fixed`, `kinematic` or `character` body throws `TN_PHYSICS_NOT_DYNAMIC`. Rapier
  discards such a call, so accepting it would be a silently motionless body.
- A non-finite or malformed vector throws `TN_PHYSICS_NON_FINITE`. A NaN reaching Rapier corrupts
  the body for the rest of the run instead of throwing, and surfaces frames later as a body that
  vanished.
- Actuation after `dispose()` throws.
- Impulses and velocity writes pass Rapier's `wakeUp` flag, because actuation on a sleeping body
  is otherwise discarded — the same silent no-op class this API exists to remove.

## 3. Criteria

| # | Criterion | Met? |
| --- | --- | --- |
| 1 | An impulse moves a dynamic body, where a transform write is discarded | yes |
| 2 | `linearVelocity` round-trips and produces motion | yes |
| 3 | A continuous force accumulates into motion | yes |
| 4 | An impulse wakes a settled body instead of being discarded | yes |
| 5 | Actuating a non-dynamic body throws rather than doing nothing | yes |
| 6 | NaN, infinite and malformed vectors throw | yes |
| 7 | Actuation after dispose throws | yes |
| 8 | A character with `pushesDynamicBodies` shoves a crate; without it, it does not | yes |
| 9 | Native throws on an ABI too old to actuate, rather than dropping the call | yes — `TN_NATIVE_PHYSICS_ACTUATION_MISSING` |
| 10 | Repository gates stay green | yes |

Criterion 8 is measured as a difference, not an absolute: the same 90-frame walk displaces the
crate more than 0.5 units with the option on, and less than half that with it off.

## 4. Evidence

| Gate | Command | Result |
| --- | --- | --- |
| New tests | `pnpm exec vitest run packages/physics/__tests__/actuation.spec.ts` | pass — 10 tests |
| Native + parity contracts | `pnpm exec vitest run packages/physics/__tests__/native-contract.spec.ts packages/physics/__tests__/parity.spec.ts packages/physics/__tests__/documentation.spec.ts` | pass — 36 tests |
| Typecheck | `pnpm typecheck` | pass — 0 errors |
| Lint | `pnpm lint` | pass — exit 0 |
| Test | `pnpm test` | pass — 1122 passed, 32 skipped, 133 files |
| Budgets | `pnpm budgets` | pass — 14691/15000 framework LOC, up 139 from 14552 |

Writing the character-push test surfaced a game-code bug of my own worth recording, because it is
the same trap a user hits: `moveAndSlide(dt)` derives motion from `velocity` and overwrites
whatever `move()` set, so `move()` followed by `moveAndSlide()` moves nothing. The first version of
the test walked a character zero units and looked exactly like a broken push.

## 5. What this does not do

- **It does not implement the native side.** The TypeScript ABI forwards and throws when the C++
  runtime lacks the entry points; the Rust `Simulation` must gain them before a native build can
  push a crate. Until then this is web-proved and native-guarded, not native-proved.
- **It does not re-score round 5.** The 68/100 in `score-physics-puzzle-2026-08-14.md` was measured
  against a build that ran on the old framework, and a score may not be carried forward across a
  change. Axis 3 of that score is now stale; only a fresh build re-measures it.
- It leaves two gameplay-plumbing gaps from the same round open: scene-created physics bodies are
  not disposed on scene exit, and physics steps on frame `dt` with no fixed-step option, so an
  in-session restart is not reproducible (measured: identical rest hash across five fresh loads,
  three different hashes across three restarts).
