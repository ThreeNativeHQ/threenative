---
prd_contract: v1
---

# PRD-090 — A `racing` starter kit, borrowed from SuperTuxKart, and the measurement that finally decides `PathFollow3D`

**Status: PROPOSAL, 2026-08-12.** Nothing has run. No platform readiness is claimed.
**Parent:** [PRD-087](./PRD-087-genre-borrow-ledger.md).
**Depends on:** [PRD-088](./PRD-088-physics-spatial-queries.md) for the on-road probe,
[PRD-091](./PRD-091-genre-kit-delivery-rail.md) for the registry and the Studio picker.
**Sequenced after:** [PRD-089](./PRD-089-shooter-starter-kit.md) — one new genre at a time.
**Feeds:** [PRD-092](./PRD-092-strategy-starter-kit.md), which acts on the number this PRD
records.

**Complexity: 6 → HIGH mode.** Two deliverables: a playable racing game, and a number that
closes an open API question.

## 1. Why this is user value and not tidying

**First, and obviously:** racing has the least in common with what we ship. A platformer and a
shooter are both a capsule that walks. A kart is a `RigidBody3D` with a route it is meant to
stay on and a rule for when it doesn't. If the framework generalises, it generalises here; if
it only serves character-locomotion games, this is where that surfaces, and it is better to
find out in a kit than in a user's project.

**Second, and the reason this is a PRD rather than a ticket:** PRD-087 deferred `PathFollow3D`
at 62/100 with a countable promotion rule — three hand-rolled sites and it goes into core,
fewer and it does not. Site one already exists at
`templates/platformer/src/entities/Chaser.ts:22-24`, a hand-rolled waypoint route. This kit
writes site two, deliberately and in the open, and records what it cost. **A deferred API
decision with no scheduled measurement is a decision that never gets made.**

**Third:** racing is the genre where "looks good" is hardest to fake. A static arena can be lit
once and photographed. A track has to read at speed, from a chase camera, with the horizon
moving. It is the strongest test of whether the `src/render/` layer convention actually carries
a game or merely a diorama.

## 2. Solution

`packages/create-threenative/templates/racing/` plus a `kit.json`. Per PRD-091 that is the
whole wiring.

### The game

One track, three laps, three rivals. You drive, you skid into a boost, you fall off and get
rescued back onto the road, and you finish in a position. **Win condition: finish first. Fail
condition: finish last, or the clock runs out.** Position and lap are on the HUD from the first
frame.

### What is borrowed, and from where

SuperTuxKart is the survey's racing entry; these come from `src/tracks/` and `src/karts/`,
whose file names say what each does.

| Kit file | Borrowed from | The idea |
|---|---|---|
| `src/track/Checkline.ts` | `tracks/check_line.cpp`, `check_manager.cpp` | checklines are ordered; crossing one counts only if its predecessor was crossed |
| `src/track/Lap.ts` | `tracks/check_lap.cpp` | a lap completes only on an in-order sweep — the anti-shortcut rule, which is the entire difficulty of lap counting |
| `src/track/TrackSector.ts` | `tracks/track_sector.hpp` — `m_last_valid_graph_node`, `m_latest_valid_track_coords`, `isOnRoad()`, `getDistanceFromStart()` | remember the last position that was on the road, and how far along the route it was |
| `src/track/rescue.ts` | `karts/rescue_animation.cpp` | falling off restores the kart to the last valid sector, facing along the route |
| `src/track/Driveline.ts` | `tracks/bezier_curve.cpp`, `drive_graph.cpp`, `drive_node.cpp` | the route is a curve; progress along it is a scalar, and that scalar is what ranks racers |
| `src/entities/Rival.ts` | `karts/controller/` | rivals follow the driveline at a lateral offset rather than pathfinding |
| `src/kart/boost.ts` | `karts/max_speed.cpp`, `skidding.cpp` | speed modifiers are time-limited and stack; skid charge converts to a boost |

`track_sector.hpp` is the one worth reading before writing anything. Its header states that it
keeps "the last valid sector an object was on, which is used to reset a kart in case of a
rescue" — **one piece of state answers three questions**: am I on the road, how far around am
I, and where do I go back to. Route position is derived from the last *valid* transform, not
the current one. That distinction is what makes rescue and ranking both work, and it is not
obvious until you have shipped it wrong.

### Where `boost.ts` sits with respect to PRD-087's reject

`max_speed.cpp` is a stat modifier stack — the capability PRD-087 rejected as package code at
54/100. It is not being smuggled back in. It ships here **as kit source, in one file, covering
only speed.** That *is* the verdict: the shape is real, the general version is the user's
design, and a specific version in generated source is a file they can delete.

### The `PathFollow3D` measurement

`Driveline.ts` and `Rival.ts` follow a `CatmullRomCurve3`. Three.js already ships the hard part
— `getPointAt` and the arc-length reparameterisation behind `getUtoTmapping` — so what gets
written here is progress state, looping and orientation along the tangent.

**The kit records, in `docs/verification/`, the exact line count of the reusable half and what
it does.** Then:

- Under 20 lines → the promotion rule is dead. Rule 1 forbids it permanently and PRD-087's row
  closes with that number.
- Over 20 lines → `PathFollow3D` enters `@threenative/core` and all three copies are deleted in
  the same commit.

**The third site is not hypothetical: it is PRD-092's attacker route**, already scheduled. That
is why this PRD only measures and PRD-092 only executes — the same PRD doing both would be
grading its own homework, and the number would arrive already knowing which answer was wanted.

No `PathFollow3D` is written by this PRD under any outcome.

### Looking good, at speed

