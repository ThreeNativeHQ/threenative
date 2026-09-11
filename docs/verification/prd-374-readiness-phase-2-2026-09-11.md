# PRD-374 phase 2 — tool discovery explains external applications and editor setup

Date: 2026-09-11. Base: `4568451c9` (`prd374/doctor-target-prerequisites`). Platform: linux-x64,
Node v20.19.6, pnpm 10.25.0. Every command below was executed; nothing here is projected.

## What changed

`threenative doctor` reported one fused fact where there are four. A healthy report read
`capability search: all three configured MCP servers resolve` — wrong about the count since the
fourth server landed, and, worse, read as a complete authoring toolchain on the strength of four
processes that started. Blender's server starts on a machine with no Blender; `.mcp.json` is one
of **seven** project-scoped host configs the installer writes, and doctor consulted only that one.

The report now separates:

| Check | Fact |
| --- | --- |
| `capability search` | transport: the server starts and advertises tools. Its detail now says "transport only, external applications are reported separately" in both the healthy and the degraded wording. |
| `editor activation` | which of `MCP_HOSTS`' seven project-scoped configs carry the servers, which are unreadable or incomplete (named by exact path), and the hosts that read a machine-wide config only. It states that activation itself is not observable from a CLI rather than implying it. |
| `model conversion` | the Blender executable, and separately the transport of the server that drives it. Renamed from `blender`. |
| `model conversion` detail | whether a conversion actually ran, read from `public/assets.manifest.json` entries carrying `importedFrom`. Absent manifest reads "no conversion is proven". |

The host table is read from `packages/core/mcp/install.mjs` (`MCP_HOSTS`) and the Blender server
name from `MCP_SERVERS` by its shim, not retyped — a renamed server or an eighth host cannot
leave doctor quietly describing a project that no longer exists.

Status rule kept from the incumbent: a missing Blender is `warn`, never `fail`, so a game with no
importable source stays green; the hard failure stays in `blenderImportPass`. A **broken
transport** does fail — that is a package the project installed, not an application it declined.

## Files

- `packages/create-threenative/src/doctor.ts`
- `packages/create-threenative/__tests__/doctor.spec.ts`
- `packages/create-threenative/README.md`
- this record

All five of the phase's file budget. `packages/core/mcp/install.d.mts` was written and reverted
once, then written for good in `199aebed8`: doctor's `@ts-expect-error` import of the installer is
a suppression-class finding that `pnpm quality` fails closed on, and it failed both `budgets` and
`test-unit (2/3)` on PR #198. Typing the installer once — the pattern `servers.d.mts` already
establishes — removes the directive from all five of its TypeScript consumers instead of waiving
it at one site, at the cost of a one-line deletion in three further files
(`packages/core/__tests__/mcp-install.spec.ts`, `packages/create-threenative/__tests__/scaffold-mcp.spec.ts`,
`scripts/sync-mcp-configs.ts`).

## Gates, with results

```
pnpm typecheck                                            exit 0, no diagnostics
pnpm lint                                                 exit 0 (biome check; format applied before commit)
pnpm check:docs                                           exit 0, 2027 links across 1066 files
pnpm exec vitest run packages/create-threenative/__tests__/   38 files, 656 tests passed
pnpm exec vitest run packages/core/__tests__/mcp-install.spec.ts scripts/__tests__/sync-agent-docs.spec.ts
                                                          2 files, 38 tests passed
pnpm budgets                                              exit 0
```

`pnpm budgets` was red when phase 2 was committed, and the independent reviewer caught it, not this
record. Phase 1's evidence file took `docs/verification` to 830 tracked files while
`docs/benchmark/SCREENSHOT-RETENTION.md` still recorded 829, so `generate-retention-index.ts
--check` failed. Regenerated with `pnpm tsx scripts/generate-retention-index.ts` — never
hand-edited, as the retention rules require — and committed. The lesson is the reviewer's, and it is
the gate the PRD's own verification contract names for executable changes.

**It stales on every edit, not only on a new file.** The index records tracked *bytes* as well as
counts, so editing this very record invalidates it again. Regenerate it as the last step before
committing anything under `docs/verification/`, or `pnpm budgets` goes red one commit later.

`doctor.spec.ts` went 68 → 75 tests; with `cli.spec.ts`, 73 → 80.

## Observed red, then restored green

