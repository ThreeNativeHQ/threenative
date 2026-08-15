# Production readiness, and the vanilla crossover

**Status: proposal, not commitment.** Written 2026-08-14 from two sources: an executed
physics-puzzle sweep (rounds 5 and 6, archived and scored) and a strategy review written against a
separate shooter-template run. Where a claim is measured, the evidence is cited. Where it is not,
it says so. Supersedes `PRODUCTION-READINESS-AND-VANILLA-CROSSOVER.md` and
`docs/verification/NEXT-2026-08-14.md`.

## The thesis

ThreeNative should not optimise for beating vanilla Three.js at producing the first toy in ten
minutes. Vanilla imposes almost no structure and should win that comparison.

> Vanilla Three.js minimises time to the first toy.
> ThreeNative minimises time to a maintainable, performant, verified, cross-platform game.

That promise is credible and not yet proven. Round 6 scored the framework arm **63/100** against a
**58/100** vanilla estimate on seven axes — a real but small margin, on one genre, at 938 authored
lines, which is the worst case for a framework because the scaffold's fixed cost is paid in full
and its scale benefits never arrive.

## Read this first: the instrument was broken for three rounds

For rounds 3, 4 and 5 the loop reported `0/1` for **both** arms and nobody knew why. It was not the
games. `scripts/sweep-archive.ts` allowlisted `index.html` and `vite.config.*` at the project root
and silently dropped `threenative.config.ts`, which the starter's own `src/game.ts` imports. Every
archived build 500'd in its dev server and never booted, so `sweep:proof` reported a missing bridge
for an application that had never started.

**Every functional-column number before 2026-08-14 is void**, including the kill switch round 4
fired on it. Fixed under PRD-107, with `assertArchiveResolves` failing the archive when `src/`
imports a sibling the archive does not carry. The guard, not the copy list, is what stops it
recurring.

The lesson generalises: a number produced by a broken step is worse than no number, because it is
reported with the same confidence as a real one.

## Definition of production-ready

ThreeNative is production-ready when a competent team can ship and maintain a representative game
without routinely escaping the framework, debugging the framework's own golden path, or accepting
evidence weaker than the product claims. The bar is not "the demo runs":

1. A fresh project can be created, developed, tested, and built on supported targets using
   documented commands.
2. Runtime, network, console, visual-capture, and behavioural failures fail closed by default.
3. The same gameplay contract is continuously exercised across web and native.
4. Lifecycle, disposal, restart, scheduled work, physics, and state stay deterministic under
   repeated transitions.
5. Performance budgets are measurable and regressions are attributed.
6. Asset acquisition, licensing, compilation, optimisation, and runtime loading form one
   reproducible path.
7. Templates demonstrate player-facing quality as well as framework coverage.
8. Escape hatches are explicit, observable, and rare; ordinary Three.js remains the correct tool
   for game-owned rendering.

## What is measured today

From the round 6 build (`docs/benchmark/sweeps/physics-puzzle-2026-08-15-2`, scored in
`docs/verification/score-physics-puzzle-round-6-2026-08-14.md`):

**Working.** Scaffold first try in ~3 s with no manifest edit; `tsc` clean on the untouched
scaffold; `pnpm dev` ready in 313 ms; first capture already a correct lit frame. Godot vocabulary
made `moveAndSlide`, `grounded`, `bodyEntered`, `teleport` guessable without reading them. **Zero
physics escape hatches** — no `@dimforge` import and no `.raw` on any body, so nothing forks web
from native. Restart freed every body (`worldBodies=39` across three consecutive restarts).

**Not working.** The proof hook went unused in *both* rounds. Visual quality sits at half marks:
crates read as thin bright frames rather than solid painted wood, the character clips into the
stack, and at 900×600 the bottom hint bar overlaps the control text. Physics did not reproduce
across scene reloads until PRD-109, and that fix is opt-in.

