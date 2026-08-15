# Build-experience score — physics-puzzle, framework arm, round 6 — 2026-08-14

Scored from an executed build: "Vault of Crates", built by a fresh subagent in a bare sandbox
with ThreeNative installed from tarballs carrying PRD-107 and PRD-108. Archived at
`docs/benchmark/sweeps/physics-puzzle-2026-08-15-2`; friction log travels with it.

**Not comparable to the 68/100 of 2026-08-14 round 5.** That score used a six-axis rubric with
different weights and no rendered-visual or abstraction-leverage axis. This is a seven-axis score.

Functional-column numbers recorded before the PRD-113 sealed proof contract are not comparable with numbers recorded after the revised proof hash. Superseded proof hash: `c241ea5e4120afd4a50325a5b9ee0606e81e1b9d8539896f2b6e9f6b8f85da0d`; revised proof hash: `d8e90936be7bec4046af766b108fdd7b1dcb92aad3d1e87e4c72b2de40d592f3`.
**Framework: 63/100. Vanilla (estimate): 58/100 — superseded by PRD-114 round-7 measurement.**
The round-6 vanilla number was a counterfactual, not an executed arm. Round 7 measured the
vanilla archive's authored cost and proof result; its functional result remains unmeasured as a
fair comparison because the vanilla arm stopped at the `runtime.world` capability preflight.
Verdict: the framework now wins on plumbing and abstraction fit rather than on its harness, and it
loses most of its margin to a visual gap and a proof capability the builder walked past.

