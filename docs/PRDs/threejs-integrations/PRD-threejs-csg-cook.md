# PRD: Offline CSG asset authoring

**Status:** PARTIAL — offline export hardening implemented; dependency-backed and platform qualification open.
**Priority:** P1.
**Base:** develop at `663de7c69fca3446303da8a39de7c8871bfe33c6`.
**Donor:** gkjohnson/three-bvh-csg. **PR:** #331.

## Goal and design

Author a doorway, recess or intersecting pipe in TypeScript and deliver ordinary GLB through the existing cook/loader. No runtime destruction system, new renderer, modeling language or asset cache. The framework owns portable mechanism; materials and authored geometry remain game source. Keep original inputs and shared materials alive.

**Implementation ruling, 2026-09-25:** code lives in `examples/integrations/csg`, a standalone opt-in nested example, rather than bloating the benchmark arm or adding an unqualified core dependency. Its manifest pins Three 0.185.1, BVH 0.9.14, three-bvh-csg 0.0.18 and glTF Transform 4.4.2. Source compatibility is not execution evidence. The standalone renderer is not the framework's patched renderer.

`active-geometry.ts` compacts active triangles and preserves typed/normalized attributes and groups. `csg.ts` owns the donor's scratch brushes, including a target allocated before evaluation can throw. Transform baking repairs winding under reflections. `export-glb.ts` rejects unadmitted attribute layouts/semantics, non-finite float32 values, BackSide and out-of-range untextured PBR factors. Single-material meshes do not interpret geometry group indices as material-array indices. `generate.ts` authors the doorway without overwriting assets.

## Test contract

Use a 4m x 3m x 0.3m wall minus a through-cutter making a 1m x 2m opening. Rays through the doorway miss; intact wall rays hit. Preserve this after export, cooking and reload, and build physics from LOD0. Test union, disjoint/empty intersection, transformed inputs, material groups, nonzero draw ranges, indexed/nonindexed attributes, invalid values and disposal. Require Khronos GLB validation and actual browser/desktop/Android playtests before admission. Textured/physical/interleaved/morphed inputs are rejected, not silently degraded. Watertight inputs remain required; no topology repair is claimed.

## Implementation order

### Phase 1 — admission and regression corpus
- [ ] Record capability-search results and confirm the existing cook/export extension point. proof: #331 engine capability-tool and cook-path evidence.
- [ ] Pin the donor and audit its code, transitive dependencies and fixture permissions. proof: #331 donor/dependency audit and reviewed lockfile.
- [ ] Add the Boolean/export fixture tests and record their expected initial failures. proof: `npm run test:integration`; new tests committed first in `89ccee19`, dependency-backed baseline still unexecuted.
- [x] Execute the dependency-free active-range regression corpus: 10 failing tests before implementation, then 10 passing tests on Node 22.16.0. proof: `node --experimental-strip-types --test tests/contracts.test.mjs`; the original 10 tests also pass during the 2026-09-27 rerun.

### Phase 2 — offline generation and round-trip
- [x] Implement the editable authoring script and active-range normalization. proof: 2026-09-26 strict build, 10 range contracts and real CLI generation/readback plus EEXIST overwrite protection; current normalization rerun passes 13/13 contracts.
- [ ] Pass the GLB validation and geometry round-trip tests. proof: `npm run test:integration`; Khronos validator, GLTFLoader, normalized colors and indexed/nonindexed two-material active-range cases added, execution pending.
- [ ] Prove failure diagnostics and shared-input disposal behavior. proof: `npm run test:integration`; exceptional donor cleanup, reusable shared inputs, idempotent disposal and invalid-input cases added, execution pending.
- [x] Strict-check the dependency-free normalization module with local TypeScript 5.8.3: exit 0. proof: `tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext src/active-geometry.ts`, rerun 2026-09-27.

### Phase 3 — real game and collision proof
- [ ] Wire the doorway fixture through the existing cook and model loader. proof: #331 complete engine cook/load fixture.
- [ ] Pass a browser WebGPU playtest that crosses the opening and collides with intact wall. proof: #331 cooked-doorway browser playtest.
- [ ] Pass the same cooked-asset scenario on desktop native, naming OS and adapter. proof: #331 cooked-doorway desktop playtest.
- [ ] Pass the same cooked-asset scenario on Android; report the device or emulator explicitly. proof: #331 cooked-doorway Android playtest.

