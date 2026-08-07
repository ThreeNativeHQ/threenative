---
prd_contract: v1
---

# PRD-032 — Asset discovery: the scaffold hands the agent a licensed-asset tool

**Complexity: 3 → SMALL mode** (1-5 files +1, existing system +0, external dependency
wiring +2)

**Depends on:** nothing shipped is blocking. **Gated by** `docs/strategy/ROADMAP.md`
Phase 2 — do not start until Gate 0 exits on the "framework wins" branch.
**Blocks:** nothing.
**Charter authority:** `CHARTER.md` §10 (8 packages, 15,000 framework LOC), §11.5 (a
package exists only when it carries a dependency the others must not inherit), §9b (the
scaffold is the documentation); `AGENTS.md` rule 3 (never own the look), rule 1.

## 1. Context

**Problem:** an agent building a ThreeNative game has no way to find a 3D model or a sound
effect. It writes `BoxGeometry` because that is what is reachable, and the game looks like
programmer art regardless of how good the render layer is. `CHARTER.md` §3's visual column
is scored on what a stranger sees, and a well-lit grey box is still a grey box. The legacy
tree solved this and the solution was left behind.

**Files analyzed:** `packages/create-threenative/src/index.ts` (the entire scaffolder),
`packages/core/src/assets.ts`, `docs/product/ASSET-PIPELINE.md`,
`scripts/check-budgets.ts:56-69`, `docs/product/VISUAL-BASELINE.md`,
`../threejs-to-bevy/packages/asset-mcp/{README.md,package.json,src/**}`.

**Current behavior:**

| Fact | Evidence |
|---|---|
| The scaffolder writes no MCP configuration at all | `packages/create-threenative/src/index.ts` — no `.mcp.json`, no `mcpServers` key anywhere in `packages/create-threenative/` |
| Framework-side asset support is a ~90-line cached loader | `packages/core/src/assets.ts` — `model`, `texture`, `audio`, injectable per-kind loaders |
| A working asset MCP already exists, outside this repo | `../threejs-to-bevy/packages/asset-mcp` — `threenative-asset-mcp` v0.5.0, 10,847 LOC of TypeScript, 25+ tools |
| It covers six 3D sources plus a curated audio catalog | its `README.md` — Fab, Poly Haven, ambientCG, Smithsonian 3D, Sketchfab, itch, and audio across Sonniss, Kenney, Tallbeard, Scott Buckley, Mixkit, Pixabay, Freesound, OpenGameArt, Abstraction |
| It separates source discovery from verified direct download | `asset_search_sources` / `asset_list_sources` vs `asset_download_file`, `audio_download_asset`, `fab_download_free_asset` — only packs with stable official URLs and known license metadata are directly downloadable |
| The legacy scaffold launched it from the local install, not `npx -y` | its `README.md` install block — `node ./node_modules/threenative-asset-mcp/dist/index.js` |
| The budget script counts only workspace `packages/*/src` | `check-budgets.ts:56-69` — `filesUnder(packages/<name>/src)`, and `workspacePackageCount` for the 8-package cap |

**The deferral in `ASSET-PIPELINE.md` does not apply to this PRD, and this is the point
worth being precise about.** That document defers a *build-time optimization pipeline* —
glTF Transform, Meshopt/Draco, KTX2/Basis, LOD and collider generation — explicitly on
`CHARTER.md` §10 grounds: "starting it now would consume the 15,000 LOC cap." Asset
*discovery and licensing* is a different problem, solved by a process that runs beside the
agent rather than inside the build, and it consumes **zero** framework LOC and **zero**
workspace package slots. Its trigger conditions are therefore not the ones this PRD must
clear. If a reviewer disagrees, that is a charter question and it blocks this PRD.

## 2. Solution

- **The MCP server is never vendored into this workspace.** It stays the externally
  published `threenative-asset-mcp`, outside the `@threenative/*` scope. Copying 10,847
  lines into `packages/` would consume 72% of the 15,000 LOC cap and a ninth package slot
  against a cap of eight — both of which `CHARTER.md` §10 says are not raised.
- **The scaffolder writes `.mcp.json`** into the generated project, declaring the server
  by its local install path exactly as the legacy tree did. No `npx -y`: an asset tool that
  silently fetches and executes an unpinned package is a supply-chain hole in every game
  built with it.
- **`threenative-asset-mcp` is a dependency of the generated project, never of a
  `@threenative/*` package.** `core` must not inherit it; a test asserts this.
- **The generated `AGENTS.md` documents the tools the agent actually has**, per §9b (the
  scaffold is the documentation): search before download, `fab_get_asset` before making any
  license or price claim, and the rule that free-by-default search does not imply every
  license tier is free.
- **Licensing is surfaced, never asserted.** The generated docs carry each provider's
  attribution requirement — Poly Haven must be visibly credited and requires a unique
  User-Agent; Sketchfab licenses vary per model and downloads need a user API token; Fab's
  `/i/*` JSON routes are undocumented and may restrict automated access.

**Fails closed:** a `.mcp.json` naming a server path that does not resolve is a scaffold
test failure, not a warning. A generated project whose `package.json` lacks the dependency
its `.mcp.json` points at fails the scaffold smoke gate.

