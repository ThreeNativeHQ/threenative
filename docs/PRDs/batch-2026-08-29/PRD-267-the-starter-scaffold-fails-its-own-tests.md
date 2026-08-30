---
prd_contract: v1
---

# PRD-267 — the starter scaffold fails its own tests

**Status:** PROPOSED — filed 2026-08-30 from `golden-path`, the last red job in CI.

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

## Why it was invisible

Three gates should have caught it and none could. CI had never completed a run, so `golden-path`
never executed. `pnpm test:templates` aborts at the first failing template, and the shooter fails
before the starter is reached — so the default template is never tested. And **A2 on the alpha bar
passes against `create-threenative@0.2.2`**, whose templates predate the menu.

The alpha bar's golden-path row is green for a version of the scaffold nobody is shipping.

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

- [ ] A freshly scaffolded starter passes `npm test` with no edits, and the run names the adapter
      it used.
- [ ] `pnpm test:templates` does not abort at the first failing template — every template reports,
      so the default one can never be silently untested again.
- [ ] `golden-path` is green on CI.
- [ ] The same audit is run against every other template, and the count of scenarios that assume
      they start in play is recorded per template rather than assumed to be zero.
- [ ] A2's evidence is re-taken against the version actually being shipped, not `0.2.2`.
