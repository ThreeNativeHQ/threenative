# Build-experience score — physics-puzzle, framework arm — 2026-08-14

Scored from an executed build: `crate-vault`, built by a fresh subagent in a bare sandbox with
ThreeNative installed from tarballs, archived at `docs/benchmark/sweeps/physics-puzzle-2026-08-15`
with its friction log. Round ledger: `round-5-2026-08-14.md`.

**Framework: 68/100. Vanilla (estimate): 66/100.**

> **Axis 3 of this score is stale as of the same day.** PRD-108 landed `RigidBody3D.applyImpulse`,
> `applyForce`, `linearVelocity` and `CharacterBody3D.pushesDynamicBodies`, which remove the two
> defects that produced the 7/20 — the ~90 lines of paddle, layer and load-limiter workaround
> would not be written against the current framework. **The number is not adjusted here.** A score
> may not be carried across a framework change; the next sandbox build re-measures it, and until
> then the honest reading of axis 3 is "unmeasured on the current tree", not a higher figure.

| Axis (weight) | Framework | Vanilla (est.) | Why |
|---|---|---|---|
| Setup → first frame (15) | 15 | 11 | `./scaffold.sh crate-vault` worked first try in 43.3 s with no hand-edits; `tsc --noEmit` clean on the untouched scaffold; `pnpm dev` ready in 291 ms; first screenshot rendered first try. Vanilla wires vite, three and Rapier itself — known work, no scaffold. |
| Authoring the look (20) | 20 | 17 | Nothing in the framework participated: the builder rewrote `palette/materials/lighting/postprocessing`, added `room.ts` and `crate.ts`, deleted `camera.ts`/`hud.ts`/`particles.ts`, and set the camera on `ctx.camera` directly. "No option, config key or plugin ever tried to own a material, a light or the tonemapping." Near-tie by design; the framework's edge is only the generated `roundedBox()` and a three-line `setupPost()` bloom. |
| Gameplay plumbing (20) | 7 | 15 | `RigidBody3D` has exactly six public methods and none applies force, impulse or velocity; a transform write to a dynamic body is discarded on the next step (probe: +2.0 on x reverted within 600 ms). Pushing a crate — this genre's core verb — was hand-rolled as an invisible kinematic paddle plus a third collision layer plus a load limiter. Plain Rapier has `applyImpulse` and `applyImpulsesToDynamicBodies` for free; vanilla pays instead for the loop, input map and restart, which are cheap and known. |
| Proving it works (25) | 14 | 8 | The builder's own harness (`verify.mjs`, 14 assertions, fails closed) ran to exit 0 and caught four things it had got wrong — including a scatter crate landing on the goal pad, so the win could fire with no player involvement. But it deleted all 12 generated playtest scenarios and never used the bridge, so almost none of that evidence is framework-attributable. Vanilla writes ad-hoc checks and does not build a browser-driving fail-closed harness in an afternoon. |
| Iteration speed (10) | 8 | 8 | Vite HMR instant, no stale bundle observed, 35–50 s per edit → screenshot turn dominated by browser launch, and 30+ captures with no black frame. Same browser and bundler on both sides; the framework is not in this loop. |
| Cognitive load (10) | 4 | 7 | Five runtime contracts were learnable only by experiment, never from a type or a doc: `syncToPhysics` is a no-op for dynamic bodies, `Area3D` did not report the character body, physics is not fixed-step, scene-created bodies are not disposed, and a sub-frame key press is dropped. 500 of the starter's 1117 lines were deleted. Vanilla reads three.js and Rapier docs, which are mature and widely known. |
| **Total** | **68** | **66** | |

Swing test: without axis 4, framework **54**, vanilla **58**.

**The framework only wins with the proof axis included, and the margin is two points.** That is
the headline. Worse, inside axis 4 the framework's own harness was reached for and discarded: the
builder deleted every generated scenario and wrote plain Playwright instead, so the 14 points are
credited to a harness a vanilla arm could have written too. On this run the product's heaviest
claim did not carry itself — the scaffold's *existence* nudged the builder toward writing
assertions at all, and that nudge is most of what axis 4 measures here.

Axis 3 is where the framework loses outright, and it loses to plain Rapier on the one verb the
genre is named for.

## Two caveats

- **This run did not exercise assets, save/load, hot reload, or any native target**, and it is one
  genre at roughly 1,000 authored lines. A small game is the worst case for a framework: the
  scaffold's fixed cost is paid in full and its scale benefits never arrive.
- **n = 1, and the vanilla column was not run.** It is a judgement about work I know how to do,
  not a measurement. The one place it is likely to be generous to vanilla is axis 4; the one place
  it is likely to be harsh is axis 1.

## What the sealed proof separately reported

Not part of the score, but measured in the same run and worth reading beside it. The sealed proof
evaluated all ten of its assertions against this build for the first time in the loop's history —
every earlier round died before assertion evaluation on a broken archive (PRD-107). Two passed
(`movement.distance` 8.13 m, `movement.axisDelta` +x 8.13). Six of the eight failures are naming:
the proof pins entity ids and `world.seed = 6132` that the sealed brief never states, and the arm
firewall forbids the builder from reading the proof. Those assertions are unpassable by any blind
builder, which is an instrument decision the owner has to make rather than a fact about this game.
