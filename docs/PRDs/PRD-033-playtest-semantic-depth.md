# PRD-033 — Playtest semantic depth: assert what the *game* did

**Status: proposed, and GATED. Do not start.** `ROADMAP.md` Gate 0 is unrun — two of five
axes read `0` because they have never been measured. `OPPORTUNITY-AREAS.md` is explicit:
"No area in this document should be started before round 2 completes on both arms."
This PRD is area **#2, score 90**. It starts when Gate 0 exits on its first outcome, and
not before. Building it earlier is how v1 reached 790k lines.

**Complexity: 7 → HIGH mode** (10+ files +3, complex state/temporal logic +2,
multi-package +2)

**Depends on:** `done/PRD-007-playtest-bridge.md` (the bridge and its capability
negotiation), `done/PRD-020-seeing-the-game.md` (the capture recipe this reuses).
**Charter authority:** `CHARTER.md` §3 (win condition), §8, §11 rule 4 (borrowed
vocabulary), §12.3; `AGENTS.md` "Verification honesty"; `packages/playtest/AGENTS.md`
("a check that cannot run must fail, never skip").

## 0. The strategic caveat, stated first and honestly

`CHARTER.md` §3 gives the harness to the vanilla arm too. **Nothing in this PRD wins a
point on the paired benchmark**, because both arms get it. `ROADMAP.md` already records
this: *"`playtest` is given away to the vanilla arm by §3, so it wins no comparison."*

The return is adoption, not score. An agent building vanilla Three.js has no way to tell
whether the game it just wrote works; this harness is the only thing in the repository
that answers that question, and today it answers a narrower version of it than it claims.
Do not let anyone write this up as a benchmark item. It is not one.

## 1. Context

**Problem:** the harness observes *the page* well and *the game* badly. Of 18 registered
assertion kinds, the ones that describe gameplay are either unreachable on the shipped
runner or unused, and every real scenario in the repository falls back to `diagnostics`
and one catch-all `GameState` blob.

**Files analyzed:** `packages/playtest/src/assertions.ts` (2,131 lines),
`src/scenario.ts`, `src/capabilities.ts`, `src/protocol.ts`, `src/report.ts`,
`src/runner/runner.ts`, `src/runner/bridgeClient.ts`, `src/three/bridge.ts`,
`src/three/observations.ts`, `src/three/entities.ts`, `packages/core/src/playtest.ts`,
`packages/core/src/entities.ts`, `packages/physics/src/Area3D.ts`,
`scripts/check-budgets.ts`, all 20 `*.playtest.json` under `examples/` and
`packages/create-threenative/templates/`.

### Current behavior

