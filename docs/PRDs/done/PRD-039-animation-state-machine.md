# PRD-039 — Animation state machine / blend control

**Status: CLOSED — WONTBUILD; moved to `done/` on 2026-08-08.** No framework code ships from
this PRD. The finding is that
`AnimationPlayer` at 96 lines is already the right size, that the two features an
`AnimationTree` port would add are *already implemented and tested* in it, and that the
remaining features are one-liners in vanilla Three.js. What this PRD ships instead is the
template snippet the user writes, and a **Phase 0 measurement** that names the exact
numbers which would reopen it.

The only current action is the recorded disposition: opportunity area #8 is conditionally
closed. A future rigged-asset round may reopen this finding only through the triggers in §4a;
it does not create an implementation task today.

**Gate:** `ROADMAP.md` **Gate 0 is unrun**, and even after it exits, `OPPORTUNITY-AREAS.md`
conditions this area on a further trigger: area #8, score 57 — *"Only justified if the
round-2 ledger names crossfade/root-motion as a measured gap."* §1 below checks that
ledger. It does not name them. It names `AnimationPlayer` itself as a **deletion
candidate**.

**Complexity: 0 → no implementation phases.** Nothing is built.

**Charter authority:** `CHARTER.md` §11 rule 1 (20-line rule), rule 2 (the kill switch,
`CHARTER.md:105-111`), rule 4 (vocabulary is borrowed, never invented), rule 5 (`CHARTER.md:426`
reserves the 8th package for `physics-native`; 7 of 8 are in use, and this PRD adds none).
`AGENTS.md` "Verification honesty".

**Sibling PRDs:** does not duplicate or contradict
[PRD-033](PRD-033-playtest-semantic-depth.md). PRD-033 fixes the *harness*; this PRD
declines to build a *runtime*. One correction to a claim PRD-033 makes about this area is
recorded in §5.

---

## 1. The measured gap — there is not one, and the evidence points the other way

The burden of proof was on building. Every check run against the repository came back
against it.

### 1a. Caller census — the incumbent has zero non-test consumers

```
grep -rn "AnimationPlayer" packages examples --include='*.ts' --include='*.tsx' \
  | grep -v '/dist/' | grep -v node_modules
```

Every hit is the definition, the export barrel, or a test:

| Hit | What it is |
|---|---|
| `packages/core/src/animation.ts:3,12,21,69` | the definition |
| `packages/core/src/index.ts:7-8` | the export barrel |
| `packages/core/__tests__/animation.spec.ts:3,5,10,26,40` | its own spec |
| `packages/create-threenative/__tests__/template.spec.ts:206-209` | asserts the string appears in a generated `AGENTS.md` |

**No template, no example, and no scenario constructs one.** `examples/` contains only
`abyss-framework` and `abyss-vanilla`. `examples/platformer/src/entities/Fox.ts` — the
subject PRD-009 built `AnimationPlayer` for, and the only thing that ever called it — **no
longer exists in the repository** (`find . -name 'Fox.ts'` returns nothing). The
`templates/platformer` `public/` directory holds `favicon.svg` and `.gitkeep`; there is no
`.glb` or `.gltf` anywhere in the repo.

This is the prd-creator skill's **orphan module** signature exactly: a module whose only
importers are its own tests. Adding a state machine on top of it would be building a
second storey on a floor nobody stands on.

### 1b. The round-2 ledger names it for deletion, not for extension

`docs/verification/round-2-2026-08-07.md:48-50`:

| Export | Rounds unreached | Deleted? |
|---|---|---|
| `AnimationPlayOptions` | 2 | no — report only; human deletion review remains |
| `AnimationPlayer` | 2 | no — report only; human deletion review remains |
| `AnimationPlayerOptions` | 2 | no — report only; human deletion review remains |

Two full measured rounds, both framework archives, never reached. The same three exports
sit in `stillUntouched` in `docs/benchmark/DELTA-2026-08-05.md:38-40` and `:222-224`, and in
`Unused exports` in every sweep report checked.