| Axis (weight) | Framework | Vanilla (est.) | Why |
|---|---|---|---|
| Setup → first frame (10) | 10 | 7 | `./scaffold.sh cratefall` first try ~3 s, no manifest hand-edit; `pnpm typecheck` clean on the untouched scaffold and on all ~8 later runs; `pnpm dev` ready in 313 ms; `npx vite build` exit 0 in 502 ms; first capture (call #26) was already a correct lit frame. Vanilla wires vite/three/rapier itself. |
| Rendered visual quality (20) | 10 | 10 | Four states inspected against `reference.png`. Composition and the warm-left/cool-right lighting split match; palette family matches. Materially behind: crates render as bright thin frames over flat panels, not solid matte painted wood with plank grooves, and the room lacks the reference's banners, lantern housings and stone trim. Defects: the character is occluded/clipping inside the crate stack in `15-hero.png` and `narrow.png`; a stray double-edge artifact on the left crate in `15-hero.png`; at 900×600 the bottom hint bar overlaps the control text. Estimate for vanilla is the same competent hand — **especially uncertain**, since the framework does not own the look. |
| Abstraction leverage and fit (15) | 11 | 8 | Audit below. Zero physics escape hatches and two measured workaround removals, against one framework-owned capability routed around. |
| Gameplay plumbing (15) | 10 | 11 | Fixed-step loop, declarative input, state+React bridge, and `goto("play")` restart with a **measured zero body leak** (`worldBodies=39` across three consecutive restarts). Against that: physics does not reproduce across scene reloads and the game cannot fix it — `rapier()` exposes only `{ gravity }`, with no world reset or step seam. Settle hashes `a2f87bad` vs `658eb6f8` at 240 vs 266 ticks, so divergence precedes the scripted input. The brief explicitly required deterministic replay, so vanilla driving Rapier directly scores higher here. |
| Proving it works (20) | 9 | 7 | Two real mistakes caught by the builder's own instruments: a redundant fixed-step accumulator that decoupled the character from the simulation, and a settle gate that fired at tick 1 because bodies report zero velocity on the tick they are created. Determinism reported honestly negative rather than quantised until green. But there is no fail-closed harness: assertions are HUD counters read from the DOM, self-graded, run once by their author. All 10 generated scenarios were deleted and none written, and only one entity is registered, so the sealed proof scored **0/10** and could not observe the player at all (`rawDelta: null`). |
| Iteration speed (10) | 8 | 8 | Edit → screenshot was one command at ~25 s wall clock, most of it a requested 8 s settle wait; every capture a fresh page load, so no stale bundle was ever observed, and HUD counters tracked the pixels. Headless renders this scene black; headed Chromium under xvfb was correct on the first attempt. Same vite and same browser on both sides. |
| Cognitive load (10) | 5 | 7 | Read before writing: brief, reference, 7 generated `src` files, four `.d.ts` regions — genuinely small, and Godot vocabulary made `moveAndSlide`, `grounded`, `bodyEntered`, `monitoring`, `teleport` guessable. Deleted 607 of the starter's 1117 lines against 938 authored, so neither zero anchor is hit. Three contracts were learnable only by failure or instrumentation, the worst being where fixed-step lives: `step` is a bare `readonly step?: number` in `IGameConfig` with no doc comment and the scaffold never sets it. The builder calls that "the largest wrong turn in this build". |
| **Total** | **63** | **58** | |

Visual artifacts: `/home/joao/projects/threenative-sandbox/cratefall/shots/{01,06-push,15-hero,narrow}.png`,
reference `/home/joao/projects/threenative-sandbox/reference.png`. States inspected: opening/idle
(stack intact, 36/37 at rest), active gameplay (GOAL LIT, PUSHED 2), final (PUSHED 3), plus a
900×600 viewport. No blind visual critic was run this round; the lead inspected the captures and
confirmed none is a capture failure.

## Abstraction audit

**Used well.** `defineGame` for bootstrap and lifecycle; `step: 1/60, maxSteps: 5`
(`src/game.ts:18-19`) adopted *after deleting a hand-written accumulator*, a measured workaround
removal; `CharacterBody3D` with `pushesDynamicBodies: true` (`src/entities/Player.ts:67`) — the
entire push premise of the game in one option, where round 5's build spent roughly 90 lines on an
invisible kinematic paddle, a third collision layer and a load limiter; `RigidBody3D` with
collision layers for the pass-through class (`src/layers.ts`) with no sensor hackery and no
per-frame branch; `Area3D` + `bodyEntered` so the win is a simulated contact; `directSpaceState.intersectShape`
for real overlap counters instead of the distance check the brief forbids; `RigidBody3D.linearVelocity`
(`src/scenes/Play.ts:275,291`); `goto("play")` + `state.flush()` restart.

**Escape hatches: none that matter.** No `@dimforge` import and no `.raw` on any physics body —
every physics requirement in the brief was met through the portable API, so nothing here forks
web from native. `renderer.raw` appears twice (`src/scenes/Play.ts:80`,
`src/render/postprocessing.ts:12`) for lighting and tonemapping, which is game-owned rendering and
not a portability concern.

**Missed leverage.** The proof hook. `playtest()` sits in the plugin list, but all ten generated
scenarios were deleted, none was written, and only `entity: "goal"` is registered
(`src/scenes/Play.ts:181`). The framework's harness therefore observes almost nothing, and the
build fell back to reading HUD text out of the DOM. This is the single largest unrealised value in
the run and it costs both axis 3 and axis 5.

**Over-abstraction: none found.** The builder deleted the scaffold's 3D HUD and `pick.ts` rather
than wrapping them, and added no wrapper that fails to change cost, correctness, portability,
iteration or evidence.

## Diagnostics

Without proof (axis 5): framework **54**, vanilla **51**.
Without abstraction leverage (axis 3): framework **52**, vanilla **50**.

**The framework now wins without the proof axis**, which it did not on the previous run. What
carries it is axis 3 plus setup: a correct boundary with zero physics escape hatches, and two
workarounds that measurably stopped being written. The margin is small either way, and it survives
removing either diagnostic axis — so no single axis is propping up the total.

## Acted on after this score

Two of the gaps this score measured were closed the same day, under PRD-109. **The 63 is not
adjusted for them** — a score may not be carried across a framework change, so axes 4 and 7 are now
stale on the current tree and only the next build re-measures them.

- **Determinism (axis 4).** Root cause proven, not inferred: `sceneExit` disposed the scene's
  bodies but kept the same backend world, whose solver and broad-phase state made an identical
  authored layout settle differently. `rapier({ deterministicRestart: true })` now gives each scene
  a pristine simulation; three consecutive restarts settle to one hash, with a control proving the
  default still diverges.
- **`step` discoverability (axis 7).** `IGameConfig.step` and `maxSteps` now carry doc comments,
  including why not to write an accumulator on top — the builder's single largest wrong turn.

The visual defects in axis 2 were **not** touched, and should not be: crate materials, character
placement and HUD layout are game-owned source, and the framework never owns the look.

## Two caveats

- **No native target, assets, save/load or hot reload was exercised**, and this is one genre at
  938 authored lines. PRD-108's actuation is web-proved and native-guarded, not native-proved.
- **The sealed proof scored 0/10 for reasons that are not about this game.** It pins entity ids and
  `world.seed = 6132` that the brief never states, and the arm firewall forbids the builder from
  reading it. Round 5 scored 2/10 on the same proof only because it happened to bind ArrowRight and
  register an entity named `player`. That column is measuring naming luck, not quality, until the
  brief and proof are reconciled.
