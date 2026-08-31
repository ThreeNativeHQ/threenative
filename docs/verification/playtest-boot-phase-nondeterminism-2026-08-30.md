# Scenarios that read a moving entity's phase, not its behaviour — 2026-08-30

The `golden-path` lane failed intermittently on `platformer-stomp` and `platformer-stomp-rise` with
**identical tick counts** — span 117, frames 115, pass on one run and fail on the next. What varied
was `firstTick`: how many fixed-step ticks elapsed between level load and the scenario's first step
(27 on hardware, 48 and 63 in CI). `Patrol.update(dt)` walks the enemy between x 5.2 and 7.4 from
the moment the level loads, so the scenario pressed its first key against an enemy at a different
point in its cycle every run. Same 117 ticks; different world.

The two stomp scenarios were fixed in `56aaa940` with `setup.place … frozen: true`. This record is
the measurement that fix never got, plus the audit it asked for — which found the same defect in
`platformer-damage`, `action-rpg-combat`, `action-rpg-progress` and `defense-survive`.

## The instrument

Boot time is not something a run can be asked for, so `firstTick` was driven directly: the same
scenario, re-emitted with a larger `warmupFrames`, against one already-warm dev server. Every run is
the same build, the same steps and the same span — only `firstTick` moves.

```console
$ node measure.mjs stomp 1 60   # scenario re-emitted with warmupFrames: 60
run=1 warmupFrames=60 firstTick=64 lastTick=182 span=118 frames=115 pass=false \
  failed=[resource.state.defeated,tags.patrol] \
  diagnostics=[TN_PLAYTEST_RESOURCE_STATE_STAGNATED,TN_PLAYTEST_TAG_COUNT_ASSERTION_FAILED]
```

## Red — `stomp` and `stomp-rise` reverted to `56aaa940^`

Six natural runs each never reproduced it locally: this machine boots in 15–17 ticks, so the
scenarios sit safely inside the passing band. Forcing `firstTick` reproduces it every time.

| firstTick | 16 | 25 | 34 | 46 | 56 | **64** | **74** | **86** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `stomp` (span 118, frames 115 throughout) | pass | pass | pass | pass | pass | **fail** | **fail** | **fail** |
| `stomp-rise` (span 101, frames 96 throughout) | pass | pass | — | pass | — | **fail** | — | **fail** |

The span and frame count are constant across the whole row. The only thing that changed is how long
the patrol had been walking before the run started.

## Green — the fix restored

| firstTick | 15–18 (×6) | 27 | 47 | 66 | 86 | 156 | 307 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `stomp` | pass | pass | pass | pass | pass | pass | pass |
| `stomp-rise` | pass | pass | pass | pass | pass | pass | pass |

`firstTick` still varies run to run; the result no longer does, across a twentyfold range.

## The audit: three more scenarios read the same phase

Every template scenario whose subject meets an entity that moves from load was put through the same
sweep.

**`platformer-damage` — fixed here.** It runs the *identical* step script to `stomp-rise` against
the *unfrozen* patrol, so it inherits the whole defect:

| firstTick | 18 | 65 | 87 | 90 | 100 | 112 | 130 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| before | pass | pass | — | **fail** | **fail** | **fail** | **fail** |
| after `place … frozen` | pass | pass | pass | pass | pass | pass | pass (208 too) |

The failure is `TN_PLAYTEST_COMPONENT_ASSERTION_FAILED` on `player.health equals 2` — the scripted
20-tick approach simply misses the enemy when the patrol has walked away.

**Not fixed here, because the fix is not the same shape** — reported rather than guessed at:

| Scenario | Flips at | Why `place`/`frozen` does not reach it |
| --- | --- | --- |
| `action-rpg-combat` | pass at `firstTick` **64**, fail at **66** | The hazard is `Enemy`'s 1.5 s attack *timer* started at load, not a position. `health equals 95` means exactly one hit; the second lands at ~tick 148. Freezing the transform would not stop the clock, and `Enemy` does not read the marker. |
| `action-rpg-progress` | pass at 90, fail at 128 | Same timer. `health gte 77 lte 82` absorbs one extra hit, not two. |
| `defense-survive` | pass at 80, fail at 120 (`leaks`) | `WaveSchedule` pre-loads `#elapsed = WAVE_INTERVAL`, so attackers are on the route before the first tower is built. They are pool-spawned after load, so no `setup.place` can name them. |

`action-rpg-combat`'s cliff sits between `firstTick` 64 and 66, and CI has already been observed at
63. It is the next one to go red, and it needs the wave/attack clock gated rather than a transform
pinned.

**Measured and not exposed**, invariant to `firstTick` from ~15 to ~112: `platformer` `patrol`,
`collect`, `respawn`, `terminal-loop-win`, `terminal-loop-fail`; `defense-scan`.

## One thing the audit turned up that is not a scenario bug

`setup.place … frozen: true` is a **no-op in six of the seven templates.** `PLAYTEST_FROZEN_MARKER`
is written to `userData` by the harness, and `platformer/src/entities/Patrol.ts` is the only game
object anywhere under `templates/*/src` that reads it. An author who writes `frozen: true` for a
racing rival or an action-RPG enemy gets a silent one-frame teleport and the entity walking away on
the next tick — the placement reports as applied, because it was. Worth either teaching the marker
in the other templates' entities or making the unread marker visible in the report.
