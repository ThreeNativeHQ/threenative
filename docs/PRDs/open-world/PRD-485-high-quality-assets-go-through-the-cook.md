# PRD-485 — High-quality assets go through the cook

**Status:** PROPOSED
**Complexity:** 3 (LOW) — 1–5 engine files (+1: `packages/assets/src/passes/decode-image.ts` and its pass); the proof games live in the separate sandbox repo and install engine tarballs (+2); risk override: none
**Owner:** João
**Depends on:** [PRD-VQ-01](../assets/PRD-VQ-01-native-asset-capabilities.md) for the Android box only; [PRD-377](../assets/PRD-377-auto-lod-is-on-by-default.md) (AutoLOD)

## Context

The three highest-detail sandbox games ship around the cook. The reasons they give are partly wrong (code read 2026-10-03; none of these builds was run):

| Game (`../sandbox/`) | Escape hatch | Stated reason | What the tree says |
| --- | --- | --- | --- |
| `fab-import-proof` | `models: "none"`, `textures: "none"`, `budget.uncooked: 160_000_000` | "Mobile has no WebAssembly" | Android has run V8 by default since PRD-130 (`packages/runtime-native/AGENTS.md:33`). The refusal comes from `assertNativeAssetsCompatible` (`packages/create-threenative/src/build.ts:151`), which rejects KTX2 and Meshopt for every Android/iOS build whatever the engine. That is VQ-01's bug. |
| `lumen-hall` | `models: "none"` (and `textures: "none"`, a game-side measurement freeze) | "The authored props already contain their production texture containers", so the compiler rejects the GLBs | The containers are **WebP** (`EXT_texture_webp` in `lady.glb`, `sanctuary.glb`), not KTX2. `decodeImageBytes` (`decode-image.ts:11`) reads only JPEG and PNG, so the embedded-texture pass throws `TN_ASSETS_MODEL_TEXTURE_UNDECODABLE`. Embedded KTX2 already passes through as authored (`model-textures.ts:438`). |
| `metahuman-lab` | No `assets/` dir. 301 MB is served raw from `public/content/`: 30 PNGs, `specimen.glb` (101,518 tris, 10 morph primitives, up to 821 targets), `.dna`, `.strands.bin` | None stated. `Lab.ts:886` reads bytes by "the no-manifest route". | The cook copies unknown extensions through as `other` (`packages/assets/src/compile.ts:472`), and the textures already load through `ctx.assets.texture` (`src/render/materials.ts:80`). Nothing in the engine forces `public/`. |

The asset itself: `SM_EuropeanHornbeam_Forest_01.glb` is 126,934,280 B, a single `MASK` primitive of 755,677 triangles with six embedded PNGs (45.4 MB). The importer's 7 unmapped textures (8192², `T_WindNoise` 4096²; 463 MB) are excluded.

Uncooked UE5 Megascans import as LOD0 only. The importer decompresses the largest `FMeshDescription` payload and never the smaller LOD payloads (`threenative-asset-mcp/README.md:354`). AutoLOD can rebuild a chain from LOD0. Nobody has measured whether it accepts a 755k-triangle foliage primitive: its non-manifold check (`packages/assets/src/lod/eligibility.ts:209`) declines any edge shared by more than two triangles.

**Out of scope:** runtime capability selection and the Android guard (VQ-01); first-party `.uasset` ingest ([PRD-352](../assets/PRD-352-unreal-ingest-is-first-party.md)); consuming the unmapped textures ([PRD-487](PRD-487-imported-materials-keep-their-detail.md)); skeletal LOD ([PRD-486](PRD-486-characters-get-a-lod-chain.md)).

## Solution

1. `decodeImageBytes` decodes WebP. Embedded `EXT_texture_webp` images then cook like PNG: to KTX2 where the target decodes it, and to a capped PNG on the decoder-free path. The extension leaves `extensionsRequired` once no WebP remains.
2. Each game drops its escape hatch and builds with the default cook. Any failure that appears is fixed in `packages/`, never by putting `"none"` back.
3. The UE LOD chain is rebuilt by AutoLOD over LOD0, and the Hornbeam is the test subject. The importer stays as it is.

