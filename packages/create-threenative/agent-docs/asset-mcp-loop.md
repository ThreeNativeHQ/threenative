## Finding assets — you have an MCP server for this

**Reach for it when the asset is conventional; build anything custom yourself.** Textures,
materials, HDRIs, sound effects, and conventional models (a car, a crate, a tree) come from the
tools; anything specific to this game is written in `src/render/` — a downloaded model standing
in for a bespoke design reads as a weird asset dropped into the scene. When in doubt, build it
programmatically.

Installing `@threenative/core` writes the MCP config your host reads (Claude Code, Codex, Cursor,
VS Code, Gemini CLI, opencode, Zed), so `threenative-asset-mcp` tools appear beside yours. Your
host reads it from the launch directory: start the session here, not a parent. The loop:

1. `asset_search_sources` first, never a provider — its output is the authority on what is
   reachable.
2. `polyhaven_search_assets`, `ambientcg_search_assets`, or `audio_search_assets` to find
   candidates.
3. `polyhaven_list_files` / `ambientcg_list_files` **before downloading** — read licenses and
   pick a sane resolution there (a game does not need the 16k).
4. `asset_download_file` / `audio_download_asset` with `acceptLicense: true`; they write where
   configured, never where you pass a path.
5. Append file, source, license and URL to `CREDITS.md` before the turn ends.

**Never state a license you did not read off a tool result.**

**Fab is two steps.** `fab_search_assets` finds a free listing, and `fab_list_owned` says what the
account already paid for — a free search never shows those. Then `fab_import_asset` converts it: it checks the
entitlement, downloads through the FabCLI session you established yourself, turns every static
mesh into a textured `.glb` under `assets/`, and returns the paths. It refuses anything but Fab
Standard or CC-BY, and it never logs in, claims, or buys. Most Fab listings are Unreal-only, so
without it a listing is a dead end. Full argument shapes: `agent-docs/finding-assets.md`.

The full loop — ZIP unpacking rules, the two argument shapes that bite, and the narrower
marketplace tools — is `agent-docs/finding-assets.md`.
