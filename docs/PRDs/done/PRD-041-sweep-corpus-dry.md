# PRD-041 — DRY the sweep corpus

**Status: DONE.** Four changes ship: one missing physics primitive, one missing UI binding,
a template demonstration, and a rewrite of the agent instructions that are currently
*causing* the duplication.

**The finding that reframes this PRD:** the request was "find abstractions that would be
useful to DRY." Five of the six most-duplicated shapes in the corpus **are already
abstracted** — `ctx.goto`, `ctx.tween`, `ctx.after`, `ctx.every`, `ctx.random` all ship
today in `packages/core`. Agents wrote a new call to them in **0, 0, 0, 5 and 1** of 65
framework builds respectively, and hand-rebuilt them in 468 lines instead.

The one primitive with near-total adoption (`ctx.entities.add`, 60/65 written new, 65/65
present) is the one the starter template demonstrates in the file agents rewrite most.

So the dominant cause of duplication is **not missing abstraction. It is undiscovered
abstraction** — and §5.4 shows the generated `AGENTS.md` contains an instruction that
makes the entire `Ctx` surface structurally invisible. Adding more API would make this
worse, which is the failure mode `CHARTER.md` §11 rule 4 names as what killed v1.

**Complexity: low.** Phase 1 is ~10 framework lines, Phase 2 ~8, Phases 3–4 are template
and docs only.

**Charter authority:** `CHARTER.md` §11 rule 1 (20-line rule — it rejects most of §4),
rule 3 (never own the look — rejects the animation and camera candidates), rule 4
(vocabulary is borrowed: `monitoring` is Godot's `Area3D.monitoring`), rule 5 (no new
package). `AGENTS.md` "Verification honesty".

**Sibling PRDs:** does not overlap [PRD-033](PRD-033-playtest-semantic-depth.md) (harness
depth). [PRD-040](PRD-040-physics-collision-layers.md) touches the same class; §6 sets the
ordering.

**Budget effect:** framework LOC 2,988 → ~3,006 of 15,000. PRD files 9 → **10 of 10 — at
cap.** The next PRD must be preceded by moving a completed one to `docs/PRDs/done/`.

---

## 1. The corpus, stated honestly

**Snapshot frozen 2026-08-07T19:31 -0700.** The sweep directory was still being written
during this analysis — it grew from 79 to 81 projects mid-pass, and an earlier draft of
this PRD carried the 79-project figures. Every number below is re-derived from the frozen
list. Re-running the method on a later corpus will give different counts.

| Source | What is there | What it is worth |
|---|---|---|
| `docs/benchmark/sweeps/` | 81 projects — **65 framework arm, 16 vanilla arm** | the primary evidence |
| — unique briefs | **4** (platformer, exploration, endless-runner, topdown-action) | the sample's real width |
| — replication | 48 framework platformer runs from 1 brief → **38 distinct `Play.ts`** | independent samples, not copies |
| `~/.codex/sessions` | 127 sessions with cwd in this repo, all Aug 2026 | **no usable signal — see §1a** |
| `/home/joao/projects/threenative-*sandbox*` | 6 scaffolded sandboxes, same 4 briefs | duplicates the sweep evidence |

**The width caveat bounds every claim below.** This is 4 briefs replicated 81 times, not 81
games. A shape in 64/65 projects means *64 independent runs across 4 briefs converged on
it* — strong evidence for these genres, and **no evidence** about genres not in the set.
Nothing in §5 is justified by genre breadth; it is justified by depth of repetition.

Replication is not degenerate: the 48 same-brief platformer runs produced 38 distinct
`Play.ts` and 16 distinct `main.ts`. Different agents, same brief, convergent output — the
condition under which "they all wrote this by hand" is informative.

### 1a. The codex sessions produce no independent signal — do not cite them

127 sessions have a cwd inside this repo. Every friction probe came back contaminated:

- `TN_PLAYTEST_BRIDGE_MISSING` appears in 117/127 sessions. Extracting the surrounding 120
  characters shows **all 443 hits are the `AGENTS.md`/`CLAUDE.md` sentence** "…against a
  project with neither bridge fail `TN_PLAYTEST_BRIDGE_MISSING`; that is the harness being
  right." It is instruction text loaded into every session. Not one runtime failure.
- `20-line rule` appears in 121/127 sessions — same cause.
- The 918 sessions matching `TN_[A-Z_]+` across the wider `~/.codex/sessions` tree are
  **v1-era codes** — `TN_RECIPE_OWNER_CONFLICT` (4,220), `TN_GAME_PLAN_OFF_RECIPE` (1,367),
  `TN_IR_RENDERER_ADVANCED_FEATURE_UNSUPPORTED` (297). They describe the 790k-line v1 whose
  IR and recipe system are already closed questions.

Genuine compile-time friction in the v2 sessions is low and unpatterned: `Cannot find
module` 17/127, `Property … does not exist` 9/127, `has no exported member` 5/127, with no
recurring symbol. **The codex corpus was analysed and yielded nothing.** That is the honest
result, not a gap in the analysis.

---

## 2. Method

Each of the 81 projects' `src/**/*.{ts,tsx}` was diffed against the template recorded in its
`sweep.json`. Only added lines were kept — 45,468 total, **36,253 in the framework arm**.
Every count is over agent-authored lines only; template code is excluded, which matters
because the templates already ship coyote time, a spring arm and a materials set.

Two metrics are reported separately throughout, because they answer different questions:

- **written-new** — the project *added* a call. Measures whether the agent reached for it.
- **present-in-final** — the call survives anywhere in the shipped `src/`. Includes template
  lines the agent happened not to delete.

| | framework arm (n=65) | vanilla arm (n=16) |
|---|---:|---:|
| agent-authored lines, median | **482** | **600** |
| min / max | 115 / 907 | 139 / 1,023 |

The framework arm authors ~20% fewer lines. This PRD does not relitigate that claim.

### 2a. What agents do to a scaffolded project

They **rewrite the template in place; they almost never add files.** Across all 81 projects
only **11 new files** were created (`level.ts` ×4, `entities/Enemy.ts` ×3, plus
`Projectile.ts`, `PatrolSensor.ts`, `Mission.ts`, `Goal.ts`). Rewrite rates:

| File | Rewritten in | File | Rewritten in |
|---|---:|---|---:|
| `main.ts` | **81/81** | `render/materials.ts` | 60/81 |
| `state.ts` | 65/81 | `render/postprocessing.ts` | 31/81 |
| `scenes/Play.ts` | 63/81 | `ui/Hud.tsx` | 29/81 |
| `render/lighting.ts` | 63/81 | `ui/Menu.tsx` | 26/81 |
| `entities/Player.ts` | 62/81 | `scenes/Boot.ts` | 24/81 |

This is the mechanism behind §3. The template is not a library the agent calls, it is a
**seed the agent overwrites**. Its working set is the file it is currently rewriting, so
anything not visible in that file does not exist.

---

## 3. The finding — shipped primitives have near-zero adoption

Framework arm, n=65.

| Shipped primitive | Demonstrated in a template? | written-new | present-in-final | Hand-rolled instead |
|---|---|---:|---:|---|
| `ctx.entities.add` | **yes** — `Play.ts`, all 3 templates | **60/65** | **65/65** | — |
| `ctx.goto(name)` | only `Boot.ts`, one-way boot→play | **0/65** | 25/65 | 47/65 wrote a manual `#reset`/`#restart` — 208 lines |
| `ctx.tween(t, props, s)` | **no** | **0/65** | **0/65** | 61/65 hand-rolled `Math.sin`/`lerp`/`damp` — 210 lines |
| `ctx.after(delay, cb)` | **no** | **0/65** | **0/65** | 48/65 hand-rolled `elapsed += dt` — 50 lines |
| `ctx.every(cb)` | **no** | 5/65 | 5/65 | folded into the row above |
| `ctx.random` | one line in `starter/Play.ts:43` | 1/65 | 4/65 | — (`Math.random()`: 0/65) |