**Two corrections to the record.** Round 5's friction log asserted that scene-created bodies leak
and that no fixed-step option exists. Round 6 *measured* both and disproved them: bodies are freed,
and `step`/`maxSteps` are in `IGameConfig` — they simply carried no documentation. A friction log is
a builder's experience, not a measurement. Verify each claim against source or an instrument before
turning it into a PRD.

## P0 — make the foundation trustworthy

### 1. Make verification fail closed

This is the strongest potential advantage and therefore must be stricter than ordinary test tooling.

- Any unexplained page error, console error, network failure, runtime diagnostic, unhandled
  rejection, or GPU validation error fails the scenario by default.
- Allow-listing must be explicit, narrow, versioned, and printed in the report.
- Separate capture failure from render failure. A white or black WebGPU screenshot is never valid
  visual evidence, but it is not automatically a game failure either.
- Store browser arguments, GPU adapter, renderer kind, target, viewport, and capture method with
  every visual artifact.
- Require behavioural assertions *and* representative visual evidence when both are in scope.

**One claim to verify before acting on it.** The strategy review reported a generated playtest
returning `pass: true` alongside 18 console errors and 18 runtime diagnostics. If true that is the
vacuous pass this package exists to prevent, and it outranks everything else in this document.
It is **not reproduced here**: round 6's run reported 19 console errors and correctly failed. Try
to reproduce it first; do not write the fix from the report.

Acceptance gate: seeded negative fixtures prove each diagnostic category turns a run red, and the
harness catches a deliberately introduced restart leak, stale scheduler callback, physics mismatch,
network failure, and visual-capture failure.

### 2. Make the scaffold's proof hook survive contact with a real game

**Both** rounds deleted all ten generated playtest scenarios and never used the bridge. Round 6's
builder was explicit: they assert the starter game's pickups, coyote time and respawns, "none of
which survives contact with a different game", and the `test` script that runs them "is dead the
moment you change the game."

This is the single largest unrealised value in the product. It costs points on two axes worth 35
combined, and it is why the sealed proof observed nothing in round 6 — only `entity: "goal"` was
ever registered.

Try: ship **one** generic scenario that survives changing the game — boots, renders a canvas, no
console errors, the subject entity moves under input — and have the scaffold register the player
entity by default. Template change, not a package change.

### 3. Make the golden path unbreakable

Required journey: `create → dev → test → build web → build native → package`.

- `--help` reliable for every public CLI command.
- Template and genre selection exposed directly; never require editing a generated shell script.
- Project-resolved build dependencies discovered consistently. The review hit
  `TN_CONFIG_TRANSPILER_MISSING` from `threenative build --target web` while a direct `vite build`
  succeeded — **unverified here**, and worth reproducing.
- Test published commands from a clean temporary directory using packed packages, not workspace
  resolution.
- Errors name the failing layer, the searched locations, and the corrective command.

Acceptance gate: every supported template completes the full golden path from clean packed
artifacts in CI, with no manifest edits, workspace symlinks, or undocumented environment variables.

### 4. Decide the sealed-brief naming contract

Blocking real measurement today. The sealed proof pins entity ids (`player`, `crate`,
`solid-body`, `goal`, `mission`) and `world.seed = 6132` that `brief.md` never states, and the arm
firewall forbids the builder from reading the proof. Those assertions are **unpassable by any blind
builder**. Round 5 scored 2/10 and round 6 scored 0/10, and the difference was luck: round 5
happened to bind ArrowRight and name an entity `player`.

Two honest options, and it is an owner decision because changing a sealed input voids comparison
with every earlier round: state the ids and seed in `brief.md`, or rewrite the proof to assert
observable behaviour rather than names.

## P1 — prove the reasons to choose ThreeNative

### 5. Run one paired round on the repaired instrument