**Red 1 — the incumbent tests.** Renaming `blender` to `model conversion` broke exactly the three
tests that asserted the old fused check, before any new test was written:

```
× should warn, not fail, when Blender is absent
× should report the version when Blender resolves
× should name the sources that need Blender when the project carries them
Tests  3 failed | 65 passed (68)
```

**Red 2 — a real project, not a fixture.** A project at
`$SCRATCH/verify-game` declaring `@threenative/core`, with all seven host configs written by the
installer's own `ensureJsonMcpConfig`/`ensureCodexMcpConfig`, run against the built CLI
(`packages/create-threenative/dist/threenative.js`).

Green, before breaking anything:

```
✓ editor activation: 7 of 7 host configs carry the servers (Claude Code, Codex, Cursor, VS Code,
  Gemini CLI, opencode, Zed); whether an editor loaded one is not observable from here. Windsurf,
  Cline, Amp, the JetBrains assistants read a machine-wide config only and are wired by hand
✓ model conversion: threenative-blender was not probed and Blender 5.2.0 converts .fbx, .blend,
  .obj and .dae on this machine; no bake manifest here, so no conversion is proven
```

The control the phase asks for — remove Blender from the probe path while keeping its server
bundle, and remove one declared MCP entry separately. `.vscode/mcp.json` overwritten with
`{ not json`, `threenative-blender` deleted from `.zed/settings.json`, and a second run with
`PATH=/usr/bin:/bin` **and `HOME` scrubbed** — the second independent review showed `PATH` alone
does not reproduce this, because `resolveBlender` falls back to `$HOME/.local/bin/blender`
(`packages/blender-mcp/src/detect.ts:104`), where Blender 5.2.0 lives on this machine:

```
! editor activation: .vscode/mcp.json is unreadable; .zed/settings.json is missing ThreeNative
  servers — 5 of 7 host configs are complete
    fix: Reinstall @threenative/core to rewrite the host configs it owns, or restore the listed
    file by hand; doctor never edits it.
! model conversion: threenative-blender was not probed, but conversion is unavailable: No Blender
  4.2 or newer was found. … — no .fbx, .blend, .obj or .dae in this project, so nothing needs it
  yet; no bake manifest here, so no conversion is proven
```

Restoring `.vscode/mcp.json` and re-running `ensureJsonMcpConfig(…, ".zed/settings.json", "zed")`
(which returned `updated`) returns both checks to the green text above. The malformed config was
**preserved**, not rewritten, and its exact path is what the report named.

## User verification

Run on linux-x64 with the real built CLI in two real projects.

- `examples/engine-load-test`, which has no `.mcp.json`: `editor activation` fails and lists all
  seven paths it looked for, so the next action is a path, not a guess.
- The scaffolded-shape project above: the four facts read separately, and the one fact a CLI cannot
  observe says so in the report rather than being folded into a tick.

A reader is never told the toolchain is complete on the strength of a process that started.

## Independent review — FAIL, then repaired

A fresh reviewer subagent returned **FAIL** on this phase with seven defects. It re-ran the gates
itself, mutated the implementation five ways and confirmed a distinct test catches each, and
verified on the real CLI that a malformed host config is left **byte-identical** (md5 before and
after) while its exact path is named. It judged the `warn`-not-`fail` decision for a missing Blender
correct and the derivation of `BLENDER_SERVER` and `MCP_HOST_TABLE` sound.

Two defects were blocking, and both were real:

1. **Severity was inverted.** `editorActivationCheck` tested "some config is broken" before "nothing
   is wired", so a project where **no** host worked reported `warn`, while a project merely missing
   the files reported `fail`. Corrupting a config *downgraded* the report. The zero-wired branch is
   now first.
2. **The central claim was half-delivered, and the halves contradicted each other.** Only the new
   check was widened to seven hosts; `mcpConfig` and the health-probe gate still keyed on
   `.mcp.json`. A correctly wired Cursor-only project got:

   ```
   ✗ capability search: no .mcp.json, so an agent here cannot search engine capabilities …
   ✓ editor activation: 1 of 7 host configs carry the servers (Cursor); …
   ```

   Exit 1 for a user whose setup was fine. `mcpConfig` now reads every host whose format this file
   can validate by shape — the `mcpServers` table Claude Code, Cursor and the Gemini CLI share — in
   the installer's own order, and the probe gate follows it. The same project now reports against
   `.cursor/mcp.json` and the two checks agree.

   The four remaining formats (VS Code, Zed, opencode, Codex) each spell a server differently, and
   reproducing them here would be a second copy of the installer's `SERVER_FORMATS`. They are
   reported by name presence in `editor activation`, and `capability search` **warns** rather than
   failing when one of them is the only thing wired, naming it. Both facts are stated; neither is
   inflated into the other, and the record no longer claims more than was built.

