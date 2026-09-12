<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — ThreeNative

Rules for any agent here; the closest nested `AGENTS.md` wins for its subtree. **Every `CLAUDE.md` is generated** — edit `AGENTS.md`, run `pnpm sync:agents` (CI runs `--check`). Diagrams are Mermaid, never ASCII.

## What this is

One source, two runtimes: browser WebGPU and an owned C++ host for desktop/Android/iOS. Godot vocabulary, React/Tailwind UI, vanilla `three` underneath, MIT. Studio, the paid editor, is a separate private repo this one knows nothing about. **Agents write the games, humans only play them**: framework quality is friction per cold-agent build, and a human grades the templates.
**Conventions ship on by default** — feet meet the floor, a weapon stays in the hand that holds it, an agent walks around a wall, one metre is one metre — working before any game asks, each with a named override on the same object, honest reporting when overridden, and measurement that survives the override. A convention missing from the templates' `AGENTS.md` does not exist. **Auto by default**: if the engine can measure the value where it is used it decides; a default that is a constant the author is told to revisit later is a bug, not an option.

## How you work

1. **Search the manifest before you write, by rule and never by judgement** — `engine_search_capabilities`, then `engine_capability_detail` on every hit — before any new file under `src/` or `packages/`, any helper longer than a screen, and any render stage you turn on or off. Not "before a system": that judgement always answers no. Measured: 880 colliders, a loading gate and four tuned render stages shipped without one search, straight past the `ClusteredBatch` built for exactly that; another game hand-wrote 446 already-installed lines and ran at 9 FPS. The manifest (`packages/create-threenative/capabilities.json`, rebuilt by `pnpm build`) is the only complete public surface, searchable by plain-words situation, binding in its constraints, and the only way to see subpath exports like `@threenative/physics/navigation`. Both tools ship in `threenative-engine-mcp`, wired by the `.mcp.json` that installing `@threenative/core` writes — read from the launch directory, so launch from the game-project root or the server is not there.
2. **Name the layer before you fix the bug**: engine (`packages/`) or game (example or template)? Say which and why. An engine bug fixed in game code buys one green screenshot and leaves every other game broken.
3. **Red-green for behavior changes, bugfixes included.** Reproduce the failure, fix it and run the regression check. Do not manufacture failures for planning or prose edits.
4. **Never claim a gate you did not run.** Summarize the actual result in the PRD, PR or response; "unverified" is an acceptable answer. Separate verification reports are not required.
5. **Keep the PRD current as you work, not at the end.** Tick each checkbox in the PRD the moment its work is done and verified, move the phase/status line with it, and write the actual result beside the box when it carries evidence. The PRD edit ships in the same commit as the change it describes. Never tick a box for work that is unrun, partial or unverified — leave it open and say why. Run `pnpm prd:progress <prd file>` before you start and after every phase: it reads the PRD's own boxes, prints the `prd:25/50/75/100` label to put on the PR, and **exits 1 when the PRD has no per-phase boxes** — the shape that stalled 80 of 143 open PRDs, so fix it before working. One PR per PRD, opened as a draft, never one per phase. Filing rules and the label table: `docs/PRDs/AGENTS.md`; the whole lifecycle: the `prd-lifecycle` skill.
6. **Surgical.** Touch only what the task needs; tidying is its own change. Ask when the request is ambiguous — a silent interpretation costs more than a question.
7. **Primary docs follow the executables.** README, `docs/architecture/` and package AGENTS files may name only commands and packages the CLIs and manifests ship (`scripts/__tests__/primary-docs.spec.ts` fails on drift); code is the source of truth, so fix the prose.

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
pnpm typecheck && pnpm lint && pnpm test   # executable, config, generated-contract or unknown changes
pnpm check:docs && pnpm exec vitest run scripts/__tests__/check-doc-links.spec.ts scripts/__tests__/evidence-budget.spec.ts scripts/__tests__/evidence-citations.spec.ts scripts/__tests__/sync-agent-docs.spec.ts scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-needs.spec.ts  # strict prose-only lane
pnpm test:playtest                         # playtests against the in-repo example fixture
pnpm test:templates                        # playtests against each scaffolded template
pnpm budgets                               # hard invariants fail; LOC triggers only report
pnpm quality                               # file length, suppressions, lint holes; never fatal
pnpm sync:agents                           # regenerate CLAUDE.md mirrors
pnpm prd:progress <prd file>               # the PRD's own boxes -> prd:25/50/75/100 label; exit 1 = no phase boxes
pnpm release:prepare                       # bump, build, and preflight the full release cohort
pnpm --filter <example> dev                # there is no root `pnpm dev`