**Demonstrated in the rewritten file → 92% adoption. Not demonstrated → 0%.**

`ctx.goto` is the sharpest case because it is not merely undocumented, it is *mis-framed*.
`packages/core/src/game.ts:199-219` shows `#goto` performs a complete teardown —
`scene.exit()`, `scheduler.clear()`, `entities.clear()`, `clearScene()` — then constructs a
fresh `SceneType` and re-runs `load`/`enter`. **`ctx.goto("play")` is a correct, total
restart.** It is what 47 projects spent 208 lines rebuilding by hand, and rebuilding
incompletely: the hand-written resets restore collectibles and player position but leave
scheduler entries and spawned entities behind.

The templates *do* call `goto` — in `Boot.ts`, to go from boot to play. Checked precisely:
**25/65 projects retain that call, and 0/65 call `goto` anywhere outside `Boot.ts`.**
Demonstrating a primitive in its one-way navigation role produced **zero** transfer to its
restart role.

`ctx.random` is the honest counter-case and is reported as such: it *is* demonstrated
(`starter/src/scenes/Play.ts:43`) yet sits at 4/65, because 63/81 projects rewrote `Play.ts`
and dropped the line. Demonstration is necessary, not sufficient — which is why §5.4
exists.

---

## 4. The full convergence table, and the verdict on each

Framework arm, n=65, agent-authored lines only. Line counts are keyword-proximity
estimates (±20%), used only to rank, never to justify.

| # | Convergent shape | Projects | Verdict |
|---|---|---:|---|
| 1 | Collectible lifecycle (spawn → trigger → hide → score → restore) | 64/65 | **Reject the shape. Ship the one missing primitive inside it** → §5.1 |
| 2 | Run restart / reset | 64/65 | **Already shipped as `ctx.goto`** → §5.3–5.4. UI reachability is a real gap → §5.2 |
| 3 | Camera work beyond `createSpringArm` | 65/65 | **Reject** — rule 3, this is framing, it is what a screenshot shows |
| 4 | `Area3D` trigger wiring | 58/65 | **Reject the wiring** (the API working); **ship `monitoring`** → §5.1 |
| 5 | Idle spin + bob | 62/65 | **Reject the look; `ctx.tween` covers the timing** → §5.3 |
| 6 | UI restart button | 51/65 | **Real gap** → §5.2 |
| 7 | Health / damage / lives | 41/65 | **Reject** — ~6 lines, no two briefs agreed on semantics |
| 8 | Recycle / endless streaming | 21/65 | **Reject** — one genre; genre logic is not framework |
| 9 | Raw DOM key listeners | 12/65 | **Partially real, insufficient evidence** → §5.2 |

Rows 3, 5, 7, 8 are rejected by the 20-line rule and rule 3 without further argument. Rows
2 and the timer half of 5 are rejected as *new* work because the abstraction exists. That
leaves two things to build, one to demonstrate, and one instruction to fix.

---

## 5. What ships

### 5.1 `Area3D.monitoring` — the one genuinely missing primitive

**Evidence.** 35 of 65 framework projects (54%) disable a trigger by **teleporting it out
of the world**, 64 occurrences:

```ts
// platformer-2026-08-07-16/src/scenes/Play.ts:271-273
item.collected = true;
item.mesh.visible = false;
item.area.setPosition({ x: 0, y: -100, z: 0 });   // ← "disable" a trigger
```

then teleport it back on reset (`:337-342`).

`packages/physics/src/Area3D.ts` exposes `on`, `setPosition`, `handleCollision`,
`drainContacts`, `reconcileIntersections`, `dispose` — nothing between "live" and
"destroyed". `dispose()` is too coarse (the area is needed again after restart), so agents
invented a sentinel coordinate. It works, and is wrong twice: the collider still
participates in the broad phase every frame, and `y: -100` collides with any game whose
world extends below −100.

