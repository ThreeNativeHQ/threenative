# Vector texture census — PRD-099 Phase 0, 2026-08-22

Verdict: **PRD-099 is DECLINED under its own Phase 0 exit.** The decline condition reads: "if
no shipped template or example has flat-colour, icon-like or hard-edged art that KTX2 handles
badly, this is a solution without a problem." That condition is met by inventory, before any
scorer is needed.

## The complete raster-texture inventory (commands and output)

`find packages/create-threenative/templates examples -type f \( -name '*.png' -o -name '*.jpg'
-o -name '*.webp' \)` over everything not in `node_modules` or `dist/`, with sizes:

| Bytes | File | Reachable by the pipeline? |
|---|---|---|
| 150 | `templates/starter/assets/native-proof.png` | Yes — the only texture any shipped game loads through `ctx.assets.texture()` (`starter/src/scenes/Play.ts:49`) |
| 150 | `templates/{minimal,platformer,starter}/public/icon.png` | No — launcher icons consumed by the native packager, never sampled by a material |
| 117,101 | `templates/starter/playtests/textures-baseline.png` | No — playtest evidence artifact, not game art |
| 2,021,836 | `docs/benchmark/genres/platformer/reference.png` | No — documentation reference image |

Every favicon in the repo is already `.svg`. The templates' in-game art is otherwise
procedural (`CanvasTexture` in `src/render/shapes.ts`, `loading.ts`; plain geometries).

## Why the scorer was not built

The PRD's Phase 0 test table specifies a scorer validation ("hard-edged synthetic scores
worse than a photographic texture under ETC1S") for use on real assets. Two facts closed that
path, one practical and one principled:

1. Practical: a faithful ETC1S round-trip score needs encode → GPU-or-transcoder decode. The
   Basis transcoder JS glue in `three@0.185.1` does not load under Node by either require or
   import (UMD export resolves to nothing; verified twice), and building a browser-fixture
   harness purely to score a nonexistent asset set is disproportionate to a Phase 0 census.
2. Principled and decisive: the same PRD says "Building an MSDF pipeline for art nobody has is
   the kind of speculative abstraction this repo deletes." With exactly ONE pipeline-reachable
   in-game texture — a 16×16, 150-byte procedural toy whose magnification behaviour is
   meaningless — there is no subject for the scorer, no eligible "worst real asset" for
   Phase 1's proof, and no template material that could consume an MSDF node.

## What would reopen this PRD

A shipped template or example gaining flat-colour / icon-like / hard-edged **in-game** art
loaded through `ctx.assets.texture()` — at which point Phase 0 reruns with real subjects, the
scorer gets built against them first, and the worst-scoring asset becomes the proof subject.
The decline strands nothing: PRD-095's raster path is untouched, and the MSDF TSL node was
always going to be generated user source in `src/render/`, which needs no framework change.

## What this record does not claim

No measurement of KTX2-vs-MSDF quality on any texture was taken; none was possible on an empty
subject set, and the inventory above is the whole basis of the decision.
