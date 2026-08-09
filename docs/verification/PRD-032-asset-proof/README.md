# PRD-032 live-agent exit gate — 2026-08-09

**Result: FAIL.** The distribution path worked, but the no-MCP arm produced the better
crate. PRD-032's own Phase 5 kill switch fired.

## Subject and controls

- Commit under test: `e38439c677a72f8aabd16f4f0ea9b92661ff5831`.
- Both arms were fresh starter projects scaffolded from packed local framework tarballs.
- Brief: “give the crate a real material and a pickup sound.”
- The positive arm used the generated `.mcp.json`. The control's config was renamed to
  `.mcp.json.disabled` before its agent started. The control agent was forbidden from
  browsing or downloading manually and did not inspect the positive arm.
- Both final comparison frames are the initial state at 1600×900 in headed Chromium with
  WebGPU enabled. Both reported `navigator.gpu === true` and zero console/page errors.

## Positive arm: what the MCP proved

The lead agent followed only the generated `AGENTS.md` loop over the installed
`threenative-asset-mcp@0.4.0` stdio server:

1. `asset_search_sources(category: "texture")` returned Poly Haven as agent-ready, CC0,
   with visible Poly Haven API credit required.
2. `polyhaven_search_assets(query: "rusted metal", type: "textures")` selected
   `rusty_metal_05`; `polyhaven_list_files` supplied the URLs and MD5 values before any
   download.
3. Three `asset_download_file(..., acceptLicense: true)` calls wrote below
   `public/assets/`; `audio_download_asset(assetId: "kenney-interface-sounds",
   acceptLicense: true)` wrote below `public/audio/`.
4. `CREDITS.md` records only license, source, author and URL claims returned by those tool
   calls. No browser, `curl`, `wget`, manual download or human-pasted asset was used.

| File | Provider MD5 | Observed MD5 |
| --- | --- | --- |
| `rusty_metal_05_diff_1k.jpg` | `7662ff71242d7e11ff9aa647598d7e99` | `7662ff71242d7e11ff9aa647598d7e99` |
| `rusty_metal_05_nor_gl_1k.jpg` | `2cbf5ed10583b720d243bf5fae2fd9fa` | `2cbf5ed10583b720d243bf5fae2fd9fa` |
| `rusty_metal_05_rough_1k.jpg` | `0c03068b64bcae6f9272b6c1175f7d29` | `0c03068b64bcae6f9272b6c1175f7d29` |

The Kenney ZIP's MCP-returned and observed SHA-256 were both
`f2193d072726d6758a5f7871b2dcc54dcce0d5c35c6f0a62f92549b327c81232`.
The positive project passed `pnpm typecheck`, `vite build`, the headed `starter-pick`
scenario, and the headed `play` scenario (`score: 0 → 2`, zero diagnostics/network errors).

## Negative control and blind verdict

The isolated control agent obtained no external asset. It authored a varnished wood material,
steel braces and rivets in user-space Three.js and reused the starter's existing
`public/pickup.ogg`. Its typecheck and headed WebGPU capture passed with zero errors.

A fresh read-only critic saw only `with-mcp.png` as A and `without-mcp.png` as B:

| Criterion | A: with MCP | B: without MCP |
| --- | ---: | ---: |
| Crate readability | 2/5 | 5/5 |
| Material credibility | 4/5 | 3/5 |
| Scene fit | 3/5 | 4/5 |
| Overall visual improvement | 3/5 | 4/5 |

Verdict: **B**, medium confidence. The external texture was richer, but its dark values made
the crate difficult to identify; the authored control had the clearer silhouette, bracing
and scene integration. This is exactly Phase 5's declared deletion condition: the no-MCP arm
produced a good frame and beat the MCP arm.

## Harness defect found during the gate

The first scaffold `pnpm test` exited 0 without output because pnpm's `.bin` shim passed a
path whose lexical spelling differed from `import.meta.url`; the CLI entry guard therefore
never called `main()`. The gate was rerun only after the entry check used filesystem real
paths and an installed-path regression test passed. The original silent exit is the observed
negative control for that repair.