**Godot ships exactly this as a boolean.** `Area3D.monitoring` — when false, the area stops
detecting bodies. Rule 4 says borrow the name.

```ts
// packages/physics/src/Area3D.ts
/** Mirrors Godot's Area3D.monitoring. When false the area reports no contacts. */
get monitoring(): boolean { return this.#monitoring; }
set monitoring(value: boolean) {
  if (this.#monitoring === value) return;
  this.#monitoring = value;
  if (!value) this.#intersecting.clear();
}
```

plus one guard at the top of `handleCollision`. **~10 lines.**

**Fail-closed note.** `monitoring = false` must *clear* tracked intersections, not merely
suppress emission — otherwise re-enabling replays a stale `bodyExited`. The spec asserts
this.

### 5.2 Restart reachable from React

**Evidence.** 51 of 65 framework projects ship a restart or "Play again" button in
`ui/Hud.tsx` or `ui/Menu.tsx`. Eleven invented a state field to carry the click into the
scene (65 lines):

```ts
// platformer-2026-08-07-3
restartNonce: number;                                                    // state.ts
const restart = () => game.state.set({ restartNonce: state.restartNonce + 1 });  // Menu.tsx
if (ctx.input.justPressed("restart") || state.restartNonce !== this.restartNonce) { … }  // Play.ts
```

A monotonically-increasing integer used as an event channel, because the `Game` object
handed to React has no navigation method. `packages/core/src/game.ts:105-111` exposes
`ctx`, `scene`, `state`, `start`, `pause`, `resume`, `stop`. `goto` lives only on `Ctx`.

It is *technically* reachable — `game.ctx?.goto("play")` works today. Nobody found it.

```ts
// packages/core/src/game.ts — on the Game interface and class
goto(name: string): Promise<void>;
```

delegating to the existing `#goto`, throwing if `ctx` is not yet constructed. **~8 lines.**

**Re-entrancy hazard, found while verifying this.** `game.ts:313-322` reads `#sceneFrame`
and calls it. If a frame function calls `ctx.goto()` *synchronously*, `#goto` runs to
completion inside that call — tearing down the scene, clearing entities, and installing a
new frame — and then control returns to the **old** frame function, which continues
executing against a disposed world. `#enterScene` has an explicit guard for the
`enter()`-time version of this (`if (this.#scene !== scene) return;`); there is no
equivalent for the frame path. Phase 2 must test this and the instructions in §5.4 must
state the rule (`goto` then `return` immediately). `game.goto()` from React is unaffected —
it is called outside the frame.

**Not in scope:** a React input hook. 12/65 projects added raw `keydown` listeners, but
reading the sites splits them three ways — `ui/Hud.tsx` toggling a journal panel with `J`
(a UI-only binding that legitimately belongs to the UI), `ui/App.tsx` calling
`preventDefault` on Space/Arrows to stop page scroll, and `entities/Player.ts` duplicating
`ctx.input` it already had. Three causes, one arguably correct. Twelve projects across four
briefs is not enough to design against. **Re-measure after Phase 4.**

### 5.3 Demonstrate the primitives in the templates — 0 framework LOC

The four undemonstrated primitives account for **468 hand-rolled lines** at 0–8% adoption.
Demonstrate them *in the role we want them used in*, in `Play.ts`, the file agents rewrite:

1. A restart path calling `ctx.goto("play")`, with a comment stating that `goto` to the
   *current* scene is a full restart and clears entities and scheduled callbacks. This is
   the single highest-value line in the change.
2. One pickup animated via `ctx.tween` rather than a `Math.sin` accumulator.
3. One `ctx.after` for a respawn delay.

Rule 3 is not violated: `goto`, `tween` and `after` are lifecycle and timing plumbing, not
look. The visual choices (which pickup, what it looks like) already live in the template
and are unchanged.

