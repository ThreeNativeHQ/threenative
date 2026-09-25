# PRD: Constrained skeletal animation admission

**Status:** PARTIAL — solver adapter and executable tests written; donor/platform qualification open.
**Priority:** P1. **PR:** #332. **Base:** develop `663de7c69fca3446303da8a39de7c8871bfe33c6`.

## Goal and ownership

Compare the existing attachment/grounding and Three CCD paths against closed-chain-ik/core for two-handed grips and coupled mechanical constraints. Keep Three bones, the engine animation lifecycle and game-owned targets authoritative. Never introduce mandatory URDF, Worker infrastructure, a second skeleton API or root-motion controller. Reject the donor if a simpler existing solution meets the same constraints and cost.

**Ruling, 2026-09-25:** prototype source is in `examples/integrations/ik`, a nested opt-in example, not a new core package or addition to the benchmark arm. Donor source is pinned to `38a7e273082311e69c84c35a7c8f64e510e188a5`; its inspected core subpath avoids the Three/URDF helper exports. Transitive package/peer obligations still require an installed audit.

`ConstrainedIK` builds internal joint/link frames for direct Three Bone hierarchies, folds positive uniform scale into link offsets, configures bounded solve iterations, preserves animation-relative joint limits, applies quaternion corrections and reports actual post-blend residuals. Targets are validated before mutation; solver errors restore the input pose. `pose.ts` provides affine/scale checks and metre/radian measurements. The example takes no animation-loop ownership.

## Test contract and limitations

Executable donor tests cover translated/scaled parents, reachable/unreachable targets, invalid inputs, blend=0 and Three CCD baseline. Pure tests cover transforms, quaternion equivalence, measurement units and independent target copies. The coupled-linkage admission fixture, orientation/length tolerances under a full animated trace, performance comparison and browser/native playtests remain required. A simple limb test alone is not proof that the new dependency adds value. No iOS support claim.

## Implementation order

### Phase 1 — baseline and donor admission
- [ ] Search capabilities and map the update order against existing animation and grounding.
- [ ] Build the reachable and closed-linkage fixtures with a CCD baseline.
- [ ] Record a coupled constraint the baseline cannot meet at the same quality and budget.
- [ ] Pin and audit the core-only donor dependency and its packaging requirements.
- [x] Execute nine numerical contract tests after observing the stub fail: 9 passed, 0 failed on Node 22.16.0.

### Phase 2 — constrained pose adapter
- [ ] Add failing contact, length, orientation and coordinate-space regression tests.
- [ ] Implement bounded pose solving and explicit residual/status reporting.
  Source is present; real donor execution is required before this behavior claim is checked.
- [ ] Pass invalid-input, cloning, blending and idempotent-disposal tests.
- [x] Strict-check `src/pose.ts` with locally available TypeScript 5.8.3: exit 0.

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

## Verification

Executed: dependency-free Node tests 9/9 and strict checking of pose.ts with TypeScript 5.8.3. The complete integration package pins TypeScript 5.9.3 and exposes `npm test` (strict build, contracts, real donor tests). Dependency downloads are unavailable locally, so donor execution and full build are not reported green. A focused PR workflow runs that exact command; its observed result is separate evidence. Formal capability tools, lockfile, license audit, Biome, full repository suite, independent review and every GPU/native lane remain unrun. Keep this PR draft.

## References

- [Implementation and actual commands](../../../examples/integrations/ik/README.md)
- [Donor](https://github.com/gkjohnson/closed-chain-ik-js)
- [Original detailed planning revision](https://github.com/ThreeNativeHQ/threenative/blob/74a6878dada95fef2afd38053295632c67defd18/docs/PRDs/threejs-integrations/PRD-threejs-constrained-ik.md)
- [Charter](../../architecture/CHARTER.md)
