# PRD-383 final develop reconciliation — 2026-09-14

PRD-383 was reconciled with `develop` at `05a4c6d2ce9392e586537aa75d50f646bca350d0` before merge qualification.

The mechanical reconciliation preserved PRD-383's published `threenative-asset-mcp@0.9.0` adoption and completed rigging guidance while taking current `develop` fixes. The two content conflicts were resolved as follows:

- `docs/midway-session-mining-2026-09-14.md`: retained current `develop`, whose links satisfy repository documentation validation.
- `packages/create-threenative/__tests__/scaffold.spec.ts`: retained PRD-383's explanatory history and regenerated every scaffold-tree expectation from the reconciled source tree.

The stale planning copy at `docs/PRDs/assets/PRD-383-rig-and-retarget-humanoids-through-the-asset-mcp.md` was removed because the completed PRD lives under `docs/PRDs/done/`.

The reconciled lockfile was regenerated from the combined tree. Targeted verification then passed for the complete scaffold suite plus the asset-MCP installation and capture-tool contracts, followed by repository documentation validation and `git diff --check`.

The one-shot reconciliation workflow removed itself after pushing the reconciled branch; this record remains as bounded evidence of the conflict-resolution decision and verification performed.
