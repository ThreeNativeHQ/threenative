---
prd_contract: v1
---

# PRD-089 — A `shooter` starter kit: a playable arena game, borrowed from Quake III, reachable from `npx` and from Studio

**Status: IMPLEMENTED; generated browser evidence recorded 2026-08-12.** Desktop execution is
covered by the batch record; no mobile readiness is claimed.
**Parent:** [PRD-087](./PRD-087-genre-borrow-ledger.md).
**Depends on:** [PRD-088](./PRD-088-physics-spatial-queries.md) for the physics raycast, and
[PRD-091](./PRD-091-genre-kit-delivery-rail.md) for the registry and the Studio picker.

**Complexity: 6 → HIGH mode.** No package code. The scope is a *game*, not a scene — it has to
be playable and it has to clear the visual floor, and those two are most of the work.

## 1. Why this is user value and not tidying

Three templates ship and all three are one genre: `minimal`, `starter` and `platformer` are a
capsule that walks and jumps. **We have never scaffolded a game whose core verb is not
locomotion**, so every claim that the framework generalises across genres is an argument, not
a run.

A starter kit is not a template with more files in it. The difference is what a stranger gets
in the first thirty seconds:

| | Template (today) | Starter kit (this PRD) |
|---|---|---|
| What boots | a scene with a character in it | a game with a win condition and a fail condition |
| What the user does | walks around | plays, loses, and wants another go |
| What they edit first | `src/entities/Player.ts`, to make something happen | `src/weapons/`, to change something that already happens |
| What the screenshot shows | the framework works | a game they would ship |

That gap is the whole point. An agent handed a scene has to invent a game before it can change
one; an agent handed a game has something to modify on turn one. The five-minute stranger test
this repo has open is not passable from a scene.

**The shooter earns the first slot for a reason that is not taste:** hitscan, radius damage and
target acquisition are three distinct query shapes in one game. If PRD-088's API is wrong, it
shows here, not in a fourth platformer.

## 2. Solution

`packages/create-threenative/templates/shooter/`, plus a `kit.json`. Per PRD-091 that is the
entire wiring: no CLI edit, no gate-script edit. If this kit needs either, PRD-091 did not
finish.

### The game

A single arena. You have a hitscan weapon and a projectile weapon. Targets spawn on a wave
timer, acquire you on a jittered scan, and shoot back. Health pickups respawn on a timer. You
die, you respawn at the spawn point furthest from anything hostile, and the wave counter
resets. **Win condition: clear five waves. Fail condition: die three times.** Both are on the
HUD from the first frame.

That is deliberately small. It is not small because a shooter needs less than a platformer; it
is small because every one of those nouns is a file a user can open and change, and a kit that
ships ten systems teaches nothing about any of them.

### What is borrowed, and from where

| Kit file | Borrowed from | The idea, not the code |
|---|---|---|
| `src/weapons/Hitscan.ts` | Quake III `code/game/g_weapon.c` | fire a ray from the muzzle, damage the first hit; a per-weapon cooldown gates the shot |
| `src/weapons/Projectile.ts` | `code/game/g_missile.c` | a moving body with a lifetime that resolves on impact or expiry |
| `src/combat/damage.ts` | `code/game/g_combat.c` (`G_Damage`, `G_RadiusDamage`) | direct damage, and radius damage with distance falloff; death is a signal, not a branch |
| `src/level/SpawnPoints.ts` | `code/game/g_spawn.c` | spawn points are level data; selection prefers the point furthest from any live hostile |
| `src/entities/Pickup.ts` | `code/game/g_items.c`, `bg_misc.c` | pickups are trigger volumes with a respawn timer |
| `src/entities/Target.ts` | OpenRA `Traits/AutoTarget.cs` | scan on a jittered interval, not every frame; nearest valid hostile in range wins |
| `src/waves.ts` | OpenRA `Traits/ActorSpawner.cs` | waves are a schedule, not a spawn-on-death reflex |

**`bg_pmove.c` is deliberately not borrowed.** Quake III's air control and strafe acceleration
are `CharacterBody3D`'s territory, and `moveAndSlide` already covers what `bg_slidemove.c`
does. Reimplementing movement in kit source would be a game working around the engine — the
engine bug wearing a game-code costume this repo warns about. **If the shooter genuinely needs
air control `CharacterBody3D` cannot express, that is an engine bug and it gets its own PRD.**

OpenRA's jittered scan is borrowed exactly:
`World.SharedRandom.Next(MinimumScanTimeInterval, MaximumScanTimeInterval)`, default 3–8 ticks.
The kit uses `Scheduler` seeded from `createRandom`, so the interval is deterministic and a
replay reproduces. A per-frame scan would work on desktop and quietly cost frames on Android,
and a kit teaches by example either way.

### Looking good is a gate, not an aspiration

The kit clears `scripts/visual-gate.ts` on the same terms as every other template: the six
`RENDER_LAYER_FILES` under `src/render/`, each with a live importer; a palette of at most six
named colours with exactly one `accent`; `materials.ts` and `sky.ts` importing `palette.js`;
key and rim `DirectionalLight` plus a fill, `PCFSoftShadowMap` and `normalBias`; `toneMapping`,
`toneMappingExposure`, `setOutputNode` and `bloom(` in post. Then a blind score at or above
`VISUAL_SCORE_FLOOR = 4`.

The kit's *look* — an indoor arena, hard key light, coloured emissive targets against a neutral
room — ships as generated source under `src/render/` and nowhere else. Never own the look means
the user can repaint the whole game without touching a package, and this kit is the proof.

