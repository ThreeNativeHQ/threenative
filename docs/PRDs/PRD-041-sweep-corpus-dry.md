# PRD-041 — DRY the sweep corpus

**Status: OPEN.** Three changes ship: one missing physics primitive, one missing UI
binding, and one template/doc change that costs zero framework LOC and is the largest
measured win of the three.

**The finding that reframes this PRD:** the request was "find abstractions that would be
useful to DRY." Five of the six most-duplicated shapes in the corpus **are already
abstracted** — `ctx.goto`, `ctx.tween`, `ctx.after`, `ctx.every` all ship today in
`packages/core`. Adoption across 63 framework-arm builds is **0/63, 0/63, 0/63, 5/63**.
Agents reimplemented all four by hand, 454 lines of it. The one primitive with high
adoption (`ctx.entities.add`, 58/63) is the one the starter template demonstrates.

So the dominant cause of duplication in this corpus is **not missing abstraction. It is
undiscovered abstraction.** Adding more API would make that worse, which is the specific
failure mode `CHARTER.md` §11 rule 4 names as what killed v1.

**Complexity: low.** Phase 1 is ~10 framework lines, Phase 2 ~5, Phase 3 is template and
docs only.

**Charter authority:** `CHARTER.md` §11 rule 1 (20-line rule — it rejects most of §4
below), rule 3 (never own the look — rejects the animation candidates), rule 4 (vocabulary
is borrowed: `monitoring` is Godot's `Area3D.monitoring`, not an invented name), rule 5
(no new package; this PRD adds none). `AGENTS.md` "Verification honesty".

**Sibling PRDs:** does not overlap [PRD-033](PRD-033-playtest-semantic-depth.md) (harness
depth) or [PRD-040](PRD-040-physics-collision-layers.md) (layer masks). PRD-040 and this
PRD both touch `Area3D`; §6 notes the ordering.

**Budget effect:** framework LOC 2,988 → ~3,003 of 15,000. PRD files 9 → **10 of 10 — at
cap.** The next PRD written must be preceded by moving a completed one to `docs/PRDs/done/`.

---

## 1. The corpus, stated honestly

| Source | What is there | What it is worth |
|---|---|---|
| `docs/benchmark/sweeps/` | 79 projects — 63 framework arm, 16 vanilla arm | the primary evidence |
| — unique briefs | **4** (platformer, exploration, endless-runner, topdown-action) | the sample's real width |
| — replication | 48 framework platformer runs from 1 brief → **38 distinct `Play.ts`** | independent samples, not copies |
| `~/.codex/sessions` | 127 sessions with cwd in this repo, all Aug 2026 | **no usable signal — see §1a** |
| `/home/joao/projects/threenative-*sandbox*` | 6 scaffolded sandboxes, same 4 briefs | duplicates the sweep evidence |

**The width caveat is real and it bounds every claim below.** This is 4 game briefs
replicated 79 times, not 79 games. A shape appearing in 62/63 projects means *62 independent
agent runs across 4 briefs converged on it* — strong evidence the shape is convergent for
these genres, and **no evidence at all** about genres not in the set. Nothing in §5 is
justified by breadth of genre; it is justified by depth of repetition.

Replication is not degenerate: the 48 same-brief platformer runs produced 38 distinct
`Play.ts` files and 16 distinct `main.ts` files. Different agents, same brief, convergent
output — which is exactly the condition under which "they all wrote this by hand" is
informative.

### 1a. The codex sessions produce no independent signal — do not cite them

127 sessions have a cwd inside this repo. Every friction probe against them came back
contaminated:

- `TN_PLAYTEST_BRIDGE_MISSING` appears in 117/127 sessions. Extracting the surrounding 120
  characters shows **all 443 hits are the `AGENTS.md`/`CLAUDE.md` sentence** "…against a
  project with neither bridge fail `TN_PLAYTEST_BRIDGE_MISSING`; that is the harness being
  right." It is the instruction text, loaded into every session. Not one runtime failure.
- `20-line rule` appears in 121/127 sessions — same cause.
- The 918 sessions matching `TN_[A-Z_]+` across the wider `~/.codex/sessions` tree are
  **v1-era codes** — `TN_RECIPE_OWNER_CONFLICT` (4,220), `TN_IR_RENDERER_ADVANCED_FEATURE_UNSUPPORTED`
  (297), `TN_GAME_PLAN_OFF_RECIPE` (1,367). These belong to the 790k-line v1 whose IR and
  recipe system are already closed questions. They describe a framework that no longer exists.

Genuine compile-time friction in the v2 sessions is low and unpatterned: `Cannot find
module` 17/127, `Property … does not exist` 9/127, `has no exported member` 5/127. No
recurring symbol. **The codex corpus was analysed and is reported as yielding nothing.**
That is the honest result, not a gap in the analysis.

---

## 2. Method

For each of the 79 projects, its `src/**/*.{ts,tsx}` was diffed against the template it was
scaffolded from (recorded in each `sweep.json` as `template`). Only added lines were kept —
44,043 lines total, 34,828 of them in the framework arm. Every count below is over
agent-authored lines only. Template code is excluded, which matters: the templates already
ship coyote time, a spring arm and a materials set, and counting those would have inflated
almost every row.

Reproduce with the diff script recorded in this PRD's working notes; the two headline
numbers are:

| | framework arm (n=63) | vanilla arm (n=16) |
|---|---:|---:|
| agent-authored lines, median | **482** | **600** |
| min / max | 115 / 907 | 139 / 1,023 |

The framework arm authors ~20% fewer lines. That is the benchmark's existing claim and this
PRD does not restate or relitigate it.

### 2a. What agents do to a scaffolded project

They **rewrite the template in place; they almost never add files.** Across all 79 projects,
only 12 new files were created (`level.ts` ×4, `entities/Enemy.ts` ×3, `Projectile.ts`,
`PatrolSensor.ts`, and 3 others). Rewrite rates:

| File | Rewritten in | File | Rewritten in |
|---|---:|---|---:|
| `main.ts` | 79/79 | `entities/Player.ts` | 60/79 |
| `state.ts` | 63/79 | `render/materials.ts` | 58/79 |
| `scenes/Play.ts` | 61/79 | `render/postprocessing.ts` | 29/79 |
| `render/lighting.ts` | 61/79 | `ui/Hud.tsx` | 27/79 |

This is the mechanism behind §3: the template is not a library the agent calls, it is a
**seed the agent overwrites**. Anything the template does not visibly demonstrate is
invisible, because the agent's working set is the file it is currently rewriting.

---

## 3. The finding — existing primitives have near-zero adoption

Framework arm, n=63. "Hand-rolled equivalent" counts projects that wrote the thing the
primitive does, without calling it.

| Shipped primitive | Demonstrated in a template? | Adoption | Hand-rolled equivalent |
|---|---|---:|---|
| `ctx.entities.add` | **yes** — `Play.ts` in all 3 templates | **58/63** | — |
| `ctx.goto(name)` | only in `Boot.ts`, as one-way boot→play | **0/63** | 45/63 wrote a manual `#reset`/`#restart` (202 lines) |
| `ctx.tween(target, props, dur)` | **no** | **0/63** | 59/63 hand-rolled `Math.sin`/`MathUtils.lerp`/`damp` (202 lines) |
| `ctx.after(delay, cb)` | **no** | **0/63** | 48/63 hand-rolled `elapsed += dt` accumulators (50 lines) |
| `ctx.every(cb)` | **no** | 5/63 | folded into the row above |

The correlation is not subtle. **Demonstrated → 92% adoption. Not demonstrated → 0%.**

`ctx.goto` is the sharpest case, because it is not merely undocumented — it is
*mis-framed*. `packages/core/src/game.ts:199-219` shows `#goto` performs a complete
teardown: `scene.exit()`, `scheduler.clear()`, `entities.clear()`, `clearScene()`, then
constructs a fresh `SceneType` and re-runs `load`/`enter`. **`ctx.goto("play")` is a
correct, total restart.** It is exactly what 45 projects spent 202 lines rebuilding by
hand, badly — the hand-rolled resets restore collectibles and player position but leave
scheduler entries and spawned entities behind.

The templates *do* call `goto`, in `Boot.ts`, to go from boot to play. Demonstrating a
primitive in its one-way navigation role produced **zero** transfer to its restart role.
A primitive has to be demonstrated in the shape you want it used in.

---

## 4. The full convergence table, and the verdict on each

Framework arm, n=63, agent-authored lines only. Line counts are keyword-proximity
estimates, not exact block extraction — they are accurate to about ±20% and are used only
to rank, never to justify.

| # | Convergent shape | Projects | Median lines/proj | Verdict |
|---|---|---:|---:|---|
| 1 | Collectible lifecycle (spawn → trigger → hide → score → restore) | 62/63 | ~52 | **Reject the shape. Ship the one missing primitive inside it** → §5.1 |
| 2 | Run restart / reset | 62/63 | ~15 | **Already shipped as `ctx.goto`** → §5.3. UI reachability is a real gap → §5.2 |
| 3 | Camera work beyond `createSpringArm` | 63/63 | ~6 | **Reject** — rule 3, this is framing, it is what a screenshot shows |
| 4 | `Area3D` trigger wiring | 58/63 | ~14 | **Reject the wiring** (it is the API working); **ship `monitoring`** → §5.1 |
| 5 | Idle spin + bob on pickups | 60/63 | ~4 | **Reject** — 4 lines, rule 1; and `ctx.tween` covers the non-look part → §5.3 |
| 6 | Health / damage / lives | 41/63 | ~6 | **Reject** — 6 lines and no two briefs agreed on the semantics |
| 7 | Recycle / endless streaming | 20/63 | ~21 | **Reject** — 20/63 is one genre; genre logic is not framework |
| 8 | Hand-rolled timers / cooldowns | 48/63 | ~1 | **Already shipped as `ctx.after`/`every`** → §5.3 |
| 9 | Manual AABB / lane overlap | 16/63 | ~1 | **Reject** — 1 line |
| 10 | Raw DOM key listeners in framework builds | 10/63 | ~2 | **Partially real** → §5.2 |

Rows 3, 5, 6, 7 and 9 are rejected by the 20-line rule and by rule 3 without further
argument. Rows 2 and 8 are rejected as *new* work because the abstraction exists. That
leaves two things to build and one thing to demonstrate.

---

## 5. What ships

### 5.1 `Area3D.monitoring` — the one genuinely missing primitive

**Evidence.** 35 of 63 framework projects (56%) disable a trigger by **teleporting it out
of the world**, 64 occurrences:

```ts
// platformer-2026-08-07-16/src/scenes/Play.ts:273
item.collected = true;
item.mesh.visible = false;
item.area.setPosition({ x: 0, y: -100, z: 0 });   // ← "disable" a trigger
```

and then, in the reset path, teleport it back:

```ts
// platformer-2026-08-07-16/src/scenes/Play.ts:337-342
for (const coin of this.#coins) {
  coin.collected = false;
  coin.mesh.visible = true;
  coin.area.setPosition(coin.position);
}
```

`packages/physics/src/Area3D.ts` exposes `on`, `setPosition`, `handleCollision`,
`drainContacts`, `reconcileIntersections`, `dispose` — and nothing between "live" and
"destroyed". `dispose()` is too coarse (the area is needed again after restart), so agents
invented a sentinel coordinate. It works, and it is wrong in two ways they did not notice:
the collider still participates in the broad phase every frame, and `y: -100` collides with
any game whose world extends below −100.

**Godot ships exactly this and it is a boolean.** `Area3D.monitoring` — when false, the
area stops detecting bodies. Rule 4 says borrow the name; borrow it.

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

and one guard at the top of `handleCollision`. **~10 lines.** It deletes the sentinel-
coordinate idiom from 35 projects and removes a class of bug nobody has hit yet.

**Fail-closed note.** `monitoring = false` must clear tracked intersections, not merely
suppress emission — otherwise re-enabling replays a stale `bodyExited`. The spec asserts
this.

### 5.2 Restart reachable from React

**Evidence.** 49 of 63 framework projects ship a restart or "Play again" button in
`ui/Hud.tsx` or `ui/Menu.tsx`. Nine of them invented a state field to carry the click back
into the scene:

```ts
// platformer-2026-08-07-3/src/state.ts
restartNonce: number;

// ui/Menu.tsx
const restart = () => game.state.set({ restartNonce: state.restartNonce + 1, paused: false });

// scenes/Play.ts
if (ctx.input.justPressed("restart") || state.restartNonce !== this.restartNonce) { … }
```

A monotonically-increasing integer used as an event channel, because the `Game` object
handed to React has no navigation method. `packages/core/src/game.ts:105-111` exposes
`ctx`, `scene`, `state`, `start`, `pause`, `resume`, `stop`. `goto` lives only on `Ctx`.

It is *technically* reachable — `game.ctx?.goto("play")` works today. Nobody found it, and
requiring React code to reach through an optional `ctx` to get at navigation is a
discovery cost the framework should not charge.

```ts
// packages/core/src/game.ts — on the Game interface and class
goto(name: string): Promise<void>;
```

delegating to the existing `#goto`, throwing if `ctx` is not yet constructed. **~5 lines.**
It deletes `restartNonce` and every hand-written reset it fed.

**Not in scope:** a React input hook. 10/63 projects added raw `keydown` listeners, but
reading the actual sites splits them three ways — `ui/Hud.tsx` toggling a journal panel
with `J` (a UI-only binding that legitimately belongs to the UI), `ui/App.tsx` calling
`preventDefault` on Space/Arrows to stop page scroll, and `entities/Player.ts` duplicating
`ctx.input` it already had. Three different causes, one of them arguably correct behaviour.
Ten projects across four briefs is not enough to design an API against. **Re-measure after
Phase 3; do not build now.**

### 5.3 Demonstrate `goto`, `tween`, `after`, `every` in the templates — 0 framework LOC

This is the largest measured win in this PRD and it adds no package code.

The four primitives account for **454 hand-rolled lines** across the corpus at 0–8%
adoption. `entities.add`, demonstrated in every template's `Play.ts`, sits at 92%. The
intervention is to demonstrate the other four **in the role we want them used in**:

1. `starter/src/scenes/Play.ts` — a restart path that calls `ctx.goto("play")`, with a
   comment stating that `goto` to the *current* scene is a full restart and that it clears
   entities and scheduled callbacks. This is the single highest-value line in the change:
   it converts a 202-line hand-rolled pattern into one call.
2. `starter/src/scenes/Play.ts` — one pickup collected via `ctx.tween` rather than a
   `Math.sin` accumulator, and one `ctx.after` for a respawn delay.
3. `starter/AGENTS.md` and `minimal/AGENTS.md` — a short "primitives you already have"
   table listing `goto`, `tween`, `after`, `every`, `entities.add`. None of the three
   template `AGENTS.md` files currently names any of them.

Rule 3 is not violated: `goto`, `tween` and `after` are loop and lifecycle plumbing, not
look. The demonstration lines that *are* visual (which pickup, what it looks like) already
live in the template and are not changed.

**Template budget.** `pnpm budgets` today reports largest template 1,078 of 1,200 LOC.
That largest is `platformer` (1,054 raw); `starter` is 798 and `minimal` 326. The change
lands in `starter` and `minimal`, which have 402 and 874 lines of headroom. Phase 3 is
budgeted at ≤40 lines. **`platformer` is not touched** — its 122-line headroom is too thin
to spend, and the check-budgets comment is explicit that template lines are exempt from the
sweep's authored cost, so growing a template silently improves the framework arm's score.
Phase 3 must not become that.

---

## 6. Phases

Each phase ships with its test in the same commit. `pnpm typecheck && pnpm lint && pnpm test`
must pass before the next phase starts.

| Phase | Change | LOC | Test |
|---|---|---:|---|
| 1 | `Area3D.monitoring` | ~10 | `packages/physics/__tests__/Area3D.spec.ts`: contacts suppressed while false; **no stale `bodyExited` on re-enable**; `monitoring` defaults true |
| 2 | `Game.goto` | ~5 | `packages/core/__tests__/game.spec.ts`: `goto` to the current scene reconstructs it, clears entities and scheduler; throws before `start()` |
| 3 | Template demonstration + `AGENTS.md` tables | 0 framework, ≤40 template | `packages/create-threenative/__tests__/template.spec.ts` asserts each of `goto`/`tween`/`after` appears in the generated `starter` source; `pnpm budgets` green |

**Ordering vs PRD-040.** PRD-040 adds collision layers to the same class. Land Phase 1
first — `monitoring` is a single boolean with no interaction with layer masks, and doing it
second means rebasing a 10-line change onto a larger one for no reason.

**Playtest obligation.** Phases 1 and 2 both change runtime behaviour, so per `AGENTS.md`
each needs a playtest scenario driving the real build, not only a unit test. Phase 1:
collect a pickup, assert score does not increment a second time on re-entry while
`monitoring` is false. Phase 2: click the HUD restart button, assert score returns to zero
and entity count returns to its post-`enter` value. Neither is written yet; **they are part
of the phase, not follow-up work.**

---

## 7. Success criteria — runnable, and they can fail

The gate is a re-run sweep, not inspection. Re-run the platformer and exploration briefs at
n≥10 on the framework arm after Phase 3, diff against the templates as in §2, and require:

| Metric | Now | Required |
|---|---:|---:|
| projects calling `ctx.goto` for restart | 0/63 | **≥ 6/10** |
| projects calling `ctx.tween` or `ctx.after` | 0/63 | **≥ 4/10** |
| projects using the `setPosition({y:-100})` sentinel | 35/63 | **0/10** |
| projects declaring `restartNonce`/`restartRequested` | 9/63 | **0/10** |
| median agent-authored lines, framework arm | 482 | **≤ 440** |

**If adoption after Phase 3 stays near zero, the discovery hypothesis in §3 is wrong and
this PRD's §5.3 must be reported as failed** — not re-explained. In that case the live
alternative is that `goto`/`tween`/`after` are unreachable in the shapes agents actually
write, and the correct response is the round-2 deletion review (`pnpm round:deletions`),
not more documentation.

---

## 8. Explicitly not built

Recorded so a later PRD does not relitigate them.

| Candidate | Projects | Why not |
|---|---:|---|
| `Collectible` / `Pickup` node | 62/63 | The ~52 lines are game design — which objects, worth what, respawning how. No two briefs agreed. Rule 1, and rule 3 on everything visual in it. `monitoring` (§5.1) is the only part that was framework's to own. |
| Endless-runner streaming / object pool | 20/63 | One genre. Belongs in a template if anywhere, and there is no endless-runner template. |
| Health / damage / invulnerability | 41/63 | ~6 lines, no shared semantics across briefs. |
| Camera framing helpers beyond `createSpringArm` | 63/63 | Rule 3, without qualification. This is the loudest thing in a screenshot. |
| Idle spin + bob helper | 60/63 | ~4 lines. Rule 1. |
| React input hook | 10/63 | Three distinct causes behind the 10 (§5.2); one is correct behaviour. Re-measure after Phase 3. |
| A `CharacterBody3D` beyond what ships | 60/63 rewrote `Player.ts` | The rewrites change **movement feel** — lane widths, jump arcs, limb rigs — not plumbing. This is the ceiling-setting failure `OPPORTUNITY-AREAS.md` opens with. |

---

## 9. Risks

1. **§3's correlation is not proven causal.** `entities.add` may be adopted because it is
   demonstrated, or because it is unavoidable — a scene cannot register an entity any other
   way, whereas a timer can always be hand-rolled. Phase 3's re-run in §7 is the experiment
   that separates these, which is why §7 is allowed to fail rather than being written as a
   formality.
2. **Four briefs.** Every count generalises across *agent runs*, not across *genres*. A
   fifth brief could surface a shape absent here.
3. **Phase 3 is the one that can corrupt the benchmark.** Template lines are exempt from the
   sweep's authored cost. Capping Phase 3 at 40 lines and leaving `platformer` untouched is
   the mitigation; if a later change wants more template room, it needs a fresh argument,
   not this PRD's.
4. **`Game.goto` widens the public surface by one method.** Accepted: it is a delegation to
   an existing private method, borrowed from `Ctx` where it already exists, and it deletes
   an invented idiom (`restartNonce`) from the corpus rather than adding one.
