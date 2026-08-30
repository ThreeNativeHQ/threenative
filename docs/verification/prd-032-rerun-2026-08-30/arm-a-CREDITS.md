# Credits

Every line below was read off an `ambientcg_list_files` or `asset_download_file` result from the
`threenative-assets` MCP server this project's `.mcp.json` configures. Nothing here is from memory.

## Textures

| File in `assets/` | Source asset | Provider | License | URL |
| --- | --- | --- | --- | --- |
| `cliff-color.jpg` | Rock 051, `Rock051_1K-JPG_Color.jpg` | ambientCG | CC0 | https://ambientcg.com/a/Rock051 |
| `cliff-normal.jpg` | Rock 051, `Rock051_1K-JPG_NormalGL.jpg` | ambientCG | CC0 | https://ambientcg.com/a/Rock051 |
| `cliff-roughness.jpg` | Rock 051, `Rock051_1K-JPG_Roughness.jpg` | ambientCG | CC0 | https://ambientcg.com/a/Rock051 |
| `deck-color.jpg` | Paving Stones 141, `PavingStones141_1K-JPG_Color.jpg` | ambientCG | CC0 | https://ambientcg.com/a/PavingStones141 |
| `deck-normal.jpg` | Paving Stones 141, `PavingStones141_1K-JPG_NormalGL.jpg` | ambientCG | CC0 | https://ambientcg.com/a/PavingStones141 |
| `deck-roughness.jpg` | Paving Stones 141, `PavingStones141_1K-JPG_Roughness.jpg` | ambientCG | CC0 | https://ambientcg.com/a/PavingStones141 |

`asset_search_sources` reported ambientCG as `"licenseSummary": "CC0"`, `"attribution": "Not
required"`; `ambientcg_list_files` reported `"license": "CC0"` for both assets. The attribution
above is kept anyway because a credit costs nothing and a missing one cannot be added later.

### Provenance

Downloaded through `asset_download_file` with `acceptLicense: true`, which wrote to the directory
`.mcp.json` configures:

- `Rock051_1K-JPG.zip` — 8,993,166 bytes, sha256
  `036c5c18beb3c63cca9411c898d3a42a6a0dd923b5672ee35b021cd81b888aa9`,
  from `https://ambientcg.com/get?file=Rock051_1K-JPG.zip`
- `PavingStones141_1K-JPG.zip` — 9,235,036 bytes, sha256
  `8b2da06651e31c2514eb476c46538b4d475b847da4dbed3dcceed93cda2ad6c6`,
  from `https://ambientcg.com/get?file=PavingStones141_1K-JPG.zip`

Only the colour, OpenGL normal, and roughness maps were kept out of each archive and copied into
`assets/` under the names above, so `ctx.assets.texture()` resolves them through the ordinary
manifest. The displacement, ambient-occlusion, metalness, DirectX-normal, `.blend`, `.usdc`,
`.mtlx` and `.tres` entries were not kept.

## Packaged with the starter

`assets/native-proof.glb`, `assets/native-proof.png` and `assets/pickup.wav` ship with
`create-threenative` and are unchanged.
