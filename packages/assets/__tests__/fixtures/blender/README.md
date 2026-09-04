# Blender import fixtures

Two `.fbx` files, because one of them cannot be both real and committable.

## `flag_A_blue.fbx` — a genuine, untouched download

| | |
| --- | --- |
| Source | KayKit Platformer Pack 1.0 FREE, `Assets/fbx/blue/flag_A_blue.fbx` |
| Author | Kay Lousberg (KayKit) |
| Page | https://kaylousberg.itch.io/kaykit-platformer |
| Licence | **CC0** — no attribution required; do not resell the unmodified pack |
| Obtained | `asset_download_bundle_entry` (the asset MCP), 2026-09-03 |
| sha256 | `7f324fd4b1f0433d046f22d13e217e1a806209567220f6948eee32f60055a639` |
| Bytes | 32,876 |

Committed byte-for-byte as downloaded. Nothing in this repository has opened and re-saved it, so
it is a real third-party FBX writer's output, including its external `platformer_texture.png`
material reference — the shape a game author's own download has.

It is a prop: one mesh, one material, no skeleton, no clips.

## `character.fbx` — the rigged proof subject

Rigged (3 bones), 2 animation clips (`Idle`, `Wave`), 2 materials (`Skin`, `Cloth`), one embedded
64×64 texture, 620 triangles across 2 meshes. Regenerate it with:

```sh
blender --background --factory-startup --python make-character.py -- "$PWD/character.fbx"
```

**This one was authored here, and that is a deviation from PRD-346, which asks for a real Fab or
Sketchfab character.** Four sources were tried on 2026-09-03 and none produced a committable
rigged, multi-clip, multi-material `.fbx`:

| Source | Result |
| --- | --- |
| Sketchfab (`sketchfab_search_models` found several) | `sketchfab_get_downloads` → `SKETCHFAB_AUTH_REQUIRED`; needs `SKETCHFAB_API_TOKEN`. Its `source` archives are 0.2–390 MB. |
| Fab (`fab_search_assets`, free listings) | Free listings are added to an Epic library rather than downloaded directly; `fab_download_free_asset` covers only directly available files. |
| Quaternius Universal Animation Library (CC0, rigged, many clips) | itch.io returned HTTP 429 to every `asset_list_bundle_animations` and `asset_list_bundle_entries` call. |
| KayKit Platformer FREE (CC0, reachable — this pack) | Props only. No character, no armature, no actions in the free tier. |

The smallest genuinely rigged candidates found were 0.24–5.9 MB compressed *and* behind an
account. Committing a multi-megabyte binary into a repository whose `pnpm budgets` gate measures
evidence weight is its own defect, so the rig, the clips and the materials are authored by
`make-character.py` — which is committed, GPL-headed like every other file that runs inside
Blender, and reviewable line by line.

**What this costs, stated plainly:** `character.fbx` was written by Blender's own FBX exporter, so
the gate that converts it does not prove ThreeNative reads *another vendor's* FBX dialect for the
rigged case. `flag_A_blue.fbx` carries that half — it is Kay Lousberg's exporter's output, not
ours — and both run through the same pass. When a rigged third-party `.fbx` becomes reachable,
replace `character.fbx` and keep the assertions.

## What the gate reads

`blender-import.spec.ts` reads every produced GLB through `packages/assets/src/gltf-io.ts` — the
reader the runtime itself uses — never through the JSON summary `gpl/convert.py` printed. A summary
asserting about itself is manufactured evidence.
