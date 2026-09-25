# PRD: Optional VRM avatar loading and animation

**Status:** NOT STARTED — planning-only seed for one draft implementation PR.
**Priority:** P3 — demand-driven format support.
**Base:** `develop` at `663de7c69fca3446303da8a39de7c8871bfe33c6` (2026-09-25).
**Donor:** `pixiv/three-vrm`.
**Scope of this commit:** this PRD only; no implementation, dependency or runtime changes.

## Goal and adoption decision

Load a license-clear VRM avatar through ThreeNative's existing asset/lifecycle path and prove
expressions, humanoid pose and secondary animation on WebGPU and native. Adopt a format
integration, not a universal rig-repair system or a compulsory character renderer. Keep the
integration opt-in; a game using only GLB must not load a VRM dependency graph.

## Source findings and overlap

The inspected @pixiv/three-vrm manifest declares MIT, ESM exports and a Three peer range that
includes the base's 0.185.1. Upstream documents a WebGPU material route using MToonNodeMaterial.
Peer compatibility and upstream examples do not prove native compatibility in this host.
The umbrella package includes several components, so measure actual transitive/bundle cost.
VRM code licensing does not grant permission to redistribute every VRM avatar or its textures.

Existing assets.ts provides an injected model loader plus manifest resolution, caching and
compressed-texture support. Existing SkeletalMesh3D and AnimationPlayer cover ordinary rigs.
Use those seams where appropriate; do not create a parallel fetch cache or blindly apply
normalization/mirrored-clip repair twice. The donor is not a fix for arbitrary non-VRM GLBs.

## Design and file ownership

Start with `examples/abyss-framework/src/render/vrm-avatar.ts`, a fixture-specific optional
loader integration, and `packages/core/__tests__/vrm-loader-contract.spec.ts` for the shared
asset seam. Appearance and MToon selection remain editable source. Promote only missing
portable loader lifecycle plumbing to core after a demonstrated repeated need. Do not add
React Three Fiber, a donor renderer or a new game-facing scene format.

Reuse the existing GLTFLoader setup, KTX2 support and logical-to-cooked path resolution. Register
the VRM plugin without replacing other loader plugins. If the injected model hook bypasses
necessary processing, fix the narrow shared extension point and test its existing consumers
instead of claiming a separate cache is equivalent. Keep ordinary GLB loads unchanged.

Define a supported format envelope: VRM 1.0 is the initial fixture; VRM 0.x requires its own
explicit evidence or a clear unsupported-format error, not a silent best-effort success.
Validate the required VRM extension and return named diagnostics for invalid metadata.
Preserve permitted extensions during cooking; if the cook cannot preserve them yet, use its
existing pass-through/exclusion mechanism and report unoptimized output, never strip behavior
silently. External buffers/textures follow the project's asset-resource policy; do not add
unbounded remote fetching or arbitrary executable content.

Humanoid pose is updated from the game before the donor's constraints/springs for the fixed
step. Expressions, look targets and materials are game choices. No new requestAnimationFrame,
independent Clock or DOM-dependent viewer is installed. Use skeleton-safe avatar instancing;
expression and spring state cannot leak between instances. Disposal runs once per owned avatar
and does not release shared textures or the asset loader's cached source while another avatar
uses them. Asset-level metadata/permissions are retained where the format requires them.

## Test contract

Use an owned or explicitly redistributable VRM 1.0 fixture with provenance, one expression,
a constrained bone and a spring chain. Verify the cooked/pass-through load retains the VRM
extension, the expression changes the intended morph, the spring advances with simulation dt,
and a paused simulation does not move it. The WebGPU fixture must prove the selected material
node compiles and renders; a nonblank pixel count alone is insufficient.

Add corrupt/missing extensions, failed external texture loads, unsupported versions, two
independent avatar instances, cancellation during scene exit, repeated load/release and
non-VRM GLB regression cases. Verify logical asset resolution does not bypass the manifest.
Use a bundle assertion: the ordinary GLB-only fixture contains no @pixiv/three-vrm modules.
Check actual captures for material behavior and preserve the normal renderer/asset pipeline.

## Implementation order

### Phase 1 — fixture and loader admission
- [ ] Search asset/animation capabilities and identify the shared loader extension point.
- [ ] Pin the donor and audit code dependencies and avatar redistribution permissions.
- [ ] Establish a license-clear VRM 1.0 fixture and an ordinary GLB regression baseline.

### Phase 2 — optional format integration
- [ ] Add failing loader, extension-preservation and isolated-avatar-state tests.
- [ ] Implement plugin composition and game-owned WebGPU material selection.
- [ ] Pass fixed-step animation, cancellation and shared-resource-disposal tests.
- [ ] Prove that cooking preserves behavior or explicitly uses the existing pass-through path.

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

## Stop conditions and rollback

No demo asset is vendored on the strength of the package's code license. Do not admit a
WebGL-only material fallback while calling the result WebGPU/native complete. If the supported
asset envelope cannot be preserved by the loader/cook, leave the integration partial and keep
the ordinary GLB route. Removing the optional plugin must not change non-VRM assets or core's
main import surface. Generic facial animation and arbitrary retargeting remain separate work.

## References

- [Upstream and WebGPU guidance](https://github.com/pixiv/three-vrm)
- [Donor manifest](https://github.com/pixiv/three-vrm/blob/dev/packages/three-vrm/package.json)
- [Asset loader](../../../packages/core/src/assets.ts)
- [Existing animation surface](../../../packages/core/src/index.ts)
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