# when a gate fails for a reason that is not the game — no browser, blank screenshot, silent
# device — ask the machine and the project first
node packages/playtest/dist/runner/cli.js doctor --text
node packages/playtest/dist/runner/cli.js doctor --url <url> --text   # + the scene at a glance
node packages/playtest/dist/runner/cli.js doctor --device <serial> --text  # + is the phone cool enough
npx threenative doctor --text              # inside a generated project

# prove one game — usually the sandbox game you are working on, not an in-repo example
# (flags, four targets and exit codes: packages/playtest/AGENTS.md; the runner provisions its own
# Xvfb on headless Linux, so no display wrapper is needed)
pnpm --filter @threenative/playtest build
node packages/playtest/dist/runner/cli.js <scenario>.playtest.json \
  --url http://127.0.0.1:5173 --server-command "<workspace dev command>" --browser-recipe webgpu

pnpm native:build                          # opt-in; downloads deps, compiles the C++ host
pnpm native:verify:desktop                 # 300 native frames + a non-blank screenshot
```

The pre-push hook runs bounded `pnpm ci:fast` drift checks and reports the shared classifier's
selection; it never proves runtime correctness. `pnpm ci:local --full` runs the full local board.
`pnpm ci:local --affected --base origin/develop --target develop` runs the same selected local
families as CI; dirty, missing or unknown inputs fail safe to full. `scripts/ci-change-scope.mjs`
uses the complete merge-base diff, including deleted files and both rename endpoints. Only
explicit inert prose, root/playtest instruction contracts and isolated website consumers are exempt from
native work; shared/package/template/dependency/CI changes remain full. Main PRs, main pushes,
nightly and manual qualification are full. `ci-required` rejects missing or unsuccessful selected
checks; full coverage retains `typecheck`, `lint`, `build`, `budgets`, `supply-chain`, unit/browser/
playtest gates, `golden-path`, `template-nonvisual`. The `native-platforms.yml` matrix including `desktop-parity` still runs on full selections, but it is **not part of the merge verdict** — the release lane validates the native rows for the exact candidate SHA, so a slow or red native matrix cannot hold every merge. Never cache test verdicts.

**The integration flow is active (PRD-373).** `develop` is protected and requires `ci-required`;
start feature branches from `develop`, open their PRs against `develop`, and squash-merge there.
Set each checkout's `git config threenative.integrationBranch develop`. Main accepts only
full-checked frozen `promotion/<full-head-sha>` PRs (merge commits, never squash/rebase) or
full-checked `hotfix/` PRs merged back to develop; `TN_DEVELOP_CI_ENABLED=true` makes `ci-required`
reject a main PR whose head is not a `promotion/` or `hotfix/` ref. Native platform evidence is
produced on full selections but is not part of the merge verdict — the release lane validates it
for the exact candidate. Inventory `gh pr list` and `pnpm worktree:status` before retargeting,
retarget in-flight PRs individually, and never rewrite another worktree. Keep the existing release
gates and exact-main push qualification. Activation and rollback:
`docs/PRDs/production-readiness/PRD-373-selective-ci-and-develop-promotion.md`.
**Prove it locally before you push** and record unrun platform gates honestly. Registry commands
take the untracked local `.npmrc` explicitly (`npm --userconfig .npmrc <command>`); never print it.

TypeScript 5.9 `strict`, **ESM only**; relative imports carry `.js` even though the file is `.ts`. Versions come from the `catalog:` in `pnpm-workspace.yaml`, templates excepted. Biome owns formatting — do not hand-format. Interfaces are `I`-prefixed, classes and type aliases are not. Unit tests are `<package>/__tests__/*.spec.ts`, vitest, node environment, DOM and GPU stubbed.

**Harnesses that already exist**, easy to miss, which is how work gets redone by hand. Find a capability by situation, or what a symbol constrains: `capabilities.json`, `packages/engine-mcp`. Prove behaviour on browser, Android, desktop or iOS: `packages/playtest --target <platform>`. Install like a user's machine and measure agent friction across arms: `pnpm sandbox`, `pnpm sweep:capture|judge|pair`, `scripts/score-blind.ts`. Judge a visual change against its baseline, or score framework code against plain Three.js: `pnpm visuals`, `visuals:ab`, `visuals:baseline`, `pnpm tsx scripts/count-loc.ts`. Diff web against native, profile or benchmark the host, read frame meters without opening a log: `pnpm parity` (`packages/runtime-native/conformance/registry.json`), `profile:native-cpu`, `bench:engines`, playtest `perf --file|--executable|--logcat`. Ask what to verify next: `pnpm round:next`, `round:deletions`, `alpha:bar`.

## Verification

Keep routine results in the existing PRD, PR or response. Create a separate evidence file only when
the user requests it or an existing automated workflow consumes it. Planning and prose edits need
only relevant document checks; regenerate agent mirrors when their source changes. Do not run
implementation checkpoints or create artificial negative controls for a document-only task.

**Fail closed everywhere**: malformed input throws, a missing observation fails, an empty assertion set is a failure — v1 dropped malformed assertions and reported green on scenarios asserting nothing. `pnpm test` proves the units; **a playtest scenario proves the game** by driving the real build and asserting what happened, so every change with runtime behaviour gets one, re-run on each later change to that behaviour.
**Prove it on the nearest lane that holds the claim: local first, CI last.** A CI round trip is over an hour of queue and runner time, so it is the slow lane for landing work, never the way to find out whether a change works — run the unit test, playtest, Android emulator or attached-device check here and push once local evidence is green. Never wait on CI for an answer a local run can give. **Prefer an emulator over physical hardware whenever the claim can be made there** — take a device only when nothing else can prove it, and an emulator that is not running is a request to start one, not a blocked lane. Two traps that manufacture false results, both already wrapped for you: never call `xvfb-run`, whose exit status is its own failing cleanup kill (`sh scripts/xvfb.sh <cmd>` survives as a no-op wrapper); and a WebGPU run that does not name its adapter may be SwiftShader, so pass `--browser-recipe webgpu` and check `adapter.info`. Free a dev server by port (`lsof -ti tcp:<port> | xargs -r kill`) — `pkill -f vite` matches your own shell.
Long gates write one read-only record at `artifacts/gates/status.json`: read it with `pnpm gate:status` (run, phase, heartbeat, owner, command, artifact), probe a stale or blocked phase with `pnpm gate:doctor`, and `pnpm gate:resume` continues only while the recorded worktree, branch, HEAD, lease and status artifact still match. None of them repair or remove a worktree.

## Working outside the repo

`pnpm sandbox` builds a machine that behaves like a user's: tarball installs, no workspace, no `AGENTS.md` chain. Sandbox games live outside this repo, one per folder; an engine fix goes into `packages/` and is reinstalled there rather than patched into the copy. Device lanes are in `packages/runtime-native/AGENTS.md`, PRD filing and the round ledger in `docs/PRDs/AGENTS.md`. Another agent may be working in this tree, so commit as you go — an uncommitted edit here does get overwritten.
`.worktrees/` and `.claude/worktrees/` hold other agents' lanes, so never search them and never read their AGENTS.md — a repo-wide grep or a "closest AGENTS.md" walk that lands there is reading a dead lane from another day, not this repository. Generated sweep arm sources and scaffold instruction files are untracked; their benchmark records (`proof.json`, `proof-artifacts/`, captures) stay tracked. A tracked `.ignore` keeps `docs/PRDs/done/` and the generated `CLAUDE.md` mirrors out of the **default** search path only — reach them with `rg --no-ignore <pattern>` or by naming the directory as the search root.
