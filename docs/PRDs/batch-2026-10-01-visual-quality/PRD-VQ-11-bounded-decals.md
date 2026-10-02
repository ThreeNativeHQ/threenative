---
prd_contract: v1
---

# PRD-VQ-11 — Impact and environment decals use a bounded portable lifecycle

**Status:** PARTIAL — 2026-10-02. The existing shooter decal field's owned-material teardown is repaired; the full receiver/projection feature and platform qualification remain open.
**Batch:** [Visual quality execution batch](https://github.com/ThreeNativeHQ/threenative/blob/docs/visual-quality-batch-2026-10-01/docs/PRDs/batch-2026-10-01-visual-quality/README.md). **Wave:** 2 / high-payoff detail.
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

All proof paths below are **planned implementation targets**, not existing passing tests unless a result is explicitly recorded. Reuse an existing equivalent test or scenario after inspecting current code, and update the canonical proof path rather than adding a duplicate. Follow [EXECUTE.md](https://github.com/ThreeNativeHQ/threenative/blob/docs/visual-quality-batch-2026-10-01/docs/PRDs/batch-2026-10-01-visual-quality/EXECUTE.md) for fixture setup, variables, review and repository gates.

### Phase 1 — Reuse projection and bound lifetime

- [ ] Integrate upstream decal projection with existing picking/base-geometry data and explicit receiver support. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts`.
- [ ] Implement deterministic pool limits, eviction, receiver cleanup and borrowed-resource ownership. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts`.
  - Partial, 2026-10-02: the existing generated shooter `DecalField` now releases each cloned slot material, family material and shared geometry once; its texture remains borrowed. `node node_modules/vitest/vitest.mjs run packages/create-threenative/__tests__/shooter-decals-lifetime.spec.ts` passed 4 tests after reproducing 4 failures on the original implementation. This repairs the existing 224-slot template; it does not implement the proposed 256-decal receiver/projection fixture or introduce an engine pool.
  - Caller ownership follow-up, 2026-10-02: `Play` registers its procedural decal texture in the existing scene registry after the borrowing field. The real `Play.load`/`enter` and registry teardown regression proves all 224 material disposals precede one texture disposal on each of three scene lifecycles; repeated cleanup does not redispose it, and the borrowed sky texture is retained. proof: `node node_modules/vitest/vitest.mjs run --maxWorkers 1 packages/create-threenative/__tests__/template-runtime-cost.spec.ts -t 'releases the shooter-owned decal texture'` — missing-disposal failure before the fix, pass afterward.

### Phase 2 — Preserve authored appearance and receiver motion

- [ ] Add game-owned decal material/atlas composition with bounded bias and fade controls. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts`.
- [ ] Verify rigid receiver motion, LOD changes and repeated scene teardown without detached marks or allocation growth. proof: `pnpm exec vitest run packages/core/__tests__/vq-bounded-decals.spec.ts`.
  - Partial, 2026-10-02: the lifetime regression exercises 20 field construction/teardown cycles, 2,000 pooled placements, clear/reuse, zero-slot teardown and repeated `dispose()`. Real Three disposal events/spies verify owned-resource release and retention of the borrowed map. Rigid receivers, LOD changes, GPU memory and game-scene transitions are not qualified by these unit tests.

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
Browser/native visual qualification needs a runnable fixture and GPU/runtime lane. The current container has no `/dev/dri` or `/dev/kvm`; `node packages/playtest/dist/runner/cli.js doctor --text` exits 2 because `adb` is absent. These limits do not block the still-unimplemented CPU-testable projection, receiver and LOD work.

## Completion record

Update the phase boxes and this PRD only after the named proof runs. Record actual results inline, including any remaining exclusions. A merged planning or implementation PR alone is not proof that every acceptance criterion passed. Archive according to the parent PRD filing rules when the work is genuinely complete.

2026-10-02 initial bounded ownership repair at `d134451e` (historical results from the prior environment; not a fresh aggregate pass for later changes):

- Red/green: the final four-test lifetime regression failed all four cases on the original `decals.ts` and passed all four with the repair. No Three disposal implementation is replaced; listeners and call-through spies observe the real methods.
- `node node_modules/vitest/vitest.mjs run --maxWorkers 1 packages/create-threenative/__tests__/shooter-decals-lifetime.spec.ts packages/create-threenative/__tests__/world-environment-lifetime.spec.ts packages/create-threenative/__tests__/shooter-rig.spec.ts packages/create-threenative/__tests__/template-runtime-cost.spec.ts`: 4 files, 13 tests passed after building local package prerequisites. Existing Rapier/Three warnings were emitted.
- `pnpm typecheck` and `pnpm --filter create-threenative build`: exit 0 after building package prerequisites. `pnpm lint`: exit 0 with 1,000 existing warnings. `node --import tsx scripts/check-doc-links.ts`: exit 0, 2,395 links checked. The doc-link/evidence-budget/evidence-citations suites passed 31 tests using the `node --import tsx` loader in place of the CLI's unavailable IPC socket.
- Full `pnpm test` was attempted and stopped at the `tsx` IPC socket with `EPERM`; its loader-based retry was interrupted during aggregate builds to avoid running the batch's full suite concurrently. This is not a full-suite pass. No browser, native, GPU-allocation or visible-result claim is made.
- All six phase boxes and both acceptance boxes remain open. The proposed 256-mark projection fixture, receiver motion/removal, LOD handling, appearance controls and platform scenarios are still to be implemented or qualified.

2026-10-02 caller texture ownership follow-up, verified in the recovered environment:

- Fresh red/green on the actual shooter caller: its generated map emitted zero disposal events after scene/registry teardown before the fix. After the fix, the new regression passes through three scene construction/teardown cycles, checks borrower-before-texture disposal ordering and idempotent cleanup, and leaves the borrowed sky map untouched.
- The same four-file focused/adjacent command above passes 14/14 tests with `--maxWorkers 1`, including the original four field-ownership regressions. Fixture Rapier/Three warnings remain visible; no real disposal implementation is replaced.
- `node node_modules/typescript/bin/tsc --noEmit -p packages/create-threenative/tsconfig.json`: exit 0. Biome check on the changed caller and test: exit 0 with six existing complexity warnings. `node --import tsx scripts/check-doc-links.ts`: exit 0, 2,395 links checked.
- This follow-up does not rerun aggregate root build/typecheck/test lanes while parallel rendering work is active. Browser/native qualification, actual relevant runtime screenshot proof, required CI and independent review remain open; the PR stays draft. Projection/receiver feature expansion is not included in this ownership repair.
