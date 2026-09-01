---
name: threenative-assets
description: Find, import, license, or sculpt assets for a portable ThreeNative game.
---

# ThreeNative assets and sculpting

Use tools for conventional textures, materials, HDRIs, sounds, and models; write bespoke visuals
in `src/render/`. Start the session from the game root so the project-scoped MCP config is read.

1. Run `asset_search_sources` to learn what is reachable, then search with
   `polyhaven_search_assets`, `ambientcg_search_assets`, or `audio_search_assets`.
2. List files with `polyhaven_list_files`/`ambientcg_list_files` before downloading; read the
   license and choose a sane resolution.
3. Download with `asset_download_file`/`audio_download_asset` and `acceptLicense: true`; tools
   write to the configured project directory.
4. Add file, source, license, and URL to `CREDITS.md`. Never state a license not returned by a tool.

Fab is `fab_search_assets`, then `fab_list_owned`, then `fab_import_asset`; it checks entitlement,
downloads through the user's existing FabCLI session, writes textured `.glb` files under `assets/`,
and accepts only Fab Standard or CC-BY. It never logs in, claims, or buys. Full arguments:
`agent-docs/finding-assets.md`.

Choose the sculpt branch before coding: conventional → asset tools; trivial → portable geometry;
bespoke with a reference → `sculpt_plan`, `sculpt_spec_gate` until every region passes, one
factory per pass in `src/render/`, then `sculpt_compare` and `sculpt_pass_gate` against a real
capture; bespoke without a reference → ask for one. `sculpt_grimoire` supplies techniques.
`threenative-sculpt-mcp` guides source and never launches a browser. A missing/blank capture fails;
credit the reference before the turn ends. See `agent-docs/sculpt-from-a-reference.md`.
