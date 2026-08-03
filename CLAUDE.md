<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — ThreeNative

Instructions for any AI agent working in this repository. Nested `AGENTS.md` files add
package-specific rules; the closest one to the file you are editing wins.

**Every `CLAUDE.md` in this repo is generated.** It is the `AGENTS.md` beside it under a
generated banner, written by `scripts/sync-agent-docs.ts`. Edit `AGENTS.md`, then run
`pnpm sync:agents`. CI runs `--check` and fails on drift, so a hand-edited `CLAUDE.md` will
be reverted.

## What this is

An application framework for Three.js games. WebGPU by default, Godot-shaped conventions,
React/Tailwind for UI, vanilla `three` on every surface underneath. **The framework ships
the plumbing. The user's agent ships the gameplay.**

`DESIGN.md` is the only binding document. If anything here contradicts it, `DESIGN.md`
wins — say so instead of quietly following this file. `docs/README.md` maps the rest, and
labels which docs are proposals rather than commitments.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm typecheck                          # tsc across root + every package
pnpm lint                               # biome check . (add --write to fix)
pnpm test                               # package builds + vitest run
pnpm test:browser                       # playwright, examples/abyss-vanilla
pnpm budgets                            # §10 caps — fails CI when exceeded
pnpm sync:agents                        # regenerate CLAUDE.md mirrors (--check in CI)
pnpm tsx scripts/count-loc.ts           # regenerates the README LOC table
pnpm --filter abyss-framework dev       # run the framework example
```

CI runs typecheck → lint → test → scaffold smoke, in that order, and each gate blocks the
next. Run `pnpm typecheck && pnpm lint && pnpm test` before claiming a change is done.

## Rules that get a change rejected

These come from `DESIGN.md` §11 and from the 790k-line v1 that died of ignoring them.

1. **The 20-line rule.** If a competent developer could write it in under 20 lines, it does
   not go in the framework. Write it in the example or the template instead.
2. **The kill switch.** Any abstraction that costs more code than plain Three.js is
   deleted, however much work it took. `scripts/count-loc.ts` scores this in CI.
3. **Never own the look.** Materials, shaders, TSL, lighting, tonemapping, post-processing,
   camera framing — anything a screenshot shows — ships as generated source in the user's
   `src/render/`, never as package code or a `defineGame` option.
4. **Vocabulary is borrowed, never invented.** Godot for nodes (`RigidBody3D`, `Area3D`,
   `CharacterBody3D`, `CollisionShape3D`), Three.js for rendering, Rapier for physics,
   Tailwind for UI. A new name is a discovery cost for every model; that is what killed v1.
5. **A package exists only when it carries a dependency the others must not inherit.** Cap
   is 8 workspace packages, and it is not raised.
6. **Never claim a green gate you did not run.** Paste the failure instead.

## Budgets

`pnpm budgets` enforces: 8 workspace packages, 15,000 framework LOC (`packages/*/src`,
excluding salvage), **5,000 markdown lines repo-wide**, 10 files in `docs/PRDs/`.

Generated `CLAUDE.md` mirrors are excluded from the markdown count — they are one set of
instructions, not two documents. Everything else counts.

Exceeding a cap is never a reason to raise the cap. The markdown cap is the one you will
hit first — adding a doc spends budget PRDs also draw from. Delete before you add, and
prefer editing an existing doc to writing a new one.

## Layout

```
packages/core/                 loop, scenes, input, assets, renderer bootstrap, state, registry
packages/physics/             Rapier bindings — separate only because of the WASM dep
packages/ui/                  React bindings — separate only because of the React dep
packages/playtest/            salvaged scenario harness; runs on plain Three.js
packages/create-threenative/  scaffolder; templates/ is shipped to users
examples/abyss-vanilla/       FROZEN benchmark control — do not edit
examples/abyss-framework/     the framework arm of the same benchmark
docs/                         PRDs, verification, strategy, architecture, product
scripts/                      budgets, LOC classifier, blind scoring
```

## Code conventions

- TypeScript 5.9, `strict`, **ESM only**. Relative imports carry a `.js` extension even
  when the file on disk is `.ts` — `import { Play } from "./scenes/Play.js"`.
- Dependency versions come from the `catalog:` in `pnpm-workspace.yaml`, never a literal
  version in a package. Template `package.json` files are the exception: they ship real
  versions, and CI asserts no `catalog:` survives scaffolding.
- Formatting and lint are Biome (100 columns, spaces, organized imports). Do not hand-format.
- Unit tests live in `<package>/__tests__/*.spec.ts` and run under vitest in a node
  environment. `examples/**` is excluded — browser proof goes through Playwright or playtest.
- Every package's `test` script is its build plus `publint`, so a broken export map fails
  `pnpm test`.

## When you add a feature

1. Check `DESIGN.md` for whether it is on the "what it is not" list (§2). An IR, a scene
   format, an editor, a preset system, a code-first ECS, and a bespoke CLI vocabulary are
   all closed questions, decided against with evidence.
2. Check the 20-line rule. Most "framework features" are user-space code.
3. Put visual behaviour in `packages/create-threenative/templates/`, not in a package.
4. Add the test with the change, in the same commit.
5. Run `pnpm budgets`. If a cap moved the wrong way, cut something.

## Verification honesty

The most dangerous failure in this repo is a check that reports green while asserting
nothing — v1's playtest harness had 19 validators that returned `undefined` on a
wrong-typed value and 13 `.filter()` calls that dropped them silently. A scenario asserting
nothing reported pass.

The rule everywhere: **fail closed.** Malformed input throws, a missing observation fails,
and an empty assertion set is a failure, never a pass. Applies to your own reporting too —
"unverified" is an acceptable answer, "verified" without a run is not.
