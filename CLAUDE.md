<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

# AGENTS.md — ThreeNative

Instructions for any AI agent working here. Nested `AGENTS.md` files add rules for their
subtree; the closest one wins.

**Every `CLAUDE.md` in this repo is generated** from the `AGENTS.md` beside it by
`scripts/sync-agent-docs.ts`. Edit `AGENTS.md`, then run `pnpm sync:agents`. CI runs
`--check`, so a hand-edited `CLAUDE.md` gets reverted.

## What this is

An application framework for Three.js games that runs **the same source on web and native**
— browser WebGPU, plus an owned C++ runtime for desktop/Android/iOS. Godot-shaped
conventions, React/Tailwind for UI, vanilla `three` on every surface underneath.
**The framework ships the plumbing. The user's agent ships the gameplay.**

Mantra: *build a system that builds itself.* Every piece you build gets playtested against
the real build before you move on. If it fails, fix it before continuing.
Build systems that build themselves: continuously build harnesses to debug, inspect, and measure performance.

## How you work

1. **Think first.** State assumptions. Ask when the request is ambiguous — a silent
   interpretation costs more than a question.
2. **Simplicity.** Nothing beyond what was asked. No speculative abstraction, no option
   nobody requested.
3. **Surgical.** Touch only what you must. Unrelated tidying is its own change.
4. **Goal-driven.** Turn the task into criteria you can _run_, then loop until they pass.
   `pnpm test` green plus a playtest asserting the behaviour is a goal; "make it work" is not.
5. **Never claim a gate you did not run.** Paste the failure. "Unverified" is an acceptable
   answer; "verified" without a run is not.
6. **Name the layer before you fix the bug.** Every defect is either an **engine bug** — the
   framework or the native runtime is wrong — or a **game bug**, the game misusing Three.js or
   ThreeNative. Say which, and why, before you write the fix. The two have opposite homes: an
   engine bug is fixed in `packages/`, a game bug in the example or template. Fixing an engine
   bug inside game code buys a green screenshot and leaves every other game broken, and each
   such workaround is a line the user has to write that the framework promised to ship. When a
   game needs to annotate its own scene graph, branch on platform, or hand-tune a framework
   pass to make native match web, that is an engine bug wearing a game-code costume.

**Diagrams:** Whenever a diagram is needed, use Mermaid rather than ASCII art.

## Where a change goes

| What you are adding | Where it belongs |
| --- | --- |
| Anything a screenshot shows — materials, shaders, TSL, lights, tonemapping, post, camera framing | `packages/create-threenative/templates/*/src/render/`, as generated user source |
| Gameplay | an example or a template — never a package |
| Plumbing every game repeats and no game should write | `packages/core/src/` |
| Physics or navigation (carries the WASM dep) | `packages/physics/src/` |
| React HUD/menu bindings (carries the React dep) | `packages/ui/src/` |
| C++ host, platform bring-up, native systems | `packages/runtime-native/` |
| Scenario harness / assertions | `packages/playtest/` |
| Proof that any of it works | `<package>/__tests__/*.spec.ts` **and** a playtest scenario |

```
examples/abyss-vanilla/    FROZEN benchmark control — do not edit
examples/abyss-framework/  the framework arm of the same benchmark
examples/native-smoke/     the native bundle contract (one import-free ESM file)
docs/                      PRDs, verification, strategy, architecture, product
scripts/                   budgets, LOC classifier, sweeps, blind scoring
```

`docs/architecture/CHARTER.md` is the only binding document and wins if anything here
contradicts it — say so rather than quietly following this file. **Do not read it by
default**; everything it binds for ordinary work is restated here. Open it only when you
change what the framework *is*: adding or removing a package, moving a budget, reopening a
closed question. `docs/README.md` maps the rest and labels proposals versus commitments.

**Never cite the charter by section in a doc you write.** No `**Charter authority:** §3, §7`
headers, no "per `CHARTER.md` §5b", no "§12 criterion 3". Nobody has the section numbers
memorised, so a reader hits a lookup instead of a fact, and most of those citations are
decoration anyway. **State the rule itself in one plain clause** — "gameplay is permanently
the user's to write", "no stranger has played a ThreeNative game for five minutes yet". Name
`CHARTER.md` at most once per document, without a section number, and only when a reader who
disagrees would genuinely need to go read it. The same applies to status boilerplate: a date
and one line of what the file is beats a block of authority declarations.

## Web and native are one codebase

**A feature that works on web only is an unfinished feature.** Before you add anything to a
package, work out what the native host does with it.

- **One file per public class.** `RigidBody3D`, `Area3D`, `CharacterBody3D`,
  `CollisionShape3D` are each a single source file shared by both targets. The
  `threenative-native` export condition may swap **only** the `PhysicsSimulation` backend
  beneath them — never a node, scene, entity, or anything a game writes against. Two copies
  of a class is a fork, and a fork diverges silently: a feature added to one is simply
  missing from the other and no gate reports it.
