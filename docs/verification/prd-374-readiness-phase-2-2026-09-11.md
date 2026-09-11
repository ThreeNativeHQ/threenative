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

Four of the phase's five-file budget. The planned `packages/core/mcp/install.d.mts` was written
and then reverted: giving the installer a declaration file made two previously untyped consumers
(`packages/core/__tests__/mcp-install.spec.ts`, `packages/create-threenative/__tests__/scaffold-mcp.spec.ts`)
type-check for the first time and would have widened the phase past its budget. Doctor uses the
`@ts-expect-error` import this repository's existing consumers of that module already use.

## Gates, with results

```
pnpm typecheck                                            exit 0, no diagnostics
pnpm lint                                                 exit 0 (biome check; format applied before commit)
pnpm check:docs                                           exit 0, 2027 links across 1066 files
pnpm exec vitest run packages/create-threenative/__tests__/   38 files, 656 tests passed
pnpm exec vitest run packages/core/__tests__/mcp-install.spec.ts scripts/__tests__/sync-agent-docs.spec.ts
                                                          2 files, 38 tests passed
```

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
`PATH=/usr/bin:/bin`:

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

## Independent review

PENDING — a fresh reviewer subagent has not yet seen this diff.
