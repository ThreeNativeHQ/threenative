# PRD: Optional VRM avatar loading and animation

**Status:** PARTIAL — actual optional VRM reader and avatar lifecycle implemented; donor/material/native qualification open.
**Priority:** P3, demand-driven format support. **PR:** #337. **Base:** develop `663de7c69fca3446303da8a39de7c8871bfe33c6`.

## Goal and ownership

Load permitted VRM 1 avatars through the existing asset lifecycle, preserving logical paths, caching and configured compressed-texture support. Expose expressions and secondary animation without a new loop. Ordinary GLB-only games inherit no VRM dependency. Keep material choices in editable source. Code licensing does not grant permission to redistribute avatar assets.

**Implementation ruling, 2026-09-25:** use standalone nested `examples/integrations/vrm`, not core or the benchmark arm. createVrmModelReader registers the actual VRMLoaderPlugin on a caller-configured GLTFLoader and provides the existing model-loader override. VRM assets are immutable-byte descriptors whose instantiate method reparses independent humanoid/expression/spring state. Ordinary glTF still returns GLTF. VrmAvatar owns explicit update/expression/disposal behavior. The visual plugin chooses upstream MToonNodeMaterial for WebGPU in editable render source.

The format boundary validates GLB header/chunk lengths, UTF8/JSON and VRM 1.0 metadata without rewriting bytes. It is not a complete glTF validator. Shared-resource owners can override release; completed parses are released on cancellation. A disposed reader/asset rejects new work. Cook retention must still be proven or use the existing pass-through configuration.

## Test contract

Pure tests cover binary subarray offsets, truncated/false lengths, wrong/duplicate chunk handling, malformed UTF8/JSON, ordinary glTF and rejected legacy/unknown versions. Real-loader tests use an authored synthetic humanoid and exercise independent expression state, ordinary GLTF, cancellation and lifecycle. Actual rendered expressions, springs, MToon materials, compressed assets, cook preservation and platform behavior require real fixtures/playtests before admission.

## Implementation order

### Phase 1 — fixture and loader admission
- [ ] Search asset/animation capabilities and identify the shared loader extension point.
- [ ] Pin the donor and audit code dependencies and avatar redistribution permissions.
- [ ] Establish a license-clear VRM 1.0 fixture and an ordinary GLB regression baseline.
- [x] Run ten container/format contracts after observing the initial stub fail: 10 passed, 0 failed on Node 22.16.0.

### Phase 2 — optional format integration
- [ ] Add failing loader, extension-preservation and isolated-avatar-state tests.
- [ ] Implement plugin composition and game-owned WebGPU material selection.
  Actual source is present; dependency-backed execution/GPU compilation remain unverified.
- [ ] Pass fixed-step animation, cancellation and shared-resource-disposal tests.
- [ ] Prove that cooking preserves behavior or explicitly uses the existing pass-through path.
- [x] Strict-check the dependency-free document parser with TypeScript 5.8.3: exit 0.

### Phase 3 — real platform proof
- [ ] Pass the expression/spring/material browser WebGPU playtest.
- [ ] Pass the same fixture on desktop native, naming the actual OS and adapter.
- [ ] Pass the same fixture on Android, naming the executed lane.
- [ ] Compare real captures and record supported VRM/material features without extrapolation.

### Phase 4 — optional packaging and documentation
- [ ] Prove the ordinary GLB-only game excludes the VRM module graph.
- [ ] Document supported format versions, asset permissions and ownership/cleanup behavior.
- [ ] Run repository checks and ordinary model-loading regressions.
- [ ] Complete a separate code review and synchronize PRD, PR and progress label.

## Acceptance criteria
- [ ] A permitted VRM 1.0 asset loads through the ordinary logical asset/lifecycle path.
- [ ] Expressions and secondary animation survive the supported cook/load path.
- [ ] Avatar instances have independent animation and secondary-motion state.
- [ ] Non-VRM games retain their existing behavior and dependency graph.
- [ ] Unsupported versions and missing resources fail with actionable diagnostics.
- [ ] Browser WebGPU evidence is recorded.
- [ ] Desktop-native evidence is recorded.
- [ ] Android evidence is recorded.

## Verification

Executed locally: pure format tests 10/10 and strict TypeScript 5.8.3 checking of document.ts. npm test includes strict TypeScript 5.9.3 build, pure contracts and real three-vrm/Three tests. Dependency downloads are unavailable locally, so their result is not reported green. The dedicated PR workflow runs the complete command because examples are excluded from root Vitest. Formal capability tools, installed audit/lockfile, Biome, repository suite, independent review and all GPU/native lanes remain open. No iOS claim. Keep draft and do not advertise material/native support until executed inside the actual patched framework runtime.

## References

- [Implementation and commands](../../../examples/integrations/vrm/README.md)
- [Upstream](https://github.com/pixiv/three-vrm)
- [Original planning revision](https://github.com/ThreeNativeHQ/threenative/blob/7b951dba80b2324c9665b2275c0db39b40310805/docs/PRDs/threejs-integrations/PRD-threejs-vrm-avatars.md)
- [Charter](../../architecture/CHARTER.md)
