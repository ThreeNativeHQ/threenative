# Studio wiring verification — 2026-08-12

PRD-085, phases 0–5. Every result below was executed on this host on 2026-08-12 against
`examples/abyss-framework`, scratch git projects, and a scaffolded `minimal` project installed
from packed tarballs. No native, mobile, or device claim is made — Studio has no native source.

## The five reported symptoms, and what each one was

| Reported | Cause found | Where |
| --- | --- | --- |
| "Studio status endpoint did not answer" | The browser printed one sentence for every failure mode, and a preview that could not spawn killed the server outright | `app.tsx` `OFFLINE`, `server.ts` preview spawn |
| Project files has no proper icon | `[+]` and `-` text placeholders; three of four dock tabs had no icon | `app.tsx` `paintAssets` |
| Live activity may not be functional | It was inert on the default agent: `agentStep` parsed only Codex's vocabulary, and Claude Code ran with a non-streaming output format | `server.ts` `agentCommand`, `agentStep` |
| No control to hide the bottom panel | The only control sat in the far top-right corner of the window | `app.tsx` stage head |
| The agent should run "as if in our sandbox" | Nothing isolated instruction context; both agents read this repository's rules | `server.ts` `agentCommand` |

A sixth defect was found while proving the fifth: **Studio's `bin` never started when installed
as a dependency.** `pnpm studio` in a scaffolded project printed the pnpm banner and exited `0`
in silence, because the CLI guard compared `process.argv[1]` — the `node_modules/.bin` symlink —
against the module's real path with `path.resolve`, which does not resolve symlinks.

## Phase 0 — Studio survives its own environment

Control, with `pnpm` removed from `PATH`:

```text
before: Error: spawn pnpm ENOENT → Unhandled 'error' event → process dead
after:  alive: 200 | preview.reason: The preview process could not start: spawn pnpm ENOENT
```

`parseStudioArgs(["--porte","4200"])` now throws `Unknown flag '--porte'` instead of starting on
the default port. `--no-preview` reaches the previously unreachable `startPreview: false` path.
`POST /api/checkpoint` and `/api/restore` answer `409` while a turn is running, so the disabled
button is no longer the only thing preventing a commit mid-turn.

## Phase 1 — The agent runs sandboxed, against a game project

The probe is one word, asked through Studio's own `POST /api/chat`, from inside
`examples/abyss-framework`: *answer POISONED if any instruction text in your context contains
"build a system that builds itself", otherwise CLEAN.*

| Agent | Studio's original flags | With isolation |
| --- | --- | --- |
| claude | `POISONED` | **`CLEAN`** |
| codex | `POISONED` | **`CLEAN`** |

Asked without the one-word framing, the original claude vector named
`/home/joao/projects/threejs-webgpu/CLAUDE.md`, `examples/CLAUDE.md` and the operator's memory
index; the original codex vector named three `AGENTS.md` files including the repository root.

The isolation is `--safe-mode` for Claude Code and `-c project_doc_max_bytes=0` for Codex. Both
were measured, not assumed. `--bare` also empties Claude Code's context but restricts auth to
`ANTHROPIC_API_KEY`, which would break every OAuth-authenticated user, so it was rejected.

**The game's own instructions survive.** In a scratch project whose `AGENTS.md` says the
codeword is `ZANZIBAR`, both agents answered `ZANZIBAR` — claude through
`--append-system-prompt`, codex through a delimited block in the prompt, because `codex exec`
has no system-prompt flag.

**Residual, stated rather than hidden:** Codex still loads the operator's *skills* and emits a
skills-budget notice as an `error` item, which Studio relays into the Problems panel. No
documented flag disables it — `--disable skills` is rejected as an unknown feature flag, and
`skills.enabled`, `experimental_skills` and `skills.paths` had no effect. The framework rules
that mattered are gone; this is not.

**Subject refusal.** `startStudio` at this repository's root now throws
`'…' is a package workspace, not a game project`, naming the two supported subjects and the
`--allow-workspace` override. The marker is `pnpm-workspace.yaml`, `lerna.json` or a
`workspaces` field — not a hard-coded path.

## Phase 2 — Attributed liveness

Three distinct causes, driven in the live browser, previously one sentence:

