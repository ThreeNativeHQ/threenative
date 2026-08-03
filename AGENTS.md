# AGENTS.md — ThreeNative

Instructions for any AI agent here. Nested `AGENTS.md` files add package rules; closest wins.

**Every `CLAUDE.md` in this repo is generated** by `scripts/sync-agent-docs.ts` from the
`AGENTS.md` beside it. Edit `AGENTS.md`, then run `pnpm sync:agents`. CI runs `--check` and
fails on drift, so a hand-edited `CLAUDE.md` will be reverted.

## Our main mantra

- Build a system that builds itself. Whenever you build some piece of this system, remember to playtest it and verify that it works as expected. If it doesn't, fix it before moving on.

## What this is

An application framework for Three.js games. WebGPU by default, Godot-shaped conventions,
React/Tailwind for UI, vanilla `three` on every surface underneath. **The framework ships
the plumbing. The user's agent ships the gameplay.**

`CHARTER.md` at the repo root is the only binding document. If anything here contradicts
it, `CHARTER.md` wins — say so instead of quietly following this file. `docs/README.md`
maps the rest, and labels which docs are proposals rather than commitments.

## How you work

1. **Think before coding.** State assumptions explicitly. If the request is ambiguous, ask
   rather than guess — a silent interpretation costs more than a question.
2. **Simplicity first.** Nothing beyond what was asked. No speculative abstraction, no
   option nobody requested. This is the 20-line rule applied to your own diff.
3. **Surgical changes.** Touch only what you must, and clean up only your own mess.
   Unrelated tidying belongs in its own change.
4. **Goal-driven execution.** Turn the task into success criteria that can be _run_, then
   loop until they pass. Criteria beat instructions: `pnpm test` green and a playtest
   scenario asserting the behaviour is a goal; "make it work" is not.

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

These come from `CHARTER.md` §11 and from the 790k-line v1 that died of ignoring them.

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
   **Godot is the only node source — not Unity, not Unreal.** Every new abstraction copies
   Godot's class name, method names (`move_and_slide` → `moveAndSlide`), property names and
   signal semantics, in camelCase. When Godot has no equivalent, borrow from Three.js or
   Rapier before inventing. Mixing conventions costs more than either one alone.
5. **A package exists only when it carries a dependency the others must not inherit.** Cap
   is 8 workspace packages, and it is not raised.
6. **Never claim a green gate you did not run.** Paste the failure instead.

## Budgets

`pnpm budgets` enforces: 8 workspace packages, 15,000 framework LOC (`packages/*/src`,
excluding salvage), and 10 files in `docs/PRDs/`.

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

1. Check `CHARTER.md` §2's "what it is not" list. An IR, a scene format, an editor, a preset
   system, a code-first ECS and a bespoke CLI vocabulary are closed questions, decided
   against with evidence.
2. Check the 20-line rule. Most "framework features" are user-space code.
3. Put visual behaviour in `packages/create-threenative/templates/`, not in a package.
4. Add the test with the change, in the same commit.
5. Run `pnpm budgets`. If a cap moved the wrong way, cut something.

## Verification honesty, and how you prove it

The most dangerous failure here is a check that reports green while asserting nothing —
v1's harness had 19 validators returning `undefined` on a wrong-typed value and 13
`.filter()` calls dropping them silently, so a scenario asserting nothing reported pass.
The rule everywhere is **fail closed**: malformed input throws, a missing observation
fails, an empty assertion set is a failure. It applies to your own reporting too —
"unverified" is an acceptable answer, "verified" without a run is not.

`pnpm test` proves the units. **A playtest scenario proves the game**, by driving the real
build in a browser and asserting what happened. Any change with runtime behaviour gets one,
re-run on every later change to that behaviour — this is what rule 4 loops against.

```sh
pnpm --filter @threenative/playtest build          # the CLI is built, not checked in
node packages/playtest/dist/runner/cli.js init     # writes playtests/smoke.playtest.json
node packages/playtest/dist/runner/cli.js playtests/smoke.playtest.json \
  --url http://127.0.0.1:5173 --server-command "pnpm dev" --browser-arg --enable-unsafe-webgpu
```

In a scaffolded project the same CLI is `npx @threenative/playtest`. Working today:
`diagnostics`, console, network, screenshot and trace assertions, against any URL, with no
adapter. Semantic ones (`movement`, `camera`, `visibility`) need
`installThreePlaytestBridge` in the app under test — nothing in this repo installs it yet,
and PRD-007 wires it into `defineGame` but is **not shipped**. Until then a semantic
scenario fails `TN_PLAYTEST_BRIDGE_MISSING`; that is the harness being right. Install the
bridge or narrow the scenario, never delete the assertion to get green.