- **Browser globals exist only insofar as the host shims them.** See
  `packages/runtime-native/src/` — `canvas`, `input`, `storage`, `http`, `fs`, `audio`,
  `video`, `workers`, `webgpu`. Reaching for one that is not shimmed breaks native silently.
- **No WASM on native.** Android runs QuickJS. A WASM dependency is web-only by
  construction; its native equivalent compiles into `runtime-native` and is reached through
  a coarse bulk typed-array ABI (`step`, `readVisibleTransforms`), never per-object frame
  calls. `@threenative/physics/navigation` is therefore browser-only; the shipped platformer
  uses template-local steering so its portable entry still runs on desktop and Android.
- **A backend that cannot honour an option throws at construction.** Accepting it and
  discarding it becomes a gameplay bug on one platform only.
- **The native bundle is one import-free ESM file.** No code splitting, no dynamic
  `import()`; `examples/native-smoke` asserts this on every build.
- **`src/game.ts` is the portable entry; `src/main.ts` is the web entry.** Native builds
  read `threenative.nativeEntry` (default `src/game.ts`), import its default game export,
  and start it. Keep React mounts and other browser-only UI in `src/main.ts`.
- **Never claim a platform you did not execute.** Desktop and the **iOS simulator** are
  green; the Android emulator is red on the hosted lane; physical hardware and performance
  parity are open. A result may say desktop-ready, iOS-simulator-proved or
  Android-emulator plumbing-ready — it must not say mobile-ready.
- **The hosted `macos-15` runner is an Apple machine and it executes.** This repo's operator
  machine has none, but simulator-class iOS evidence is producible in CI and PRD-045 closed
  on it (2026-08-11). It proves nothing physical: arm64, real Metal, signing, touch hardware,
  thermal and battery still need a phone.

Native compilation is opt-in: the default repo gate must never require CMake, an NDK or
Xcode. `third_party/`, `build/`, `.runtime/` and `artifacts/` stay untracked.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm typecheck                     # tsc across root + every package
pnpm lint                          # biome check . (--write to fix)
pnpm test                          # package builds + publint + vitest run
pnpm test:browser                  # playwright, boots abyss-vanilla
pnpm test:playtest                 # playtest scenarios against abyss-framework
pnpm test:templates                # playtests against each scaffolded template
pnpm budgets                       # hard invariants fail; LOC triggers report
pnpm sync:agents                   # regenerate CLAUDE.md mirrors (--check in CI)
pnpm tsx scripts/count-loc.ts      # regenerates the README LOC table
pnpm --filter abyss-framework dev  # run the framework example

pnpm studio:inspect --browser      # boot the live Studio and report what it observed
pnpm studio:probe --browser        # the Studio bar: one line per check, exit 0/1/2
pnpm studio:loop --dry-run         # the next Studio action, unattended-agent guardrails

