# PRD-014 — Foundations any game needs: time, sound, determinism

**Complexity: 7 → HIGH mode** (new system +2, complex state +2, multi-package +2, closed-list amendment +1)

**Depends on:** PRD-008 (shipped: `ctx.goto`, input edges). **Blocks:** PRD-013 Phase 2, PRD-015.
**Charter authority:** `CHARTER.md` §6, §11; `packages/core/AGENTS.md` (the closed list);
`AGENTS.md` rules 1, 2, 4.

## 1. Context

**Problem:** three things every game reaches for on day one have no home in this framework,
so every game invents them — badly, and differently each time.

**Files analyzed:** `packages/core/src/{scene,loop,game,assets,state}.ts`,
`packages/create-threenative/templates/{starter,minimal}/**`, `~/projects/fox-game/src/**`.

**Evidence, from a real 1,850-line game built with no framework (see PRD-013 §1):**

| Gap | Evidence | Consequence |
|---|---|---|
| No scheduled work | `fox-game` wrote a per-frame updater list **three times in one codebase**: `level.js:22,424`, `main.js:204,367`, and `hud.js:41` via `setTimeout` | every module grows an ad-hoc `updaters[]`; none is cleaned up on scene exit |
| No pause, and timers ignore it | `main.js:194` respawns via `setTimeout(700)` | wall-clock timers keep firing while the game is stopped; a respawn lands mid-pause |
| No audio playback | `assets.audio()` returns an `AudioBuffer` (`assets.ts:53-57`) and **nothing in the repo can play it** — grep for `AudioListener` across `packages/`: 0 hits | `fox-game` shipped with **no sound at all**. Not one line. |
| No seeded randomness | `fox-game` hand-rolled an LCG (`level.js:9-15`) and pinned seed `90210` so the level is stable between runs | a playtest over anything procedural cannot assert a position, because the world moves between the run and the re-run |

The audio gap is the sharpest: the loader was built, the sink was not. `AssetLoader.audio`
is a function that today can only ever feed `/dev/null`.

## 2. Solution

Three additions to `packages/core`, each carrying something user code genuinely cannot
supply itself. Each needs one line in `packages/core/AGENTS.md`'s closed list, and that
amendment is part of Phase 1 — not a follow-up.

### A. The loop owns time — `ctx.after`, `ctx.every`, `ctx.tween`, `game.pause()`

```ts
ctx.after(0.7, () => respawn())              // fires in game-seconds, not wall-clock
const stop = ctx.every((dt) => windmill.rotation.z += dt * 0.55)
ctx.tween(door.position, { y: 3 }, 0.4)      // returns a Promise
game.pause(); game.resume()
```

Why this is not rule 1: the value is not the 20 lines of bookkeeping, it is that the
handles are **owned by the scene and cancelled by `ctx.goto`**. A user-space `updaters[]`
cannot see the scene lifecycle without the user threading it through every module — which
is exactly the leak `fox-game` demonstrates three times. Everything registered dies with
the scene, and a leaked handle after `goto` is a test failure, not a slow drift.

**Vocabulary (rule 4):** Godot's `SceneTree.create_timer` and `Tween` — `after`/`every`
are the camelCase reduction of `create_timer(...).timeout` and `_process`. `pause()` is
Godot's `SceneTree.paused`.

### B. Sound has a sink — `AudioBus`

```ts
const sfx = new AudioBus({ camera: ctx.camera })
sfx.play(await ctx.assets.audio("jump.ogg"))                   // 2D
sfx.playAt(await ctx.assets.audio("coin.ogg"), coin.position)  // positional, follows the node
sfx.music(await ctx.assets.audio("theme.ogg"), { loop: true, fade: 1.5 })
```