`OPPORTUNITY-AREAS.md` asked whether the round-2 ledger names crossfade or root-motion as
a measured gap. **It does not mention either.** What it names is `AnimationPlayer` as a
rule-2 deletion candidate. The trigger for building was not met, and the trigger that did
fire points the opposite way.

### 1c. Both benchmark arms already animate, and neither used the framework to do it

`docs/verification/topdown-action-pair-2026-08-07.md:22-26`:

> Framework pointer proof: `framework-sealed-pointer3` … **attack animation observed**, diagnostics `0`.
> Vanilla pointer proof: `vanilla-sealed-pointer3` … **attack animation observed**, diagnostics `0`.

The framework arm's `Used exports` list for that genre
(`docs/verification/sweep-topdown-action-2026-08-05-r2.md:17`) is
`Area3D, CharacterBody3D, CollisionShape3D, Ctx, DebugOverlay, Game, GameCanvas,
PhysicsContext, RigidBody3D, Scene, defineGame, playtest, rapier, useGameState` —
`AnimationPlayer` is not in it. Both arms animated, both passed, and the framework
contributed nothing to either. That is a measured **tie**, which under the kill switch is
an argument for deletion, not investment.

### 1d. What real agents actually write

The proving subject named in the task is `templates/platformer/src/entities/Character.ts`.
It drives animation like this:

- `Character.ts:110` — `animateCharacter(this.#rig, this.state, this.#time, this.body.velocity.x)`
- `Character.ts:203-215` — `#applyState()`, a **12-line ternary** producing
  `"dash" | "jump" | "fall" | "run" | "idle"`
- `templates/platformer/src/render/rig.ts:54-67` — `animateCharacter`, **14 lines** of
  `Math.sin` on limb joints. No `AnimationMixer`, no clips, no blending.

The state machine agents want already exists, it is 12 lines, the user wrote it, and it is
correct. A guarded state graph in a package would be *more* code than the 12 lines it
replaces — rule 2, decided in advance.

### 1e. The one thing that is genuinely missing is a rigged asset, not a state machine

`AnimationPlayer` and the `animation` assertion are both unexercised for the same single
reason: **nothing in the repository has an animated `.glb`.** That is an asset gap. Adding
a state machine does not close it, and closing it does not need a state machine.

---

## 2. The 20-line rule applied per feature, not to the whole

Each candidate feature scored on its own, as required. Vocabulary in the "Godot / Three.js
name" column is borrowed — Godot's `AnimationTree` node names in camelCase, or Three.js's
own `AnimationAction` methods. No name below is invented.

| # | Feature | Godot / Three.js name | Cost in user space | Verdict |
|---|---|---|---|---|
| 1 | Crossfade between two clips | `crossFadeTo` / `fadeIn` / `setEffectiveWeight` (Three.js) | `mixer.clipAction(b).crossFadeFrom(mixer.clipAction(a), 0.3, true)` — **1 line**. Also already shipped: `AnimationPlayer.play(name, { fade })`, `animation.ts:40-65` | **KILL** — rule 1 |
| 2 | Transition interruption mid-blend | `AnimationNodeStateMachine.travel()` | **Already implemented.** `animation.ts:46-48` zeroes and stops every action except the outgoing one on each `play()`, so a second transition arriving mid-fade cannot leak weight from a third clip | **KILL** — already shipped |
| 3 | Additive layering (aim/lean over locomotion) | `AnimationNodeAdd2` / `AdditiveAnimationBlendMode` (Three.js) | `AnimationUtils.makeClipAdditive(clip)` then `action.blendMode = AdditiveAnimationBlendMode` — **2 lines**, both already in `three` | **KILL** — rule 1 |
| 4 | Two-clip parametric blend (walk↔run by speed) | `AnimationNodeBlend2` | `a.setEffectiveWeight(1 - t); b.setEffectiveWeight(t)` — **2 lines** | **KILL** — rule 1 |
| 5 | One-shot clip returning to the previous state | `AnimationNodeOneShot` / `oneShot` | ~8 lines in the entity (§3 below). Not in `AnimationPlayer` today | **KILL** — rule 1; it is entity state, and belongs beside the entity that owns it |
| 6 | State graph with guard conditions | `AnimationNodeStateMachine` | The platformer's whole graph is `Character.ts:203-215`, **12 lines**. A generic guarded graph is larger than the thing it replaces | **KILL** — rules 1 and 2 |
| 7 | Root-motion extraction | Godot `root_motion_track` | Genuinely **>20 lines**: isolate the root track, delta it per frame, hand the displacement to `CharacterBody3D.moveAndSlide`, zero the track so it does not double-apply | **KILL — for lack of demand, not lack of size.** Zero measured requests, no rigged asset to extract from, and it would contest `CharacterBody3D`'s ownership of `velocity` (`Character.ts:107, 170-192`). This is the only row that could reopen; see §4 |