Same gate as every template: the six `RENDER_LAYER_FILES`, a ≤6-colour palette with exactly one
`accent`, `materials.ts` and `sky.ts` importing `palette.js`, key and rim `DirectionalLight`
plus a fill, `PCFSoftShadowMap`, `normalBias`, and `toneMapping` / `toneMappingExposure` /
`setOutputNode` / `bloom(` in post — then a blind score at or above `VISUAL_SCORE_FLOOR = 4`.

The chase camera is the kit's own `src/render/camera.ts`, not a framework node. A follow camera
is well under twenty lines and it is also exactly the thing a user retunes first.

### What this kit deliberately does not ship

- **No vehicle physics package.** Wheels are ground raycasts plus forces on a `RigidBody3D`, in
  kit source. `VehicleBody3D` is not proposed and not implied.
- **No track editor and no track format.** The track is TypeScript.
- **No racing-line solver.** Rivals follow the authored driveline.
- **No networking, no ghosts, no rewind.** `kart_rewinder.cpp` is real and out of scope;
  deterministic rewind is PRD-087's deferred 74/100 candidate with its own future PRD.

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `templates/racing/` + `kit.json` | discovered by PRD-091's loader; `npx` and Studio picker | no vehicle genre exists | n/a | scaffold and the playtest must reach assertions, not just boot |
| 2 | Ordered checkline lap counting | `src/track/Lap.ts` over `Area3D` | nothing counts laps | n/a | drive backwards through the finish line → the lap count must not increase |
| 3 | `TrackSector` + rescue | `src/track/TrackSector.ts`, on-road probe via PRD-088 `intersectRay` | nothing | n/a | drive off the edge → assert the restored position equals the last on-road sector |
| 4 | Route-progress ranking | `src/track/Driveline.ts` | no shipped template ranks anything | n/a | rank by world distance instead → the same-distance-different-lap case inverts |
| 5 | The `PathFollow3D` line count | recorded in `docs/verification/`; PRD-087's row updated | an open API question with no scheduled answer | n/a | the number is either under or over 20, and both outcomes are pre-committed above |

## 4. Execution phases

### Phase 0 — Scaffold and boot, no gameplay

**Outcome:** `--template racing` installs, type-checks, builds web and native bundles, and boots
to a kart on a track that does nothing. **Gate:** `pnpm test:templates` green; native
single-file bundle assertion green; visual gate structural pass.

### Phase 1 — Driveline, sector, rescue

**Outcome:** the kart drives, the sector tracks it, falling off restores it.
**Gate:** a playtest asserting restored position and heading after a deliberate fall — numbers,
not a screenshot. **The `PathFollow3D` line count is recorded at the end of this phase**, before
laps exist to muddy it.

### Phase 2 — Checklines, laps, ranking

**Outcome:** laps count, shortcuts do not, and position is by route progress.
**Gate:** three playtests — a clean lap, an attempted shortcut, and the
same-world-distance-different-lap ranking case.

### Phase 3 — Rivals, boost, and the race

**Outcome:** three rivals, skid-to-boost, a finish, a win screen and a fail screen.
**Gate:** a playtest asserting finishing order over a short race, and asserting the boost's
speed delta expires.

### Phase 4 — Looks, scored blind

**Outcome:** track, sky, lighting and post finished and scored.
**Gate:** blind score ≥ 4. **Below the floor is a red phase, not a note.**

### Phase 5 — Studio and device

**Outcome:** the kit appears in Studio's picker; playtests run under `--target android` and
`--target ios`. **Gate:** `pnpm studio:probe --browser` green with the kit listed; device runs
executed or explicitly recorded as not executed.

## 5. Verification strategy

Lap counting fails silently everywhere it is written badly — a counter that increments on any
pass through a trigger looks correct for a whole first lap.

- **The shortcut run is the primary test, not the happy path.** A course where the finish is
  reachable without the mid-course checkline; drive straight to it; assert the counter is
  unchanged. An implementation that ignores ordering passes a clean lap and fails only this.
- **Reverse crossing is its own assertion.** Cross the finish backwards; assert no lap.
- **Rescue asserts position and heading**, both to a tolerance, against the recorded last
  on-road sector — not "the kart is somewhere on the track".
- **Boost asserts expiry, not just application.** Peak speed during, steady speed after, both as
  numbers. A modifier that never expires passes any test that only checks it applied.
- **Ranking asserts route progress.** Two racers at equal world distance from the finish, one a
  lap behind; assert the order. This is the exact bug the borrowed `getDistanceFromStart()`
  design exists to prevent.
- **`--browser-recipe webgpu`, and `xvfb-run -a -s '-screen 0 1600x900x24'` for anything
  visual**, per the standing headless WebGPU limitation on this machine.

## 6. Acceptance criteria

- [ ] The kit ships as a directory plus a `kit.json` — **no CLI file and no gate script was
      edited.**
- [ ] `npx create-threenative --template racing` and the Studio picker both produce it, and the
      trees are byte-identical.
- [ ] It boots to a race with a win and a fail condition on the HUD, not to a drivable scene.
- [ ] Lap counting rejects both a shortcut and a reverse crossing, each with its own executed
      playtest.
- [ ] Rescue restores position **and** heading, asserted numerically.
- [ ] Ranking is by route progress, with the same-distance-different-lap case asserted.
- [ ] The visual gate passes structurally and the blind score is **≥ 4** — for a moving chase
      camera, not a parked hero shot.
- [ ] The curve follower's reusable line count is recorded in `docs/verification/`, and
      PRD-087's `PathFollow3D` row is updated with that number and the resulting decision.
- [ ] No `PathFollow3D`, `VehicleBody3D`, track format or racing-line solver was added to any
      package.
- [ ] `src/game.ts` runs on desktop native; React stays in `src/main.ts`.
