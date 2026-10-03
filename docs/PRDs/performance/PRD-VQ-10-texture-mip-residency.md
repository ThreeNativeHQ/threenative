---
prd_contract: v1
---

# PRD-VQ-10 — Texture residency releases real GPU memory rather than only biasing sampling

**Status:** PROPOSED — 2026-10-01. No implementation or qualification is claimed.
**Batch:** Visual quality execution batch. **Wave:** 3 / memory-gated.
**Dependencies:** Reconcile PRD-454 resource budgets and VQ-01 decoder selection first.

## Grounding and intended outcome

Existing asset cooking and world-cell residency already manage models, compressed textures and lifetimes. [PRD-454](https://github.com/ThreeNativeHQ/threenative/blob/develop/docs/PRDs/unreal-like-features/PRD-454-worldcells-budget-real-resources.md) owns truthful world-resource budgeting. This slice addresses a measured residual texture-memory bottleneck; it does not assume that lack of virtual texturing is itself a defect.

**Outcome:** A detailed world uses high-detail textures near the player, evicts unnecessary high-detail representations under a hard byte budget and restores them without black materials, stale binds or unbounded cache growth.

## Design and ownership

Begin with separately loadable cooked resolution variants or an available portable mip-loading mechanism. Merely changing LOD bias or sampler LOD limits does not count as memory reclamation. The existing asset owner holds shared references; replace representations atomically and retire GPU resources only after in-flight use is safe. Prioritize current view demand with hysteresis and cancellation, preserve a valid low-detail fallback, and report both committed and pending GPU bytes. No sparse-texture assumption or full runtime virtual-texturing system in v1.

Color/normal/roughness texture families in a representative streamed world; preserve color-space, normal-map and material binding semantics. No tile-feedback renderer or unrelated geometry streaming rewrite.

## Required behavior

- Shared textures are counted once, and active materials never reference disposed textures.
- A hard budget includes pending replacement overlap and a reserved fallback; over-budget pressure is reported rather than hidden.
- Teleport, cancellation and two out-and-back routes return resident resources to the expected baseline.
- Improvement is shown in real allocation/residency accounting, not only smaller files or a visually blurrier frame.

## Execution phases

All proof paths below are **planned implementation targets**, not existing passing tests. Reuse an existing equivalent test or scenario after inspecting current code, and update the canonical proof path rather than adding a duplicate. Follow EXECUTE.md for fixture setup, variables, review and repository gates.

### Phase 1 — Cooked variants and truthful ownership

- [ ] Extend the existing cook/manifest only with the required variant records and capability-aware cache identity. proof: `pnpm exec vitest run packages/core/__tests__/vq-texture-mip-residency.spec.ts`.
- [ ] Implement shared variant lifetime and byte accounting including pending uploads and in-flight retirement. proof: `pnpm exec vitest run packages/core/__tests__/vq-texture-mip-residency.spec.ts`.

### Phase 2 — Bounded demand and safe replacement

- [ ] Add budgeted demand, hysteresis and cancellation while retaining a valid fallback representation. proof: `pnpm exec vitest run packages/core/__tests__/vq-texture-mip-residency.spec.ts`.
- [ ] Wire atomic material replacement and verify repeated streaming/teleport cycles release actual high-detail allocations. proof: `pnpm exec vitest run packages/core/__tests__/vq-texture-mip-residency.spec.ts`.

### Phase 3 — Qualify the visible result

- [ ] A fixed world route stays inside the declared allocation budget and demonstrates near-detail restoration on browser WebGPU. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-texture-mip-residency.playtest.json --url ${VQ_URL:?} --browser-recipe webgpu`.
- [ ] The same cooked package and budget contract pass on Linux native, with explicit decoder/format reporting. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-texture-mip-residency.playtest.json --target desktop --executable ${VQ_NATIVE_EXECUTABLE:?}`.

## Acceptance criteria

- [ ] The route reduces measured resident texture bytes while preserving near-field quality and avoiding missing-texture frames; no demonstrated bottleneck means defer the feature. proof: the completed Phase 3 scenario outputs, with the named fixture, package/cohort and adapter recorded inline here.
- [ ] The feature preserves its documented inactive/fallback path and releases owned resources after repeated lifecycle transitions. proof: `pnpm exec vitest run packages/core/__tests__/vq-texture-mip-residency.spec.ts` plus the Phase 3 lifecycle scenario.

## Performance and promotion

Use a fixed 256 MiB test budget only for the synthetic fixture, not as a shipping default. Include overlap and fallback bytes; measure upload hitches separately. Numerical targets are proposed acceptance targets, not benchmark results. Pin the fixture, metrics and thresholds before changing the implementation; never relax a failing threshold just to mark this PRD complete. Shared abstractions must pass the repository's reuse/LOC admission rule. Appearance remains editable source.

## Blocked on

A world with an observed texture-memory bottleneck is required for admission. Mobile claims require decoder qualification and a named device run.

## Completion record

Update the phase boxes and this PRD only after the named proof runs. Record actual results inline, including any remaining exclusions. A merged planning or implementation PR alone is not proof that every acceptance criterion passed. Archive according to the parent PRD filing rules when the work is genuinely complete.
