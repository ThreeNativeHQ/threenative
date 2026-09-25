# PRD: Offline CSG asset authoring

**Status:** NOT STARTED — planning-only seed for one draft implementation PR.
**Priority:** P1.
**Base:** `develop` at `663de7c69fca3446303da8a39de7c8871bfe33c6` (2026-09-25).
**Donor:** `gkjohnson/three-bvh-csg`.
**Scope of this commit:** this PRD only; no implementation, dependency or runtime changes.

## Goal and adoption decision

Let an agent author a doorway, recess or intersecting pipe in TypeScript, then deliver a normal
GLB through the existing asset cook. Adopt `three-bvh-csg` for controlled offline geometry,
not as a runtime destruction system or an engine-owned modeling language. Use direct donor
calls in editable authoring source first; extract export plumbing only if repeated consumers
prove that the existing asset package should own it.

## Source findings and overlap

The inspected donor manifest declares MIT, Three >=0.179.0 and three-mesh-bvh >=0.9.7.
The base catalog pins Three 0.185.1 and BVH 0.9.14, so declared peer ranges overlap. This is
not a test result. Upstream requires watertight solid inputs and warns about numerical
edge cases. Its README also warns that CSG draw ranges need special treatment for export.
Existing `mergeParts` is mesh consolidation, not Boolean geometry; keep it for its own job.
Do not duplicate the Blender Boolean workflow when that already solves the consumer's task.

## Design and file ownership

Use `examples/abyss-framework/tools/csg-assets.ts` for the authored solid operations and
`examples/abyss-framework/src/render/csg-fixture.ts` for the appearance and playable fixture.
Keep the donor in the example's development dependency graph. Reuse `@threenative/assets`
for cooking and `ctx.assets.model` for loading. A proposed
`packages/assets/__tests__/csg-export.spec.ts` exercises the export contract; it does not
justify a new public package. Use one real Three installation, including its existing patch.

Geometry output is ordinary BufferGeometry/GLB. Normalize only the active draw range, remap
indices and material groups, preserve authored attributes and validate finite values before
export. Do not serialize unused backing-buffer triangles. For indexed geometry, ranges count
indices; for non-indexed geometry, they count vertices. Reject non-triangle-aligned ranges,
invalid groups, unsupported attributes and non-invertible input transforms with an asset name.
An empty intersection is an explicit empty result, never a full original mesh or a corrupt GLB.

Preserve source brushes and game-owned materials. Clear the donor's acceleration data when
geometry changes; disposal must not destroy shared inputs. Admit only a documented input
corpus, not an assertion that every arbitrary mesh is manifold. Do not silently repair holes.

## Test contract

A synthetic 4 m by 3 m by 0.3 m wall minus a through-box 1 m wide by 2 m high is the main fixture.
The cutter extends beyond both wall faces. Use interior sample points away from boundaries:
rays through the doorway miss; rays through intact wall hit. After export, cooking and reload,
those queries agree with the original Boolean result. The example creates collision from the
same authoritative LOD0 geometry, not the currently selected visual LOD.

Add union, disjoint and empty-intersection cases; rotated parents; multi-material cuts;
nonzero drawRange starts; indexed/non-indexed output; NaN; singular transforms; and a
repeated-generate/dispose case. A GLB validator must accept the output. Compare normalized
geometry/attributes for repeatability, not arbitrary GLB metadata byte order. Desktop and
Android load the cooked GLB without importing the CSG donor. Native parity is a runtime-asset
claim, not a claim that the offline generator runs inside the host.

## Implementation order

### Phase 1 — admission and regression corpus
- [ ] Record capability-search results and confirm the existing cook/export extension point.
- [ ] Pin the donor and audit its code, transitive dependencies and fixture permissions.
- [ ] Add the Boolean/export fixture tests and record their expected initial failures.

### Phase 2 — offline generation and round-trip
- [ ] Implement the editable authoring script and active-range normalization.
- [ ] Pass the GLB validation and geometry round-trip tests.
- [ ] Prove failure diagnostics and shared-input disposal behavior.

