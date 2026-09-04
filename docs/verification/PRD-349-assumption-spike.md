# PRD-349 — assumption spike, 2026-09-04

Run before implementation, to kill wrong assumptions cheaply. Subject: **6 real wildwood pines**
(`SM_pine01..05`, `SM_pine-small01`) from the Landscape Pro pack, compiled with the **installed**
`@threenative/assets@0.3.0` — not the engine working tree.

```
config: { models: { sharedImages: true } }      // textures absent = defaults = on
```

## What was proved

| # | Assumption | Verdict | Evidence |
|---|---|---|---|
| 1 | The cook works on real Unreal-derived assets | **CONFIRMED** | 55.2 MB → **4.97 MB (-90.6%)**, 6 models, 25 s |
| 2 | `sharedImages` dedupes *across separate model files* | **CONFIRMED** | `shared/images/` holds **4 files, 3.68 MB** — 4 textures written once, not 6× (would have been 22.1 MB) |
| 3 | The model pass accepts input that is *already* meshopt-compressed | **CONFIRMED** | all 6 inputs carry `EXT_meshopt_compression`; all 6 recompiled without error |
| 4 | Output is structurally loadable | **CONFIRMED** | `KHR_texture_basisu` in `extensionsRequired`; images carry `uri: shared/images/<hash>.uastc.ktx2`; `basis_transcoder.js` + `.wasm` copied into the output root automatically |
| 5 | The manifest records the shared store | **CONFIRMED (better than assumed)** | each entry carries a `sharedImages[]` array with `codec`, `key`, `bytes`, `output` — the reporting the PRD wanted already exists |
| 6 | Quality survives at unchanged resolution | **CONFIRMED** | `0 resized`; both sides 1024², SSIM 0.9689-0.9903 (table below) |
| 7 | **`needSupercompression: true` shrinks UASTC** | **REFUTED** | **0.0% on all four textures.** Raw UASTC blocks are high-entropy; zstd only pays once RDO has made them compressible. |

### Quality, measured (global SSIM on luma, 8×8 windows)

| Texture | SSIM | mean abs err | p99 | PNG → KTX2 |
|---|---|---|---|---|
| `T_pine_bark_diffuse` | 0.9857 | 2.21/255 | 9 | 3.55 → 1.29 MB (−64%) |
| `T_pine_bark_normal` | 0.9689 | 4.08/255 | 15 | 2.82 → 1.29 MB (−54%) |
| `T_leafs_diffuse` | 0.9837 | 1.30/255 | 14 | 1.08 → 0.51 MB (−53%) |
| `T_leafs_normal` | 0.9903 | 2.32/255 | 21 | 1.22 → 0.60 MB (−51%) |

Visual: `scratchpad/spike/texture-quality.png` — source / cooked / 8×-amplified difference, 1:1
pixels, centre 384² crop. Decoded through the shipped `basis_transcoder` at `cTFRGBA32`.

### Supercompression matrix

```
T_pine_bark_diffuse   1024x1024   source PNG 3.55 MB
   uastc              1.287 MB
   uastc+zstd         1.287 MB     <-- 0.0% smaller
```

Same result on all four textures. The RDO variants (`enableRDO` + `rdoQualityLevel`) crashed the
encoder module mid-run and were not measured; they are lossy and belong to PRD-351 anyway.

## Consequences for PRD-349

1. **Phase 2 (UASTC supercompression) is deleted.** It buys nothing. The flag stays unset.
2. **`chooseCodec` selected `uastc` for all four textures** — including `T_pine_bark_diffuse`,
   because this pack stores cutout alpha in the diffuse map (`alpha: 1` in every encoder slice).
   ETC1S, the cheap codec, never fired on this pack. So the remaining compression headroom is
   **RDO**, which is lossy, which is exactly what PRD-351's quality floor is for.
3. **The projection holds.** Six pines at −90.6% against a predicted −87% for the flora set.
4. **Reporting is already built.** `manifest.entries[*].sharedImages[]` means the PRD's byte
   accounting needs no new plumbing.

## Still unverified — the one that must be closed before landing

**Does a browser actually render the cooked GLB?** Structure is right (assumption 4) and the
transcoder decodes the files standalone, but an end-to-end `GLTFLoader` + `KTX2Loader` render was
not achieved — the headed-capture harness failed on module resolution and lock contention, not on
the assets. **PRD-349 Phase 4 (`quarry`) closes this**, and it must be a real render, not a
structural assertion.

## Reproduce

```
scratchpad/spike/
  assets/            6 source GLBs copied from wildwood
  public/            the compile output (committed numbers above)
  run.mjs            compileAssets({ models: { sharedImages: true } })
  compare.py         SSIM + difference image
packages/assets/spike-enc.mjs      supercompression A/B
packages/assets/spike-matrix.mjs   codec matrix (RDO variants crash)
packages/assets/spike-decode.mjs   KTX2 -> RGBA via the shipped transcoder
```
