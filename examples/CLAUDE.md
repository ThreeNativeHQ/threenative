<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — examples

Read `/AGENTS.md` first. This file covers only what is different here.

Examples are excluded from the root vitest run and from the framework LOC budget. Browser
proof goes through Playwright or a playtest scenario.

## `abyss-vanilla/` is a frozen control

The benchmark's vanilla arm: a real game in plain `three/webgpu`. **Do not edit it** to fix a
comparison, tidy the code, or match a framework change. Changing the control invalidates
every result measured against it, and `CHARTER.md` §3 makes that comparison the kill switch
for the whole framework. It is excluded from Biome for the same reason.

If it genuinely must change, that is a benchmark decision — see `docs/benchmark/PROTOCOL.md` —
and the sealed prompt hash and dated results have to be re-derived.

## `abyss-framework/` is the framework arm

The same game, ported. It must stay honest: ordinary Three.js in the scene code, visual setup
in `src/render/`, no shortcuts the framework's users would not have.

If the framework arm ends up longer than the vanilla arm, that is a real result, not a bug to
hide. The README table publishes both columns and CI recomputes them.

## `native-smoke/` is the native bundle contract

The smallest game that must run on the native host, and the gate that catches a web-only
change. `scripts/verify-bundle.mjs` asserts the build is **one ESM file named
`native-smoke.js` with no `import` and no dynamic `import()`** — code splitting stays
disabled — and that the frame markers are present.

It depends on `@threenative/core`, `@threenative/physics` and `three`, and never on
`@threenative/ui`. `playtests/` holds device scenarios plus the deliberately-failing negative
controls (`-misspelled`, `-wrong-value`) that prove the device path fails closed. Run
`pnpm --filter threenative-native-smoke test` after any change to core or physics.

## `REFERENCE.png` is a scoring target, not a spec

A look-and-feel bar to build *some* game against and score honestly. It is not the framework's
subject matter: nothing in `packages/` may name or accommodate what is in that image. A
framework tuned to one screenshot proves nothing.

## The LOC table is generated

`pnpm tsx scripts/count-loc.ts` regenerates the block between the `benchmark:loc` markers in
the root README. CI runs the same classifier with `--check`, so hand-edited numbers fail the
build. Never write those numbers by hand.

Plumbing versus game classification is the classifier's call, not yours — if a line lands in
the wrong bucket, fix the classifier and say so.

## Running

```sh
pnpm --filter abyss-framework dev
pnpm --filter abyss-vanilla dev
pnpm --filter platformer dev
pnpm --filter threenative-native-smoke test   # native bundle contract
pnpm test:browser                             # Playwright, boots abyss-vanilla on :4173
```
