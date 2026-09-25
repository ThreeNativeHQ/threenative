# PRD: Constrained skeletal animation admission

**Status:** NOT STARTED — planning-only seed for one draft implementation PR.
**Priority:** P1.
**Base:** `develop` at `663de7c69fca3446303da8a39de7c8871bfe33c6` (2026-09-25).
**Donor:** `gkjohnson/closed-chain-ik-js`.
**Scope of this commit:** this PRD only; no implementation, dependency or runtime changes.

## Goal and adoption decision

Keep a character's two hands on a game-authored grip or a mechanical linkage constrained while
its body moves. Compare Three's CCDIKSolver against `closed-chain-ik/core` before admitting a
more complicated dependency. Independent limbs use the simpler baseline when it meets the same
requirements. Coupled-chain solving is the reason to evaluate the donor, not an excuse to wrap
all animation or replace Three.js bones.

## Source findings and overlap

The inspected donor declares Apache-2.0 and separates core, Three/URDF helpers and worker
exports. A core-only import still needs an installation and bundle audit; it does not magically
remove package peers. Do not require URDF, DOM helpers, SharedArrayBuffer or a Worker in the
first native-compatible implementation. Worker acceleration is outside this initial scope.

ThreeNative already provides AnimationPlayer, SkeletalMesh3D, GroundSnap, attachToBone,
boneContact and bone-length/clip diagnostics. Reuse them. A hand-parented weapon and a root
height correction do not solve two simultaneous hand constraints. The donor is not a
replacement for clip playback, root movement, collision or these existing instruments.

## Design and file ownership

Prototype in `examples/abyss-framework/src/render/constrained-ik.ts`, with game-owned grips,
joint limits, contact states, blending and presentation. Add a synthetic articulated fixture and
`packages/core/__tests__/constrained-ik-contract.spec.ts` for lifecycle and pose invariants.
Add an example-local donor dependency only after the baseline demonstrates its need.

Animation evaluates first, body/root placement and world matrices are made current, target
positions are sampled in one declared coordinate space, the constrained pose is solved, and
final matrices are updated before rendering. No second loop or autonomous movement owner.
A thin adapter reads/writes real THREE.Bone rotations; it must not change bind matrices, bone
lengths or game-authored root position. A skeleton-safe clone has independent solver state.

Targets and limits are explicit game data. Iterations are bounded, and each solve reports
residual error, iterations and status (converged, iteration-limited, unreachable or invalid).
Invalid input throws before mutating a pose. An unreachable target never reports convergence
or writes NaNs. Blend zero restores the current animation pose rather than a stale cached one.
Dispose releases only adapter-owned data and is idempotent. Nonuniform/reflected ancestors
are either supported by tested conversions or rejected explicitly before partial mutation.

Promote only repeated mechanical binding/lifecycle into core after the charter's ownership and
LOC tests. A public Godot-shaped name is selected from the existing vocabulary at that point,
not invented in this planning document. Gait generation and aiming policy remain editable.

## Test contract

Use a synthetic 1.8 m humanoid fixture and a separate closed mechanical linkage, both with
license-clear geometry. At authored reachable targets, proposed acceptance is <=0.01 m maximum
contact error over a 600-step sweep and <=1e-4 relative change in nonzero bind bone lengths.
These are proposed test limits, not measured performance claims. Measure wrist orientation
as well as position; fixture-specific grip orientation tolerance is 2 degrees.

Test unreachable targets, a straight/singular chain, joint limits, root transforms, repeated
scene entry/exit, blend weights 0 and 1, animation changes, detached targets and cloned rigs.
Keep a pose-only baseline, a CCD baseline and the donor candidate on identical target traces.
Bound solver iterations at 32 for this comparison; record CPU distributions and residuals.
Do not treat fast failure to converge as an optimization. Any final budget must be fixed from
the baseline before candidate tuning, with a named hardware lane.

## Implementation order

### Phase 1 — baseline and donor admission
- [ ] Search capabilities and map the update order against existing animation and grounding.
- [ ] Build the reachable and closed-linkage fixtures with a CCD baseline.
- [ ] Record a coupled constraint the baseline cannot meet at the same quality and budget.
- [ ] Pin and audit the core-only donor dependency and its packaging requirements.

### Phase 2 — constrained pose adapter
- [ ] Add failing contact, length, orientation and coordinate-space regression tests.
- [ ] Implement bounded pose solving and explicit residual/status reporting.
- [ ] Pass invalid-input, cloning, blending and idempotent-disposal tests.

### Phase 3 — runtime proof
- [ ] Pass the constrained-animation browser WebGPU playtest.
- [ ] Pass the same target trace on desktop native, recording the actual OS and adapter.
- [ ] Pass the same target trace on Android, naming the executed lane.
- [ ] Compare candidate residuals and CPU cost against both fixed baselines.

### Phase 4 — ownership and adoption
- [ ] Keep grips, gait, aiming and visual decisions in editable game source.
- [ ] Prove ordinary games load no new solver unless the integration is imported.
- [ ] Run repository checks and document supported transforms and solver limits.
- [ ] Complete a separate code review and synchronize PRD, PR and progress label.

## Acceptance criteria
- [ ] The closed-linkage fixture demonstrates value beyond the existing attachment/CCD paths.
- [ ] Reachable targets meet the recorded contact and orientation tolerances.
- [ ] Bone-length invariance holds throughout the test trace.
- [ ] Unreachable and malformed targets cannot silently corrupt the pose.
- [ ] The adapter does not own root movement or start another frame loop.
- [ ] Browser WebGPU evidence is recorded.
- [ ] Desktop-native evidence is recorded.
- [ ] Android evidence is recorded.

## Stop conditions and rollback

If CCD meets the same fixtures within the same constraints, retain the smaller implementation
and do not add the donor. If a large alternative skeleton architecture is required, reject the
integration rather than exporting it as a second game model. Removing the optional adapter
restores ordinary clip playback and existing attachments without converting asset files.

## References

- [Upstream](https://github.com/gkjohnson/closed-chain-ik-js)
- [Donor manifest](https://github.com/gkjohnson/closed-chain-ik-js/blob/main/package.json)
- [Three CCD baseline](https://threejs.org/docs/pages/CCDIKSolver.html)
- [Existing animation and pose surface](../../../packages/core/src/index.ts)
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