The rest, also fixed:

- **`ok` at 1 of 7 now says why** — "one is enough for the host you work in" — instead of showing a
  green tick a reader would take for a miscount.
- **The machine-wide-host sentence reaches the `fail` branch**, which is the audience that most
  needs it: a Windsurf or JetBrains user was getting a bare hard failure listing seven files none of
  their tools read.
- **`MANUAL_GLOBAL_MCP_HOSTS` is still retyped** — it exists only as prose in the installer, so it
  cannot be derived. A module-load guard now throws if core ever wires one of those four
  project-scoped, which is the only way the sentence doctor prints could silently become false.
- **`pnpm budgets` was missing from this phase's gate list and was red.** Both fixed above.

One box was **unticked** as a result, and stays open: see phase 2's user-verification line in the
PRD. `mcpServerHealth` is populated only when a validatable config exists *and* the shim resolves,
so both real-project runs above report `threenative-blender was not probed`. Transport-up-with-
Blender-missing — the headline separation — is proven by unit fixture, not by a real project. That
is narrower than "the four facts read separately in a real run", and the box should not claim it.

## User verification, closed 2026-09-11 (second execution session)

The independent review left this open because `mcpServerHealth` was only populated when a shim
resolved, so every real run printed `threenative-blender was not probed` and the headline
separation was fixture-only. Run in `../sandbox/caravel` — a real game with `@threenative/core`
installed, outside this repository — with Blender removed from both `PATH` and `HOME`:

```
! model conversion: threenative-blender transport is up, but conversion is unavailable: No Blender
  4.2 or newer was found. Set THREENATIVE_BLENDER_PATH, or install it: … — no .fbx, .blend, .obj
  or .dae in this project, so nothing needs it yet; no bake manifest here, so no conversion is proven
✓ editor activation: 7 of 7 host configs carry the servers (Claude Code, Codex, Cursor, VS Code,
  Gemini CLI, opencode, Zed); one is enough for the host you work in. Whether an editor loaded it
  is not observable from here
✓ capability search: threenative-sculpt-mcp: threenative-sculpt resolves threenative-sculpt-mcp@0.1.1;
  transport initialized and advertised 5 tool(s)
```

No `was not probed` line appears. The same project with Blender on `PATH` reports
`threenative-blender transport is up and Blender 5.2.0 converts .fbx, .blend, .obj and .dae on this
machine; no bake manifest here, so no conversion is proven` — transport, external application and
executed operation, three separate facts in one line, in a real run.

## Second independent review, 2026-09-11 — FAIL, two defects fixed here

1. **Every per-server message hardcoded `.mcp.json`** while the summary named the host actually
   read. A Cursor-only project printed `threenative-engine is missing from .mcp.json` with a fix
   naming a file that does not exist. The host file is now threaded through `mcpServerCheck`.
2. **`mcpConfig` took the first host that *parses*,** not the one carrying the servers. A project
   with all seven configs correctly wired but a user-owned `.mcp.json` holding their own table
   reported `0 of 4 server(s) in .mcp.json resolve` and exit 1, beside `editor activation: 7 of 7`.
   It now picks the table carrying the most ThreeNative servers, the installer's host order
   breaking ties.

Observed red first, both: `should name the host config it actually read in every per-server
message` and `should diagnose the host config that carries the servers, not the first that parses`
fail against the pre-fix implementation (`3 failed | 81 passed`, with phase 1's blocker test) and
pass after (`84 passed`). Confirmed on the real built CLI in a temporary project wired by
`ensureHostMcpConfigs`: with a user-owned `.mcp.json` the summary now reads
`0 of 4 server(s) in .cursor/mcp.json resolve`, and with `threenative-assets` deleted from Cursor's
table the per-server line reads `threenative-assets is missing from .cursor/mcp.json`.

Gates after the fixes: `pnpm typecheck` 0, `pnpm lint` 0, `pnpm quality` 0,
`pnpm exec vitest run packages/create-threenative/__tests__` **665 passed across 38 files**.