**Six of seven fail the 20-line rule outright. The seventh passes it and fails the
evidence test.** That is the whole finding.

### The one real behavioural limitation, and why it still is not a PRD

`animation.ts:43` — `if (this.#current === name) return;`. Re-triggering the clip that is
already current is a no-op, so a second attack during the first will not restart the swing.
Godot's `AnimationNodeOneShot` does restart. This is a two-line change (`{ restart?: boolean }`),
and it is **deliberately not proposed here**: you do not extend an export that the round-2
ledger has queued for deletion review (§1b). If the deletion review keeps
`AnimationPlayer`, this belongs in that review's disposition, not in a new PRD. The
`oneShot` pattern in §3 sidesteps it entirely in user space.

---

## 3. What the user writes instead

The whole animation layer for a rigged platformer hero. This goes in
`templates/platformer/src/entities/` in the user's repo when they add a `.glb` — not in a
package. It covers state→clip mapping, crossfade, interruption, and `oneShot`, which is
everything an `AnimationTree` port would have provided for this genre.

```ts
// src/entities/Hero.ts
import { AnimationPlayer } from "@threenative/core";
import type { AnimationClip, Object3D } from "three";
import type { CharacterState } from "./Character.js";

const CLIP_FOR_STATE: Record<CharacterState, string> = {
  dash: "Dash", fall: "Fall", hurt: "Hurt", idle: "Idle", jump: "Jump", run: "Run",
};

export class Hero {
  // Named `animation` on purpose: core/src/playtest.ts:109-129 reads
  // `entity.animation.current` and `entity.animation.advancedFrames` off any
  // registered entity, so this field alone makes the `animation` assertion work.
  readonly animation: AnimationPlayer;
  #oneShot: string | undefined;
  #oneShotRemaining = 0;

  constructor(gltf: { animations: AnimationClip[]; scene: Object3D }) {
    this.animation = new AnimationPlayer({ clips: gltf.animations, root: gltf.scene });
  }

  // Godot's AnimationNodeOneShot, in camelCase.
  oneShot(clip: string, seconds: number, fade = 0.1): void {
    this.#oneShot = clip;
    this.#oneShotRemaining = seconds;
    this.animation.play(clip, { fade });
  }

  update(state: CharacterState, dt: number): void {
    this.#oneShotRemaining = Math.max(0, this.#oneShotRemaining - dt);
    if (this.#oneShotRemaining === 0) this.#oneShot = undefined;
    this.animation.play(this.#oneShot ?? CLIP_FOR_STATE[state], { fade: 0.15 });
    this.animation.update(dt);
  }
}
```

Under 20 lines of logic. It needs no framework change: `Ctx.assets.model()`
(`assets.ts:11, 60-62`) loads the `.glb`, `AnimationPlayer` handles the blend, and the duck-typed
contract at `core/src/playtest.ts:109-129` makes it observable to playtest for free.

---

## 4. Phase 0 — the measurement, not an implementation

Nothing here writes framework code. Each item is a number, and §4a states in advance what
number reopens this PRD.

