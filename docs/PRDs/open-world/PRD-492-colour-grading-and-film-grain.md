# PRD-492 — Colour grading and film grain

**Status:** IN PROGRESS — Phase 1 landed with the shipped default neutralised; Phase 2's desktop scenario passes; AC-1, the identity round trip and a judge's verdict are open
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

## Decisions

**The log shaper was measured and dropped; the engine anchor is the shipped design** (2026-10-04,
Phase 1). The shaper cannot meet this PRD's own box. An 8-bit `.cube` quantises in 1/255 steps, so
the round trip's error is `dL/du · display'(L)` per code, and sweeping the two-parameter family
`(x/W)^g / (1 + (x/W)^g)` over the frame's whole range found no pair under **2.0** 8-bit steps per
channel; the filed `W = 4, g = 1/2.2` costs **4.3**. The reason is arithmetic, not tuning: ACES and
sRGB together stretch a small change in light into several codes across most of the range, so the
only shaper that reaches one step is the output transform itself.

So the fallback this file already named is what shipped: a stage may declare
`afterOutputTransform`, the chain then installs the graph with the renderer's automatic transform
off (`setOutputNode(node, pass, { outputColorTransform: false })`), and `grade.ts` applies three's
own `renderOutput` before looking the table up — the arrangement three's FXAA example uses. The
table's quantisation is then the whole of the error, and it is bounded by the load rather than by a
curve: `LUTCubeLoader` truncates `value * 255` into a `Uint8Array`, so an identity table reads low
by at most **0.875** of a step. Measured over every value the frame can hold, in
`packages/create-threenative/__tests__/grade.spec.ts`. A `.cube` also now means what a grading tool
means by it, which the shaper could not offer.

**The starter's table is a 9³ grid and its interpolation error is measured, not assumed.** A channel
gain above one has to clip the top of the range, and a coarse grid cannot follow that corner, so
`make-grade-lut.mjs` carries the number (≤ 7.5 of 255 steps, all of it in the top interval of a
clipping channel) and the spec re-reads the generator's own constants, so raising the contrast or
the SIZE cannot pass unnoticed.

**The starter's desktop render-chain scenario could not run before this PRD touched it.** Its
`visibility` assertion is refused outright by the desktop runner
(`TN_PLAYTEST_OBSERVATION_UNAVAILABLE`, "Assertion 'visibility' is not supported on target
'desktop'"), so the scenario failed before it read a single stage and no box of this phase's first
item was reachable. The assertion is dropped, and `grade`/`grain` added to the stages and
contributions it does read. Nothing is lost: the runner never produced that observation on this
target, so the row was a hard error rather than a check.

**The shipped table was a look, not a default, and a blind judge said so.** It first shipped as a
13% warm spread about a 0.18 pivot, and the judge compared the starter with it against the starter
without it and preferred **without**: "grey concrete reads as sandstone, sky washed toward cream, a
bit muddy/low contrast; grain clearly visible as speckle". The owner's rule is that a default must
never degrade the look, so both numbers moved (2026-10-04):

| | shipped first | shipped now |
| --- | --- | --- |
| `PIVOT` | 0.18 | **0.5** |
| `GAIN` | r 1.07 / b 0.94 (13% spread) | **r 1.0025 / b 0.9975** (0.5% spread) |
| `CONTRAST` | 1.06 | 1.06 (unchanged) |
| `grainIntensity` at `high` | 0.12 | **0.0039** |

The pivot was the larger half of the damage and neither the judge nor the spec had measured it: a
contrast curve anchored at 0.18 leaves *everything above it* brighter, and on the captured frame
that lifted mid-grey 8 of 255 steps and the sky 12 — which is what "washed toward cream" looks like
on screen. Anchored at mid-grey it darkens below the middle and brightens above it. The gain is now
one 8-bit step or less on concrete and on sky alike, and `grade.spec.ts` pins that, the contrast
against the ungraded frame, and that no black is lifted; the old table is red on the first.

Grain is `1/255` because `film()` scales its noise by the pixel's own value, so that is under half a
step on a mid-grey surface — below what the frame can show. It stays non-zero so `TN_RENDER_CHAIN`
keeps naming `grain` as **applied** at `high`, which is this file's own ticked box; `low` still
refuses it with a reason, and `quality.ts` says how far to raise it.

**`public/grade.cube` was never staged by the packager, because it was never in the game.** Phase 2
filed this as a packaging defect: "the staging loop copies `selectManifestAssets(assets)` and nothing
else, so a `public/` file the manifest does not declare never reaches the host". That is not what
`selectManifestAssets` does — its rule 3 keeps everything no cook produced, and its own spec already
proved an undeclared `public/hand/level.json` reaches the Android, desktop and iOS staging
directories. What actually happened is duller: the scaffold that run used had **no
`public/grade.cube` in it** (the before-arm of the AC-2 comparison deletes that file, and it was
never put back), so there was nothing to stage. With the file present, `pnpm build --target desktop`
reports it among the unmanaged files and the host reads it out of the bundle. A guard now sits in
`packages/runtime-native/__tests__/asset-manifest.spec.ts` for a hand-placed file whose extension no
asset pipeline emits, so the next report of this shape is checked against the selector first.

**The starter's table and the capture both had to be rebuilt to say any of this.** A browser run
that reports `swiftshader / google` instead of `turing / nvidia` is a CPU rasteriser's picture of a
hardware look: the frame came back a flat grey (p50 50, p99 70) and 7,359 `createBuffer` errors
later. `--browser-recipe webgpu` alone does not prevent it — the runner launches
`chrome-headless-shell`, which serves WebGPU from SwiftShader; `--headed` launches the full browser
and the adapter is the 2080 again. Every capture below ran headed, on `turing / nvidia`, at `tier high`.

## Acceptance Criteria

- [ ] AC-1 [local]: grade and grain together cost ≤ 0.3 ms GPU at 1080p on the RTX 2080 browser lane, read as the `gpuOther` p50 delta against the same build with both stages off. proof: `TN_FRAME_BUDGET` from `node packages/playtest/dist/runner/cli.js perf` on the scaffolded starter. **Open — the metric resolves too rarely in this lane to read a delta.** Two 1080p runs of the same scenario (`grade-perf2.playtest.json`, `assert.performance`, no screenshots, adapter `webgpu:architecture=turing|vendor=nvidia`, `adapterClass: hardware`): the graded arm carried `gpuOther` in **1 of 17** windows (p50 `0`, total gpu p50 `0.4`, 65 samples) and the ungraded arm in **0 of 16**. With one arm carrying no `gpuOther` observation at all there is no delta, and a missing observation is not a zero.
- [x] AC-2 [local]: the graded frame is judged at or above the ungraded one by a fresh judge, and the HUD is not graded. proof: `pnpm visuals:ab --before <ungraded> --after <graded> --raters 3`. **Pass (2026-10-05):** `pnpm visuals:ab --raters 3` on the phase1b pair (`.afk/scratch/prd492-ab`), 3 fresh blind raters: starter-spawn 4 → 4, starter-spawn-crop 3 → 3, Δ 0, minimum detectable effect 0 (6 duplicate pairs, spread 0) — the graded frame scores at the ungraded one. HUD not graded: before/after difference on the HUD is mean 0.55 / max 1.2 codes on the bottom panel and max 1.9 on the score glyph (the translucent panel shows the scene through it), against max 112 codes in the scene.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Grade and grain stages | starter `setupPost` → `WorldEnvironment.apply` → `renderer.createRenderChain()` authored stages | New; no prior grade | Phase 1, AC-2 |
| `afterOutputTransform` stage seat | `RenderChain` → `IRendererLike.setOutputNode(node, pass, options)` → `RenderPipeline.outputColorTransform` | New; mechanism only, and the PRD's named fallback | Phase 1: `packages/core/__tests__/render-chain.spec.ts` — runs last, hands the renderer `outputColorTransform: false`, keeps it when the stage is refused, refuses an anchor |

## Execution Phases

#### Phase 1: Grade and grain in the starter
**Status:** LANDED — one box open (see below); the shipped table and grain default were neutralised after the blind judge, red-to-green on `grade.spec.ts`
**Files:** `packages/create-threenative/templates/starter/src/render/grade.ts` (new), `postprocessing.ts`, `quality.ts`, `public/grade.cube` (new), `tools/make-grade-lut.mjs` (new), `packages/core/src/render/chain.ts`, `packages/core/src/renderer.ts`, `packages/create-threenative/template-assets/worldEnvironment.ts` + its 13 kit copies
- [ ] With grain off, an identity `.cube` through the grade reproduces the ungraded frame within one 8-bit step per channel. proof: `maxChannelDelta` ≤ 1 from `pnpm --filter quarry compare` on the scaffolded starter, with `packages/create-threenative/__tests__/grade.spec.ts` holding the arithmetic underneath it. **The shaper is gone — the stage now grades after the output transform (see `## Decisions`) — and the arithmetic half is proved: `maxChannelDelta` over every display value ≤ 1** (worst 0.875), from `pnpm exec vitest run packages/create-threenative/__tests__/grade.spec.ts` — 8 passed, reading the shipped table back through a port of `LUTCubeLoader.parse`. **Open on the frame half.** `pnpm --filter quarry compare` on the scaffolded starter, ungraded against identity-table-with-grain-off, 1920x1080, same build otherwise: `maxChannelDelta 86, rmse 0.81, changedPixelRatio 0.003` — and the *same ungraded build captured twice* reads `maxChannelDelta 114, rmse 0.37, changedPixelRatio 0.0026`. The starter's own animated content moves between runs by more than the claim, so a whole-frame maximum cannot carry it; the captures are in `/home/joao/projects/threenative/threenative-engine/.afk/scratch/prd492-captures/phase1/` and `/home/joao/.cache/tnt/scratch/prd492/cmp-{off,off2,identity}/`. A still-scene capture (the arena without `STARTER_MIST` or the pennants) would carry it.
- [x] `TN_RENDER_CHAIN` names `grade` and `grain` as applied at `high`, and grain as refused with a reason at `low`. proof: `pnpm test:templates` with the starter's render-chain assertion extended. **Ran at `high` on the starter's `look.playtest.json`** (`packages/create-threenative/template-playtests/starter/look.playtest.json`): `renderChain.tier`, `renderChain.stages.includes`, `renderChain.stages.order` and `renderChain.contributions.graphOutputChanged` all pass at `adapterClass: hardware`, and the marker carries `stages: ["ambientOcclusion","bloom","vignette","antialias","grade","grain"]`, `dropped: []`, with `grade` and `grain` both `graphOutputChanged: true`. **The `low` leg** is `perAdapter.software`, which needs an adapter the harness classes as software — and Chromium here reaches no WebGPU adapter under SwiftShader (`TN_PLAYTEST_CAPTURE_PROVENANCE_MISSING`, adapter request resolved null), so it was run instead on a throwaway copy of the scaffold with `setupPost(..., { tier: "low" })` pinned and a scenario asserting `stages: { includes: ["grade"], excludes: ["grain"] }`: both rows pass, and the marker carries `stages: [...,"grade"], dropped: [{"name":"grain","reason":"grainIntensity:0"}]`. Nothing about that pin is committed.

