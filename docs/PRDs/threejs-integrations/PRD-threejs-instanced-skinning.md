# PRD: WebGPU animated-instance benchmark and selective port

**Status:** NOT STARTED — planning-only seed for one draft implementation PR.
**Priority:** P2 — benchmark-gated.
**Base:** `develop` at `663de7c69fca3446303da8a39de7c8871bfe33c6` (2026-09-25).
**Donor:** `agargaro/instanced-mesh`.
**Scope of this commit:** this PRD only; no implementation, dependency or runtime changes.

## Goal and adoption decision

Reduce the measured cost of many independently animated characters or machines without changing
the scene's visual quality. Study InstancedMesh2's techniques; do not install its WebGL renderer
plumbing into ThreeNative. The output is either a narrowly scoped WebGPU mechanism with an
executed A/B result, or a documented rejection. More APIs and a fast synthetic screenshot alone
are not success.

## Source findings and overlap

The inspected donor declares MIT, requires Three >=0.186.0 and uses WebGLRenderer,
GLInstancedBufferAttribute and GLSL chunks. The base is patched Three 0.185.1. A version bump
would not make those mechanisms WebGPU-compatible. The inspected donor test command is a
placeholder, so its advertised features are not inherited regression coverage.

Existing InstancedBatch and ClusteredBatch already cover static repetition. The discrete LOD
surface excludes skinned/morphed inputs. Scope this work to independent skeletal animation,
instance visibility and correct history; do not build another static batch helper. Reuse
FrameBudget, frame counters, pass attribution and VelocityTracker instead of a parallel meter.

## Design and file ownership

Start with `examples/abyss-framework/src/render/instanced-skinning-fixture.ts` and a matching
playtest scenario. Add `packages/core/__tests__/instanced-skinning-contract.spec.ts` only for
mechanism that is actually admitted. Any implementation in `packages/core/src/` accepts the
game's mesh, material, pose and transforms; geometry, clips, animation policy and appearance
remain game-owned. Prefer Three's existing WebGPU/TSL node composition over a renderer fork.

A stable instance handle is not a compacted GPU slot. Recycling uses generations so a stale
handle cannot move another character. Visibility compaction preserves current and previous
transforms/bone data and picking identity. Define insert/update/remove capacity failure before
allocating; do not grow buffers unboundedly in the render loop. Disposal is idempotent and
never destroys shared materials or source rigs.

Culling is per camera/pass: a main-camera rejection must not remove an off-camera shadow caster.
Animated bounds are conservative. Pose uploads are explicit and measured. First-frame motion
history is initialized from the current pose; removed slots do not leak history into new ones.
Transparent materials, morph targets and multi-material rigs are either proven supported or
explicitly rejected before mutation; do not silently degrade them. No automatic animation-rate
or quality reduction is allowed to manufacture a performance gain.

## Benchmark protocol and stop gate

Use a checked-in, license-clear synthetic rig (64 bones, fixed topology) with independently
phased clips at 8, 128 and 512 instances. Baseline is ordinary cloned SkinnedMesh plus the
current animation path; candidate draws the exact same pose trace, geometry, materials,
resolution and shadow/temporal configuration. Include visible, mostly-culled, shadow-only and
spawn/despawn workloads. Fix all fixture hashes and policies before tuning the candidate.

For each named hardware lane, run an A/A noise check followed by six paired baseline/candidate
runs with seeded randomized order. Warm each for at least 300 frames and measure at least 1800
presented frames per run. Compare per-run aggregates, not millions of correlated frames as
independent samples. Record CPU p50/p95, resolved GPU time, bytes uploaded, pass draws/triangles,
peak/resident memory and adapter. Separate cold startup from steady state. Missing timestamps
remain unavailable, not zero. A software adapter can prove correctness, not device performance.

Proposed admission gate: the preselected 128-instance bottleneck metric improves at least 15%
and more than twice observed A/A variation, with a paired interval excluding zero improvement;
no >5% regression on the 8-instance holdout in a noise-qualified lane. Measure 512 as a stress
case, not as a substitute for failing the target workload. Correctness is mandatory regardless
of speed. If A/A variability exceeds 5%, fix the measurement lane rather than tuning thresholds.
Freeze any revision of these proposed gates before collecting candidate results and explain it.

## Implementation order

### Phase 1 — reproducible baseline
- [ ] Search capabilities and record the specific unserved animated-instance workload.
- [ ] Pin source references and audit notices for any selected donor techniques.
- [ ] Implement the fixed-pose baseline and establish the A/A measurement lane.
- [ ] Freeze fixture hashes, comparison order and admission thresholds before candidate tuning.

### Phase 2 — bounded WebGPU mechanism
- [ ] Add failing instance-identity, pose, culling and previous-frame-history tests.
- [ ] Implement only the WebGPU mechanism needed by the admitted fixture.
- [ ] Pass capacity, invalid-input, slot-reuse and shared-resource-disposal tests.
- [ ] Prove shadows, picking and temporal output at unchanged quality.

### Phase 3 — platform and A/B proof
- [ ] Pass the browser WebGPU correctness scenario.
- [ ] Pass the same correctness scenario on desktop native, naming OS and adapter.
- [ ] Pass the same correctness scenario on Android, naming the executed lane.
- [ ] Run the six paired measurements on the named accelerated desktop lane.
- [ ] Measure physical Android separately before making any mobile performance claim.

### Phase 4 — admission or explicit rejection
- [ ] Evaluate the fixed performance gate without reducing fidelity or workload.
- [ ] Prove zero added runtime work for scenes that do not use the mechanism.
- [ ] Run repository checks and document unsupported inputs and capacity behavior.
- [ ] Complete a separate code review and synchronize PRD, PR and progress label.

## Acceptance criteria
- [ ] A measured animated-instance gap is established before a new mechanism is adopted.
- [ ] Independent poses, instance identities and slot reuse are correct.
- [ ] Shadow and temporal passes remain correct under camera-specific culling.
- [ ] The frozen paired benchmark passes its admission gate at equal quality.
- [ ] Browser WebGPU evidence is recorded.
- [ ] Desktop-native evidence is recorded.
- [ ] Android correctness evidence is recorded.
- [ ] Mobile performance claims are backed by physical-device measurements or explicitly withheld.

## Stop conditions and rollback

No drop-in WebGL dependency, no unrelated Three upgrade and no renderer fork. If the baseline
already meets the workload or the candidate misses the gate, retain the benchmark and record
rejection; do not merge an unused abstraction. Keep the ordinary SkinnedMesh path available so
the optional mechanism can be removed without changing assets or gameplay architecture.

## References

- [Upstream](https://github.com/agargaro/instanced-mesh)
- [Donor manifest](https://github.com/agargaro/instanced-mesh/blob/master/package.json)
- [WebGL-specific implementation](https://github.com/agargaro/instanced-mesh/blob/master/src/core/InstancedMesh2.ts)
- [Current catalog](../../../pnpm-workspace.yaml)
- [Current mechanism and profiling surface](../../../packages/core/src/index.ts)
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
