---
prd_contract: v1
---

# PRD-176 — The abyss navigation scenario's navigator never moves, and no default gate runs the scenario

**Status:** COMPLETE, 2026-08-22. Cause named at `file:line` (game/harness side: the scenario was
driven at the wrong entry point, then two later harness guards fire on the scene it did load; the
engine suspect was checked and rejected), green under the standard web recipe, both scenario lines
mutation-proved, scenario wired into root `test:playtest` with the full chain green, and scoped
typecheck/lint clean on the changed files. Evidence appended to
[navigation-red-at-head-2026-08-22](../../verification/navigation-red-at-head-2026-08-22.md);
the full-workspace `pnpm test` suite runs at wave integration (coordinator gate).

**Outcome:** `examples/abyss-framework/playtests/navigation.playtest.json` exits `0` under the
standard web recipe (`--browser-recipe webgpu --headed`) — the navigator routes around the blocker,
reaches `[0, 0.75, 0]`, and is visible — and the scenario joins the default playtest chain so it can
never go red invisibly again.

## 1. What was observed

Exit `1`, `"pass": false`, twice, identical rows (full command and JSON in the reproduction record):

| Assertion | Pass | Details |
| --- | --- | --- |
| `diagnostics` | true | 0 console errors, 0 network errors |
| `movement.pathLength` | **false** | `pathLength: 0`, required `minimum: 9` |
| `movement.reachesPosition` | **false** | `closestDistance: null`, target `[0, 0.75, 0] ± 0.7` |
| `visibility.navigator` | **false** | below `minProjectedPixels: 100` |

212 frames ran; the scene loads clean. The navigator accumulates no movement at all.
`closestDistance: null` says not one sample was ever recorded near the target — consistent with the
navigation driver never producing a route or never driving the entity, and inconsistent with a route
that overshoots or stalls partway.

## 2. The second defect is the coverage hole

Root `test:playtest` runs `moves.json`, `camera.json` and `movement-axis.playtest.json`
against abyss-framework. It does not run `navigation.playtest.json`. A scenario outside the default
chain goes red and stays red — this one demonstrably did, across multiple sessions. Whatever fixes
the movement must also wire the scenario into that chain in the same commit, or the next regression
hides exactly this way.

## 3. Layer attribution is part of the job

Root AGENTS.md rule 2: say the layer before fixing. The observed evidence — clean load, zero
movement — is consistent with both an engine-side defect (`packages/physics/src/` navigation or its
harness contract) and a game-side break (`examples/abyss-framework/src/` stopped driving it). The
diagnosis names one of them at a `file:line` before any repair lands.

## 4. Acceptance criteria

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | The cause is named at a `file:line`, with its layer (engine or game) stated | pasted diagnosis naming both |
| 2 | `navigation.playtest.json` exits `0` under the standard web recipe | pasted green output |
| 3 | Red-green mutation: reverting the fix's named line makes criterion 2 red again | pasted red from that revert |
| 4 | The scenario is in the default playtest chain and passes there | pasted `test:playtest` output including the navigation row |
| 5 | `pnpm typecheck && pnpm lint && pnpm test` green | pasted output |

Criterion 3 exists because five repair rounds in one historical batch were spent on reds produced by
the wrong thing failing (`docs/PRDs/AGENTS.md`): state which line, reverted, reproduces §1's red,
and paste it before calling the fix done.

## 5. Deliberately out of scope

- Native-target proof for navigation beyond what existing conformance rows already cover — this
  defect is filed from the web lane and stays there unless diagnosis proves it crosses runtimes.
- The SwiftShader headless console errors noted in the reproduction record — separate observation,
  explicitly not attributed here.
