---
prd_contract: v1
---

# PRD-VQ-07 — Local volumetric fog composes with depth, lights and existing atmosphere

**Status:** PARTIAL — 2026-10-02. Output-lifetime prerequisite implemented; fog and runtime qualification remain open.
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

- [ ] Implement game-owned volumetric composition using the admitted upstream/kit mechanism and shared scene depth. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-volumetric-fog.spec.ts`.
- [ ] Cover zero density, inside/outside camera positions and opaque occlusion with analytic or reference fixtures. proof: `pnpm exec vitest run packages/create-threenative/__tests__/vq-volumetric-fog.spec.ts`.

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