**Template budget.** `pnpm budgets` reports largest template 1,078 of 1,200 LOC — that is
`platformer` (1,054 raw); `starter` is 798 and `minimal` 326. The change lands in `starter`
and `minimal`, with 402 and 874 lines of headroom, and is capped at **≤40 lines**.
**`platformer` is not touched** — 122 lines of headroom is too thin to spend, and
`check-budgets.ts:8-14` is explicit that template lines are exempt from the sweep's authored
cost, so growing a template silently improves the framework arm's score. Phase 3 must not
become that.

### 5.4 Fix the agent instructions — the cause, not the symptom

This is the section the rest of the PRD exists to justify, and it costs zero LOC.

#### 5.4a The instruction currently causing the duplication

`starter/AGENTS.md:56-57` and `minimal/AGENTS.md:53-54` both say:

> Any Three.js tutorial, StackOverflow answer, or snippet you already know works unchanged
> inside a scene. Prefer that over looking for a framework helper — **if a helper does not
> appear in the imports of an existing file, it probably does not exist.**

`ctx.goto`, `ctx.tween`, `ctx.after`, `ctx.every` and `ctx.random` are **property accesses
on `ctx`. They are never imports, and never can be.** The heuristic is structurally blind
to the entire `Ctx` surface, and it is stated with enough authority to stop the search.

Then `starter/AGENTS.md`, under "Budget real time for the look", instructs:

> 4. **Make it move.** Idle bob, a squash on impact, a particle on pickup, a screen shake
>    on damage. A few frames of motion is the cheapest quality-per-line in the whole project.

It tells the agent to animate and never names `ctx.tween`. 62/65 projects added idle
bob; 61/65 hand-rolled it with `Math.sin`. The instruction produced the behaviour it asked
for, by the most expensive route available.

The sentence is not wrong in intent — it is defending against the v1 habit of hunting for a
framework wrapper instead of writing Three.js. It just draws the boundary in the wrong
place: **Three.js surface → write it yourself. Loop, scene and scheduling surface → `ctx`
already has it.**

#### 5.4b The replacement

Replace the quoted sentence in both files with a scoped version, and add the block below to
`starter/AGENTS.md` and `minimal/AGENTS.md` immediately after the existing `ctx` list —
where the agent is already reading about `ctx`.

Scoped replacement for the heuristic:

> Any Three.js tutorial, StackOverflow answer, or snippet you already know works unchanged
> inside a scene. Prefer that over hunting for a framework wrapper — **for anything Three.js
> itself does (geometry, materials, lights, math), there is no wrapper and you should write
> the Three.js.** The exception is the loop: scene changes, timers and tweens are on `ctx`,
> not in an import, so grepping the imports of an existing file will not find them. The
> table below is the complete list.

New block:

```md
## The `ctx` surface — you already have these, do not rebuild them

`ctx` carries five things that get reimplemented by hand in almost every project, because
they are **properties on `ctx`, never imports** — grepping an existing file's imports will
never surface them. This table is the complete list.

| You already have | Rather than | Signature |
|---|---|---|
| `ctx.goto("play")` | a hand-written `#reset()` | `(name: string) => Promise<void>` |
| `ctx.tween(obj, { y: 2 }, 0.4)` | a `Math.sin` / `lerp` accumulator | `(target, props, seconds) => Promise<void>` |
| `ctx.after(0.8, fn)` | `elapsed += dt; if (elapsed > 0.8)` | `(seconds, cb) => ScheduleHandle` |
| `ctx.every(fn)` | a per-frame branch in `update` | `(cb: (dt: number) => void) => ScheduleHandle` |
| `ctx.random.range(-1, 1)` | `Math.random()` | seeded — a replay produces identical results |

**`ctx.goto(name)` restarts the current scene.** Calling `ctx.goto("play")` from inside
`Play` tears the scene down and rebuilds it: `exit()` runs, scheduled callbacks are cleared,
registered entities are cleared, the Three scene is emptied, then a fresh instance runs
`load()` and `enter()`. That is your entire restart button, and your entire death-and-retry.