### Explicitly rejected

| Proposed | Why not |
|---|---|
| Vendor `asset-mcp` into `packages/` | 10,847 LOC against a 15,000 cap, and a ninth package against a cap of eight. §10: exceeding a cap is not a signal to raise the cap |
| Wrap the MCP in a `@threenative/assets` package | A package exists only when it carries a dependency the others must not inherit (§11.5). The MCP is a separate process; there is nothing to wrap and nothing to inherit |
| Add asset search to `packages/core/src/assets.ts` | That file loads assets at runtime. Discovery happens at authoring time, in the agent's tool loop, and never ships in the game |
| `npx -y threenative-asset-mcp` in the config | Executes an unpinned remote package in every generated project. The legacy tree already rejected this and launched the local install |
| Auto-download a starter asset pack during scaffold | Picks the look for the user, which is rule 3, and licenses assets on their behalf, which is worse |
| Start the build-time optimization pipeline in the same PRD | `ASSET-PIPELINE.md` defers it behind two measured triggers. Discovery does not unlock it |
| Ship it before Gate 0 closes | `ROADMAP.md` — Phase 2 does not start until the round-2 pair says the framework wins. Building capability onto an unmeasured product is how v1 reached 790k lines |

## 3. Integration Ledger

| # | New thing | Live caller (non-test) | Replaces | Old path removed? | Negative control |
|---|---|---|---|---|---|
| 1 | `.mcp.json` written by the scaffolder | `packages/create-threenative/src/index.ts` | nothing — no generated project has ever had MCP config | n/a | point `.mcp.json` at a path with no package installed → scaffold smoke fails instead of scaffolding a project whose tool never starts |
| 2 | `threenative-asset-mcp` in each template's `package.json` | the three generated `package.json` files | agents writing `BoxGeometry` because nothing else is reachable | n/a | add it to any `@threenative/*` package → new test fails: no workspace package may depend on it |
| 3 | Asset-tool section in each template's `AGENTS.md` | generated `AGENTS.md`, mirrored `CLAUDE.md` | undocumented tools the agent never calls | n/a | `pnpm sync:agents --check` fails on drift |
| 4 | Budget assertion: the MCP is external | `scripts/check-budgets.ts` | an unstated assumption | n/a | move the package into `packages/` → `pnpm budgets` fails on both the LOC and package caps |

**Reachability:** `pnpm create threenative my-game` → generated project has `.mcp.json` and
the dependency → the user's agent starts, sees `polyhaven_search_assets` and
`audio_search_assets` in its tool list → searches, reads the license through
`polyhaven_list_files`, downloads to `public/`, and loads it through the existing
`ctx.assets.model()`.

## 4. Phases

#### Phase 1: the server is consumable

**Files:** none in this repo.

Establish that `threenative-asset-mcp` v0.5.0 resolves from the registry. If it does not,
publishing it from `../threejs-to-bevy/packages/asset-mcp` is a prerequisite that happens
in that tree, under its own license and third-party notice review — not here. Re-verify
each provider's terms before publishing: the README's own status note calls Fab's routes
undocumented and subject to restriction, and a stale claim about someone else's licensing
is the one failure mode of this PRD that is not recoverable by a patch.

This phase closes with a resolvable version pinned in `pnpm-workspace.yaml`'s catalog, or
with a written finding that it is not publishable and this PRD is void.

#### Phase 2: the scaffold writes the config

**Files:** `packages/create-threenative/src/index.ts` EDIT ·
`packages/create-threenative/templates/{minimal,starter,platformer}/package.json` EDIT ·
`packages/create-threenative/__tests__/scaffold.spec.ts` EDIT.

Write `.mcp.json` with the local-install launch command. Add the dependency to each
template's `package.json` as a real version — templates ship literal versions, not
`catalog:`, and CI already asserts no `catalog:` survives scaffolding.

Tests: a scaffolded project contains `.mcp.json`; its `command`/`args` resolve to a file
under the project's own `node_modules`; no `@threenative/*` package in `packages/` lists
`threenative-asset-mcp` in any dependency field.

#### Phase 3: the agent knows the tools exist

**Files:** `packages/create-threenative/templates/*/AGENTS.md` EDIT ·
`packages/create-threenative/templates/*/CLAUDE.md` REGENERATED ·
`docs/product/ASSET-PIPELINE.md` EDIT · `docs/README.md` EDIT.

Document the search-then-verify order, the per-provider attribution requirements, and the
`fab_get_asset`-before-any-license-claim rule. Add a paragraph to `ASSET-PIPELINE.md`
separating discovery (shipped here, zero LOC) from the build-time pipeline (still deferred
behind its two triggers), so the next reader does not re-litigate this.

Run `pnpm sync:agents`.

#### Phase 4: gates

`pnpm typecheck && pnpm lint && pnpm test && pnpm budgets`, plus the scaffold smoke gate,
plus one live run: scaffold a project, have an agent search for and download one CC0 model
and one audio file, load both, and capture a frame through `pnpm visuals`. A PRD whose tool
has never been driven end to end by an agent is a design, not a system; this phase does not
close on green tests alone.
