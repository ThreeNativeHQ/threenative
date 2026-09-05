---
prd_contract: v1
---

# PRD-354 — the manifest never names an import a scaffolded game cannot resolve

**Status: PROPOSED, 2026-09-04.** Filed into
[`astra-batch-2026-09-04`](./README.md), measured at `dae30759`.

**Complexity:** +3 for 10+ files (ten templates, the generator, the scaffolder, the reference
doc, the gate and its spec), +2 for multi-package (`create-threenative`, `engine-mcp`,
`scripts/`) = **5 → MEDIUM mode.**

## 1. Context

**Problem.** The capability manifest is the framework's answer to *"an LLM's greatest weakness is
discovering bespoke API surfaces"*. Every entry carries an `importPath` and an `example`, and the
root `AGENTS.md` instructs every agent to search the manifest and obey what it returns. **Twenty-
seven of its 272 entries hand back an import a scaffolded game cannot resolve.**

```
$ node -e "const a=require('./packages/create-threenative/capabilities.json').entries;
  const u=a.filter(e=>/raw-unreal|ueformat/.test(e.importPath));
  console.log(a.length, u.length,
    u.filter(e=>/raw-unreal/.test(e.importPath)).length,
    u.filter(e=>/ueformat/.test(e.importPath)).length)"
272 27 21 6
```

**Current behaviour.** All ten templates in `packages/create-threenative/templates/` were read at
`dae30759`:

| Package | Installed by | As |
| --- | --- | --- |
| `@threenative/core` | 10 / 10 | dependency |
| `@threenative/physics` | 10 / 10 | dependency |
| `@threenative/ui` | 9 / 10 (not `minimal`) | dependency |
| `@threenative/assets` | 10 / 10 | devDependency |
| `@threenative/playtest` | 10 / 10 | devDependency |
| **`@threenative/raw-unreal`** | **0 / 10** | — |
| **`@threenative/ueformat`** | **0 / 10** | — |

Both unlisted packages are public and published at `0.1.0`. This is a scaffold gap, not the
unpublished-workspace-dependency failure the repository has hit before — the packages install fine
if a project asks for them. **Nothing asks, and nothing tells the agent to ask.**

The 27 symbols include `createThreeObject`, `createThreeGeometry`, `decompressBulkData`,
`decompressCompressedBuffer`, `findBulkDataHeaders`, `findCompressedBufferOffsets`. An agent that
follows the instruction it was given — search, read the detail, obey the constraints, use the
`importPath` — writes an import that does not resolve, and then discovers this at build time with
no hint that the fix is an install rather than a typo.

**Why this outranks ordinary manifest hygiene.** A manifest miss (PRD-301, PRD-324) costs an agent
a rewrite of something that exists — bad, and measured. A manifest entry that *cannot be used*
costs something worse: it teaches the agent that the manifest is unreliable, on the first import it
tries. The repository's whole discovery strategy is one trust relationship, and 27 entries are
spending it.

**Files analyzed.** `packages/create-threenative/capabilities.json` (272 entries),
`packages/core/capabilities.json` (mirror), `scripts/build-capability-manifest.ts` (615),
`scripts/generate-capability-reference.ts`, `packages/engine-mcp/src/index.ts`,
`packages/create-threenative/templates/*/package.json` (10),
`packages/create-threenative/src/index.ts`, `packages/raw-unreal/package.json`,
`packages/ueformat/package.json`.

**Overlap check.** Every open PRD was surveyed on 2026-09-04.

- **PRD-301** (now beside this file) — *manifest covers every shipped package*. The exact inverse: 301 adds
  packages the manifest omits, this adds a resolvability contract to what it already names. **Both
  edit `scripts/build-capability-manifest.ts`; land them in one commit** or the second rebases onto
  a generator that no longer matches its Phase 0 measurement.
- **PRD-324** (now beside this file) — *the manifest cannot forget an export*. Authoring-side drift,
  not consumer-side resolvability. Complementary; its gate is the natural host for §2's check.
- **PRD-297 / PRD-298 / PRD-300** (now beside this file) — recall quality. Orthogonal: all three are about
  whether the right entry is *returned*, this is about whether a returned entry *works*.
- **PRD-185** (`package-naming/`) — naming law. Touches the same package list and must not be
  resolved by renaming; if it lands first, re-run §1's table before pasting a red.

## 2. Solution

**One rule: every `importPath` in the manifest is resolvable from a scaffolded project, or the
entry says how to make it resolvable.**

Three ways to satisfy it, decided per package in Phase 0 rather than assumed here:

- **(a) the scaffold installs it** — right when a template's own code needs it, or when the
  capability is one a game reaches for often enough that the dependency is the honest default;
- **(b) the entry declares its install** — a new `requires` field the MCP search result and
  `agent-docs/capability-reference.md` print verbatim (`npm i @threenative/raw-unreal`), which is
  the honest answer for a capability a game reaches only when it is importing Unreal content;