Do **not** write a `#reset()` that walks your entities putting them back. It is ~15 lines
that look right and quietly miss the scheduler and anything you spawned after `enter()`, so
the second playthrough behaves differently from the first — and no gate in this project will
catch that.

**One rule when calling it from a frame function: `goto` and then `return`, immediately.**

```ts
if (player.dead) {
  void ctx.goto("play");
  return;              // ← required. Everything below now runs against a torn-down scene.
}
```

From React, the same call is `game.goto("play")` — use that for a restart button instead of
routing a counter through game state.

**`ctx.tween` is for timing, not for looks.** Use it for the *when* — a pickup rising over
0.4s, a door opening, a hit flash — and keep the *what* (colour, shape, easing feel) in
`src/render/`. Motion driven by a persistent `Math.sin(elapsed)` in `update()` is still the
right tool for a continuous idle bob; `tween` is for anything that starts, runs once, and
finishes.

**`ctx.random` is seeded from `defineGame({ seed })`.** Use it for anything a playtest needs
to reproduce — spawn positions, patrol offsets, level variation. `Math.random()` makes a
scenario that passes once and fails on replay for no visible reason.
```

#### 5.4c Why this is expected to work when a table alone would not

`ctx.random` is already demonstrated in `starter/src/scenes/Play.ts:43` and still sits at
4/65, because 63/81 projects rewrite `Play.ts` and delete the line. So demonstration alone
is insufficient, and a table alone is untested. The design intent is that the three
mechanisms cover each other's failure modes:

- the **table** survives a `Play.ts` rewrite, because `AGENTS.md` is not rewritten;
- the **demonstration** (§5.3) survives an agent that skims `AGENTS.md`;
- **removing the blocking heuristic** (§5.4a) is what lets either one be acted on.

This is a hypothesis with a number attached, not a certainty. §7 is written so it can fail.

---

## 6. Phases

Each phase ships with its test in the same commit. `pnpm typecheck && pnpm lint && pnpm test`
must pass before the next phase starts.

| Phase | Change | LOC | Test |
|---|---|---:|---|
| 1 | `Area3D.monitoring` | ~10 | `packages/physics/__tests__/Area3D.spec.ts`: contacts suppressed while false; **no stale `bodyExited` on re-enable**; defaults true |
| 2 | `Game.goto` | ~8 | `packages/core/__tests__/game.spec.ts`: `goto` to the current scene reconstructs it and clears entities + scheduler; throws before `start()`; **a frame function calling `goto` does not corrupt the new scene** (§5.2) |
| 3 | Template demonstration | 0 framework, ≤40 template | `template.spec.ts` asserts `goto`, `tween` and `after` each appear in generated `starter` source; `pnpm budgets` green |
| 4 | `AGENTS.md` rewrite (§5.4b) in `starter` + `minimal` | 0 | `pnpm sync:agents --check` green; `template.spec.ts` asserts the `ctx` table is present and the old heuristic sentence is gone |

**Ordering vs PRD-040.** PRD-040 adds collision layers to the same class. Land Phase 1
first — `monitoring` is one boolean with no interaction with layer masks, and doing it
second means rebasing a 10-line change onto a larger one for no reason.

**Playtest obligation.** Phases 1 and 2 change runtime behaviour, so per `AGENTS.md` each
needs a playtest scenario driving the real build, not only a unit test. Phase 1: collect a
pickup, assert score does not increment again on re-entry while `monitoring` is false.
Phase 2: click the HUD restart button, assert score returns to zero *and* entity count
returns to its post-`enter` value — the entity count is what catches the incomplete
hand-rolled reset. **These are part of the phase, not follow-up work.**

**`pnpm sync:agents` after Phase 4**, or CI fails on `CLAUDE.md` drift.

---

## 7. Success criteria — runnable, and able to fail

The gate is a re-run sweep, not inspection. After Phase 4, re-run the platformer and
exploration briefs at n≥10 on the framework arm, diff against the templates as in §2, and
require:

| Metric | Now (n=65) | Required |
|---|---:|---:|
| projects calling `ctx.goto` for restart | 0/65 | **≥ 6/10** |
| projects calling `ctx.tween` or `ctx.after` | 0/65 | **≥ 4/10** |
| projects using the `setPosition({y:-100})` sentinel | 35/65 | **0/10** |
| projects declaring `restartNonce`/`restartRequested` | 11/65 | **0/10** |
| projects writing a manual `#reset`/`#restart` | 47/65 | **≤ 3/10** |
| median agent-authored lines, framework arm | 482 | **≤ 440** |

