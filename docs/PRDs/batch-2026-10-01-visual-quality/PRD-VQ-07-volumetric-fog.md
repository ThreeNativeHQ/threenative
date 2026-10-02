---
prd_contract: v1
---

# PRD-VQ-07 — Local volumetric fog composes with depth, lights and existing atmosphere

**Status:** PARTIAL — 2026-10-02. Phase 1 browser reference proof is complete; receipt review and broader lifecycle/native qualification remain open.
**Batch:** [Visual quality execution batch](https://github.com/ThreeNativeHQ/threenative/blob/docs/visual-quality-batch-2026-10-01/docs/PRDs/batch-2026-10-01-visual-quality/README.md). **Wave:** 2 / atmosphere.
**Dependencies:** Independent of clouds. Reuse VQ-06 only for any local-light feature it has actually qualified.

## Grounding and intended outcome

ThreeNative already has atmosphere LUTs and god-ray composition. Current upstream [VolumeNodeMaterial](https://threejs.org/docs/pages/VolumeNodeMaterial.html) and volumetric lighting machinery are reuse candidates, not proof of a finished ThreeNative fog product. Recheck the installed pin and the merged rain kit before introducing a new algorithm.

**Outcome:** A bounded mist volume in an interior/exterior fixture responds to the main light and declared local lights, is occluded by solid geometry and blends into the existing atmosphere without becoming a uniformly bright screen overlay.

## Design and ownership

Start with the supported upstream volume/material or existing kit implementation. Density functions, phase function, color and artistic controls remain generated TSL/game source. Share only depth access, lifetime and ordered dispatch that the current render loop cannot already supply. Composite radiance with transmittance in the scene-linear graph before its one output transform; specify the relationship with aerial perspective and god rays so the same medium is not added twice. Keep history optional until its disocclusion behavior is qualified.

A bounded volume and height-dependent density, one directional source and an explicitly supported local-light subset. No mandatory froxel engine, general weather manager, or promise that all point/spot shadow types work.

## Required behavior

- Zero density produces the no-fog image; an opaque foreground wall hides fog behind it.
- The fixture tests the camera both outside and inside the volume, a light toggle and overlapping density bounds.
- Step count and resolution are quality controls, with an explicit off/unsupported route and no dormant GPU allocations.
- Resizes, camera cuts and streamed occluder changes do not reuse invalid depth/history.

## Execution phases

All proof paths below are **planned implementation targets**, not existing passing tests. Reuse an existing equivalent test or scenario after inspecting current code, and update the canonical proof path rather than adding a duplicate. Follow [EXECUTE.md](https://github.com/ThreeNativeHQ/threenative/blob/docs/visual-quality-batch-2026-10-01/docs/PRDs/batch-2026-10-01-visual-quality/EXECUTE.md) for fixture setup, variables, review and repository gates.

### Phase 1 — Depth-correct participating volume

- [x] Implement game-owned volumetric composition using the admitted upstream/kit mechanism and shared scene depth. Verified: generated source builds on the pinned shader compiler and hosted WebGPU run 36990624761 renders it; proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-volumetric-fog.spec.ts`.
- [x] Cover zero density, inside/outside camera positions and opaque occlusion with analytic or reference fixtures. Verified: run 36990624761 captured all positions, exact off/zero image identity and the unchanged foreground-wall reference patch recorded below; proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-volumetric-fog.spec.ts`.

### Phase 2 — Compose with the existing environment

- [ ] Integrate directional and the declared local-light subset without double-applying atmosphere or god rays. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-volumetric-fog.spec.ts`.
- [ ] Add bounded quality settings, history invalidation where used and deterministic resource disposal. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-volumetric-fog.spec.ts`.

### Phase 3 — Qualify the visible result

- [ ] The fog fixture verifies occlusion, light response and zero-density identity on browser WebGPU with fixed-camera captures. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-volumetric-fog.playtest.json --url ${VQ_URL:?} --browser-recipe webgpu`.
- [ ] The same authored volume runs on Linux native and remains valid through resize and scene teardown. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-volumetric-fog.playtest.json --target desktop --executable ${VQ_NATIVE_EXECUTABLE:?}`.

## Acceptance criteria

- [ ] Fog is depth-correct and light-responsive, and turning it off restores the original graph and allocation baseline. proof: the completed Phase 3 scenario outputs, with the named fixture, package/cohort and adapter recorded inline here.
- [ ] The feature preserves its documented inactive/fallback path and releases owned resources after repeated lifecycle transitions. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-volumetric-fog.spec.ts` plus the Phase 3 lifecycle scenario.

## Performance and promotion

Record pixels, ray steps, light count and cost on the same fixture. Choose tier admission from measurements, not an arbitrary AAA label. Numerical targets are proposed acceptance targets, not benchmark results. Pin the fixture, metrics and thresholds before changing the implementation; never relax a failing threshold just to mark this PRD complete. Shared abstractions must pass the repository's reuse/LOC admission rule. Appearance remains editable source.

## Blocked on

Phone performance and a wider local-shadow set are separate qualification work.

## Completion record

Update the phase boxes and this PRD only after the named proof runs. Record actual results inline, including any remaining exclusions. A merged planning or implementation PR alone is not proof that every acceptance criterion passed. Archive according to the parent PRD filing rules when the work is genuinely complete.

### Current checkpoint — 2026-10-02

The fresh checkout implements ownership-aware `clearOutputNode(expectedNode?)` without changing legacy no-argument calls. Generated `WorldEnvironment` now returns an idempotent disposer for a base-colour-only graph, passes its explicit scene pass to installation, releases its own scene pass and materialized base texture, and refuses an unsupported direct path before invoking the allocation factory. This prerequisite does not enable fog or change the default picture.

Red-green proof: three new behavioral failures reproduced first; `pnpm exec vitest run packages/core/__tests__/renderer.spec.ts packages/create-threenative/__tests__/world-environment-lifetime.spec.ts packages/create-threenative/__tests__/shared-render-sources.spec.ts --maxWorkers=1` then passed 39/39. `pnpm exec tsc --noEmit -p packages/core/tsconfig.json`, focused strict renderer/generated-source compilation, API-surface and capability-manifest checks passed. Focused Biome passed with four complexity warnings, no errors. No runtime screenshot, native qualification, aggregate CI or fog acceptance is claimed.

Reuse review at pinned `three@0.185.1`: `VolumetricLightingModel.direct()` skips a directional light because it has no `distance`; extinction is derived from accumulated light rather than independent density. Its material cannot satisfy the bounded directional radiance/transmittance contract unchanged. Existing `GodraysNode` provides the depth reconstruction and ordinary directional shadow coordinates to reuse in game-owned source. Rain's screen-quad coast and its god-ray composition do not provide bounded participating volumes. No new shared visual algorithm or renderer is admitted.

Review correction: pinned `convertToTexture(PassNode)` returns a borrowed pass texture, not an owned RTT. A new PassNode-return regression reproduced the disposal TypeError; the ownership test now additionally requires `isRTTNode === true`. PassNode disposal and caller-owned texture/RTT preservation are covered. The same focused suite passes 42/42 and strict touched-source/test typechecking passes; this supersedes the earlier 39-test checkpoint for the lifecycle code.

Mixed ownership correction: actual-renderer regressions reproduced an obsolete chain clearing a newer direct graph and automatic budget observation rebuilding the obsolete chain. `RenderChain` now retains the installed input identity, clears only owned/attempted output, and skips automatic observation when the renderer says it was superseded. Replacement does not implicitly dispose caller dependencies; explicit disposal remains available. Borrowed RTT target and material preservation are both asserted directly. Focused renderer/render-chain/environment/shared-source suite passes 88/88; core typecheck passes. This proves the exercised lifecycle transitions, not GPU behavior.

Fog implementation checkpoint: opt-in generated `templates/starter/src/render/volumetricFog.ts` now builds bounded overlapping height-density transport before exposure, with independent extinction, directional shadow lookup and explicitly unshadowed finite-range point lights. It owns a half-float nearest-filtered RTT, supports full/half resolution with per-pixel depth-discontinuity fallback, retains no history, and returns before graph allocation when off/unsupported/zero-density. No default tier enables it. The standalone fixture at `examples/abyss-framework/vq-fog/` exercises that exact source with outside/inside camera, light, wall, overlap, quality and rebuild controls.

Fresh proof: the fog and verifier contract suites pass 23/23, including generation of the actual depth/shadow transport WGSL with/without lights; focused strict source/test/fixture/verifier typechecks and the production Vite fixture build pass. These are not rendered-pixel tests: analytic/wall-depth image proof and all Phase 3 qualification remain open. The hosted `integration-volumetric-fog.yml` uses the built public playtest runner for actual canvas captures and adapter/source-SHA provenance, rejects software device loss, and retains diagnostic captures on failure. The local executor has no display tooling and its Unix-socket restriction was verified, so local screenshot execution was not attempted through an alternate route.

Scaffold validation initially failed only its whole-tree byte snapshot because the deliberate shared lifetime changes affect all thirteen kits and the new optional fog file affects starter. After inspecting that source-only delta, the expected generated-tree hashes were refreshed with an inline rationale; the unchanged starter-copy assertions now include the new file. The full scaffold suite passes 66/66. Fog/verifier plus CI structure/needs suites pass 164/164; relative documentation-link checks pass. No runtime evidence is inferred from these checks.

Actual diagnostic progress: [hosted run 36989192897](https://github.com/ThreeNativeHQ/threenative/actions/runs/36989192897) rendered the off baseline at source `1bb878e033d29e084b912bc9266a15b72d6cbf16`, Chromium WebGPU / Google SwiftShader / 640×400. The [unchanged captured PNG](../../verification/vq07-progress/1bb878e03/off-baseline.png) and [provenance](../../verification/vq07-progress/1bb878e03/provenance.json) are retained for the requested progress screenshots. The run failed closed on one HTTP404 console error; all baseline image/component assertions passed, but fog-on variants did not run. This is diagnostic baseline progress, not fog qualification or a hardware/native claim. The first report omitted the failing resource URL; fixture-only preview diagnostics now record HTTP error status and URL without relaxing the error gate.

The unchanged-HTML diagnostic rerun [36990205268](https://github.com/ThreeNativeHQ/threenative/actions/runs/36990205268) identifies the exact failed resource in `off/http-errors.jsonl`: `/favicon.ico`, HTTP404. The fixture now uses the repository's existing inline-favicon convention. Its new source regression failed first; fog/verifier tests then pass 24/24 and the production bundle builds. No error assertion was weakened. The next hosted run must verify that this removes the console failure and reaches fog-on capture.

First successful actual fog captures: [run 36990624761](https://github.com/ThreeNativeHQ/threenative/actions/runs/36990624761), source `4f8fe47b1801282827c9b5d0f0cba40b99c7c2a7`, Chromium WebGPU / Google SwiftShader / 640×400. All nine named variants passed with empty diagnostic lists, and off/zero images were pixel-identical. The unchanged [fog-on PNG](../../verification/vq07-progress/4f8fe47b1/fog.png), [inside-volume PNG](../../verification/vq07-progress/4f8fe47b1/inside.png), [off baseline](../../verification/vq07-progress/4f8fe47b1/off.png) and [all-variant provenance](../../verification/vq07-progress/4f8fe47b1/provenance.json) are retained. Visual inspection confirms bounded mist and light response. The fixed wall-center patch (x184, y216, 18×18) has exactly zero changed pixels against off; full/half fog mean absolute difference is 0.0695/255. This is browser software-rendered correctness progress, not native or hardware-performance qualification. Same-node replacement ownership still needs a unique installation receipt; a green screenshot run does not close that review finding.


Installation ownership correction: `setOutputNode` now returns a unique optional receipt with `isCurrent()` / `dispose()`, capturing the actual `RenderPipeline` installation. Same-node reinstall regressions failed first; old observers and disposers now respect the receipt, as does the generated direct base-colour path. Legacy void-style adapters (including historically ignored return values) retain compatibility behavior but do not gain installation-level guarantees. Receipts own only the installed pipeline; graph dependencies still belong to their explicit caller. The superseded node-equality query was removed. The focused renderer/chain/environment/shared-source/scaffold suite passes 157/157, core and touched-source/test typechecks pass, and API/capability checks pass. Generated-source hashes are refreshed only for this intentional shared lifecycle edit. Fresh hosted capture is selected for subsequent renderer/chain/canonical-environment changes.

Independent receipt review of staged tree `2062ba7783c53bc27a5ba6537a8b60874b9c06fa` passed for pipeline-installation ownership: the reviewer reran renderer/render-chain/WorldEnvironment tests, 89/89 passed, with no blocking defect in that delta. This explicitly does not transfer or guarantee arbitrary shared graph-dependency lifetimes. Hosted pixel proof will be rerun at the published receipt head.


Receipt-head runtime revalidation: [run 36994760252](https://github.com/ThreeNativeHQ/threenative/actions/runs/36994760252) passed all nine variants at exact source `9b2bcd7a1e9db2aa181a34c2c7fd5a060724138a`, Google SwiftShader WebGPU, 640×400, no diagnostics. Downloaded artifact `11220323995` matched SHA256 `658c454f4f1888f2b98f9b78054b7f3ae6cebedbe6327372ec844f21a058e71d`; all nine PNGs are byte-identical to the retained successful captures. [Existing provenance](../../verification/vq07-progress/4f8fe47b1/provenance.json) now includes that source/run revalidation. This closes receipt-head visual regression evidence, not the remaining fog acceptance.

The next fixture-only qualification slice removes surface illumination from light-response evidence: black unlit override surfaces plus a black background preserve geometry/depth/shadow casters. A black no-fog arm must produce exactly zero RGB across the whole image. Both fog light toggles must add at least 1 mean RGB byte and change more than 2 RGB bytes on at least 10% of the pinned room ROI (x260, y155, 150×90), excluding the foreground plate; its interior patch (x184, y216, 18×18) must remain exactly black in all four arms. These gates were pinned before hosted execution. Normal positive-arm nonblank checks and all runtime/error/device-loss checks remain unchanged. The verifier now actually runs the committed repeated-lifecycle scenario and its return-to-off extension, checks actual target/material disposal events, and requires the restored pixels to equal the off baseline. Fixture/verifier/source tests pass 29/29 after the new behavioral assertions failed first; strict types and the production build pass. New hosted light/lifecycle evidence remains pending, as do resize/native/performance qualification.


Aggregate verification for this slice: root `pnpm typecheck` passed; root `pnpm lint` passed with 1,017 warnings and no errors. Root `pnpm test` exited 2 before suite phases because the installed `tsx` CLI cannot create `/tmp/threenative-suite…/tsx-1000/482.pipe` (`listen EPERM`), the confirmed environment Unix-socket restriction. Two positive `evidence-budget.spec.ts` subprocess fixtures fail for the same `tsx` restriction; no gate was weakened or represented as passed. Full aggregate tests and native execution remain unrun here. Expanded public scenario round-trip validation also caught and corrected the lifecycle loader's metadata (`sourcePath`) being serialized back as an invalid authored key, before hosted execution.

Moving-base reconciliation: `beedf1e8703b8d7318f11dea0f183764075cc153` is merged with exact develop `6c8858d74ae0c76887c4387ffbd90cf6b32fb6a1`. The sole conflict was the generated scaffold digest table: current 0.2.8 package pins and rain's corrected `.ts` verifier import are retained alongside VQ07's receipt/fog source. All thirteen hashes were remeasured from the combined isolated tree after the old table failed. The combined scaffold/doctor/renderer/chain/environment/fog/fixture/verifier suites pass 282/282, create-threenative types and the fixture production build pass. No shared rendering source was changed by the reconciliation.