| Fact | Evidence |
|---|---|
| 18 assertion kinds are registered and documented to agents | `assertions.ts:25-314` |
| The shipped standalone runner populates exactly 7 observation fields: `console`, `hud`, `network`, `resources`, `runtimeObservations`, `runtimeDiagnostics`, `visual` | `runner/runner.ts:178-189` |
| It populates **none** of `entityTransforms`, `components`, `componentSeries`, `resourceSeries`, `effectLog`, `effectLogSeries`, `physicsDebug`, `physicsDebugSeries`, `overlayNodes` — all of which `IPlaytestObservations` declares and evaluators read | `assertions.ts:378-404` vs `runner/runner.ts:178-189` |
| So `reachability`, `overlayNodes`, `resources[].atSteps`, `resources[].throughoutSteps`, `components[].atSteps`, and five `movement` sub-checks (`minResolvedAxisDelta`, `facesMovementWithinDegrees`, `notFacing`, `notFacingPosition`, `reachesPositionWithin`) can **only ever fail** | evaluators at `assertions.ts:413-447`, `448-471`, `544-577`, `624-639`, `811-968` |
| …and they fail with a *gameplay* diagnostic, e.g. `TN_PLAYTEST_NOT_FACING_ASSERTION_FAILED` → "Drive patrol yaw from movement direction" | `assertions.ts:946-951` |
| `unknownPlaytestCapabilities` is exported and has **zero non-test callers** | `capabilities.ts:60`; caller census returns only the definition and `dist/` |
| Consequently `core/src/playtest.ts:67` advertises `runtime.audio`, which is not in `PLAYTEST_CAPABILITY_REGISTRY`, and nothing notices | `capabilities.ts:1-24` has no `runtime.audio` |
| `visual.entityVisible.throughoutFrames: true` degrades silently to one sample, because `runtimeDiagnosticsSeries` is never populated and the fallback is a single-element array | `assertions.ts:514-517` |
| `Registry.snapshot()` already carries per-entity gameplay fields (up to 24 scalars + `toArray` values, or the entity's own `debug()`) | `core/src/entities.ts:15-28, 60-74` |
| `core/src/playtest.ts` reads that snapshot and forwards **only** `animation`, `state` and `tags` from it | `core/src/playtest.ts:104-142` |
| Everything else the agent's game knows about itself reaches assertions as one blob: `{ GameState: state, state }` | `core/src/playtest.ts:212-224` |
| Across all 20 committed scenarios, kind usage is: `diagnostics` ×19, `resources` ×14, `movement` ×9, `visibility` ×5, `tags` ×3, `world` ×1, `visual` ×1, `camera` ×1 | `grep` over `examples/**` and `templates/**/*.playtest.json` |
| `components`, `states`, `contacts`, `animation`, `hud` are used **zero times** *within this scope* | same. **Scope matters and must travel with this claim:** widening the grep to `docs/benchmark/genres/**` finds exactly one `animation` user, `topdown-action/proof/topdown-action-pointer.playtest.json:22`. Nothing shipped to a scaffolded user reaches these kinds. |

The last two rows are the finding this PRD exists for. The semantic channels PRD-009 and
PRD-010 built are used by nothing, and the channel agents actually reach for is a
hand-maintained global state bag. **That is the "what the page did, not what the game did"
gap, measured.**

**What is working and must not be broken:** fail-closed holds everywhere it was checked.
An unregistered assertion key throws at load (`scenario.ts:726`), a registered kind with
no evaluator result fails (`assertions.ts:1127-1136`), a scenario that evaluated nothing
fails (`assertions.ts:1137-1147`), a missing capability throws
(`bridgeClient.ts:84-92`), and `TN_PLAYTEST_BRIDGE_MISSING` fires for semantic kinds with
no bridge (`bridgeClient.ts:58-67`). None of that is touched except to extend it.

### The budget claim in circulation is wrong — correcting it

`packages/playtest` is a **salvage package and is excluded from the 15,000-line framework
cap**: `scripts/check-budgets.ts:11` holds `SALVAGE_PACKAGES = new Set(["playtest",
"asset-mcp", "shader-portable"])` and line 61 skips them. `pnpm budgets` on a clean tree
reports `7 packages, 2988 framework LOC, 2 PRD files`.

So:

- Playtest-side LOC is **free against the cap** — which is a reason for discipline, not
  licence. The 20-line rule still applies, and 2,131 lines in one `assertions.ts` is
  already the largest single file in the repository.
- `packages/core/src/playtest.ts` **does** count. Phase 3 is the only phase that adds
  core lines; budget it at **≤120 net lines** and check with `pnpm budgets`.
- **No new package.** 7 of 8 slots are used, the last one is reserved for a WASM/native
  dependency (`OPPORTUNITY-AREAS.md` §"The constraint that actually binds"), and
  navigation is already competing for it. This PRD spends zero slots.
- PRD file count goes 2 → 3 against a cap of 10.

## 2. Solution

Four moves, smallest-blast-radius first. Nothing here invents a noun.

- **Make the harness say which of its own claims it can back.** Each registry entry
  declares the observation path its evaluator reads. At connect time the runner refuses a
  scenario whose declared kinds need an observation this runner+bridge pair cannot supply,
  with `TN_PLAYTEST_OBSERVATION_UNAVAILABLE` naming the path. An agent then learns "the
  harness cannot see this", not "your patrol yaw is wrong".
- **Wire the dead validator.** `unknownPlaytestCapabilities` runs against `describe()`.
  A bridge advertising a capability the protocol does not define fails the run.
- **Sample at labeled steps, not just before/after.** The runner already walks
  `scenario.steps`; sampling on each `label` fills `resourceSeries` and `componentSeries`
  and makes `atSteps` / `throughoutSteps` real. This is what turns "the score ended at 3"
  into "the score reached 1 at the pickup and never reset" — the transient-state class of
  bug a before/after pair structurally cannot see.
- **Expose the registry the framework already keeps.** `core/src/playtest.ts` forwards
  `Registry.snapshot()` per-entity fields as `components`, advertising `runtime.components`
  only when it does. The `components` assertion stops being decorative and per-entity
  gameplay state — `health`, `ammo`, `grounded`, `coyoteFrames` — becomes assertable by
  name instead of being flattened into `GameState`.
- **One new kind: `signals`.** Godot's exact word (`signal`, `emit_signal`, `connect`),
  over the protocol slot that already exists and is implemented by nobody:
  `IPlaytestBridgeV1.drainEvents` (`protocol.ts:94`) and capability `runtime.events`
  (`capabilities.ts:17`). It observes the events a game emits and leaves no transform
  trace: `damaged`, `died`, `collected`, `level_completed`.

**The framework does not own an event bus.** `signals` is sourced from a user-supplied
`events: () => JsonValue[]` callback on the bridge, exactly as `diagnostics` and
`gameplay` are today (`three/bridge.ts:22-32`). `OPPORTUNITY-AREAS.md` Tier 3 scores an
event bus at 5 and the 20-line rule kills it; the harness ships the *observation channel*,
the user's agent ships the emission. Same division as `contacts`.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| An effect log in the standalone runner, to revive the five dead `movement` sub-checks and `settled`/`occluded`/`aerodynamics` | Those evaluators were salvaged against `threejs-to-bevy`'s runtime service log. Reproducing it means the framework owns a per-call tracing layer — far past the 20-line rule and a new vocabulary of its own. Phase 1 marks them unsupported honestly instead. Reviving them is a separate PRD with its own evidence |
| A new `@threenative/playtest-semantics` package | The 8-slot cap, and the last slot is reserved for a dependency the others must not inherit. This carries none |
| Generic per-entity introspection ("assert any path on any entity") | That is a scene/state format by another name — `CHARTER.md` §2 closed question, 25,898 LOC of evidence. `components` is bounded by what `Registry.snapshot()` already emits and stays bounded |
| `health`/`damage`/`inventory` as first-class assertion kinds | Invents gameplay vocabulary the framework has no business owning, and §5b's sibling logic applies: the user's agent decides what its game's nouns are. `components` names them without the framework knowing them |
| Deleting the unreachable kinds outright | They are load-bearing for the `bevy`/`desktop` targets the scenario schema still supports, and deletion is a bigger decision than this PRD. Mark unsupported per target; delete when a round ledger says nobody wants them |
| Auto-emitting signals from physics contacts | `contacts` already covers that path. Two live implementations of one observation is the additive-migration smell |

## 3. Integration Ledger

| # | New thing | Live caller (`file:line`, non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `observationPath` on each registry entry + `TN_PLAYTEST_OBSERVATION_UNAVAILABLE` | `runner/bridgeClient.ts:~93` in `connectPlaytestBridge`; TBD at implementation | a misleading gameplay-shaped red | n/a — the evaluators stay for supported targets | a scenario asserting `movement.notFacing` against `abyss-framework` must fail with the new code naming `effectLog`; today it fails with `TN_PLAYTEST_NOT_FACING_ASSERTION_FAILED` and advice about patrol yaw |
| 2 | `unknownPlaytestCapabilities` wired into connect | `runner/bridgeClient.ts:~68` after `describe()`; TBD | the dead export at `capabilities.ts:60` | export kept, now called | **fails on the unmodified tree**: `core/src/playtest.ts:67` advertises `runtime.audio`, absent from `PLAYTEST_CAPABILITY_REGISTRY`. Phase 1 must resolve it deliberately (register it or stop advertising it), and the red is recorded first |
| 3 | Labeled-step sampling → `resourceSeries` | `runner/runner.ts:~91` step loop; TBD | before/after-only sampling | before/after retained — different question | delete the per-step sample call → the new `collect` scenario's `atSteps` goes red with "no sample for label", not green |
| 4 | `components` from `Registry.snapshot()` + `runtime.components` advertised | `core/src/playtest.ts:~34` `gameplayObservations`; `runner/runner.ts` sample `include`; TBD | `GameState` as the only per-entity view | no — `resources` still serves genuinely global state; `components` serves per-entity | delete the damage handler in `templates/platformer` → `components` on `player.health` goes red while `resources.GameState` stays green, which is the whole point |
| 5 | `signals` assertion + `drainEvents` in `three/bridge.ts` | `runner/runner.ts` step loop; `templates/platformer/src/main.ts` supplies `events` | nothing — new observation | n/a | remove the `collected` emit in the template → the `signals` scenario goes red; remove the whole `events` callback → `TN_PLAYTEST_CAPABILITY_MISSING` for `runtime.events`, never a pass |
| 6 | Template scenarios exercising 3–5 | `pnpm test:playtest`; scaffold smoke in CI | scenarios that assert only `diagnostics` + `resources` | no — existing scenarios stay | delete a scenario file → suite count drops and the gate fails |

### Reachability

**How is this reached?** Entry point: the `playtest` CLI
(`packages/playtest/dist/runner/cli.js`), driven by `pnpm test:playtest` in CI and by
`npx @threenative/playtest` in a scaffolded project.

- Pre-existing files edited to call it: `runner/runner.ts`, `runner/bridgeClient.ts`,
  `assertions.ts`, `three/bridge.ts`, `core/src/playtest.ts`.
- Registration: `capabilities.ts` registry entries; `defineGame` plugin array in the
  templates (already present from PRD-007).

**Full flow:** CI runs `pnpm test:playtest` → CLI loads the scenario → `connectPlaytestBridge`
negotiates capabilities **and now observations** → the step loop samples at each labeled
step → `evaluateRichPlaytestAssertions` → `report.json` + a non-zero exit. Result
observable in the CI gate and in `observations.json`.

**Is this user-facing?** No UI. It is agent-facing, and the report *is* the interface —
which is why Phase 1's diagnostic wording is a deliverable, not polish.

**What does it replace?** Row 4 replaces `GameState`-as-everything for per-entity state;
row 1 replaces a misleading red. Nothing is deleted, because nothing here has an incumbent
implementation — the incumbent is the *absence* of one.

## 4. Phases

Max 5 files each. Every phase edits at least one pre-existing file.

### Proof subject

**`packages/create-threenative/templates/platformer`** — the richest real template
(coins, a patrol enemy, dash, coyote time, respawn, one-way platforms; 8 committed
scenarios), plus `examples/abyss-framework` for the CI gate. Not a synthetic fixture.

**Requirements this subject does NOT exercise:** animation clips and state machines
(`templates/starter` and `minimal` carry those), and the `desktop`/`bevy` targets.
**Phase that closes each gap:** Phase 1 covers the targets by marking per-target
support explicitly; animation/state **have no usable regression control and Phase 5 must
build one rather than inherit it.**

> **Corrected 2026-08-07 — the original plan here was a gate that could not fail.** It
> said animation/state "remain proven by their own PRD-009 scenarios, re-run unchanged as
> a regression control in Phase 5." PRD-009's subject `examples/platformer/src/entities/Fox.ts`
> no longer exists, there is no `.glb` anywhere in the repo, and no committed scenario
> under `examples/**` or `templates/**` asserts `animation`. Re-running "unchanged" would
> have re-run nothing and reported green — the exact silent-pass mechanism `CLAUDE.md`'s
> verification-honesty section names. Phase 5 therefore authors a new scenario against a
> live subject, and its negative control must be observed red before the gate counts.
> Found by PRD-039's caller census; see `PRD-039-animation-state-machine.md` §5.

---

#### Phase 1: the harness stops blaming the game for its own blind spots

**Files (5):**

- `packages/playtest/src/assertions.ts` — EDIT: add `observationPath` + `supportedOn` to
  each `PLAYTEST_ASSERTION_REGISTRY` entry (`:25-314`)
- `packages/playtest/src/capabilities.ts` — EDIT: resolve `runtime.audio` (register it or
  remove the advertisement in core), keep `unknownPlaytestCapabilities` exported
- `packages/playtest/src/runner/bridgeClient.ts` — EDIT: call
  `unknownPlaytestCapabilities`; add the observation-availability check after `:92`
- `packages/playtest/src/runner/runner.ts` — EDIT: declare which observation fields this
  runner populates, as one exported constant the check reads
- `packages/playtest/__tests__/silent-drop.spec.ts` — EDIT (existing fail-closed suite)

**Implementation:**

- [ ] One exported constant lists the observation fields the standalone runner fills.
      Derive the check from it — do not hand-copy the list into a second place (twin
      constants are the smell).
- [ ] `TN_PLAYTEST_OBSERVATION_UNAVAILABLE`, thrown at connect, naming the assertion kind,
      the observation path, and the reason ("this runner does not produce an effect log").
- [ ] `TN_PLAYTEST_BRIDGE_CAPABILITY_UNKNOWN` when `describe()` advertises a capability
      the protocol does not define.
- [ ] Fix `assertions.ts:514-517`: `throughoutFrames: true` with no series available
      **fails**; it must not silently check one frame and report a multi-frame guarantee.

**Wiring:** caller edited — `bridgeClient.ts` `connectPlaytestBridge`. Registration —
registry entries. Old path — n/a. Ledger rows: #1, #2.

| Test file | Test name | Assertion | Negative control (observe red) |
|---|---|---|---|
| `__tests__/silent-drop.spec.ts` | `should refuse a scenario whose observation this runner cannot produce` | throws `TN_PLAYTEST_OBSERVATION_UNAVAILABLE` for `movement.notFacing` | remove the check → the run reaches the evaluator and emits patrol-yaw advice; assert that string is **absent** |
| `__tests__/silent-drop.spec.ts` | `should reject a bridge advertising an unregistered capability` | throws `TN_PLAYTEST_BRIDGE_CAPABILITY_UNKNOWN` | run against today's `core` bridge → red on `runtime.audio` before the fix |
| `__tests__/vacuous-assertion.spec.ts` | `should fail throughoutFrames when no frame series was captured` | `visual[].entityVisible` fails | today's code passes this case having checked one frame — record that red first |
| `__tests__/silent-drop.spec.ts` | `should still evaluate every supported kind` | supported kinds unaffected | narrow the supported list by one → a template scenario fails; proves the gate is live, not decorative |

**Revert check:** revert the observation check → `__tests__/silent-drop.spec.ts` fails,
and a `notFacing` scenario silently reports a gameplay defect again.

**User verification:** run a scenario with `assert.movement.notFacing` against
`examples/abyss-framework`. Expect a diagnostic that names the missing observation.

---

#### Phase 2: assert what happened *during* the run, not only at the end

**Files (4):**

- `packages/playtest/src/runner/runner.ts` — EDIT: sample on each labeled step; populate
  `resourceSeries`
- `packages/playtest/src/assertions.ts` — EDIT: `throughoutSteps` fails closed when the
  series is shorter than the labeled-step count (tighten `:549`)
- `packages/create-threenative/templates/platformer/playtests/collect.playtest.json` —
  EDIT: labels + `atSteps`
- `packages/playtest/__tests__/evidence-required.spec.ts` — EDIT

**Implementation:**

- [ ] Sample after each step carrying a `label`. Unlabeled steps do not sample — bounded
      by authoring, so the payload cap stays honest.
- [ ] A duplicate label is a load-time error in `scenario.ts` (silent last-wins is the bug
      class this package exists to prevent).
- [ ] A scenario asserting `atSteps` against a label no step defines fails at **load**,
      not at evaluation.

**Wiring:** caller edited — `runner.ts` step loop. Ledger row: #3.

| Test file | Test name | Assertion | Negative control |
|---|---|---|---|
| `__tests__/evidence-required.spec.ts` | `should fail atSteps when the named label was never sampled` | red with the label named | remove the load-time check → it reaches the evaluator as a generic red |
| `__tests__/evidence-required.spec.ts` | `should fail throughoutSteps when fewer samples than labeled steps` | red | drop one sample → red; today the field is unreachable, so record the current red first |
| `__tests__/scenario.spec.ts` | `should reject duplicate step labels` | throws at load | — |
| `templates/platformer/playtests/collect.playtest.json` | coins reach 1 at `first-coin` and 3 at `last-coin` | passes on the shipped template | reset `coins` to 0 in the pickup handler after incrementing → `atSteps` red while the final `gte: 3` assertion **still passes**. This is the phase's whole justification; if it does not reproduce, the phase is not done |

**Revert check:** remove per-step sampling → `collect.playtest.json` fails in
`pnpm test:playtest`.

---

#### Phase 3: per-entity gameplay state becomes assertable by name

**Files (5):**

- `packages/core/src/playtest.ts` — EDIT: forward `Registry.snapshot()` fields as
  `components`; advertise `runtime.components` only when non-empty
- `packages/playtest/src/protocol.ts` — EDIT: `components?: Record<string,
  Record<string, JsonValue>>` on `IPlaytestObservationSnapshot`
- `packages/playtest/src/runner/runner.ts` — EDIT: carry `snapshot.components` into
  `observations.components` and `componentSeries`
- `packages/create-threenative/templates/platformer/playtests/damage.playtest.json` — NEW
- `packages/core/__tests__/playtest.spec.ts` — EDIT

**Implementation:**

- [ ] Reuse `Registry.snapshot()` unchanged (`core/src/entities.ts:60`). It already
      prefers `debug()` and caps at 24 fields — do not add a second introspection path.
- [ ] `assertJsonSafe` the payload; a non-JSON-safe field throws rather than being dropped.
- [ ] Advertise `runtime.components` **only when a component was actually emitted** —
      PRD-007's acceptance criterion 3 forbids advertising a dead capability, and there is
      a test guarding it.
- [ ] Net core LOC ≤ 120. Run `pnpm budgets`.

**Wiring:** caller edited — `core/src/playtest.ts` `gameplayObservations`. Ledger row: #4.

| Test file | Test name | Assertion | Negative control |
|---|---|---|---|
| `core/__tests__/playtest.spec.ts` | `should not advertise runtime.components when no entity exposes fields` | capability absent | advertise unconditionally → the PRD-007 capability-parity test fails |
| `core/__tests__/playtest.spec.ts` | `should expose registry fields as components` | `sample().components.player.health` present | clear the registry → absent, assertion red |
| `templates/platformer/playtests/damage.playtest.json` | player health drops on enemy contact | passes on the shipped template | **delete the damage handler** → `components` red; `resources.GameState` and `diagnostics` stay green. Both halves must be observed |
| `__tests__/silent-drop.spec.ts` | `should fail a components assertion naming an unregistered entity` | red, not skipped | — |

**Revert check:** revert `core/src/playtest.ts` → `damage.playtest.json` fails with
`TN_PLAYTEST_CAPABILITY_MISSING` for `runtime.components`.

**Manual checkpoint (HIGH):** confirm the failure text points at the game's damage
handler, not at the harness. The report is the interface.

---

#### Phase 4: `signals` — the events a game emits that leave no trace

**Files (5):**

- `packages/playtest/src/assertions.ts` — EDIT: registry entry + evaluator
- `packages/playtest/src/scenario.ts` — EDIT: `IPlaytestSignalAssertion` + validator
- `packages/playtest/src/three/bridge.ts` — EDIT: `drainEvents` from an optional
  `events: () => JsonValue[]`; advertise `runtime.events` only when supplied
- `packages/create-threenative/templates/platformer/src/main.ts` — EDIT: supply `events`
- `packages/playtest/__tests__/vacuous-assertion.spec.ts` — EDIT

**Shape** — every field borrowed, nothing invented:

```json
{ "signals": [{ "name": "collected", "entity": "player", "minCount": 3, "atStep": "last-coin" }] }
```

`signal` and `name` are Godot's (`emit_signal("body_entered")`). `entity`, `minCount`,
`maxCount`, `atStep` are copied field-for-field from the existing `contacts` assertion
(`assertions.ts:251-268`) rather than renamed.

**Implementation:**

- [ ] Drain on each labeled step, bounded by `maxEventsPerDrain` (`protocol.ts:6`).
- [ ] A malformed signal entry **throws at load**. No `.filter()` may drop one.
- [ ] An empty `signals: []` is a load-time error — an empty assertion set is a failure.
- [ ] `maxCount: 0` (prove a signal did *not* fire) requires the drain to have run at all;
      the same absent-value trap the `maxDistance` comment documents at `assertions.ts:750-757`.

**Wiring:** caller edited — `runner.ts` step loop; `three/bridge.ts`. Registration —
`capabilities.ts` `runtime.events` becomes reachable. Ledger row: #5.

| Test file | Test name | Assertion | Negative control |
|---|---|---|---|
| `__tests__/vacuous-assertion.spec.ts` | `should fail an empty signals array at load` | throws | — |
| `__tests__/vacuous-assertion.spec.ts` | `should fail maxCount:0 when no drain occurred` | red, not green | remove the guard → an unobserved game "proves" the signal never fired |
| `__tests__/silent-drop.spec.ts` | `should throw on a wrong-typed signal name` | throws at load | pass `{ name: 42 }` → must throw, never coerce |
| `templates/platformer/playtests/collect.playtest.json` | `collected` fires 3× | passes on the shipped template | remove the emit → red. Remove the whole `events` callback → `TN_PLAYTEST_CAPABILITY_MISSING` |

**Revert check:** revert `three/bridge.ts` → `collect.playtest.json` fails on
`runtime.events`.

---

#### Phase 5: gates and the regression control

**Files:** `package.json` EDIT (`test:playtest` gains the new scenarios) · CI workflow
EDIT · `docs/verification/PRD-033.md` NEW.

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`
- [ ] `pnpm test:playtest` with the new scenarios, under the PRD-020 browser recipe
      (`xvfb-run`, `--enable-unsafe-webgpu`) — headless WebGPU renders blank here
- [ ] Re-run PRD-009's animation/state scenarios and PRD-010's contact/tag scenarios
      unchanged. Phase 1 tightened the capability path; if it broke them, the gate is
      right and the change is wrong
- [ ] Every red in every table above recorded in `docs/verification/PRD-033.md` with its
      command and output

## 5. Verification

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets
pnpm test:playtest

# 1. Caller census — the dead validator must acquire a live consumer
grep -rn "unknownPlaytestCapabilities" packages --include="*.ts" | grep -v node_modules | grep -v dist | grep -v __tests__
# Expected: a hit in runner/bridgeClient.ts that is not the definition

# 2. Baseline control — run the new gates at the previous commit
git stash && pnpm test:playtest; git stash pop
# Expected: the new scenarios FAIL. A gate the pre-change tree satisfies measures nothing.

# 3. Runner-populates-what-it-claims — no twin constants
grep -rn "observations: {" packages/playtest/src/runner/runner.ts
# Expected: the field list is derived from the exported constant, not a second literal

# 4. Revert check — Phase 3
#    Comment out the components forwarding in core/src/playtest.ts, rerun:
# Expected: damage.playtest.json fails TN_PLAYTEST_CAPABILITY_MISSING (runtime.components)
#           and resources/diagnostics assertions still pass — the pre-existing gate notices

# 5. Negative control for the whole PRD — delete the platformer damage handler
# Expected: damage.playtest.json red, collect.playtest.json green.
#           If both stay green, this PRD shipped nothing.
```

**Evidence required:**

- [ ] Every gate above has an observed red, pasted (not summarized) into
      `docs/verification/PRD-033.md`
- [ ] `pnpm budgets` still reports 7 packages and ≤3,110 framework LOC
- [ ] `unknownPlaytestCapabilities` caller census returns a non-test hit
- [ ] The `runtime.audio` discrepancy is resolved deliberately, with the decision recorded

## 6. Acceptance criteria — consumer-scoped

Each of these is a statement about a game, not about a file.

- [ ] **A scenario asserting the player took damage on contact fails when the collision
      handling is removed**, and the `diagnostics` and `resources` assertions in the same
      scenario stay green — so the failure names the gameplay defect.
- [ ] **A scenario asserting a score that reaches 1 at the pickup and holds fails when the
      score is reset on the following step**, while the final-value assertion still
      passes. Transient state is now visible.
- [ ] **A scenario asserting the player emitted `collected` three times fails when the
      third pickup stops emitting**, and fails differently when the emitter is removed
      entirely (`TN_PLAYTEST_CAPABILITY_MISSING`).
- [ ] **An agent that writes an assertion this runner cannot observe is told so**, with
      the observation named — not handed advice about its patrol yaw.
- [ ] **A bridge advertising a capability the protocol does not define fails the run**,
      instead of the run proceeding on a capability nothing implements.
- [ ] **A scaffolded platformer's committed scenarios exercise at least three semantic
      kinds beyond `diagnostics` and `resources`** — the usage distribution measured in §1
      has moved.
- [ ] Every gate observed red once, recorded in `docs/verification/PRD-033.md`.

**Integration gates:**

- [ ] Integration Ledger has zero `TBD` cells; every live caller is a real non-test `file:line`
- [ ] Every new exported symbol has a non-test consumer (census pasted)
- [ ] Revert check passed for each of rows 1–5
- [ ] Every gate has a negative control observed failing
- [ ] `pnpm budgets` green with no cap raised, and no new workspace package
