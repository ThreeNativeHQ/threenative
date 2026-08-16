---
prd_contract: v1
---

# PRD-075 — Generated-source render workload advisor

**Status:** DONE — advisory diagnostics only; verified 2026-08-11.
**Depends on:** PRD-074 outcome counters and truthful renderer draw/pass counters; may consume PRD-EXP-002 experimental data but must not depend on private hooks in production.
**Evidence:** `docs/verification/render-work-reduction-2026-08-11.md`; `docs/verification/prd-075-render-workload-advisor-2026-08-11.md`.

## 1. Decision

Give generated ThreeNative games an opt-in development advisor that identifies render-work hotspots and names stock Three.js remedies. Do not automatically rewrite, instance, merge, reorder, batch or change user scene content.

The controlled matrix found that 4,000 independent shared-material meshes cost 5.70–6.90 ms median diagnostic render wall time versus about 0.20 ms when compatible with `InstancedMesh` or merged geometry. Distinct equal-looking material objects added roughly 2.7–3.1 ms, and a redundant pass approximately doubled the expensive path. Existing templates already demonstrate HUD instancing and GPU particle batching, but authors cannot see when their own generated source has drifted into thousands of objects, material identities or passes.

## 2. Scope

An explicit development command or playtest report summarizes, per scene/frame window:

- logical Object3D count and renderable count;
- visible render-object/draw count;
- material and geometry identity counts;
- top groups by shared geometry+material compatibility;
- sprites/HUD/camera-overlay counts;
- transparent, custom-shader, hook, skinning, morphing, layer and render-order constraints;
- pass count and repeated scene/camera render pairs where observable;
- SceneCollapse applied/skipped results;
- stock Three.js recommendations with evidence and caveats.

Recommendations may include:

- use `InstancedMesh` in generated `src/render/` for repeated dynamic transforms with compatible geometry/material;
- merge truly static compatible geometry in generated source;
- share material instances when properties and mutation semantics allow;
- use existing starter HUD instancing or `GPUParticles3D` for compatible sprite-like workloads;
- remove a redundant render pass only when final pixels/depth semantics remain equivalent;
- inspect a named incompatibility rather than suggesting unsafe folding.

## 3. Non-goals

- no framework auto-instancer or auto-batcher;
- no scene-content rewriting;
- no “performance: high/low” mode;
- no private Three.js method dependency in shipped runtime;
- no recommendation based only on object count without compatibility constraints;
- no upload of scene names, object names, assets or user content.

## 4. Integration

Expected paths:

- playtest/performance report schema and command;
- `packages/core` public diagnostics already justified by PRD-074 and renderer info;
- generated template documentation/examples in user-owned `src/render/`;
- tests using synthetic scene summaries, not a second optimizer.

The advisor consumes counters from live callers. It does not maintain a mirror scene and does not traverse production scenes every frame; snapshots are explicit or sampled in development.

## 5. Phases

### Phase 1 — report schema and safety

Define a versioned local report with aggregate counts only. Add fail-closed compatibility reason codes. Prove report generation retains no Object3D/Material/Geometry references and serializes no names or asset paths.

### Phase 2 — actionable rules

Implement bounded rules backed by the findings report and existing framework mechanisms. Every recommendation includes current count, expected reduced count, constraints, owner (`packages/core` versus generated `src/render/`) and a link/path to a working repository example.

### Phase 3 — template examples

Ensure starter HUD instancing, GPU particles and one static/shared-material example are discoverable. Add no magic runtime behavior. Generated code remains ordinary upstream Three.js code editable by the user.

### Phase 4 — correlation gate

Run the advisor on the controlled independent/instanced/merged/distinct-material/two-pass fixtures and one real example. It must warn only on the intentionally expensive compatible cases and stay silent or explain incompatibility on negative controls.

## 6. Acceptance criteria

- [x] The advisor reports actual observed draw/pass/material/geometry counts from a running build.
- [x] The 4,000 independent compatible fixture recommends instancing or static merging and states the expected draw reduction.
- [x] The already-instanced and merged fixtures do not receive the same warning.
- [x] Equal-looking distinct material fixtures recommend sharing only when mutation and shader semantics are compatible.
- [x] Transparent, skinned, morphed, custom-shader, hook-driven, layered or render-ordered fixtures are rejected or caveated explicitly.
- [x] Redundant-pass advice requires an observed repeated scene/camera/pass pattern and never deletes or changes a pass automatically.
- [x] Reports contain aggregate counts/reason codes only and retain no scene references or private content.
- [x] No production private-renderer hooks, automatic scene rewrite or native scene mirror are added.
- [x] Tests, typecheck, targeted Biome, budgets and `git diff --check` pass. Full root `pnpm lint` is not claimed because ignored/generated artifacts currently make it fail outside this PRD surface; see the verification report.

## 7. Negative controls

| Control | Change | Expected |
|---|---|---|
| false instancing advice | use meshes with incompatible materials/hooks | advisor gives incompatibility reason, not instancing instruction |
| redundant advice | run already-instanced fixture | no repeated-object warning |
| pass semantics lie | two passes with different targets/depth purpose | no redundant-pass claim |
| privacy leak | attach object name/asset path to report | schema test fails |
| hidden optimizer | mutate scene while collecting | identity/snapshot test fails |

## 8. Kill and rollback

Drop any rule whose false-positive rate exceeds 10% on repository fixtures or whose compatibility cannot be determined from public semantics. If collecting a metric requires permanent per-frame traversal or private renderer hooks, omit it from the production advisor and keep it experimental. The entire advisor remains opt-in development tooling and can be removed without affecting runtime output.