### Phase 3 — real game and collision proof
- [ ] Wire the doorway fixture through the existing cook and model loader.
- [ ] Pass a browser WebGPU playtest that crosses the opening and collides with intact wall.
- [ ] Pass the same cooked-asset scenario on desktop native, naming OS and adapter.
- [ ] Pass the same cooked-asset scenario on Android; report the device or emulator explicitly.

### Phase 4 — integration and release hygiene
- [ ] Prove the runtime bundle has no CSG generator dependency.
- [ ] Run repository checks and document the admitted input limitations.
- [ ] Measure authoring effort and reject an adapter that adds more code than direct use.
- [ ] Complete a separate code review and synchronize PRD, PR and progress label.

## Acceptance criteria
- [ ] A TypeScript-authored Boolean model reaches a playable game through the ordinary asset path.
- [ ] The rendered opening and collision opening agree after the complete cook/load round-trip.
- [ ] Active ranges and material groups survive export without hidden extra triangles.
- [ ] Invalid or unsupported input fails with a named diagnostic.
- [ ] No Boolean authoring code is loaded by a game using only the cooked asset.
- [ ] Browser WebGPU evidence is recorded.
- [ ] Desktop-native evidence is recorded.
- [ ] Android evidence is recorded.

## Stop conditions and rollback

Do not expand into runtime fracture, navmesh rebuilding, networking or a CAD editor. If the
admitted corpus cannot export reliably, retain the existing Blender path and record the failed
admission rather than relaxing validation. Removing the authoring dependency must leave cooked
GLBs loadable. No changes to WorldCells PR #317 or cook-profile PR #330 are required.

## References

- [Upstream](https://github.com/gkjohnson/three-bvh-csg)
- [Donor manifest](https://github.com/gkjohnson/three-bvh-csg/blob/main/package.json)
- [Asset loader](../../../packages/core/src/assets.ts)
- [Dependency catalog](../../../pnpm-workspace.yaml)
- [Charter](../../architecture/CHARTER.md)

## Cross-cutting requirements

The framework owns portable mechanism, never the game's appearance or gameplay policy.
Keep ordinary Three.js objects and the existing loop authoritative. Before implementation,
run `engine_search_capabilities` and read `engine_capability_detail` for every relevant hit.
Do not add a second renderer, scene format, ECS, CLI vocabulary, asset cache or world streamer.
No dependency reaches `@threenative/core` merely because a demonstration imports it.
Pin admitted dependencies and record the upstream commit/package integrity, code notices,
transitive licenses and fixture-asset permissions. No unlicensed demo assets are copied.

All new file names below are proposed, not shipped APIs. Read the nearest `AGENTS.md` before
editing. Update the relevant template instructions and generated mirrors only when a capability
actually ships. Keep this PRD and its one draft PR synchronized; no phase-sized replacement PRs.
Do not merge this planning seed as evidence that the integration is complete.

## Verification commands and initial evidence

After implementation, run the focused tests named below, then `pnpm typecheck`, `pnpm lint`,
`pnpm test`, `pnpm check:docs`, and the applicable playtest/native lanes. Record actual commands,
exit codes and adapters beside their boxes. Missing observations are failures, not zero cost.
Run `pnpm prd:progress` on this file before work and after every phase. Do not label a phase
verified solely because code or a document exists.

This initial change is planning-only. Source inspection used the GitHub connector. A local
`git ls-remote` attempt failed because the sandbox could not resolve github.com; pnpm and a
repository checkout were not available. Dependency installation, repository checks, browser
execution and native execution have not been performed. iOS is not a supported target and is
not added by this work. Platform support must name the lane actually executed.

Document-only validation: the fetched `scripts/prd-progress.ts` blob
`f3ec0a737a5b3bcfa06952a48b523ae56f7fd119` was hash-verified and executed directly with
`node --experimental-strip-types`, returning four phases and `prd:0%` for this file.
The PR checklist matches this PRD, and relative links were checked against inspected paths.
These checks do not replace repository-wide documentation, build or runtime tests.