Wraps `AudioListener` + `Audio`/`PositionalAudio`. Why not rule 1: the listener must be
parented to the active camera and re-parented across `goto`; browsers refuse playback
before a user gesture, so the bus must queue and flush on first input; and every voice must
stop on scene exit or the previous level keeps singing. That is the failure mode this
replaces, and it is not 20 lines.

**Vocabulary (rule 4):** Godot's `AudioStreamPlayer` / `AudioStreamPlayer3D` and audio
**buses**. `playAt` is the 3D variant; the name is borrowed, the shape is Three.js's.

### C. The world is reproducible — `ctx.random`

`GameConfig.seed?: number` seeds a deterministic generator exposed as `ctx.random()`,
`ctx.random.range(a, b)`, `ctx.random.pick(list)`. The seed is reported on the playtest
`runtime.world` channel, so a failing scenario over a procedural level can be replayed
exactly. With no seed configured, it falls back to `Math.random` and the channel reports
`seed: null` — **fail loud, not fake-deterministic.**

Why not rule 1 (an LCG is 8 lines): the 8 lines are not the point. The point is that the
playtest harness can read the seed and a scenario can pin it. A user-space RNG is invisible
to the runner, so "re-run and get the same level" stays unprovable — which is the exact
class of silent-green failure `AGENTS.md` §"Verification honesty" exists to prevent.

### Considered and rejected

| Proposed | Why not |
|---|---|
| Object pool for particles / projectiles | ~25 lines, and **rule 4 has no name to borrow** — Godot, Three.js and Rapier all lack an equivalent. Invented vocabulary is what killed v1. Revisit only with a measured GC problem. |
| `ctx.save()` / `ctx.load()` persistence | `localStorage.setItem(k, JSON.stringify(ctx.state.get()))` is one line. Template. |
| An event bus / signals system | `Area3D.on` already carries the Godot signal shape where signals exist. A global bus is a v1 pattern with no owner. |
| A particle system | Rule 3 — particles are the loudest thing in a screenshot. Ships as generated source. |
| `ctx.time.scale` (slow-motion) | `dt * scale` at the call site. Rule 1. |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `ctx.after` / `ctx.every` / `ctx.tween` | `templates/starter/src/scenes/Play.ts`, PRD-013 `Checkpoints.ts` | ad-hoc `updaters[]`, `setTimeout` | starter's `setTimeout` removed | drop cancel-on-`goto` → leak test fails |
| 2 | `game.pause()` / `resume()` | `templates/starter/src/ui/Menu.tsx` | menu that does not pause | yes | tick while paused → `pause.playtest.json` position delta fails |
| 3 | `AudioBus` | `templates/starter/src/scenes/Play.ts` (pickup sfx) | nothing (was absent) | n/a | skip stop-on-exit → `runtime.audio.voices` non-zero after `goto`, fails |
| 4 | `runtime.audio` channel | `core/src/playtest.ts` capability list | — | n/a | advertise without supplying → PRD-007 parity test fails |
| 5 | `ctx.random` + `GameConfig.seed` | PRD-013 `terrain.ts` scatter | `fox-game`'s hand-rolled LCG | n/a | reseed per call → `seed.playtest.json` two-run comparison fails |
| 6 | `runtime.world.seed` channel | `core/src/playtest.ts` | — | n/a | report a seed when none configured → fail-closed test fails |

**Reachability:** frame loop → `FixedStepLoop.step` → scheduler tick → scene `update`.
User-facing: a coin that makes a sound, a menu that actually stops the world, and a level
that is the same level twice.

## 4. Phases

#### Phase 1: the loop owns time

**Files:** `core/src/schedule.ts` NEW · `core/src/scene.ts` EDIT (`Ctx`) ·
`core/src/game.ts` EDIT (`pause`/`resume`) · `core/src/index.ts` EDIT ·
`core/AGENTS.md` EDIT (closed list) · `core/__tests__/schedule.spec.ts` NEW ·
`templates/starter/playtests/pause.playtest.json` NEW.