| # | Measurement | Command / instrument | Owner |
|---|---|---|---|
| 0.1 | Close Gate 0 | `pnpm round:next` to completion on `exploration`, both arms | ROADMAP Gate 0 |
| 0.2 | **STAY the rule-2 deletion of `AnimationPlayer` until 0.3 has run.** Record the stay and its reason in the round ledger; do not let it lapse silently | `round:deletions` (`PRD-021` phase 3, unbuilt) reports it as a 2-round deletion candidate. **Disposition: keep, pending 0.3** — see §4b | PRD-021 |
| 0.3 | Put one rigged `.glb` in front of an agent | A sealed round on a genre whose brief requires a rigged character. This is the only way §1e's asset gap becomes a measurement rather than a guess. **Scheduled, not hypothetical** — see §4b | benchmark protocol |
| 0.4 | Read the transcripts, not the score | In that round, count: how many turns each arm spent on animation, whether either arm produced a visible T-pose or a snapped transition, and whether either reached for `AnimationPlayer` unprompted | `docs/verification/` |

### 4a. Reopening triggers, stated before the measurement

This PRD reopens **only** if 0.3 and 0.4 produce one of these, and the disposition is
recorded with the run that produced it:

1. **Root motion (row 7).** The framework arm's character visibly slides or foot-skates,
   *and* fixing it in user space costs more than 20 lines against `CharacterBody3D`.
2. **A measured differential.** The framework arm spends materially more turns on
   animation than the vanilla arm, on the same brief. A tie is a KILL, per §1c.
3. **A T-pose or a snapped transition in the framework arm** that `AnimationPlayer.play()`
   cannot fix — noting that `animation.spec.ts:37-51` already proves it does not produce
   one under interruption.

Anything short of those, this stays closed. "An agent might want a state machine" is not a
trigger; that is how v1 reached 790k lines.

### 4b. The census is confounded by a missing input, and rigged assets are imminent

**Added 2026-08-07, on the project owner's statement that rigged `.glb` assets are coming
soon.** This changes nothing about the WONTBUILD verdict on the state machine, and
everything about §4's item 0.2.

`AnimationPlayer` reads as unreached in `round-2-2026-08-07.md:48-50` because **the repo
contains no rigged asset at all** — `find . -name "*.glb"` returns nothing outside
`node_modules`. An export that animates skinned clips cannot be reached by a round whose
briefs have no skinned clips to animate. That is a **missing input, not a rejected
abstraction**, and rule 2 does not distinguish between the two.

So the two dispositions come apart, and must be recorded separately:

| Question | Disposition | Why |
|---|---|---|
| Build `AnimationNodeStateMachine` / blend trees? | **WONTBUILD, unchanged** | §3's per-feature table stands on its own: 6 of 7 features are 1–2 lines of vanilla `three`, and interruption is already implemented and tested at `animation.ts:46-48` / `animation.spec.ts:37-51`. No rigged asset would change a line count. |
| Delete `AnimationPlayer` under rule 2? | **NO — stay it** | The evidence for deletion is reach rate, and reach rate is unmeasurable until 0.3 supplies the input. Deleting now and rewriting in a month is the kill switch misfiring, not working. |

**Where the asset could arrive from:** PRD-032 prepared an upstream profile but is void
until a publishable version exists. Its Phase 2 scaffold integration never ran, so this
PRD's measurement 0.3 remains blocked on a future asset-tool release rather than being
claimed as delivered.

**The trap this section exists to prevent:** if 0.2 executes before 0.3, the round after
it will report `AnimationPlayer` as absent rather than unreached, and the deletion becomes
self-justifying — nothing can reach an export that no longer exists. Record the stay in
the ledger with this reason attached, so the next round reads it as a decision rather than
an oversight.

---

## 5. Corrections to claims circulating about this area

Both are stated because a wrong premise is how a declined PRD gets rebuilt later.

**The `animation` assertion kind has one committed user, not zero.**
`docs/benchmark/genres/topdown-action/proof/topdown-action-pointer.playtest.json:22`:

```json
"animation": [{ "entity": "player", "clip": "attack", "entered": true, "advancedFrames": 1 }]
```

