---
prd_contract: v1
---

# PRD-267 — the starter scaffold fails its own tests

**Status:** PARTIAL — filed 2026-08-30 from `golden-path`, the last red job in CI. **Mostly fixed**
in `6e327a7f`: eighteen scenarios gained the menu-entry steps they had been missing, and the run
went from **40 failures across seven kinds to one scenario's movement assertion**. What remains is
§2, below — a harness limitation the menu exposed.

**Goal: a stranger who scaffolds a project and runs `npm test` sees it pass.**
Today they see a wall of failures, and they see it on the default template.

## The measurement

`golden-path` scaffolds a starter from workspace tarballs and runs the project's own playtests. It
fails. Reproduced locally against a scaffolded starter on an RTX 2080 with a real display, so this
is not CI's rasteriser:

```text
     19 TN_PLAYTEST_RESOURCE_ASSERTION_FAILED
     11 TN_PLAYTEST_VISIBILITY_FAILED
      4 TN_PLAYTEST_MOVEMENT_ASSERTION_FAILED
      3 TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED
      1 TN_PLAYTEST_AXIS_DELTA_ASSERTION_FAILED
      1 TN_PLAYTEST_PATH_LENGTH_ASSERTION_FAILED
      1 TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED
```

with messages of the form *"Observed resource value did not change during the scenario"*. Nothing
moves, nothing scores, and the goal flag is not on screen.

Run with and without `--no-screenshots`: **identical counts**, so the flag added for golden-path is
not the cause and is exonerated by control rather than by argument.

## The cause

The starter boots to its main menu — `start: "menu"` in `game.ts`, with a name field and a `begin`
submit. **Three of its twenty-one scenarios press that button**; `zoom-pinch`, `zoom-wheel` and
`menu-flow` carry a `start-game` step. The other eighteen open the game and immediately press
`ArrowRight`, expecting a player that does not exist yet:

```json
{ "kind": "input", "label": "run-up", "press": "ArrowRight", "holdTicks": 205, "release": false }
```

The repository's own `playtests/starter-look.playtest.json` shows what the others are missing — it
waits for the menu, clicks the name field, types a name, and clicks start before doing anything
else — and it passes.