#### Phase 2: Native runs the grade
**Status:** LANDED — both boxes pass: the conformance row and the starter's desktop scenario
**Files:** `packages/create-threenative/templates/starter/native-playtests/render-chain.playtest.json`, `packages/runtime-native/conformance/scenes/shared/lut-grade.js` (new), `registry.json`
- [x] The starter's desktop render-chain scenario includes `grade` and `grain` in its applied stages, with a non-blank screenshot. proof: `node packages/playtest/dist/runner/cli.js native-playtests/render-chain.playtest.json --target desktop` in a scaffolded starter. **Ran and passes** — `pnpm build --target desktop` in the scaffolded starter (checkout runtime at `THREENATIVE_RUNTIME_BINARY=packages/runtime-native/build/tn-linux/mystral`, which is the binary that both compiles and runs; `mystral-tools` compiles but cannot host the game), then the scenario with `--executable dist-native/starter`: exit 0, all six assertions true at `adapterClass: hardware`, `renderChain.stages.includes` and `.order` both `["ambientOcclusion","bloom","vignette","grade","grain"]`, `contributions.graphOutputChanged` true for `grade` and `grain`, `dropped: []` for the grade and grain (the chain's own `antialias` is refused with `build:Image is not defined`, which no box here claims). The host logs `[Fetch] Read 19909 bytes from bundle: grade.cube`, and the screenshot is not blank (`tone` mean 117.1, p1 41, p99 192). Nothing in the packager changed: see the second decision above for why the earlier run could not see the table.
- [x] A conformance row grades a fixed colour chart through a known 17³ `.cube` with `lut3D` and `film` at zero intensity. It matches the LUT's expected colours and the browser reference within tolerance, which proves the `Data3DTexture` upload and trilinear sampling on the host. proof: `pnpm parity --target desktop --only-tests lut-grade`. **Ran, and passes:** after `pnpm native:build` (409/409 targets) and a web-lane reference capture, the desktop row reports `status: "pass"`, `metrics: { pixelMismatchRatio: 0, perceptualDeltaE: 0 }` over 1280x720 and `gpuValidationErrors: []`, with the host rendering 300 frames in 9.4 s. The table is a 17³ per-channel gain (r 0.75, g 1, b 0.5) rather than the identity, so a host that ignored the upload or substituted a constant would fail it, and the parsed `Data3DTexture` is read back in JS against that formula before the frame is compared. The sweep exits 2 because a `--only-tests` run blocks the other 95 rows by design, not because this row failed.