No round has ever produced a functional-column comparison, because until now no archive booted. A
pair also settles the deletion verdict on PRD-108: round 6 reached for `pushesDynamicBodies` and
`linearVelocity` but **not** `applyImpulse` or `applyForce`. `AGENTS.md` rule 2 deletes an
abstraction no fresh uninformed build reaches for. One round is thin evidence; a second unreached
round is not.

Run the vanilla arm too. `pnpm sandbox --arm vanilla` exists, and every score so far has carried an
*estimated* counterfactual, which is the weakest number in the record.

### 6. Demonstrate native parity continuously

A native build that compiles is not enough; the same game must remain the same game.

- Representative scenarios on web, desktop native, and at least one mobile target.
- Compare state transitions, collision outcomes, random traces, input semantics, and frames.
- Document target-specific capability differences rather than hiding them behind nominal API
  compatibility.
- Make browser-only globals and `.raw` visible in portability reports.

**Immediately relevant:** PRD-108's actuation is web-proved and native-guarded. The TypeScript ABI
forwards and throws `TN_NATIVE_PHYSICS_ACTUATION_MISSING` on an old runtime, but the Rust
`Simulation` has not gained the entry points, so **no native build can push a crate yet.** Do not
describe the physics work as done on native until that lands and runs.

### 7. Make performance advantages visible and enforceable

"Performance for free" must be measurable, not positioning: frame-time, CPU, GPU, draw calls,
triangles, allocations, physics step, asset memory; budgets in playtests with warm-up and
percentiles; regressions attributed to systems and content. Each automatic optimisation must
demonstrate measured benefit and document its escape hatch and failure mode.

### 8. Make templates credible games, not coverage fixtures

Two independent bars: technical (lifecycle, input, physics, state, restart, portability, proof) and
player-facing (camera, controls, hierarchy, feedback, HUD, audio, coherence, game feel).

- Capture idle, active gameplay, success/failure, and narrow-viewport states for every template.
- Blind visual review against a fixed rubric.
- Genre names must match player expectations — a shooter should feel like a shooter before
  customisation.
- Treat opening frame quality as a release gate, not decorative polish.

The visual defects round 6 exhibited are **game-owned and must stay that way**: the framework never
owns the look. The lever is the scaffold's starting point, never `packages/`.

## P2 — make the framework cheaper than accumulated engine code

- **Progressive disclosure.** Simple defaults for common games; advanced contexts, platform
  differences, and low-level physics only when needed. One obvious owner for loop, input, state,
  lifecycle, disposal. Document escape hatches as supported boundaries.
- **Do not wrap ordinary Three.js** to increase framework usage. Detect dead wrappers, duplicated
  state buses, parallel loops, and browser-only dependencies in audits.
- **Production operations** that get expensive after a prototype: versioned save data and
  migrations, suspend/resume, controller/touch/accessibility input semantics, crash reports with
  gameplay context, asset provenance, reproducible release packaging, upgrade tooling.

Networking, ECS variants, and visual scripting should not outrank the golden path, verification
correctness, native parity, or performance evidence unless a reference game proves otherwise.

## The vanilla crossover benchmark

The current sweep compares a single build. That under-measures the thesis, which is about the
*second* month, not the first hour. Execute both arms from clean directories through the same
sequence:

1. First playable game.
2. Physics and multiple entity types.
3. Death, restart, persistence, another scene.
4. Controller and mobile input.
5. Introduce and detect a seeded regression.
6. Increase world/entity/asset scale.
7. Build web and native targets.
8. Make a late architectural change.
9. Ship and reproduce a release artifact.

Measure at each step: elapsed implementation and debugging time; authored LOC and dependencies;
platform branches and escape hatches; defects introduced, auto-detected, and found by hand;
frame-time percentiles, memory, load time, build size; restart stability; visual quality across
states; evidence quality; and **time required for the next change**, not only the initial build.

A clear win means ThreeNative may trail at step one but overtakes as real-game requirements arrive,
then keeps the lead without sacrificing visual freedom or forcing framework escapes.