| Test | Assertion | Negative control (observe red) |
|---|---|---|
| `should fire after() in game-seconds, not wall-clock` | fires at accumulated dt, not `Date.now()` | use wall-clock → paused test fails |
| `should cancel every registration on goto` | scheduler empty after transition | skip the clear → count > 0, leak test fails |
| `should not advance timers while paused` | zero callbacks across 60 paused ticks | tick regardless → fails |
| `should reject a non-finite delay` | throws (fail closed) | coerce to 0 → fires immediately, silent |
| `pause.playtest.json` | player position unchanged while paused | keep stepping → `minAxisDelta` fails |
| `should resolve tween() exactly once at the end` | one resolution, final value exact | resolve per tick → fails |

#### Phase 2: sound has a sink

**Files:** `core/src/audio.ts` NEW · `core/src/index.ts` EDIT · `core/src/playtest.ts` EDIT
(`runtime.audio`) · `core/AGENTS.md` EDIT · `core/__tests__/audio.spec.ts` NEW ·
`templates/starter/src/scenes/Play.ts` EDIT.

| Test | Assertion | Negative control |
|---|---|---|
| `should queue playback before the first user gesture and flush after` | queued count → 0 after gesture | play immediately → browser rejects, voice lost |
| `should stop every voice on scene exit` | `voices === 0` after `goto` | skip stop → previous level's music continues |
| `should re-parent the listener to the active camera` | listener's parent is the new camera | leave it → positional audio pans from the old camera |
| `should throw on a null buffer` | throws (fail closed) | ignore → a silent game reports success |
| `runtime.audio` parity | `describe().capabilities` matches `sample()` keys | advertise only → PRD-007 parity test fails |

#### Phase 3: the world is reproducible

**Files:** `core/src/random.ts` NEW · `core/src/game.ts` EDIT (`seed`) ·
`core/src/scene.ts` EDIT (`Ctx.random`) · `core/src/playtest.ts` EDIT (`runtime.world`) ·
`core/src/index.ts` EDIT · `core/AGENTS.md` EDIT · `core/__tests__/random.spec.ts` NEW ·
`templates/starter/playtests/seed.playtest.json` NEW.

| Test | Assertion | Negative control |
|---|---|---|
| `should produce an identical sequence for an identical seed` | 1,000 draws equal | reseed from `Math.random` → fails |
| `should report seed: null when none is configured` | channel value is `null`, not a number | fabricate a seed → fail-closed test fails |
| `should reject range(a, b) with b <= a` | throws | swap silently → a "random" value that is always `a` |
| `should reject pick() on an empty list` | throws | return `undefined` → the v1 failure mode exactly |
| `seed.playtest.json` | two runs at the same seed land the player at the same position | vary the seed → fails |

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets
pnpm tsx scripts/count-loc.ts     # kill switch — no framework row may lose to vanilla

# closed-list honesty: every new core export is listed
grep -c "AudioBus\|ctx.random\|ctx.after" packages/core/AGENTS.md   # expect 3

# capability parity (guards the PRD-007 invariant)
# Expected: describe().capabilities === channels present in sample()

# Revert check — make ctx.after() use setTimeout
# Expected: pause.playtest.json fails on movement, NOT "0 assertions, pass"
```

## 6. Acceptance (consumer-scoped)

- [ ] In the starter, collecting the pickup plays a sound, and the sound stops on `goto`.
- [ ] The menu's pause button stops the world — asserted by a scenario, not by eye.
- [ ] A seeded game produces the same level twice, and the playtest report shows the seed.
- [ ] `ctx.after`/`every`/`tween` handles are all gone after a scene transition; a leak is a
      test failure.
- [ ] `packages/core/AGENTS.md`'s closed list names every new export.
- [ ] `pnpm budgets` still passes: 7 packages, framework LOC under 15,000.
- [ ] Every gate observed red once, recorded in `docs/verification/PRD-014.md`.
