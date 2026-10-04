# PRD-492 — Colour grading and film grain

**Status:** PROPOSED
**Complexity:** 1 (LOW) — 1–5 files, all generated template source; no package change expected; risk override: none
**Owner:** João
**Depends on:** [PRD-VQ-02](../native/PRD-VQ-02-native-postprocessing-parity.md) (a post stage must not blank the native frame; this PRD adds two more stages to the same chain)

## Context

`RENDER_CHAIN_STAGE_ORDER` in `packages/core/src/render/chain.ts` includes bloom, motion blur, god rays, vignette, lens distortion and sharpen. It has no colour grade and no film grain, and no template or example uses either one. Depth of field is out of scope: [PRD-VQ-13](../rendering/PRD-VQ-13-cinematic-stage-integration.md) owns it.

No engine mechanism is missing. The pinned `three@0.185.1` ships:
- `lut3D(node, lut, size, intensity)` in `examples/jsm/tsl/display/Lut3DNode.js`
- `film(input, intensity, uv)` in `FilmNode.js`
- `LUTCubeLoader`, `LUT3dlLoader` and `LUTImageLoader`, which return a `Data3DTexture`

`LUTCubeLoader` defaults to `UnsignedByteType`, which is filterable on every adapter. `FloatType` would need the optional `float32-filterable` feature, so the template must not ask for it.

The chain already accepts game-owned stages. A kit's `postprocessing.ts` passes `authoredStageNames` and `authoredStages` to the shared `WorldEnvironment`. The rain template anchors its `stormPost` stage with `after: "gradualBackground"`. The shared `worldEnvironment.ts` is identical across all 13 templates, and `packages/create-threenative/__tests__/shared-render-sources.spec.ts` refuses kit-specific stage names in it. So the grade belongs in a kit's own file.

## Solution

The look is generated source, so both stages live in the default `starter` template's `src/render/postprocessing.ts`, as authored stages after `gradualBackground`.

- **The grade runs in a log shaper, before the tone curve.** The render pipeline applies tone mapping and the sRGB encode after the graph (`templates/rain/src/render/postprocessing.ts` explains why rain disables them). So an authored stage sees scene-referred HDR, and a display-space LUT would clamp it at 1. The stage log-encodes, samples the `.cube` with `lut3D`, then decodes. The frame keeps one output transform, and no engine anchor is needed. If an identity LUT through the shaper is not pixel-identical to the ungraded frame, this design fails, and an engine "after output transform" anchor in `chain.ts` (mechanism only) becomes the fallback. That fallback would be recorded under `## Decisions`.
- **The grade file is the game's.** It is a `.cube` exported from any grading tool, loaded with `LUTCubeLoader`. The template ships a small neutral-plus-warm grade and a comment saying how to replace it. Intensity, grain amount and the tier at which each stage runs live in the kit's `quality.ts`.
- **Grain** is `film()` after the grade. The kit's `quality.ts` decides whether it is animated per frame and whether `low` turns it off.

Risk: the native packager stages files by the asset manifest (`selectManifestAssets`). A raw `.cube` under `public/` may not be staged. Phase 2's native run is what proves it is.

## Acceptance Criteria

- [ ] AC-1 [local]: grade and grain together cost ≤ 0.3 ms GPU at 1080p on the RTX 2080 browser lane, read as the `gpuOther` p50 delta against the same build with both stages off. proof: `TN_FRAME_BUDGET` from `node packages/playtest/dist/runner/cli.js perf` on the scaffolded starter.
- [ ] AC-2 [local]: the graded frame is judged at or above the ungraded one by a fresh judge, and the HUD is not graded. proof: `pnpm visuals:ab --before <ungraded> --after <graded> --raters 3`.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Grade and grain stages | starter `setupPost` → `WorldEnvironment.apply` → `renderer.createRenderChain()` authored stages | New; no prior grade | Phase 1, AC-2 |

## Execution Phases

#### Phase 1: Grade and grain in the starter
**Status:** NOT STARTED
**Files:** `packages/create-threenative/templates/starter/src/render/postprocessing.ts`, `quality.ts`, `public/grade.cube` (new)
- [ ] With grain off, an identity `.cube` through the log shaper reproduces the ungraded frame within one 8-bit step per channel. proof: `maxChannelDelta` ≤ 1 from `pnpm --filter quarry compare -- --reference <off> --candidate <identity> --frames <pose>`. It is a generic PNG diff; the starter's playtest supplies both captures.
- [ ] `TN_RENDER_CHAIN` names `grade` and `grain` as applied at `high`, and grain as refused with a reason at `low`. proof: `pnpm test:templates` with the starter's render-chain assertion extended.

#### Phase 2: Native runs the grade
**Status:** NOT STARTED
**Files:** `packages/create-threenative/templates/starter/native-playtests/render-chain.playtest.json`, `packages/runtime-native/conformance/scenes/shared/lut-grade.js` (new), `registry.json`
- [ ] The starter's desktop render-chain scenario includes `grade` and `grain` in its applied stages, with a non-blank screenshot. proof: `node packages/playtest/dist/runner/cli.js native-playtests/render-chain.playtest.json --target desktop` in a scaffolded starter.
- [ ] A conformance row grades a fixed colour chart through a known 17³ `.cube` with `lut3D` and `film` at zero intensity. It matches the LUT's expected colours and the browser reference within tolerance, which proves the `Data3DTexture` upload and trilinear sampling on the host. proof: `pnpm parity --target desktop --only-tests lut-grade`.
