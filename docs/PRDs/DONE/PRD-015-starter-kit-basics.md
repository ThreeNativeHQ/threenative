# PRD-015 — The starter kit: the basics, wired, and good-looking on first run

**Complexity: 5 → MEDIUM mode** (1-5 files +1, template surface +2, visual gate +2)

**Depends on:** PRD-009 (shipped), PRD-014 (audio, pause). **Blocks:** nothing.
**Charter authority:** `AGENTS.md` rules 1, 2, 3; `CHARTER.md` §11.

## 1. Context

**Problem:** the starter template already contains the code that would make a scaffolded
game look designed and feel good. **It never calls it.**

**Files analyzed:** every file under
`packages/create-threenative/templates/{starter,minimal}/`, plus `packages/core/src/index.ts`
and `packages/physics/src/CharacterBody3D.ts`.

### Generated, then never imported

```
$ grep -rl "render/camera" templates/starter/src | grep -v render/camera.ts   → (nothing)
$ grep -rl "render/shapes" templates/starter/src | grep -v render/shapes.ts   → (nothing)
```

| File | LOC | What it does | Importers |
|---|---|---|---|
| `src/render/camera.ts` | 55 | `createSpringArm` — damped, frame-rate-independent follow camera | **0** |
| `src/render/shapes.ts` | 138 | `roundedBox` + welded normals, cached | **0** |
| `src/render/lighting.ts` | 50 | key + bounce + rim + ambient | 1 |
| `src/render/materials.ts` | 11 | three standard materials | 1 |
| `src/render/postprocessing.ts` | 19 | ACES + `RenderPipeline` | 1 |

**193 of 491 template source lines are dead on arrival — 39%** — and they are precisely the
two files whose own header comments claim to be the highest-leverage code in the folder.
`shapes.ts:5` says *"A sharp BoxGeometry reads as Minecraft"*; every mesh in the starter is
a sharp `BoxGeometry` (`Play.ts:28`, `Crate.ts:17`, `Player.ts:14`). `camera.ts:8` says a
static camera *"reads as rubber-banding"*; `Play.ts:31-32` sets a static camera.

### What the first frame actually shows

| Ingredient | Present? | Evidence |
|---|---|---|
| Background / sky | **no** | `grep -rn "scene.background\|Fog\|environment" templates/*/src` → 0 hits |
| Fog / depth cue | **no** | same |
| Ground | a `10 × 0.2 × 4` slab | `Play.ts:28` |
| Rounded silhouettes | no | three sharp boxes |
| Camera that follows | no | fixed at `(0, 3, 9)` |

The scaffolded game is three sharp boxes on a slab, floating in the CSS background colour,
seen from a camera that never moves. Nothing is broken; nothing is worth a screenshot.

### What it teaches the next agent

| Shipped API | Used in `starter`? | In `minimal`? | Consequence |
|---|---|---|---|
| `CharacterBody3D.moveAndSlide` + `velocity` + `gravity` (PRD-009) | **no** — `Player.ts:16,30-36` hand-rolls `#verticalVelocity` and calls `move()` | no | the scaffold demonstrates the superseded path, so the agent reimplements gravity |
| `AnimationPlayer` (core) | **no** | no | agent assumes there is no animation support |
| `ctx.assets` / `createAssetLoader` | **no** | no | nothing loads a model, texture or sound; the agent assumes it must |
| coyote time / jump buffer | no | no jump at all (`Player.ts:29`, `y: 0`) | the default character feels stiff, and the agent has no reference for the fix |

An agent reads the scaffold before it reads the types. Whatever the scaffold does is what
the game will do — so an unused export is worse than a missing one: it costs LOC budget,
review attention and template surface, and returns nothing.

## 2. Solution

**Mostly wiring, not new code.** The look-and-feel work is already generated source in
`src/render/` where rule 3 requires it; this PRD makes the scene call it, adds the one
missing render file, and fixes the two places where the starter teaches a dead API.

### A. Call what is already there

- `Play.ts` builds meshes with `roundedBox()` from `shapes.ts`.
- `Play.ts` holds a `createSpringArm(ctx.camera)` and calls `follow(player.position, dt)`
  from `update`, `snap()` on `enter`. Zero new lines in `packages/`.

