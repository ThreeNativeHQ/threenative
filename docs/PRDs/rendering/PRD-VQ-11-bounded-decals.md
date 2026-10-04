---
prd_contract: v1
---

# PRD-VQ-11 — Impact and environment decals use a bounded portable lifecycle

**Status:** PROPOSED — 2026-10-01. No implementation or qualification is claimed.
**Batch:** Visual quality execution batch. **Wave:** 2 / high-payoff detail.
**Dependencies:** Independent. Share receiver/base-geometry selection with existing LOD and picking paths.

## Grounding and intended outcome

Upstream [DecalGeometry](https://threejs.org/docs/pages/DecalGeometry.html) already provides mesh projection. The earlier audit must not be interpreted as permission to rewrite that algorithm. The useful product gap is qualified receiver handling, pooling, lifetime and game-owned material composition for real impacts.

**Outcome:** Repeated bullet impacts and environment marks remain attached to their receivers, respect normals and occlusion, and stay within a fixed resource cap as the player moves or the scene unloads.

## Design and ownership

Start from ordinary Three decal geometry and generated materials. Reuse existing hit results, object transforms and authored LOD0 geometry rather than raycasting the whole world again. Admit a shared lifecycle owner only when at least two consumers need it. Keep material, atlas choice, color, depth bias and fade curves in generated source. A world-static mark and a rigid-moving receiver are separate supported cases; skinned or deforming decals are explicitly refused in v1.

Surface-color impacts and environment marks on static/rigid opaque receivers. No deferred G-buffer decal renderer, normal/roughness channel rewrite, skinned tattoo system or virtual-texture painting.

## Required behavior

- A cap of 256 decals in the fixture is enforced with deterministic eviction, and receiver teardown removes its marks.
- A mark stays on a rigid receiver under translation/rotation; nonuniform or unsupported transforms have a specified behavior.
- Receiver isolation avoids marks projecting through nearby unrelated geometry; corner distortion is documented.
- LOD changes do not alter the gameplay hit surface or strand a decal on disposed geometry.

## Execution phases

All proof paths below are **planned implementation targets**, not existing passing tests. Reuse an existing equivalent test or scenario after inspecting current code, and update the canonical proof path rather than adding a duplicate. Follow EXECUTE.md for fixture setup, variables, review and repository gates.

### Phase 1 — Reuse projection and bound lifetime

- [ ] Integrate upstream decal projection with existing picking/base-geometry data and explicit receiver support. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts`.
- [ ] Implement deterministic pool limits, eviction, receiver cleanup and borrowed-resource ownership. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts`.

### Phase 2 — Preserve authored appearance and receiver motion

- [ ] Add game-owned decal material/atlas composition with bounded bias and fade controls. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts`.
- [ ] Verify rigid receiver motion, LOD changes and repeated scene teardown without detached marks or allocation growth. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts`.

### Phase 3 — Qualify the visible result

- [ ] The impact sequence covers the 256-mark cap, moving receiver and LOD boundary on browser WebGPU. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-bounded-decals.playtest.json --url ${VQ_URL:?} --browser-recipe webgpu`.
- [ ] The same sequence runs on Linux native with matching pool/receiver observations and visible marks. proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/vq-bounded-decals.playtest.json --target desktop --executable ${VQ_NATIVE_EXECUTABLE:?}`.

## Acceptance criteria

- [ ] The supported receiver cases retain their marks under motion and teardown, and resource use is bounded independently of total shots fired. proof: the completed Phase 3 scenario outputs, with the named fixture, package/cohort and adapter recorded inline here.
- [ ] The feature preserves its documented inactive/fallback path and releases owned resources after repeated lifecycle transitions. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts` plus the Phase 3 lifecycle scenario.

## Performance and promotion

Measure draw calls and geometry bytes at the cap. Batch only compatible marks when it improves the measured cost; do not trade correctness for an advertised one-draw system. Numerical targets are proposed acceptance targets, not benchmark results. Pin the fixture, metrics and thresholds before changing the implementation; never relax a failing threshold just to mark this PRD complete. Shared abstractions must pass the repository's reuse/LOC admission rule. Appearance remains editable source.

## Blocked on

Skinned/deforming receivers require a separate demand-backed extension and are not silently treated as rigid meshes.

## Completion record

Update the phase boxes and this PRD only after the named proof runs. Record actual results inline, including any remaining exclusions. A merged planning or implementation PR alone is not proof that every acceptance criterion passed. Archive according to the parent PRD filing rules when the work is genuinely complete.
