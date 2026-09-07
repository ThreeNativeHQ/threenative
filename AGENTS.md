# AGENTS.md — ThreeNative

Rules for any agent here; the closest nested `AGENTS.md` wins for its subtree. **Every `CLAUDE.md` is generated** — edit `AGENTS.md`, run `pnpm sync:agents` (CI runs `--check`). Diagrams are Mermaid, never ASCII.

## What this is

One source, two runtimes: browser WebGPU and an owned C++ host for desktop/Android/iOS. Godot vocabulary, React/Tailwind UI, vanilla `three` underneath, MIT. Studio, the paid editor, is a separate private repo this one knows nothing about. **Agents write the games, humans only play them**: framework quality is friction per cold-agent build, and a human grades the templates.
**Conventions ship on by default** — feet meet the floor, a weapon stays in the hand that holds it, an agent walks around a wall, one metre is one metre — working before any game asks, each with a named override on the same object, honest reporting when overridden, and measurement that survives the override. A convention missing from the templates' `AGENTS.md` does not exist. **Auto by default**: if the engine can measure the value where it is used it decides; a default that is a constant the author is told to revisit later is a bug, not an option.

## How you work

1. **Search the manifest before you write, by rule and never by judgement** — `engine_search_capabilities`, then `engine_capability_detail` on every hit — before any new file under `src/` or `packages/`, any helper longer than a screen, and any render stage you turn on or off. Not "before a system": that judgement always answers no. Measured: 880 colliders, a loading gate and four tuned render stages shipped without one search, straight past the `ClusteredBatch` built for exactly that; another game hand-wrote 446 already-installed lines and ran at 9 FPS. The manifest (`packages/create-threenative/capabilities.json`, rebuilt by `pnpm build`) is the only complete public surface, searchable by plain-words situation, binding in its constraints, and the only way to see subpath exports like `@threenative/physics/navigation`. Both tools ship in `threenative-engine-mcp`, wired by the `.mcp.json` that installing `@threenative/core` writes — read from the launch directory, so launch from the game-project root or the server is not there.
2. **Name the layer before you fix the bug**: engine (`packages/`) or game (example or template)? Say which and why. An engine bug fixed in game code buys one green screenshot and leaves every other game broken.
3. **Red-green, bugfixes included.** Paste the red, then fix and paste the green; both land in one commit.
4. **Never claim a gate you did not run.** Paste the output; "unverified" is an acceptable answer.
5. **Surgical.** Touch only what the task needs; tidying is its own change. Ask when the request is ambiguous — a silent interpretation costs more than a question.
6. **Primary docs follow the executables.** README, `docs/architecture/` and package AGENTS files may name only commands and packages the CLIs and manifests ship (`scripts/__tests__/primary-docs.spec.ts` fails on drift); code is the source of truth, so fix the prose.

## Where a change goes

| Adding | Where |
| --- | --- |
| Anything that **decides how it looks** — materials, shaders, TSL, lights, tonemapping, post, framing — and any preset or default picking one of them | `templates/*/src/render/`, as generated user source |
| The **mechanism** that puts it on screen — pooling, lifetime, billboarding, instancing, dispatch, culling — when every appearance parameter comes from the game; plus plumbing every game repeats and none should write | `packages/core/src/` |
| Physics or navigation (carries the WASM dep) · React HUD/menu bindings · C++ host, platform bring-up, native systems · scenario harness and assertions | `packages/physics/` · `ui/` · `runtime-native/` · `playtest/` |
| Gameplay, never in a package · proof that any of it works | an example or a template · `<package>/__tests__/*.spec.ts` **and** a playtest scenario |

`examples/abyss-vanilla/` is a frozen control — do not edit. `docs/architecture/CHARTER.md` binds and outranks this file; open it only when changing what the framework *is*, and state its rule in a plain clause instead of citing a section number.

## Rules that get a change rejected

1. **The two questions.** (a) Could the game write this portably itself? If no — it needs a browser global, a platform seam, or a backend it must not know it got — the framework owns it, at any size. (b) Does it decide how anything looks? Then it ships as generated source in `src/render/`, at any size. (b) vetoes (a).
2. **The kill switch.** An abstraction costing more code than plain Three.js is deleted however much work it took; `scripts/count-loc.ts` scores every repetition, not one site.
3. **Never own the look.** Mechanism is fair game while geometry, material, colour, texture, curve and timing come from the game. The test: can the game change the appearance completely without editing package code? `GPUParticles3D` is the shape.
4. **Vocabulary is borrowed, never invented** — Godot for nodes and the only node source, Three.js for rendering, Rapier for physics, Tailwind for UI, in camelCase. **A package exists only when it carries a dependency the others must not inherit.**
5. Closed with evidence and outranking rule 1: an IR, a scene format, an editor, a preset/genre system, a code-first ECS, a bespoke CLI vocabulary. **Web-only is unfinished** — a helper admitted for being unportable ships native proof in the same commit (a conformance case or a `--target` playtest) and no result claims a platform it did not execute; the contract is `packages/runtime-native/AGENTS.md`.

## Commands