### B. One new generated file: `src/render/sky.ts` (~45 lines)

Vertical gradient background + matched `scene.fog`, exported as
`setupSky(scene, { top, bottom })`. It is the difference between "a render" and "a place",
and it is where the fox build spent its first visual effort (`fox-game/src/sky.js`).
Generated source under rule 3 — never a `defineGame` option.

### C. Teach the current API

- `Player.ts` uses `body.velocity` + `moveAndSlide(dt)`; `#verticalVelocity` is deleted.
- `Player.ts` gains coyote time and a jump buffer — ~10 lines, constants at the top of the
  file, commented as the two knobs that make a jump feel right.
- `minimal`'s player gets the same jump. The two templates stop disagreeing about how a
  character moves.

### D. Demonstrate the rest of the surface, once each

- `Boot.ts` awaits `ctx.assets.texture(...)` for one texture before `goto("play")` — the
  loading path exists and is visibly on the critical path.
- Pickup plays a sound through PRD-014's `AudioBus`; `Menu.tsx` calls `game.pause()`.
- A kill plane below the floor respawns the player. Three lines, and it means a scaffolded
  game cannot be permanently lost.

`AnimationPlayer` is **not** demonstrated: the starter has no rigged asset, and shipping a
`.glb` to prove an export is how templates rot. It is documented in `AGENTS.md` instead.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| Move the spring arm / rounded shapes into `packages/` | Rule 3 — camera framing and silhouette are what a screenshot shows. They stay generated. |
| A third "showcase" template | Rule 5's spirit: two templates already disagree. Fix them; do not add a third. |
| Deleting `minimal` | Out of scope. It is a real use case; it just needs to match. |
| A `theme` / palette option on `defineGame` | Rule 3, and `CHARTER.md` §2 closes preset systems. |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `createSpringArm` **called** | `starter/src/scenes/Play.ts` | static `camera.position.set` | **yes**, deleted | detach → `assert.camera.targetInViewport` fails |
| 2 | `roundedBox` **called** | `Play.ts`, `Crate.ts`, `Player.ts` | `new BoxGeometry(...)` | **yes**, deleted | revert to `BoxGeometry` → dead-export test fails |
| 3 | `src/render/sky.ts` | `Play.ts` | nothing (was absent) | n/a | skip `setupSky` → background/fog assertion fails |
| 4 | `moveAndSlide` in the template | `starter/`+`minimal/src/entities/Player.ts` | `#verticalVelocity` + `move()` | **yes**, deleted | `grep -c "#verticalVelocity" templates` must be 0 |
| 5 | coyote + jump buffer | same | — | n/a | coyote 0 → `coyote.playtest.json` fails |
| 6 | kill plane + respawn | `Play.ts` | — | n/a | disable → `respawn.playtest.json` fails |
| 7 | `ctx.assets.texture` in `Boot` | `starter/src/scenes/Boot.ts` | bare `goto` | yes | drop the await → load-order test fails |

**Reachability:** `npx create-threenative my-game` → `pnpm dev` → a rounded character on a
lit ground plane under a gradient sky, followed by a damped camera, that jumps well, makes
a sound, pauses, and respawns if it falls off. That is the 80%.

## 4. Phases

#### Phase 1: no dead generated code, ever again

**Files:** `starter/src/scenes/Play.ts` EDIT · `src/entities/{Player,Crate}.ts` EDIT ·
`create-threenative/__tests__/template.spec.ts` NEW.

| Test | Assertion | Negative control (observe red) |
|---|---|---|
| `should import every module under src/render` | each `render/*.ts` has ≥1 importer in the same template | delete one import → fails |
| `should export nothing from src/render that is never called` | every exported symbol appears at a call site | add an unused export → fails |
| `should use roundedBox for every mesh in the template` | 0 `new BoxGeometry(` outside `shapes.ts` | revert one → fails |

This test is the point of the phase. Without it the same 193 lines rot again in six weeks.

#### Phase 2: it looks like a place

**Files:** `starter/src/render/sky.ts` NEW · `Play.ts` EDIT ·
`starter/playtests/look.playtest.json` NEW.

