# PRD: Procedural vegetation asset generation

**Status:** PARTIAL — actual EZ Tree adapter, TSL wind source and executable tests added; platform/forest admission open.
**Priority:** P2. **PR:** #333. **Base:** develop `663de7c69fca3446303da8a39de7c8871bfe33c6`.

## Goal and ownership

Reuse seeded EZ Tree geometry at authoring time; keep every species/material/wind/density choice in editable game source. Cook ordinary assets and reuse existing batching, loader and world infrastructure. No engine-owned forest look or second streamer. The donor's WebGL onBeforeCompile implementation is not a WebGPU integration.

**Ruling, 2026-09-25:** use nested standalone `examples/integrations/vegetation`, not a core dependency or benchmark-arm change. Its actual implementation calls EZ Tree, validates estimated/generated vertex budgets, reconstructs safe index arrays from raw donor lists, replaces donor materials with borrowed game materials and disposes owned resources. `src/render/wind.ts` supplies editable TSL deformation, an analytic normal correction and conservative bounds. The first wind lane explicitly admits ordinary meshes only; this is a bounded implementation, not completion of instanced forest rendering.

## Test contract

Cover reproducible seeded geometry, index values 65535/65536, invalid indices, complete triangles, bounded generation, material ownership, deterministic wind and finite-difference normal-gradient agreement. Round-trip generated GLBs and prove the runtime actually selects every claimed LOD. Test wind in shadow and culling passes at unchanged alpha coverage and silhouette. Never assume pending WorldCells LOD support has shipped.

## Implementation order

### Phase 1 — generation admission
- [ ] Search existing assets, batching and LOD capabilities and record the chosen integration point.
- [ ] Pin the donor and audit code, noise attribution and all fixture textures separately.
- [ ] Add failing determinism, index-boundary and GLB round-trip tests.
- [x] Run ten dependency-free index/wind contracts after the observed failing baseline: 10 passed, 0 failed on Node 22.16.0.

### Phase 2 — offline variants and editable wind
- [ ] Implement bounded variant generation through the ordinary asset workflow.
  Actual donor code is present; dependency-backed generation and asset export/cook remain unverified.
- [ ] Implement game-owned TSL wind with matching shadow deformation and conservative bounds.
  Ordinary-mesh TSL source is present; actual GPU shadow proof remains open.
- [ ] Pass geometry, material, ownership and cleanup tests.
- [ ] Prove which runtime path selects every exported LOD rather than assuming support.
- [x] Strict-check the pure geometry/wind-reference module with TypeScript 5.8.3: exit 0.

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

## Verification and stop conditions

Executed: pure Node contracts 10/10 and TypeScript 5.8.3 strict checking of geometry.ts. Actual EZ Tree/Three integration tests and a strict dependency build are included in npm test and the focused PR workflow, but locally dependency downloads are unavailable. Do not infer their result, GPU compilation, native rendering or actual LOD behavior from CPU tests. Formal capability tools, installed transitive audit, lockfile, Biome, repository suite and independent review remain open. Keep draft; no iOS claim. Retain existing authored vegetation if the donor fails generation/quality admission instead of loosening geometry checks.

## References

- [Implementation and commands](../../../examples/integrations/vegetation/README.md)
- [EZ Tree](https://github.com/dgreenheck/ez-tree)
- [Original planning revision](https://github.com/ThreeNativeHQ/threenative/blob/31fee67315a7b134c360d04990db81fb54f2c041/docs/PRDs/threejs-integrations/PRD-threejs-procedural-vegetation.md)
- [Charter](../../architecture/CHARTER.md)