## Decisions

- 2026-10-03 (agent, proposed): rely on AutoLOD rather than importing UE's LOD payloads. An authored `_LODn` node inside a GLB is declined as `authored-lod` (`eligibility.ts:185`), and nothing in `packages/core` selects between such nodes at runtime, so importing them would draw every LOD at once. Revisit only if the Hornbeam box below cannot be met in `packages/assets`.
- 2026-10-03 (agent, proposed): Phase 1 picks the WebP decoder in this order: an installed dependency first, a new pure-JS or WASM one second. `sharp` is already declared in `packages/assets/package.json:57` (added as a CVE pin in `e11c1fd0b`, with no import in `src/`). However, `decode-image.ts` forbids native dependencies, so using it needs its wasm32 build or that rule changed in the same commit.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| WebP embedded-texture cook | `threenative build` → `compileAssets` → `modelTexturesPass` → `decodeImageBytes` | `TN_ASSETS_TEXTURE_CONTAINER` throw for WebP; deleted | Phase 1 |
| Default cook for a Fab tree | `fab-import-proof` `threenative.config.ts` with `assets` reduced to `exclude` | `models`/`textures: "none"`; deleted in the game | Phase 2 |

## Blocked on

- The Android box waits for VQ-01 Phases 1–2: until they land, `assertNativeAssetsCompatible` refuses the cooked KTX2 on Android whatever this PRD does. It unblocks when VQ-01 merges.

## Execution Phases

#### Phase 1: Embedded WebP cooks
**Status:** NOT STARTED
**Files:** `packages/assets/src/passes/decode-image.ts`, `packages/assets/src/passes/model-textures.ts`; `packages/assets/__tests__/model-texture-pass.spec.ts`
- [ ] [local] A GLB with an `EXT_texture_webp` image cooks to KTX2 on a decoding target and to a capped PNG on the decoder-free path. No output still requires `EXT_texture_webp`. proof: red-green case in `pnpm exec vitest run packages/assets/__tests__/model-texture-pass.spec.ts`.
- [ ] [local] `lumen-hall` builds on web with `models: "none"` deleted, and its asset scenario passes. proof: `npx threenative build` in the game, then `node packages/playtest/dist/runner/cli.js playtests/assets.playtest.json --url <preview> --browser-recipe webgpu`.

#### Phase 2: The Fab tree cooks by default
**Status:** NOT STARTED
**Files:** `packages/assets/src/lod/eligibility.ts` only if the Hornbeam is declined; `fab-import-proof/threenative.config.ts` (sandbox)
- [ ] [local] `fab-import-proof` builds on web with `assets` reduced to `exclude`. The build report shows the Hornbeam's six embedded textures encoded and 0 uncooked bytes for its GLB. proof: `npx threenative build`, `dist.build-report.json`.
- [ ] [local] The cooked Hornbeam carries a `TN_discrete_lod` chain whose far rung is at most 10% of 755,677 triangles. proof: the build report's LOD row for the GLB.
- [ ] [local] The Hornbeam scenario passes on web and on native desktop from installed tarballs. proof: `playtests/hornbeam.playtest.json --browser-recipe webgpu` and `native-playtests/fab-import-native.playtest.json --target desktop`.

#### Phase 3: Android and the cold-agent path
**Status:** NOT STARTED
**Files:** `metahuman-lab` asset layout (sandbox); `packages/create-threenative/agent-docs/references/finding-assets.md`
- [ ] [local] `fab-import-proof` packages its cooked KTX2 and Meshopt output for Android V8 and renders the Hornbeam on the emulator. proof: `native-playtests/fab-import-native.playtest.json --target android` on the local emulator.
- [ ] [local] `metahuman-lab` serves `content/` from `assets/` through the cook with no `assets` block, and `face-controls.playtest.json` passes on web. proof: `npx threenative build` plus that scenario with `--browser-recipe webgpu`.
- [ ] [local] `finding-assets.md`'s Fab import step says the default cook handles imported packs and that `"none"` is not a fix. proof: `pnpm exec vitest run scripts/__tests__/primary-docs.spec.ts` and `pnpm check:docs`.