| Test | Assertion | Negative control |
|---|---|---|
| `look.playtest.json` | `assert.screenshot` — the frame is not a single flat colour | skip `setupSky` and the lights → fails |
| `should set both scene.background and a matched fog` | both present; fog colour equals the gradient bottom | set only the background → distant geometry pops, fails |
| `should throw on a sky gradient missing a colour` | throws (fail closed) | default silently → an unstyled sky reports success |

**Honest limit:** no assertion can tell you it looks *good*. `assert.screenshot` catches
black frames and flat frames, nothing more. The visual gate in §6 is a human or agent
putting the screenshot beside `examples/REFERENCE.png` — and per `AGENTS.md`, headless
Chromium renders WebGPU blank, so capture runs under `xvfb-run` or real Chrome.

#### Phase 3: it feels like a character

**Files:** `starter/`+`minimal/src/entities/Player.ts` EDIT · `Play.ts` EDIT (kill plane) ·
`starter/playtests/{coyote,respawn}.playtest.json` NEW.

| Test | Assertion | Negative control |
|---|---|---|
| `coyote.playtest.json` | a jump pressed just after leaving the ledge fires, exactly once | coyote 0 → no jump, fails; unbounded → two jumps, count fails |
| `should buffer a jump pressed before landing` | fires on the landing tick | buffer 0 → fails |
| `respawn.playtest.json` | falling past the kill plane returns the player to spawn | disable → player falls forever, position assertion fails |
| `grep` gate | `#verticalVelocity` appears 0 times in `templates/` | leave one → fails |

#### Phase 4: the rest of the surface, demonstrated once

**Files:** `starter/src/scenes/Boot.ts` EDIT · `Play.ts` EDIT (sfx) · `src/ui/Menu.tsx` EDIT
(pause) · `starter/AGENTS.md` EDIT · `minimal/AGENTS.md` EDIT.

| Test | Assertion | Negative control |
|---|---|---|
| `should await the asset load before entering play` | `play` enters after the texture resolves | drop the await → load-order test fails |
| `should play a sound on pickup` | `runtime.audio.voices > 0` on the collect tick | mute → fails |
| `should stop the world from the menu` | position delta 0 while paused | no-op button → fails |
| `AGENTS.md` names `AnimationPlayer` and where a rigged asset goes | grep | — |

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets

# the dead-code gate, run by hand once before trusting the test
for f in camera shapes lighting materials postprocessing sky; do
  echo -n "$f -> "; grep -rl "render/$f" packages/create-threenative/templates/starter/src \
    | grep -v "render/$f.ts" | wc -l
done                                    # every row must be >= 1

grep -rn "new BoxGeometry(" packages/create-threenative/templates   # only shapes.ts
grep -rn "#verticalVelocity" packages/create-threenative/templates  # expect nothing

# scaffold and look at it
node packages/create-threenative/dist/index.js my-game && cd my-game && pnpm install && pnpm test
xvfb-run -a -s "-screen 0 1600x900x24" <capture>  # headless WebGPU renders blank; see AGENTS.md

# Revert check — restore the static camera in Play.ts
# Expected: look.playtest.json fails on assert.camera, NOT "0 assertions, pass"
```

## 6. Acceptance (consumer-scoped)

- [ ] Every module and every export under `templates/*/src/render/` has a live caller,
      enforced by a test that fails when one goes dead.
- [ ] The first frame of a freshly scaffolded game shows rounded shapes on a lit ground
      under a gradient sky, with a camera that follows the player.
- [ ] **The visual gate:** that screenshot placed beside `examples/REFERENCE.png`, and the
      answer to "would a player screenshot this?" is yes. This one is judged by eye and
      recorded in `docs/verification/PRD-015.md`; no assertion substitutes for it.
- [ ] The template's player uses `moveAndSlide`, has coyote time and a jump buffer, and
      `#verticalVelocity` appears nowhere.
- [ ] Falling off the world respawns instead of falling forever.
- [ ] `starter` and `minimal` agree on how a character moves.
- [ ] `pnpm budgets` still passes: 7 packages, framework LOC under 15,000 — this PRD adds
      roughly 45 template lines and **deletes** none of the budget, because none of it is
      package code.
- [ ] Every gate observed red once, recorded in `docs/verification/PRD-015.md`.