pnpm native:build                  # opt-in; downloads deps, compiles the C++ host
pnpm native:verify:desktop         # 300-frame desktop run + non-blank screenshot
```

Registry commands use the repository-local `.npmrc` (copied from
`~/projects/threejs-to-bevy/.npmrc`). Keep it ignored and untracked, never print its
contents, and pass it explicitly when needed: `npm --userconfig .npmrc <command>`.

CI chains `install → typecheck → lint → test → scaffold-smoke → visuals`, with `benchmark`,
`build → budgets` branching off `test`; each link blocks the next. Native platforms run in a
separate workflow. Run `pnpm typecheck && pnpm lint && pnpm test` before calling a change done.

**Validate locally on the Android emulator, not by pushing to CI** — this repo runs on a free
GitHub plan, so CI minutes are scarce; use CI only when a check cannot run locally.

The self-improvement loop resumes from `docs/verification/round-*.md`: `pnpm round:next`
computes the single next action, `pnpm round:deletions` reports exports unreached across
consecutive rounds. Keep the round ledger as the evidence record.

**When a PRD is finished, `git mv` it to `docs/PRDs/done/` in the same commit that finishes it.**
For grouped batches such as `docs/PRDs/starter-kits/`,
`docs/PRDs/native-performance-fixes/`, and `docs/PRDs/night-watch-26-08-10/`, archive the
whole folder with `git mv docs/PRDs/<batch>/ docs/PRDs/done/<batch>/` in the commit that closes
the last PRD. Do not archive a batch while any PRD is `OPEN`, `SCOPING`, `NOT STARTED`,
`BLOCKED`, or otherwise partial; a blocked criterion is not completion. If one PRD finishes
before its siblings, archive that PRD individually and leave the batch folder active until all
of its PRDs are complete.

## Rules that get a change rejected

Binding, and learned from the 790k-line v1 that died of ignoring them.

1. **The 20-line rule.** If a competent developer could write it in under 20 lines, it does
   not go in the framework. Write it in the example or the template.
2. **The kill switch.** Any abstraction that costs more code than plain Three.js is deleted,
   however much work it took. `scripts/count-loc.ts` scores this in CI.
3. **Never own the look.** Anything a screenshot shows ships as generated source in the
   user's `src/render/` — never as package code, never as a `defineGame` option.
4. **Vocabulary is borrowed, never invented.** Godot for nodes, Three.js for rendering,
   Rapier for physics, Tailwind for UI. **Godot is the only node source — not Unity, not
   Unreal.** Copy its class names, method names (`move_and_slide` → `moveAndSlide`),
   properties and signal semantics, in camelCase. Where Godot has no equivalent, borrow from
   Three.js or Rapier before inventing. A new name is a discovery cost for every model.
5. **A package exists only when it carries a dependency the others must not inherit.** That
   rule governs package count; there is no number to argue with.

These are closed with evidence and do not get reopened in a feature: an IR, a scene format,
an editor, a preset system, a code-first ECS, a bespoke CLI vocabulary.

## Budgets

`pnpm budgets` reports two kinds of limit.

**Hard — fails CI:** a native runtime tree outside `packages/runtime-native/`, any tracked
file under `packages/runtime-native/third_party/`, a vendored asset MCP, and any
`packages/*/package.json` claiming `threenative-asset-mcp`.

Template LOC is **reported, never capped** — retired by owner decision 2026-08-09. Templates
are generated user source, so a line there is the user's to keep or delete; the 20-line rule
and the kill switch still bound what the *framework* spends.

**Review triggers — reported, never fatal:** 15,000 framework LOC (`packages/*/src`,
excluding salvage and native) and 50,000 native runtime LOC. Crossing one obliges a
justification in the owning PRD and a kill-switch pass over what you added. Never silence a
trigger; a number routed around is worse than no number.

`pnpm quality` reports file length, suppressions, and lint-coverage holes as review signals;
cognitive complexity is a warn-level `pnpm lint` diagnostic. These threshold reports and
warnings never fail a build. The interface naming signal is the exception: interfaces are
`I`-prefixed, so it is enforced after the tree is clean. Run `pnpm --silent quality --json` first
when a hard change needs a machine-readable target list.

`threenative-asset-mcp` is the asset-discovery server each template pins and each generated
project installs — an external process, never vendored. Its surface of record is
`packages/create-threenative/asset-mcp-tools.json`, updated by running the pinned server,
never by reading its docs.

## Code conventions

- TypeScript 5.9, `strict`, **ESM only**. Relative imports carry a `.js` extension even when
  the file on disk is `.ts` — `import { Play } from "./scenes/Play.js"`.
- Dependency versions come from the `catalog:` in `pnpm-workspace.yaml`, never a literal in a
  package. Template `package.json` files are the exception: they ship real versions, and CI
  asserts no `catalog:` survives scaffolding.
- Biome owns formatting and lint (100 columns, spaces, organized imports). Do not hand-format.
- Interfaces are `I`-prefixed; classes and type aliases are not, so Godot-borrowed node names
  remain unchanged.
- Unit tests are `<package>/__tests__/*.spec.ts`, vitest, node environment — anything
  touching the DOM or a GPU needs a stub. `examples/**` is excluded; browser proof goes
  through Playwright or a playtest.
- Every package's `test` script is its build plus `publint`, so a broken export map fails
  `pnpm test`.
- Add the test with the change, in the same commit.

## Verification honesty, and how you prove it

The most dangerous failure here is a check that reports green while asserting nothing — v1's
harness silently dropped malformed assertions, so a scenario asserting nothing reported pass.
The rule everywhere is **fail closed**: malformed input throws, a missing observation fails,
an empty assertion set is a failure.

`pnpm test` proves the units. **A playtest scenario proves the game**, by driving the real
build in a browser and asserting what happened. Any change with runtime behaviour gets one,
re-run on every later change to that behaviour.

```sh
pnpm --filter @threenative/playtest build          # the CLI is built, not checked in
node packages/playtest/dist/runner/cli.js init     # writes playtests/smoke.playtest.json
node packages/playtest/dist/runner/cli.js playtests/smoke.playtest.json \
  --url http://127.0.0.1:5173 --server-command "pnpm dev" --browser-recipe webgpu
```

Exit `0` passed, `1` assertions failed, `2` never reached assertions. `--browser-recipe
webgpu` supplies the current Chromium WebGPU flags; `--browser-arg` is the escape hatch. For
screenshot or `visual` assertions on headless Linux, prefix with
`xvfb-run -a -s '-screen 0 1600x900x24'`.

The same scenario runs on device with `--target android|ios` (`--device`, `--ios-transport`).
That is how a behaviour change gets proved on both halves of the codebase rather than
asserted on one.

In a scaffolded project the same CLI is `npx @threenative/playtest`. `diagnostics`, console,
network, screenshot and trace assertions work against any URL. The framework template
installs the bridge with `playtest()` in `defineGame`; a plain Three.js project uses
`installThreePlaytestBridge` from `@threenative/playtest/three`. Semantic assertions
(`movement`, `camera`, `visibility`) against a project with neither bridge fail
`TN_PLAYTEST_BRIDGE_MISSING` — that is the harness being right. Install the bridge or narrow
the scenario; never delete the assertion to get green.
