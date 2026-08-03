# PRD-009 — The platformer character: controller, animation, follow camera

**Complexity: 8 → HIGH mode** (10+ files +3, new system +2, complex state +2, multi-package +2)

**Depends on:** PRD-007, PRD-008. **Blocks:** PRD-010.
**Design authority:** `DESIGN.md` §5b, §6, §11; `AGENTS.md` rules 1, 3, 4.

## 1. Context

**Problem:** nothing in this repository has a character that can jump.
`examples/REFERENCE.png` needs run, jump, dash, a skinned animated body, and a camera
behind it. All four are absent; two are **documented as present**.

**Files analyzed:** `packages/physics/src/CharacterBody3D.ts`,
`packages/core/src/{assets.ts,game.ts,scene.ts}`, `DESIGN.md` §6,
`packages/core/AGENTS.md`, `templates/starter/src/entities/Player.ts`.

**Current behavior:**

| Need | Today | Evidence |
|---|---|---|
| Gravity, jump arc, terminal velocity | caller's job; `move()` takes a per-frame translation zeroed each `step()` | `CharacterBody3D.ts:64-80` |
| Velocity state | none | no `linearVelocity` accessor |
| Skinned animation | **zero support** — no `AnimationMixer` in `packages/` | grep: 0 hits |
| Follow camera | **absent**, yet `DESIGN.md:262` prints `ctx.camera.follow(hero, …)` | `Ctx.camera` is a bare `PerspectiveCamera` |
| Moving-platform carry | not wired | the rider is not transported |

### Two doc conflicts to resolve before Phase 1

1. `DESIGN.md` §6 shows `ctx.camera.follow()`. `core/AGENTS.md` says *"`ctx.camera` is a
   real camera… no wrapper may be introduced"*, and `AGENTS.md` rule 3 bans **camera
   framing** from package code. **Proposed:** the rig ships as generated source in
   `src/camera/follow.ts` (a damped follow is under 20 lines — rule 1); `ctx.camera` stays
   raw; `DESIGN.md` §6 is amended to show that call.
2. `DESIGN.md` §6 shows `hero.body.applyImpulse(...)` on a character. Rapier kinematic
   character controllers take no impulses. **Proposed:** amend §6 to `hero.velocity.y = JUMP`.

**Both amendments need sign-off first.** A PRD that silently contradicts `DESIGN.md` is
how v1 drifted.

## 2. Solution

- `CharacterBody3D` gains `velocity: Vector3`, `gravity`, and `moveAndSlide(dt)` — the
  Godot name (rule 4). `move()` stays as the raw escape hatch.
- Carry: after `computeColliderMovement`, read the platform collider under the feet and add
  its per-tick delta before resolving. ~25 lines, with no vanilla one-liner.
- `AnimationPlayer` in core: wraps `AnimationMixer`, named clips, `play(name, {fade})`,
  `current`. Core's closed list gains one line in `packages/core/AGENTS.md`.
- Feel constants (coyote time, jump buffer, dash speed and cooldown) live in the **example
  player**, not the package. Tuning is the game.
- Two new observation channels so all of it is provable: `runtime.animation` (current clip,
  advanced frames) and `runtime.state` (controller state name).

**Proof subject:** `examples/platformer` — new, and the real target of this work. Not the
grey-box starter.

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `CharacterBody3D.moveAndSlide` | `examples/platformer/src/entities/Fox.ts` | `move({y: 0})` in starter | starter updated | gravity 0 → fox never lands, `minAxisDelta -y` fails |
| 2 | Platform carry | same | — | n/a | disable → fox slides off, `reachesPositionWithin` fails |
| 3 | `AnimationPlayer` | `examples/platformer/src/entities/Fox.ts` | — | n/a | freeze mixer → `assert.animation.advancedFrames` fails |
| 4 | `runtime.animation` channel | `core/src/playtest.ts` capability list | — | n/a | advertise without supplying → PRD-007 parity test fails |
| 5 | `runtime.state` channel | `core/src/playtest.ts` | — | n/a | pin state to `idle` → `assert.states.equals: "dash"` fails |
| 6 | `src/camera/follow.ts` (example) | `examples/platformer/src/scenes/Level.ts` | nothing (was absent) | n/a | detach → `assert.camera.targetInViewport` fails |

**Reachability:** frame loop → `Level.update` → `Fox.update` → `moveAndSlide` +
`AnimationPlayer.play` + follow rig. User-facing: a fox that runs, jumps and dashes.

