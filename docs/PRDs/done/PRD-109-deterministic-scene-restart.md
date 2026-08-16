---
prd_contract: v1
---

# PRD-109 — A restarted scene can reproduce its predecessor, and the fixed-step knob is findable

**Status: DONE, written and executed 2026-08-14.** Gates in §4.

**Complexity: 3 → SMALL mode.** One opt-in option, one doc fix, three files.

---

## 1. Context

**Problem A — a restarted scene never reproduced its predecessor, and no API could fix it.**
The physics-puzzle brief requires running the same input sequence twice with a fixed seed and a
fixed step and exposing whether the final state matched. Round 6's sandbox build could not get a
match and had no lever to pull: `rapier()` accepted only `{ gravity }`.

Measured in that build, with an identical authored layout, fixed 1/60 step and a scripted input
table:

```
TN_REPLAY_SETTLED:a2f87bad,ticks=240      TN_REPLAY_SETTLED:658eb6f8,ticks=266
TN_DETERMINISM_MATCH:false
```

The *settle* hashes differ and the settle takes a different number of ticks, so divergence happens
during the initial drop, before any input. The builder reported it honestly in the HUD rather than
quantising until it matched, and recorded it as the round's first blocking API gap.

Root cause, confirmed here rather than inferred: `sceneExit` disposed the scene's bodies and areas
but kept the same backend world. A Rapier `World` carries solver, island-manager and broad-phase
state from everything that has already run, so the second scene's identical drop starts from a
different internal configuration. `packages/physics/__tests__/scene-restart-determinism.spec.ts`
reproduces exactly this as its control.

**Problem B — the fixed-step knob was undiscoverable.** `IGameConfig.step` was a bare
`readonly step?: number` with no doc comment, and the scaffold never sets it. Round 6's builder
wrote its own fixed-step accumulator inside the scene frame callback before finding it, which ran
up to five character updates per already-fixed step and decoupled the character from the
simulation. Its own words: *"One doc line on `step` would have saved the largest wrong turn in this
build."*

**Files analyzed.**

- `packages/physics/src/plugin.ts` — `IPhysicsOptions`, `setup`, `sceneExit`
- `packages/core/src/game.ts:118-140` — `IGameConfig.step` and `maxSteps`
- `packages/physics/__tests__/plugin.spec.ts:129-144` — the test that caught the hazard below

## 2. What changed

`rapier({ deterministicRestart: true })` gives each scene a pristine simulation: `sceneExit`
disposes the bodies as before, then disposes the world and rebuilds the physics context. The
context construction moved into a `buildContext` factory so setup and scene exit produce the same
shape.

`IGameConfig.step` and `maxSteps` gained doc comments, including an explicit instruction not to
write an accumulator on top of `step` and why.

**Why the option is opt-in rather than the default.** The first version made it unconditional and
`plugin.spec.ts`'s "releases scene physics on sceneExit" went red with `null pointer passed to
rust`: freeing the world leaves any retained `body.raw` pointing at freed WASM memory, so a stale
reference faults hard instead of returning `false`. Those references are already documented as
non-portable and a scene that has exited has disposed its bodies, but converting a quiet `false`
into a backend fault is not something to inherit silently. The test was **not** weakened to
accommodate the change; the change was made opt-in so the default contract it guards still holds.

Closing this properly — invalidating handles on dispose so a stale `raw` reads `undefined` rather
than freed memory — is a larger change across `handles.ts`, `simulation.ts` and the native host,
and is not attempted here.

`deterministicRestart` is an invented name. Godot has no equivalent, and neither Rapier nor
Three.js names this concept, so the vocabulary rule's fallback order is exhausted.

## 3. Criteria

| # | Criterion | Met? |
| --- | --- | --- |
| 1 | With the option on, three consecutive scene restarts settle to the same pose hash | yes |
| 2 | With the option off, the same layout diverges — proving criterion 1 is not vacuous | yes |
| 3 | Default behaviour is unchanged, and the existing sceneExit contract test still passes unmodified | yes |
| 4 | `step` and `maxSteps` document what they are and the accumulator trap | yes |
| 5 | Repository gates stay green | yes |

Criterion 2 is the one that makes this honest. A determinism test that hashes something which never
varied would pass against a broken engine.

## 4. Evidence

| Gate | Command | Result |
| --- | --- | --- |
| New tests | `pnpm exec vitest run packages/physics/__tests__/scene-restart-determinism.spec.ts` | pass — 2 tests |
| Contract preserved | `pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts` | pass — 8 tests, unmodified |
| Typecheck | `pnpm typecheck` | pass — 0 errors |
| Lint | `pnpm lint` | pass — exit 0 |
| Test | `pnpm test` | pass — 1124 passed, 32 skipped, 134 files |
| Budgets | `pnpm budgets` | pass — 14741/15000 framework LOC |

## 5. What this does not do

- **It does not make `raw` safe across a scene change.** That is the reason the option is opt-in,
  and it is the follow-up this PRD deliberately leaves open.
- **It does not prove cross-run determinism beyond a scene restart.** The existing
  `determinism.spec.ts` still bounds the claim to one machine and one pinned runtime; nothing here
  extends it to another browser, OS or Rapier version.
- It does not set the option in any template. Whether the starter should default to it is a
  template decision, and no build has yet asked for it.