### What this kit deliberately does not ship

- **No networking.** Quake III's architecture is client prediction, and borrowing it means
  borrowing lockstep. Named here so it is not smuggled in.
- **No weapon-definition data format.** A bespoke config vocabulary is a closed question.
  Weapons are TypeScript objects the user edits.
- **No stat modifier stack.** PRD-087 rejected it; damage is a number.
- **No bot AI.** `ai_main.c` and friends are a research project. Targets follow a route and
  shoot on a timer.

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `templates/shooter/` + `kit.json` | discovered by PRD-091's loader; scaffolded by `npx` and by the Studio picker | nothing — no non-locomotion genre exists | n/a | scaffold it; the playtest must reach assertions, not just boot |
| 2 | `Hitscan.ts` over `space.intersectRay` | `src/weapons/Hitscan.ts` | the mesh-raycast fake that is otherwise the only option | n/a | swap in `ScenePicker.raycast` → the capsule-collider target is missed and the playtest goes red |
| 3 | `Target.ts` over `space.intersectShape` | `src/entities/Target.ts` | the platformer's hardcoded `#player` reference pattern | **yes** — PRD-088 row 4 deletes it there | give a target a direct reference → identical with one target, divergent with five |
| 4 | Wave / lives loop | `src/waves.ts`, `src/state.ts` | no shipped template has a win or fail condition | n/a | remove the win condition → the "clears five waves" assertion cannot pass |
| 5 | Shooter playtest scenario | `templates/shooter/playtests/` | no genre-crossing runtime proof exists | n/a | assert a hit at the wrong distance → fails |

## 4. Execution phases

### Phase 0 — Scaffold and boot, with no shooting

**Outcome:** `--template shooter` installs, type-checks, builds a web bundle **and** a native
bundle, and boots to a lit arena with a player that walks.

**Gate:** `pnpm test:templates` green; `examples/native-smoke`'s one-import-free-ESM-file
assertion still green; the visual gate's structural pass on the new `src/render/`. **No
gameplay in this phase** — the scaffold and look contracts are proved before a shot is fired.

### Phase 1 — Hitscan, projectile, damage

**Outcome:** both weapons fire, targets take damage and die, radius damage falls off.
**Gate:** a playtest that fires along a known axis at a target of known position and asserts
hit distance and surface normal, then asserts the death event.

### Phase 2 — The game loop

**Outcome:** waves, lives, pickups, spawn selection, HUD, win and fail screens.
**Gate:** one playtest drives a full loop — take damage, die, respawn at a spawn point, collect
a pickup, clear a wave — asserting each transition. A second asserts the fail path.

### Phase 3 — Looks, scored blind

**Outcome:** the arena, lighting and post are finished; the blind score is run.
**Gate:** `VISUAL_SCORE_FLOOR` cleared at 4 or above. **Below the floor is a red phase, not a
note.** The kit is not shipped ugly and fixed later.

### Phase 4 — Studio and device

**Outcome:** the kit appears in Studio's picker and scaffolds from it; the playtest runs under
`--target android` and `--target ios`.

**Gate:** `pnpm studio:probe --browser` green with the kit listed; device runs executed, or
explicitly recorded as not executed. Nothing about mobile is claimed from a desktop run.

## 5. Verification strategy

The failure mode for a starter kit is a screenshot that looks like a shooter and asserts
nothing. Every assertion is a quantity the game produces:

- **Hit geometry, not hit truthiness.** Known axis, known distance, assert the number and the
  normal component-wise.
- **The layer filter gets its own assertion.** A shot that passes a friendly and hits the
  hostile behind it is one test; a shot that stops on a wall is another. A backend that ignores
  masks passes one and fails the other — a single happy-path test would ship that bug.
- **The scan interval is asserted as a count.** Over 300 frames the scan count must land inside
  the jitter window. A per-frame scan passes every behavioural test and fails only this one,
  which is why it is written.
- **Radius damage is asserted by set membership**: three dummies at known radii, two inside the
  blast, one outside; assert exactly which two died.
- **The loop is asserted as transitions**, not as a final score: damage → death → respawn →
  pickup → wave cleared, each with its own assertion, so a game that silently skips respawn
  cannot pass by reaching the end.
- **`--browser-recipe webgpu`, and `xvfb-run -a -s '-screen 0 1600x900x24'` for anything
  visual**, because headless Chromium renders WebGPU blank here and a blank canvas has passed a
  screenshot assertion in this repo before.

## 6. Acceptance criteria

- [ ] The kit ships as a directory plus a `kit.json` — **no CLI file and no gate script was
      edited.** If either was, PRD-091 is unfinished and this PRD is blocked, not exempted.
- [ ] `npx create-threenative --template shooter` and the Studio picker both produce it, and the
      two trees are byte-identical.
- [ ] It boots to a game with a stated win condition and fail condition visible on the HUD, not
      to a walkable scene.
- [ ] The visual gate passes structurally and the blind score is **≥ 4**.
- [ ] Every line a screenshot shows is under `src/render/`; no package gained a line.
- [ ] `src/` contains no reimplementation of character movement.
- [ ] Hitscan, radius damage and target acquisition all go through PRD-088's API — no
      `ScenePicker.raycast`, no JS distance loop.
- [ ] The playtest asserts hit distance, layer filtering, scan count, radius-damage set
      membership and the five loop transitions, each with a negative control run red once.
- [ ] `src/game.ts` is the portable entry and runs on desktop native; React lives only in
      `src/main.ts`.
- [ ] Template LOC is reported by `pnpm budgets`, not capped and not hidden.
