# package-naming — the npm surface speaks one law

Filed 2026-08-22 from the owner's naming audit, after `batch-2026-08-22-defects` closed (the
batch folder that briefly held this PRD was archived under it by a concurrent lane; nothing was
lost — evidence re-verified at HEAD `8033dc50` before filing here).

## 1. [PRD-185](./PRD-185-package-naming-law.md) — one naming law for the npm surface

Five workspace packages are scoped, the MCP layer runs on three more schemes
(`threenative-engine-mcp`, `threenative-asset-mcp`/`threenative-sculpt-mcp`,
`.mcp.json` keys without `-mcp`), and no document says which is standard. This PRD states the
law, renames the one in-tree offender with every live reference, declares the two externally-
owned servers as owner-tracked waivers, and makes the doc gate enforce all of it
bidirectionally.

Estimate: Phase 1+2 half a day including publish coordination; Phase 3 an hour.