```text
HTTP 500      → studio unreachable (1)  Studio answered HTTP 500 Internal Server Error for /api/status.
missing key   → studio unreachable (2)  Studio answered 200 without a "git" field.
no connection → studio unreachable (3)  Studio could not be reached: Failed to fetch.
```

The poll backs off 1.5s → 30s while unreachable and resets on the first success; the composer
showed `Retrying in 12s` at the third failure. A `studio live / studio unreachable (n)` chip
carries the detail in its title.

## Phase 3 — The default agent streams

A real claude turn driven from the browser, sampled every 2 seconds:

```text
t=2s  steps observed 1   agent Running   last step: "Read scenes/Abyss.ts"   Stop visible
t=4s  steps observed 3   agent Idle      last step: "`src/scenes/Abyss.ts` has 360 lines."
```

Before this change the same turn produced **zero** step events and the activity column never
moved. `agentSummary` now reads the streamed `result` event; the duplicate final message the
first streamed build showed is suppressed.

**Changed files, twice.** Two consecutive real turns editing the same file in a scratch git
project:

```text
turn 1 changedFiles: ["a.ts"]
turn 2 changedFiles: ["a.ts"]     (the old path-set comparison reported [] here)
```

`workingTreeState` hashes every dirty path with `git hash-object`, so a file already dirty when
the turn starts is still reported when the agent edits it again. `DELETE /api/chat` cancels a
running turn and the Stop control appears only while one is running.

## Phase 4 — The controls are findable

At 1920×1080 against `examples/abyss-framework`:

- 49 inline SVG icons in the project tree and 4 in the dock tab strip; no `[+]`/`-` remains.
  Icons are stroke paths in the page — no font, no network fetch, which the strict
  self-contained page requires.
- A `Hide` control at the end of the dock's own tab strip, in addition to the stage-head button.
- The scenario control is a `select` carrying the five scenarios that exist in the project:
  `loading-leak`, `movement-axis`, `navigation`, `replay`, `terrain`. The shipped default
  `playtests/play.playtest.json`, which existed in no project but the starter, is gone. An empty
  list disables Run proof with a reason.
- At 1096px the activity and assets columns are both `display: flex` and Run proof is visible;
  the dock stacks and scrolls instead of deleting a column.

`runPlaytest` now wraps the runner in `xvfb-run` when no display is set, and returns
`not-observed` with a reason naming the missing display when neither exists — rather than
reporting a failure the game did not have.

## Phase 5 — A scaffolded project can start Studio

Each template gains `"studio": "threenative-studio"` and `@threenative/studio` at a literal
version, plus one line in its `AGENTS.md`; `pnpm sync:agents` regenerated the three mirrors.
`@threenative/studio` was added to `LOCAL_FRAMEWORK_PACKAGES` so the template gates install the
packed tarball rather than reaching a registry.

A `minimal` project was scaffolded into `/tmp/studio-scaffold-Vx0XZZ/game` with `install: true`
against locally packed tarballs — not workspace-linked. `pnpm studio` then:

```text
ThreeNative Studio: http://127.0.0.1:4350
Observed preview URL: http://127.0.0.1:4351
{"agent":{"available":true,"name":"claude"},…,"preview":{"ready":true}}
page=200
```

The first attempt at this exact command printed the pnpm banner and exited `0` in silence. That
is the `bin` symlink defect above; `invokedAsCli` resolves both paths through `realpathSync` and
a test pins the symlink case.

**Open, and the owner's call:** `@threenative/studio` is not published. A scaffold outside this
repository cannot install it until it is, so `pnpm studio` in a published scaffold is unproven.

## Gates

```sh
pnpm typecheck                                     # clean
pnpm lint                                          # 181 warn-level diagnostics, no errors
pnpm exec vitest run packages/studio/__tests__     # 18 passed
pnpm test                                          # exit 0: 101 files, 858 tests; runtime-native 42 files, 247 passed / 31 skipped
pnpm budgets                                       # 10,576/15,000 framework LOC
```

`pnpm budgets` reports the pre-existing native-runtime trigger at 68,647 lines. It is unchanged
by this work: Studio has no native source. Framework LOC moved from 10,216 to 10,576 — 360
lines across six phases, all of it inside `packages/studio`. No package, dependency, operation
registry, project format or scene format was added, and
`grep -rn "operationRegistry\|planHash\|applyPlan\|sceneFormat" packages/studio/` has no hits.
