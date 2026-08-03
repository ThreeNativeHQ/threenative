# AGENTS.md — examples

Read `/AGENTS.md` first. This file only covers what is different here.

## `abyss-vanilla/` is a frozen control

It is the benchmark's vanilla arm: a real game in plain `three/webgpu`. **Do not edit it**
to fix a comparison, tidy the code, or match a framework change. Changing the control
invalidates every result measured against it, and `CHARTER.md` §3 makes that comparison the
kill switch for the whole framework.

It is excluded from Biome for the same reason. If it genuinely must change, that is a
benchmark decision — see `docs/benchmark/PROTOCOL.md` — and the sealed prompt hash and
dated results have to be re-derived.

## `abyss-framework/` is the framework arm

The same game, ported. It must stay honest: ordinary Three.js in the scene code, visual
setup in `src/render/`, no shortcuts the framework's users would not have.

If the framework arm ends up longer than the vanilla arm, that is a real result, not a bug
to hide. The README table publishes both columns and CI recomputes them.

## `platformer/` is the reference build

`REFERENCE.png` in this folder is the target: floating grass islands, a plank bridge, coins
on arcs, patrolling mushrooms, a `?` crate, hearts, a coin counter, a timer and a gem
count. It is the proof subject for PRD-009 (character, animation, follow camera, platform
carry) and PRD-010 (level from data, collectibles, enemies, HUD).

Rules that are easy to break here:

- **The level is a plain array**, `src/levels/level-1.ts`, consumed by `spawn()`. It is not
  a scene format and it never becomes one — `CHARTER.md` §2 closed that question. `spawn()`
  throws on an unknown prefab kind; a typo must stop the run, not silently drop a platform.
- **Feel constants live in the entity**, not in a package. Jump height, coyote time, dash
  distance and cooldown are gameplay, and gameplay is the user's agent's job.
- **Everything a screenshot shows is in `src/render/` and `src/ui/`.**

Its seven scenarios in `playtest/` are wired into `pnpm test:playtest`. They are written to
survive a variable frame rate: the fixed-step bridge advances ticks while the page's own
rAF loop keeps running, so a scenario gets *more* simulated time than it asks for. Assert
minima, or pin the fox against geometry (the crate at x=18.4, the ferry's far end) — never
a position that only holds at one exact tick.

## The LOC table is generated

`pnpm tsx scripts/count-loc.ts` regenerates the block between the `benchmark:loc` markers
in the root README. CI runs the same classifier with `--check`, so hand-edited numbers fail
the build. Never write those numbers by hand.

Plumbing versus game classification is the classifier's call, not yours — if a line lands in
the wrong bucket, fix the classifier and say so.

## Running

```sh
pnpm --filter abyss-framework dev
pnpm --filter abyss-vanilla dev
pnpm --filter platformer dev
pnpm test:browser                  # Playwright, boots abyss-vanilla on :4173
```

Examples are excluded from the root vitest run and from the framework LOC budget. Browser
proof goes through Playwright or a playtest scenario.
