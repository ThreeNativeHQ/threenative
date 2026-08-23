# Framework LOC attribution — 2026-08-19

> Superseded on 2026-08-20 by the reconciled active attribution
> (`loc-attribution-2026-08-20.md`, itself deleted on 2026-08-22 when PRD-188 retired the
> attribution machinery; see `budgets-decommission-2026-08-22.md`).
> The historical measurement and package dispositions below are retained unchanged; the active
> verifier no longer consumes this record.

This is the historical framework counter baseline for PRD-161, captured from this lane's current
tree. It records the package composition at capture; it is not a deletion list and is not rewritten
by normal budget enforcement. Later movement is reported by `pnpm budgets`, but does not make that
gate fail solely because this historical record is stale.

Recorded framework LOC: 15,025

The numbers below come from the same file walk as `scripts/check-budgets.ts`. For every package
other than the salvage packages `playtest`, `asset-mcp`, and `shader-portable`, and other than
`runtime-native`, that walk counts `.ts`, `.tsx`, `.js`, and `.jsx` under `src/`, plus the native
source extensions and `CMakeLists.txt` anywhere in the package. The shared file set removes any
overlap between those two selections. A non-empty file contributes its split-line count, including
its final line; this is why this table is not a `wc -l` approximation.

Reproduction command:

```sh
node --import tsx/esm -e 'import { collectBudgets } from "./scripts/check-budgets.ts"; const report = await collectBudgets(process.cwd()); console.log(JSON.stringify({ frameworkLoc: report.frameworkLoc, frameworkLocByPackage: report.frameworkLocByPackage }, null, 2));'
```

One-shot baseline verification command:

```sh
pnpm exec tsx scripts/check-budgets.ts --verify-framework-loc-attribution
```

The one-shot command is intentionally separate from `pnpm budgets`: it fails closed when the
historical total or package rows no longer match the current walk, while normal budget enforcement
continues to report package movement, trigger overages, and the hard invariants.

## Counter reconciliation

| Source | Framework LOC |
| --- | ---: |
| Package rows below | 15,025 |
| `pnpm budgets` at baseline capture (`frameworkLoc`) | 15,025 |

The totals reconcile exactly. `LIMITS` remains `frameworkLoc: 15,000` and
`nativeRuntimeLoc: 50,000`; this PRD does not raise either limit.

The current normal `pnpm budgets` snapshot reports 7 framework packages, 7 example workspaces,
15,025/15,000 framework LOC, 78,289/50,000 native runtime LOC, 11 direct PRD files, and largest
template 2,246 LOC. Both review triggers remain visible; the framework trigger names package
movement since this baseline rather than failing because a later record is stale.

## Repaired deletion sweep

Command: `pnpm round:deletions`

Result at baseline capture: exit `0`; current round `10`; previous round `9`; `noFrameworkArms:
[10]`; candidates: `[]`. The rendered report names round 10 as a declared no-arms round and does
not treat its missing framework arm as deletion evidence. The malformed paired-round controls still
throw when a framework row is missing and when a normal genre retains an empty Arms table.

## Package attribution and kill-switch dispositions

The five counted packages are the largest framework surfaces in this baseline. The disposition is
about the package surface as a whole; a future deletion needs the repaired sweep to identify the
same export across consecutive framework-arm rounds.

| Package | Counted LOC | Could the game write it portably? | Does it decide the game's look? | Disposition | Evidence and reason |
| --- | ---: | --- | --- | --- | --- |
| `core` | 7,832 | No — renderer/bootstrap, host seams, lifecycle, input, assets, and inspection must work on web and native. | No — the package owns mechanisms and leaves materials, lights, shaders, camera framing, and post to generated render source. | **Earned** | Live callers: `examples/abyss-framework/src/main.tsx:1` and `packages/create-threenative/templates/starter/src/game.ts:1`. The package passes both questions. |
| `physics` | 4,205 | No — Rapier/Recast WASM and the native bulk backend are the dependency boundary; the game cannot supply that portably. | No — bodies and queries bind supplied Three.js objects and do not choose their materials or composition. | **Earned** | Live callers: `examples/abyss-framework/src/navigation-main.tsx:3` and `packages/create-threenative/templates/starter/src/scenes/Play.ts:2`. The shared backend surface is reached outside tests. |
| `create-threenative` | 2,491 | No — scaffold, package wiring, and the four-command project contract are framework tooling rather than game code. | No — generated `src/render/` remains user source; the package only copies and validates it. | **Earned** | Live callers: `scripts/visual-gate.ts:315` and `packages/create-threenative/templates/starter/vite.config.ts:3`. The generator and generated project contract are live. |
| `engine-mcp` | 289 | No — the offline capability server is the framework's discovery contract, not a game feature. | No — it reports imports, constraints, and examples without rendering anything. | **Earned** | Live callers: `packages/create-threenative/src/index.ts:374` and `packages/create-threenative/templates/starter/.mcp.json:17`. The generated project wires the discovery server outside tests. |
| `ui` | 208 | Undecided — a bespoke UI can be game-owned, while the shared React canvas/store and diagnostics seam may still be the portable boundary. | Undecided — the generic diagnostics overlay has fixed presentation that needs a visual-boundary audit. | **Undecided** | Live callers include `examples/abyss-framework/src/ui/App.tsx:2-3` and the starter template's `src/ui/App.tsx:3`. Evidence still needed: audit `DebugOverlay` and `GameCanvas` against the generated-source look rule, then either retain the generic diagnostics mechanism or move any game-facing appearance into generated UI source. |
| **Total** | **15,025** |  |  |  |  |

There is no **Deletable** row. Round 10 is explicitly declared no-arms, so the repaired sweep has
no current framework archive and returns no consecutive-round candidate. Treating that absence as
deletion evidence would recreate the fail-closed defect. No export or file was deleted in this
pass.

## What this table does and does not claim

- `Earned` rows name live callers outside their own tests and pass both questions. They are not
  permission to add appearance decisions or to grow without another attribution.
- `Undecided` is evidence debt, not a hidden keep: the next evidence is named in the row.
- No browser, device, mobile, physical Android, or iOS result is claimed by this record.
