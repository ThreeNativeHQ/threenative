# PRD: Offline CSG asset authoring

**Status:** PARTIAL — implementation and executable tests added; donor and platform qualification open.
**Priority:** P1.
**Base:** develop at `663de7c69fca3446303da8a39de7c8871bfe33c6`.
**Donor:** gkjohnson/three-bvh-csg. **PR:** #331.

## Goal and design

Author a doorway, recess or intersecting pipe in TypeScript and deliver ordinary GLB through the existing cook/loader. No runtime destruction system, new renderer, modeling language or asset cache. The framework owns portable mechanism; materials and authored geometry remain game source. Keep original inputs and shared materials alive.

**Implementation ruling, 2026-09-25:** code lives in `examples/integrations/csg`, a standalone opt-in nested example, rather than bloating the benchmark arm or adding an unqualified core dependency. Its manifest pins Three 0.185.1, BVH 0.9.14, three-bvh-csg 0.0.18 and glTF Transform 4.4.2. Source compatibility is not execution evidence. The standalone renderer is not the framework's patched renderer.

`active-geometry.ts` compacts active triangles, remaps attributes/groups, preserves typed/normalized data and rejects malformed ranges. `csg.ts` executes real donor Boolean operations using owned scratch brushes. `export-glb.ts` writes bounded untextured standard-PBR GLBs via NodeIO. `generate.ts` authors the doorway without overwriting existing assets. README gives actual commands. A focused PR workflow runs strict build and both executable suites; root Vitest excludes examples.

## Test contract

Use a 4m x 3m x 0.3m wall minus a through-cutter making a 1m x 2m opening. Rays through the doorway miss; intact wall rays hit. Preserve this after export, cooking and reload, and build physics from LOD0. Test union, disjoint/empty intersection, transformed inputs, material groups, nonzero draw ranges, indexed/nonindexed attributes, invalid values and disposal. Require GLB validation and actual browser/desktop/Android playtests before admission. The exporter currently rejects textured/physical/interleaved/morphed assets instead of silently losing them. Watertight inputs remain required; no topology repair is claimed.

## Implementation order

### Phase 1 — admission and regression corpus
- [ ] Record capability-search results and confirm the existing cook/export extension point.
- [ ] Pin the donor and audit its code, transitive dependencies and fixture permissions.
- [ ] Add the Boolean/export fixture tests and record their expected initial failures.
- [x] Execute the dependency-free active-range regression corpus: 10 failing tests before implementation, then 10 passing tests on Node 22.16.0.

### Phase 2 — offline generation and round-trip
- [ ] Implement the editable authoring script and active-range normalization.
  Code is present; donor-backed build/generation must still execute before this combined claim is checked.
- [ ] Pass the GLB validation and geometry round-trip tests.
- [ ] Prove failure diagnostics and shared-input disposal behavior.
- [x] Strict-check the dependency-free normalization module with local TypeScript 5.8.3: exit 0.

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

## Verification and remaining work

Executed: `node --experimental-strip-types --test tests/contracts.test.mjs` — 10 passed, 0 failed. `tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext src/active-geometry.ts` — exit 0 using available TypeScript 5.8.3. Complete `npm test` attempted: build fails because Three/donor/glTF/node type dependencies cannot be resolved in the network-restricted sandbox. The real integration tests are written, not reported green. Dedicated CI is configured but its result must be read separately.

Formal engine capability tools, transitive-license audit, lockfile generation, Biome, full repository tests and all GPU/native/collision lanes are unrun. No iOS support claim. Keep draft. Reject adoption rather than relaxing topology/export or platform gates. Removing the authoring dependency must leave cooked GLBs loadable. Do not change WorldCells #317 or cook profiles #330 implicitly.

## References

- [Upstream](https://github.com/gkjohnson/three-bvh-csg)
- [Implementation](../../../examples/integrations/csg/README.md)
- [Original planning revision](https://github.com/ThreeNativeHQ/threenative/blob/0cfd44b3edafe75930a355f787c0f70e10ee5b26/docs/PRDs/threejs-integrations/PRD-threejs-csg-cook.md)
- [Charter](../../architecture/CHARTER.md)