- **(c) the entry leaves the manifest** — right if the symbol is tooling the MCP server calls on
  the agent's behalf and no game should import at all.

My reading of the six sampled symbols is that **(b)** fits `raw-unreal` and `ueformat`: they are
real, published, game-reachable APIs for a job most games never do. But that is a call Phase 0
makes with the importer's actual call sites in front of it, not a decision this PRD pre-empts.

**The trap that makes a naive gate useless.** The workspace resolves everything. A check that
`import()`s each `importPath` from the repository root passes on all 272 entries today and proves
nothing — it is measuring pnpm's workspace linking, not a user's `node_modules`. The gate must
compute resolvability from **the dependency closure a scaffolded project actually gets**: the
chosen template's `dependencies` + `devDependencies` + whatever `create-threenative/src/index.ts`
writes, and nothing else. Phase 0 pastes both readings side by side so the difference is on record.

## 3. Integration Ledger

| # | New thing | Live caller | Replaces | Negative control |
|---|---|---|---|---|
| 1 | Resolvability check over every distinct `importPath` | `scripts/build-capability-manifest.ts` → `pnpm budgets` | nothing — no bound exists | Add a fake entry importing `@threenative/nope`; the gate names it |
| 2 | `requires` field on an entry, emitted from a doc tag | the generator; consumed by `engine-mcp` search results and `generate-capability-reference.ts` | the silent unresolvable import | Strip the tag from one `raw-unreal` export; the gate fails naming that symbol |
| 3 | Scaffold-closure resolver (not the workspace) | the same gate | a root-relative `import()` that always passes | Run the old root-relative form against the same manifest; it reports 0 problems where the new one reports 27 |
| 4 | `requires` reaches the agent | `packages/engine-mcp/src/index.ts` search + detail output | a bare `importPath` | Search for `createThreeObject` via the MCP tool; the install line is in the result text |

## 4. Phases

**Phase 0 — the red, and the per-package ruling.** Paste the 27-entry count. Paste the
root-relative resolver reporting zero, beside the scaffold-closure resolver reporting 27 — that
pair *is* the red, and it is also the proof the instrument is not measuring pnpm. Then read the
importer's call sites and rule (a) / (b) / (c) for `raw-unreal` and for `ueformat` separately;
record the ruling and its reversal condition in this file.

**Phase 1 — the resolver.** Compute the scaffold dependency closure per template. It must be
derived from the template manifests and the scaffolder, never hard-coded, or it becomes the
sixth hand-maintained package enumeration in this repository.

**Phase 2 — the gate**, wired through `pnpm budgets` beside the existing capability checks. Fail
closed: an entry whose `importPath` is neither in the closure nor carrying `requires` fails.

**Phase 3 — the ruling, applied.** Whichever of (a)/(b)/(c) Phase 0 chose, for both packages.
If (b): the doc tag, the generator field, both manifest copies, the MCP output and
`capability-reference.md`.

**Phase 4 — the agent actually sees it.** An `engine_capability_detail` call on one affected
symbol prints the install line. Paste the tool output, not the JSON.

## 5. Acceptance criteria

- [ ] **AC1 — the red is a pair.** Root-relative resolver: 0 problems. Scaffold-closure resolver:
      27. Both pasted, same manifest, same commit. Without this pair the gate is unfalsifiable.
- [ ] **AC2 — a fabricated bad entry fails.** An entry importing `@threenative/nope` → `pnpm
      budgets` fails naming the symbol and the package. Red pasted.
- [ ] **AC3 — the 27 are resolved.** After Phase 3, the gate reports zero unresolvable entries, and
      the resolution is the one Phase 0 ruled — not a suppression list. A suppression list fails
      this criterion.
- [ ] **AC4 — the closure is derived.** Deleting `@threenative/ui` from one template's
      `dependencies` makes the gate fail on that template's UI capabilities. Red pasted. This is the
      control that proves the closure is read, not typed.
- [ ] **AC5 — the agent-visible path.** `engine_capability_detail` on `createThreeObject` returns
      text containing the install instruction. Output pasted.
- [ ] **AC6 — both manifest copies agree.** `packages/create-threenative/capabilities.json` and
      `packages/core/capabilities.json` carry the same fields; `pnpm capabilities:check` green.
- [ ] **AC7 — sealed corpus untouched.** No `docs/benchmark/genres/*/brief.md` text enters either
      manifest copy. `git diff --stat` on `docs/benchmark/` is empty.
- [ ] **AC8 — gates.** `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, output pasted.

## 6. Decline conditions

Close as DECLINED if Phase 0 finds that `raw-unreal` and `ueformat` symbols are only ever called by
the MCP server on the agent's behalf and no game should import them — in which case the correct
change is **(c)**, deleting 27 entries, which is a five-line generator filter and does not need a
PRD. Record the finding, make the deletion, and close this file citing it.

Close as DECLINED if the scaffold closure cannot be derived without hard-coding a package list. A
sixth hand-maintained enumeration costs more than the 27 entries do.