This is the same defect that broke the hot-reload proof
([PRD-266](./PRD-266-the-hot-reload-proof-and-the-browser-lane-run-anywhere.md) §1's neighbour): the
menu screen flow landed in [PRD-218](../done/batch-2026-08-24-menu-screen-flow/PRD-218-scene-screens-and-menu-flow.md),
three scenarios were updated, and the rest were not.

## What the per-scenario summary bought

The batch runner printed one JSON document at the end, and CI's log viewer truncated it — a failing
run showed `"pass": false` with only the first scenario readable, and that scenario had passed. The
runner now writes a line per scenario as it finishes, and the next run named the failure
immediately:

```text
{"scenarioSummary":{"diagnostics":["TN_PLAYTEST_PERFORMANCE_ASSERTION_FAILED"],
 "failed":["performance.maxFrameMsP95"],"pass":false,"scenario":"play"}}
```

That one line replaced a whole diagnostic cycle, and it is what turned "golden-path is red" into
"fifteen of sixteen pass and the sixteenth wants 30fps from a machine with no GPU".

## §3 — `platformer-stomp`, the last red

What is measured, on a scaffolded platformer:

- **It passes on hardware.** `stomp.playtest.json` run headed against an RTX 2080 exits `0`.
- **It fails on CI**, whose runner has no GPU, on `resource.state.defeated` (stagnated) and
  `tags.patrol`.
- **It is not the menu.** This template boots to `boot`, not to a menu with a form, so the cause
  that explained the starter's eighteen scenarios does not apply.
- **It is not the level failing to load.** `tags.patrol` was *evaluated* and disagreed, which means
  patrol entities existed to be counted. A level that never arrived would have failed differently.

So the level loads, the player runs, and the stomp does not land — only on the rasteriser. The
scenario holds `ArrowRight`+`Space` for 42 ticks and settles for 45, and ticks are meant to be
deterministic regardless of frame rate, which is what makes this worth understanding rather than
padding: **if a fixed-step scenario can change outcome with frame rate, that is a harness or
engine property worth knowing about, not a slow machine.**

Reproducing it locally needs a GPU-less Chromium under a display; running headless locally reaches
SwiftShader but drowns in backend console noise instead, so it is not the same condition. The next
step is to run this one scenario on CI with the frame budget and substep counts printed, and see
whether the physics stepped the same number of times as it does on hardware.

Do not fix it by lengthening the waits until that is known.

## Why it was invisible

Three gates should have caught it and none could. CI had never completed a run, so `golden-path`
never executed. `pnpm test:templates` aborts at the first failing template, and the shooter fails
before the starter is reached — so the default template is never tested. And **A2 on the alpha bar
passes against `create-threenative@0.2.2`**, whose templates predate the menu.

The alpha bar's golden-path row is green for a version of the scaffold nobody is shipping.

## What is left: movement measured across a run that starts before the player exists

`starter-assets` is the one scenario still red, on `movement.minDistance`. Its state proves the
player moved — `playerX` goes `-2` to `6.999`, `status` reaches `won` — while the movement
assertion reports nothing:

```text
Entity 'player' was not observed in both samples, so its movement was never measured —
the run reports no distance rather than a distance of zero.
```

That message is new, and it is the second fix in `6e327a7f`: `distance` falls back to `0` when the
entity is missing from a snapshot, and `minDistance` used to read that fallback as a measurement,
reporting `moved 0.000000` for a player who was never there. `maxDistance` already refused to,
with a comment explaining exactly this hazard. Now both refuse, and the message says which of the
two happened.

The underlying limitation: a **named** movement entity is measured between the run's first and last
snapshot, and the first is taken after warmup — on the menu, where there is no player. Per-step
sampling exists but only for *anonymous* movement scenarios, and dropping `entity` does not help
either, because those samples still span the menu steps.

Three ways out, none of them "delete the assertion":

1. **Measure a named entity from its first observation to its last.** The plain reading of "the
   player moved at least 0.5 during this run", and it needs the runner to sample a named entity
   per step the way it already does for anonymous ones.
2. **Let a scenario scope movement to a step interval** — `movement.from`/`movement.to` by label,
   next to the labels `atSteps` already uses.
3. **Warm up into the game**, so the first snapshot is taken after the menu. Smallest change,
   and it makes every scenario's first sample mean something different depending on its steps.

## The decision this PRD has to make

Not *whether* to fix it, but how a scenario should reach the play scene:

1. **Every scenario clicks through the menu**, as `starter-look` does. Honest, and eighteen files
   repeat five steps that have nothing to do with what each one proves.
2. **A scenario declares the scene it starts in** — a `setup.scene` beside the existing
   `setup.spawn` and `setup.aim`. One line per scenario, and the harness owns the transition. Does
   not prove the menu works, which is what `menu-flow` is for.
3. **The template's scenarios are rewritten around the menu** as a real part of the game.

Option 2 is the smallest change per scenario and the one that scales to every template that grows a
menu. It is also new harness surface, which is why this is a decision and not a patch.

## Acceptance criteria

- [x] A freshly scaffolded starter passes its non-visual scenarios with no edits — 14 of 14 on CI
      and exit 0 cold on a developer machine. The seven left out are the ones that need hardware:
      screenshots, baselines, a `visual` assertion, or a frame-time budget.
- [ ] The **platformer** finishes too. It is one scenario short — `platformer-stomp` — and what is
      known about it is in §3 below.
- [ ] `pnpm test:templates` does not abort at the first failing template — every template reports,
      so the default one can never be silently untested again.
- [ ] `golden-path` is green on CI.
- [ ] The same audit is run against every other template, and the count of scenarios that assume
      they start in play is recorded per template rather than assumed to be zero.
- [ ] A2's evidence is re-taken against the version actually being shipped, not `0.2.2`.