[PRD-033](PRD-033-playtest-semantic-depth.md):60 says `animation` is used "zero times", and
**that is correct within its stated scope** — it counted the 20 scenarios under `examples/**`
and `templates/**`. The hit above is under `docs/benchmark/genres/`, outside that scope.
The two statements do not conflict; anyone acting on either should use the scope with it.
Note that the arm satisfying that assertion did so *without* `AnimationPlayer` (§1c) — the
observation contract at `core/src/playtest.ts:109-129` is a duck type, satisfied by any
object exposing `{ current: string, advancedFrames: number }`.

**PRD-033:184's regression control for this area is stale.** It says
"animation/state remain proven by their own PRD-009 scenarios, re-run unchanged as a
regression control in Phase 5." PRD-009's animation subject was
`examples/platformer/src/entities/Fox.ts`, which no longer exists (§1a), and no committed
scenario under `examples/` or `templates/` asserts `animation`. Whoever executes PRD-033
Phase 5 must either supply a new subject or strike that control — re-running it as written
would be a gate that cannot fail. Raised here, not fixed here; PRD-033 is not this PRD's
file to edit.

---

## 6. Acceptance criteria

Consumer-scoped, as required. A WONTBUILD PRD's consumer is the next agent who considers
building this, so the criteria are about what that agent can find and run.

- [ ] An agent asked to add crossfading animation to the platformer finds `Hero.ts` in §3
      and ships it **without importing anything new**, using `Ctx.assets.model()` and the
      existing `AnimationPlayer`.
- [ ] With that entity registered, `assert.animation` — the kind with one user repo-wide —
      passes against the real platformer template with no framework change, because
      `core/src/playtest.ts:109-129` already reads `.animation.current` and
      `.animation.advancedFrames` off any registered entity.
- [ ] The platformer player interrupting a mid-air one-shot with a landing clip never
      T-poses. **This is already proven, and the proof was run:**
      `packages/core/__tests__/animation.spec.ts:37-51`, "normalizes an interrupted
      crossfade" — `idle → run (fade 0.1) → [10ms] → jump (fade 0.1)`, asserting total
      effective weight ≈ 1 across all three actions. Any weight leak is a T-pose, and the
      assertion catches it.
      ```
      $ pnpm vitest run packages/core/__tests__/animation.spec.ts
       ✓ packages/core/__tests__/animation.spec.ts (3 tests) 11ms
       Test Files  1 passed (1)
            Tests  3 passed (3)
      ```
      Negative control, not yet observed red: deleting the `for` loop at `animation.ts:46-48`
      leaves the first outgoing action fading with nonzero weight while a third plays, so
      the sum exceeds 1 and this test goes red. **Recorded as UNVERIFIED** — the run above
      is a pass without an observed red, and this PRD writes no code, so the control was
      not executed. Whoever touches `animation.ts` next must run it.
- [ ] Framework LOC added by this PRD: **0**. Packages added: **0** (7 of 8 in use; the 8th
      is reserved for `physics-native`, `CHARTER.md:426`). Verified: `pnpm budgets` →
      `budgets ok: 7 packages, 2988 framework LOC, 6 PRD files`.
- [ ] `OPPORTUNITY-AREAS.md` area #8 reads as **conditionally closed**, with §4a's three
      triggers as the reopening condition. *(Not done by this PRD — that file is a
      proposal document and editing it is a separate change.)*

### Budget note

`pnpm budgets` caps `docs/PRDs/` at 10 files and it currently holds 6. This file makes 7,
with sibling PRDs still landing. If the cap is reached, this one is a strong candidate to
move to `docs/PRDs/done/` — it is a finding, not work in progress, and `done/` does not
count against the cap (`docs/README.md:67-68`).

---

## 7. Integration Ledger

| # | New thing | Live caller | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| — | none | n/a | n/a | n/a | n/a |

Empty by design. This PRD ships no module, no export, no gate, and no generated artifact,
so there is nothing to wire and nothing that could be left dead. The ledger is present
because the skill requires it, and an empty one is the honest entry.