**If adoption stays near zero after Phase 4, the discovery hypothesis in §3 and §5.4 is
wrong and must be reported as failed** — not re-explained. The live alternative is that
`goto`/`tween`/`after` are unreachable in the shapes agents actually write, and the correct
response is then the round-2 deletion review (`pnpm round:deletions`), not more
documentation.

Phases 1 and 2 are **not** conditional on this gate: the sentinel-coordinate idiom and the
`restartNonce` idiom are defects regardless of whether the instruction change lands.

---

## 8. Explicitly not built

Recorded so a later PRD does not relitigate them.

| Candidate | Projects | Why not |
|---|---:|---|
| `Collectible` / `Pickup` node | 64/65 | The ~52 lines are game design — which objects, worth what, respawning how. No two briefs agreed. Rule 1, and rule 3 on everything visual in it. `monitoring` (§5.1) is the only part that was framework's to own. |
| Endless-runner streaming / object pool | 21/65 | One genre. Belongs in a template if anywhere, and there is no endless-runner template. |
| Health / damage / invulnerability | 41/65 | ~6 lines, no shared semantics across briefs. |
| Camera framing helpers beyond `createSpringArm` | 65/65 | Rule 3, without qualification. The loudest thing in a screenshot. |
| Idle spin + bob helper | 62/65 | ~4 lines. Rule 1. The timing half is `ctx.tween`; the rest is look. |
| React input hook | 12/65 | Three distinct causes (§5.2); one is correct behaviour. Re-measure after Phase 4. |
| A `CharacterBody3D` beyond what ships | 62/81 rewrote `Player.ts` | The rewrites change **movement feel** — lane widths, jump arcs, limb rigs — not plumbing. This is the ceiling-setting failure `OPPORTUNITY-AREAS.md` opens with. |

---

## 9. Risks

1. **§3's correlation is not proven causal.** `entities.add` may be adopted because it is
   demonstrated, or because it is unavoidable — a scene cannot register an entity any other
   way, whereas a timer can always be hand-rolled. §7's re-run is the experiment that
   separates these, which is why it is allowed to fail rather than being a formality.
2. **`ctx.random` is a live counter-example** (§3): demonstrated, 4/65. §5.4c states why
   the combination is expected to beat demonstration alone, and it is a hypothesis.
3. **Four briefs.** Every count generalises across *agent runs*, not across *genres*.
4. **The corpus is live.** It grew 79 → 81 during this analysis. §1's snapshot timestamp is
   load-bearing; re-derive before citing these numbers later.
5. **Phase 3 can corrupt the benchmark.** Template lines are exempt from the sweep's
   authored cost. The ≤40-line cap and leaving `platformer` untouched is the mitigation.
6. **§5.4 removes a guardrail.** The heuristic it deletes was defending against hunting for
   framework wrappers instead of writing Three.js. The replacement keeps that defence and
   scopes it to the Three.js surface; if the next sweep shows agents hunting for wrappers
   that do not exist, that is the regression to watch for, and it is not in §7's table
   because no current metric captures it.
7. **`Game.goto` widens the public surface by one method.** Accepted: it delegates to an
   existing private method, is borrowed from `Ctx` where it already exists, and deletes an
   invented idiom (`restartNonce`) rather than adding one.