## Release gates for the "clear winner" claim

Do not claim ThreeNative is clearly better for production games until all are true:

- The packed-package golden path is green for every supported template and target.
- Verification fails closed, and negative fixtures prove it.
- Representative games demonstrate behavioural and visual parity across web and native.
- Performance budgets and regression attribution run continuously.
- The asset MCP completes a licensed, optimised, target-valid import flow.
- Templates pass both technical and player-facing gates.
- At least one **executed** vanilla crossover benchmark shows where and why the lead is taken.
- A substantial game survives repeated feature changes, restarts, upgrades, and release packaging
  without framework-owned instability.

## Non-goals

- Do not optimise for winning a ten-minute toy benchmark.
- Do not claim visual superiority merely because the framework hosts Three.js rendering.
- Do not reward abstraction count, framework imports, or reach rate.
- Do not hide unsupported native behaviour behind successful compilation.
- Do not allow green reports with unexplained diagnostics.
- Do not add wrappers where ordinary Three.js is already the simpler, portable, game-owned answer.

## Smaller findings not yet acted on

- The starter ships **two** HUD systems: `src/render/hud.ts` (instanced glyphs in the 3D scene) and
  `src/ui/Hud.tsx` (React). Both rounds deleted the 3D one.
- **The starter's default bloom may be too strong — one more data point before changing it.**
  `templates/starter/src/render/postprocessing.ts` ships `bloom(colour, 0.7, 0.5, 0.2)`, the
  second-highest of the seven templates. Two independent builders, in separate sandboxes, hit the
  identical failure and both turned it down: round 5 got "a white hole where the goal pad should
  be" at `emissiveIntensity: 2.4`, and round 6 reported "emissive props blow out to white (my first
  goal pad and phase crate both read as white blobs)", retuning to `0.32/0.55/0.75`.

  This is the one legitimate "visuals by default" lever the project has: the framework never owns
  the look, but the scaffold sets the frame-one floor, and a template is generated user source, so
  tuning it there breaks no rule. **Deliberately not changed yet.** Both builders were doing the
  same genre with a glowing goal pad, and nobody has rendered the starter at 0.7 against a lower
  value to compare — changing a visual default from two text reports is the exact move this
  document's verification section argues against. If a third independent build turns the same knob
  down, treat it as decided and lower it.
- `RigidBody3D` requires an `Object3D` even for a collider-only static body, so a decorated wall
  group needs an empty anchor. Five lines of boilerplate per wall.
- PRD-109's determinism is opt-in because freeing the world leaves a retained `body.raw` reading
  freed memory — `plugin.spec.ts` caught it as `null pointer passed to rust`. The real fix is
  invalidating handles on dispose across `handles.ts`, `simulation.ts` and `native/host.ts`, which
  would let determinism become the default.
- An open engine question, deliberately not guessed at: round 5 measured that its `Area3D` never
  reported the `CharacterBody3D`, yet the platformer template's `Pickup` fires with a
  `CharacterBody3D` player and its `collect` playtest passes. `areaIntersections` uses
  `world.intersectionsWithShape`, which bypasses Rapier's `ActiveCollisionTypes`, so the obvious
  kinematic-pair explanation is wrong — and the platformer's handler takes no body argument, so its
  passing test does not prove the player is what entered. Needs a targeted experiment.

## Execution order

1. Reproduce the two unverified claims above (green-with-errors; `TN_CONFIG_TRANSPILER_MISSING`).
2. Fix the scaffold's proof hook so a real game keeps it.
3. Run one paired round, including the vanilla arm.
4. Decide the sealed-brief naming contract.
5. Land the native side of PRD-108 and handle invalidation for PRD-109.
6. Clean-package CI matrix and negative verification fixtures.
7. Performance budgets and lifecycle leak detection.
8. Raise template presentation quality.
9. Execute the staged crossover benchmark and publish the evidence, including the losses.
