# PRD: Procedural vegetation asset generation

**Status:** NOT STARTED — planning-only seed for one draft implementation PR.
**Priority:** P2.
**Base:** `develop` at `663de7c69fca3446303da8a39de7c8871bfe33c6` (2026-09-25).
**Donor:** `dgreenheck/ez-tree`.
**Scope of this commit:** this PRD only; no implementation, dependency or runtime changes.

## Goal and adoption decision

Give agents a reproducible source of vegetation variants that becomes normal cooked assets,
with editable materials and WebGPU wind. Reuse EZ Tree's geometry generation, not its editor,
its appearance defaults or a parallel forest runtime. Existing hand-authored or purchased
vegetation remains a first-class alternative; generated trees are not a quality guarantee.

## Source findings and overlap

The inspected donor manifest declares MIT and a Three peer range including the base's 0.185.1.
Its tree source creates wind by injecting GLSL through onBeforeCompile, and the inspected
geometry builder unconditionally uses Uint16Array indices. Those are concrete checks for the
admission phase, not proof that all donor versions behave identically. Pin the actual source.
Upstream exposes geometry generation separately from its own LOD container; prefer that seam.

ThreeNative already has asset cooking, InstancedBatch, ClusteredBatch and model LOD. WorldCells
is being introduced in PR #317; its description explicitly says exported LOD1 is not consumed
by that path yet. Do not assume merging this plan makes that capability available, and do not
build a competing cell streamer or silently ship unused LOD files as a completed feature.

## Design and file ownership

Put deterministic generation in `examples/abyss-framework/tools/vegetation-assets.ts` and
appearance in `examples/abyss-framework/src/render/vegetation-fixture.ts`. The offline generator
is an example-local development dependency. Geometry is authored once per seed/parameter set,
then sent through the existing model cook. Runtime material/wind source is game-owned TSL.

Seed, dimensions, species parameters, texture selection and variant count are explicit author
choices. Store generation provenance with the source assets, not in a novel scene format.
Use a bounded variant collection; do not recursively generate complete trees in a frame loop.
No donor editor or hard-coded external texture URL is needed in a packaged game.

Validate maximum index against vertex count before typed-array narrowing. Select Uint32 when
needed or reject unsupported geometry before export; add a boundary regression across index
65535. Do not let silent Uint16 wrapping create plausible but corrupted meshes. Bound generation
work by authored limits and validate nonfinite values. Dispose intermediate geometry without
freeing shared textures. The wind graph must also produce the corresponding shadow deformation;
rendering a moving tree above a motionless shadow is not a passing visual result.

Choose exactly one LOD authority. Export levels as explicit assets with verified selection, or
use the existing cook's supported LOD contract; a glTF export of a THREE.LOD hierarchy alone
does not establish runtime selection. Leaf-alpha/material groups and coverage must survive the
round-trip. If WorldCells is not landed, demonstrate placement through existing batching and
leave cell integration separate. Wind displacement must be included in culling bounds.

## Test contract

Add `packages/assets/__tests__/vegetation-export.spec.ts`: identical seed/parameters produce
identical normalized geometry; a changed seed changes geometry; large indices are valid; every
exported level loads; leaf and bark materials remain separate; failed generation leaves no
half-written output. Check max-generation settings, zero-leaf trees and repeated disposal.

The real fixture contains a single close tree, a mixed-distance grove and a shadowed tree.
Measure draw calls, submitted triangles, CPU/GPU time, uploaded bytes and memory at identical
camera/resolution. Inspect alpha coverage and silhouette during LOD changes; triangle savings
alone are not enough. A fixed time/wind input must reproduce the same deformation on web and
native. Visual approval must use actual captures; no claim of realistic or AAA quality follows
from a generator test. Existing authored vegetation is the baseline, not an empty scene.

## Implementation order

### Phase 1 — generation admission
- [ ] Search existing assets, batching and LOD capabilities and record the chosen integration point.
- [ ] Pin the donor and audit code, noise attribution and all fixture textures separately.
- [ ] Add failing determinism, index-boundary and GLB round-trip tests.

### Phase 2 — offline variants and editable wind
- [ ] Implement bounded variant generation through the ordinary asset workflow.
- [ ] Implement game-owned TSL wind with matching shadow deformation and conservative bounds.
- [ ] Pass geometry, material, ownership and cleanup tests.
- [ ] Prove which runtime path selects every exported LOD rather than assuming support.

### Phase 3 — forest fixture proof
- [ ] Pass the grove browser WebGPU playtest with actual image captures.
- [ ] Pass the same fixture on desktop native, naming OS and adapter.
- [ ] Pass the same fixture on Android, naming the executed lane.
- [ ] Record silhouette, alpha-coverage and frame-cost comparisons at fixed content/quality.

### Phase 4 — adoption and documentation
- [ ] Prove the shipped game excludes the offline generator and browser editor.
- [ ] Document author-owned appearance and the selected LOD authority.
- [ ] Run repository checks without changing WorldCells or cook-profile PRs implicitly.
- [ ] Complete a separate code review and synchronize PRD, PR and progress label.

## Acceptance criteria
- [ ] Seeded vegetation assets are reproducible and load through the normal asset loader.
- [ ] Geometry requiring indices above 65535 is safe or rejected before corruption.
- [ ] The runtime wind path uses TSL rather than the donor's GLSL compile hook.
- [ ] Wind deformation and shadow/culling behavior agree.
- [ ] Every claimed LOD is actually selected in the tested runtime.
- [ ] Browser WebGPU evidence is recorded.
- [ ] Desktop-native evidence is recorded.
- [ ] Android evidence is recorded.

## Stop conditions and rollback

Do not introduce engine-owned species presets, biome policy, a world editor or a streamer.
If the generated result cannot meet the target game's visual bar, keep the existing authored
asset route. If offline export works but wind does not, report partial work, not complete
adoption. Removing the authoring dependency must not stop static cooked trees from loading.

## References

- [Upstream](https://github.com/dgreenheck/ez-tree)
- [Geometry and material implementation](https://github.com/dgreenheck/ez-tree/blob/main/src/lib/tree.js)
- [WorldCells PR](https://github.com/ThreeNativeHQ/threenative/pull/317)
- [Asset loader](../../../packages/core/src/assets.ts)
- [Existing batching and LOD](../../../packages/core/src/index.ts)
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