## 4. Phases

#### Phase 1: the fox falls and lands — gravity and ground truth

**Files:** `physics/src/CharacterBody3D.ts` EDIT · `physics/src/index.ts` EDIT ·
`examples/platformer/src/entities/Fox.ts` NEW · `src/scenes/Level.ts` NEW ·
`physics/__tests__/character.spec.ts` EDIT.

| Test | Assertion | Negative control (observe red) |
|---|---|---|
| `should accumulate gravity into velocity when airborne` | `velocity.y < 0` after 10 ticks | gravity 0 → fails |
| `should zero downward velocity when grounded` | `velocity.y === 0`, `grounded` true | skip the clamp → fox accelerates through the floor |
| `should leave move() unchanged for raw callers` | existing spec still green | — |

#### Phase 2: one press, one jump, one dash — proved by scenario

**Files:** `examples/platformer/src/entities/Fox.ts` EDIT · `src/state.ts` NEW ·
`core/src/playtest.ts` EDIT (`runtime.state`) · `playtest/jump.json` NEW ·
`playtest/dash.json` NEW.

| Test | Assertion | Negative control |
|---|---|---|
| `jump.json` | `assert.movement.minAxisDelta {axis:'+y', min: 1.5}` | remove the impulse → fails |
| `jump.json` | `assert.states [{entity:'fox', equals:'jump'}]` | hardcode `idle` → fails |
| `dash.json` | `minAxisDelta {axis:'+x'}` above run speed | dash speed = run speed → fails |
| `should buffer a jump pressed just before landing` | jump fires on the landing tick | — |
| `should allow a jump within coyote frames of leaving ground` | exactly one jump | — |

#### Phase 3: the fox is animated and the camera stays behind it

**Files:** `core/src/animation.ts` NEW · `core/src/index.ts` EDIT ·
`core/src/playtest.ts` EDIT (`runtime.animation`) · `examples/platformer/src/camera/follow.ts`
NEW · `playtest/run-camera.json` NEW.

| Test | Assertion | Negative control |
|---|---|---|
| `should crossfade between clips without a pop` | weights sum to 1 across the fade | fade 0 → weights jump, fails |
| `should throw on an unknown clip name` | throws (fail closed) | return silently → fails |
| `run-camera.json` | `assert.animation [{entity:'fox', clip:'run', advancedFrames: 10}]` | freeze mixer → fails |
| `run-camera.json` | `assert.camera {follows:'fox', within: 14, targetInViewport: true}` | detach rig → fails |

#### Phase 4: carry — the fox rides a moving platform

**Files:** `physics/src/CharacterBody3D.ts` EDIT · `physics/src/plugin.ts` EDIT ·
`examples/platformer/src/entities/Platform.ts` NEW · `playtest/carry.json` NEW ·
`physics/__tests__/character.spec.ts` EDIT.

| Test | Assertion | Negative control |
|---|---|---|
| `carry.json` | `reachesPositionWithin` the platform's far end with no input | disable carry → fox stays put, fails |
| `should not carry a rider that is not grounded on it` | no delta applied | apply unconditionally → jumping fox teleports, fails |

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets && pnpm test:playtest
pnpm tsx scripts/count-loc.ts     # kill switch — no framework row may lose to vanilla

grep -rn "moveAndSlide\|AnimationPlayer" packages examples --include=*.ts | grep -v __tests__

# Capability parity (guards the PRD-007 invariant)
# Expected: describe().capabilities === channels present in sample()

# Revert check — comment out AnimationPlayer.play in Fox.ts
# Expected: run-camera.json fails on assert.animation, not "0 assertions, pass"
```

## 6. Acceptance (consumer-scoped)

- [ ] In `examples/platformer`, holding right and tapping jump crosses a gap and lands on
      the far platform — asserted by a scenario, not a screenshot.
- [ ] The clip changes idle→run→jump as the fox moves, and a scenario fails if the mixer
      stops advancing.
- [ ] The camera keeps the fox in the viewport for the whole run (`assert.camera`).
- [ ] Standing still on a moving platform transports the fox.
- [ ] `DESIGN.md` §6 no longer documents an API that does not exist.
- [ ] `scripts/count-loc.ts` shows no framework row losing to vanilla.
- [ ] Every gate observed red once, recorded in `docs/verification/PRD-009.md`.