### Phase 4 — integration and release hygiene
- [ ] Prove the runtime bundle has no CSG generator dependency. proof: #331 ordinary game bundle inspection and load without authoring dependencies.
- [ ] Run repository checks and document the admitted input limitations. proof: `pnpm typecheck && pnpm lint && pnpm test`; README updated, full checks unrun here.
- [ ] Measure authoring effort and reject an adapter that adds more code than direct use. proof: #331 direct-authoring comparison.
- [ ] Complete a separate code review and synchronize PRD, PR and progress label. proof: #331 independent review and `pnpm prd:progress`.

## Acceptance criteria
- [ ] A TypeScript-authored Boolean model reaches a playable game through the ordinary asset path. proof: #331 cooked-doorway playtest.
- [ ] The rendered opening and collision opening agree after the complete cook/load round-trip. proof: #331 cooked-doorway physics assertions.
- [ ] Active ranges and material groups survive export without hidden extra triangles. proof: `npm run test:integration`, both two-material active-range cases.
- [ ] Invalid or unsupported input fails with a named diagnostic. proof: `npm run test:integration`, export and ownership regressions.
- [ ] No Boolean authoring code is loaded by a game using only the cooked asset. proof: #331 runtime bundle/dependency check.
- [ ] Browser WebGPU evidence is recorded. proof: #331 browser run naming the adapter.
- [ ] Desktop-native evidence is recorded. proof: #331 desktop run naming OS and adapter.
- [ ] Android evidence is recorded. proof: #331 Android device/emulator run.

## Verification history

Initial dependency-free work: 10 contracts failed before implementation and then passed on Node 22.16.0; strict TypeScript 5.8.3 checking passed. Dependency-backed Integration csg run 36201601920 on 2026-09-25 installed successfully and exposed an ArrayBufferLike widening error in the GLB writer. The repair constructs owned index arrays without widening them.

**2026-09-26, commit `7fe936e87a8435377b2e5bfcb9ecd3eb74094f60`:** complete `npm test` passed strict TypeScript 5.9.3, 10 contracts and 5 actual donor/export/CLI tests (15 passed, 0 failed). The doorway retained its opening through NodeIO write/read. The CLI test proved a second generation rejects EEXIST without changing bytes. Biome 1.9.4 and `git diff --check` passed. The temporary cross-PR diagnostic workflow was removed. These are historical results, not qualification of the new changes.

**2026-09-27 local red-green:** the new 65,535/65,536/65,537-vertex boundary corpus produced 2 passes and 1 failure on the unchanged module. Exactly 65,536 unique vertices wrongly selected uint16 and exposed glTF's reserved 65,535 index. After switching the threshold to `< 65536`, the original 10 contracts plus all 3 boundary cases pass: **13 passed, 0 failed**. Strict TypeScript 5.8.3 checking of `active-geometry.ts` passes. The other changed TypeScript files pass syntax transpilation; new integration test files pass `node --check`. Syntax checks are not dependency-backed compilation or behavioral proof.

**New qualification suite:** 44 configured cases: 13 CPU contracts and 31 dependency-backed cases, including the original 5. Khronos `gltf-validator` 2.0.0-dev.3.10 is test-only. New cases exercise real GLTFLoader readback, reflections, exact active triangle counts and two materials, normalized colors, invalid data, owned failure cleanup and reusable shared inputs. This shell cannot resolve npm/GitHub for installation; the dependency-backed baseline workflow was still queued at the last observation. No new integration or platform box is ticked from unexecuted tests.

The focused workflow also runs on relevant pushes, so conflicts cannot silently suppress standalone qualification. Its concurrency group replaces obsolete runs. Failed contracts still fail the job; the integration step reports independently after a successful build. No repository gate was weakened. Formal capability tools, transitive-license audit/lockfile review, current Biome/full repository checks and all engine cook/collision/GPU/native lanes remain open. Keep draft/experimental. Do not change WorldCells #317 or cook profiles #330 implicitly.

## References

- [Upstream](https://github.com/gkjohnson/three-bvh-csg)
- [Implementation](../../../examples/integrations/csg/README.md)
- [Original planning revision](https://github.com/ThreeNativeHQ/threenative/blob/0cfd44b3edafe75930a355f787c0f70e10ee5b26/docs/PRDs/threejs-integrations/PRD-threejs-csg-cook.md)
- [Charter](../../architecture/CHARTER.md)