```sh
pnpm typecheck && pnpm lint && pnpm test   # all three before calling a change done
pnpm test:playtest / test:templates        # in-repo example fixture / each scaffolded template
pnpm budgets / pnpm quality                # invariants fail, LOC only reports / never fatal
pnpm sync:agents / pnpm --filter <example> dev   # regenerate mirrors / run one workspace; no root dev
pnpm native:build && pnpm native:verify:desktop  # opt-in C++ host; 300 frames + a live screenshot
# ask doctor first when a red is not the game — no browser, blank capture, silent device
node packages/playtest/dist/runner/cli.js doctor --text [--url <url> | --device <serial>]
npx threenative doctor --text              # the same question inside a generated project
pnpm --filter @threenative/playtest build  # then prove one game, usually your sandbox game:
node packages/playtest/dist/runner/cli.js <scenario>.playtest.json --url http://127.0.0.1:5173 --server-command "<workspace dev command>" --browser-recipe webgpu
```

Playtest flags, its four targets and its exit codes are in `packages/playtest/AGENTS.md`; the runner provisions its own Xvfb, so never wrap it. CI runs `typecheck`, `lint`, `build`, `budgets`, `supply-chain`, `test`, `test-browser`, `test-playtest`, the `golden-path` matrix and the main/nightly `template-nonvisual` matrix; `native-platforms.yml` adds advisory Android, `desktop-parity`, desktop, starter-linux and iOS evidence. **Prove it locally before you push** — CI is the slow lane, and a red there costs more than a run here. Registry commands take the untracked local `.npmrc` explicitly (`npm --userconfig .npmrc <command>`); never print it.

TypeScript 5.9 `strict`, **ESM only**; relative imports carry `.js` even though the file is `.ts`. Versions come from the `catalog:` in `pnpm-workspace.yaml`, templates excepted. Biome owns formatting — do not hand-format. Interfaces are `I`-prefixed, classes and type aliases are not. Unit tests are `<package>/__tests__/*.spec.ts`, vitest, node environment, DOM and GPU stubbed.

**Harnesses that already exist**, easy to miss, which is how work gets redone by hand. Find a capability by situation, or what a symbol constrains: `capabilities.json`, `packages/engine-mcp`. Prove behaviour on browser, Android, desktop or iOS: `packages/playtest --target <platform>`. Install like a user's machine and measure agent friction across arms: `pnpm sandbox`, `pnpm sweep:capture|judge|pair`, `scripts/score-blind.ts`. Judge a visual change against its baseline, or score framework code against plain Three.js: `pnpm visuals`, `visuals:ab`, `visuals:baseline`, `pnpm tsx scripts/count-loc.ts`. Diff web against native, profile or benchmark the host, read frame meters without opening a log: `pnpm parity` (`packages/runtime-native/conformance/registry.json`), `profile:native-cpu`, `bench:engines`, playtest `perf --file|--executable|--logcat`. Ask what to verify next: `pnpm round:next`, `round:deletions`, `alpha:bar`.

## Verification

**Fail closed everywhere**: malformed input throws, a missing observation fails, an empty assertion set is a failure — v1 dropped malformed assertions and reported green on scenarios asserting nothing. `pnpm test` proves the units; **a playtest scenario proves the game** by driving the real build and asserting what happened, so every change with runtime behaviour gets one, re-run on each later change to that behaviour.
**Prefer an emulator or a CI job over physical hardware whenever the claim can be made there** — take a device only when nothing else can prove it. Two traps that manufacture false results, both already wrapped for you: never call `xvfb-run`, whose exit status is its own failing cleanup kill (`sh scripts/xvfb.sh <cmd>` survives as a no-op wrapper); and a WebGPU run that does not name its adapter may be SwiftShader, so pass `--browser-recipe webgpu` and check `adapter.info`. Free a dev server by port (`lsof -ti tcp:<port> | xargs -r kill`) — `pkill -f vite` matches your own shell.
Long gates write one read-only record at `artifacts/gates/status.json`: read it with `pnpm gate:status` (run, phase, heartbeat, owner, command, artifact), probe a stale or blocked phase with `pnpm gate:doctor`, and `pnpm gate:resume` continues only while the recorded worktree, branch, HEAD, lease and status artifact still match. None of them repair or remove a worktree.

## Working outside the repo

`pnpm sandbox` builds a machine that behaves like a user's: tarball installs, no workspace, no `AGENTS.md` chain. Sandbox games live outside this repo, one per folder; an engine fix goes into `packages/` and is reinstalled there rather than patched into the copy. Device lanes are in `packages/runtime-native/AGENTS.md`, PRD filing and the round ledger in `docs/PRDs/AGENTS.md`. Another agent may be working in this tree, so commit as you go — an uncommitted edit here does get overwritten.
`.worktrees/` and `.claude/worktrees/` hold other agents' lanes, so never search them and never read their AGENTS.md — a repo-wide grep or a "closest AGENTS.md" walk that lands there is reading a dead lane from another day, not this repository. Generated sweep arm sources and scaffold instruction files are untracked; their benchmark records (`proof.json`, `proof-artifacts/`, captures) stay tracked. A tracked `.ignore` keeps `docs/PRDs/done/` and the generated `CLAUDE.md` mirrors out of the **default** search path only — reach them with `rg --no-ignore <pattern>` or by naming the directory as the search root.
