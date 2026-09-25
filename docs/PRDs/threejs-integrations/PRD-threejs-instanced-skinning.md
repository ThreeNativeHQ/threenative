# PRD: WebGPU animated-instance benchmark and selective port

**Status:** PARTIAL — experimental implementation and executable tests added; performance and platform admission not established.
**Priority:** P2, benchmark-gated. **PR:** #335. **Base:** develop `663de7c69fca3446303da8a39de7c8871bfe33c6`.

## Goal and ownership

Study InstancedMesh2 techniques for dynamic animated instances without importing its WebGL renderer plumbing or requiring Three >=0.186. Keep game-owned meshes/materials, the existing loop and ordinary Three objects. A candidate is not a core feature until equal-quality benchmarks prove incremental value. No renderer fork, ECS or quality reduction is authorized.

**Implementation ruling, 2026-09-25:** prototype stays in `examples/integrations/skinning`, a standalone opt-in example, not core. `FramePalette` manages fixed-capacity generation-tagged slots, independent poses and previous-frame snapshots. `AnimatedInstances` uses Mesh/InstancedBufferGeometry with real TSL storage nodes, bind-normalized bone matrices, previous deformed positions and on-demand CPU picking with stable ids. The package depends only on Three 0.185.1; no InstancedMesh2 code is copied.

The initial path submits every instance to every pass, avoiding unproven main-camera culling of shadow casters. It restricts input to one node material, rigid/uniformly-scaled rigs and no morph/tangent/custom deformation. It has not passed shader/native/performance qualification. This conservative prototype does not satisfy the complete donor feature list.

## Frozen benchmark contract

Before performance admission, establish identical 8/128/512-instance content and poses against the existing approach, then an A/A noise check and six paired A/B runs with frozen fixture hashes/order/thresholds. Preserve pixel quality, shadows and temporal behavior. Report CPU/GPU time, uploads and memory on the same adapter; missing GPU values are absent, not zero. No mobile speed claim without physical-device measurement. A negative result rejects core adoption, not the measurement.

## Implementation order

### Phase 1 — reproducible baseline
- [ ] Search capabilities and record the specific unserved animated-instance workload.
- [ ] Pin source references and audit notices for any selected donor techniques.
- [ ] Implement the fixed-pose baseline and establish the A/A measurement lane.
- [ ] Freeze fixture hashes, comparison order and admission thresholds before candidate tuning.
- [x] Execute the palette/reference regression suite: 13 passed, 0 failed on Node 22.16.0; initial stub and Float32-overflow regressions were observed failing first.

### Phase 2 — bounded WebGPU mechanism
- [ ] Add failing instance-identity, pose, culling and previous-frame-history tests.
- [ ] Implement only the WebGPU mechanism needed by the admitted fixture.
  Prototype code is present; no admission/GPU execution is claimed.
- [ ] Pass capacity, invalid-input, slot-reuse and shared-resource-disposal tests.
- [ ] Prove shadows, picking and temporal output at unchanged quality.
- [x] Strict-check dependency-free palette.ts using TypeScript 5.8.3: exit 0.

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

## Verification and limitations

Executed locally: pure contracts 13/13 and strict checking of palette.ts. Actual Three integration/picking tests are written and included in npm test, alongside a dependency-backed TypeScript 5.9.3 build. Local dependency downloads are unavailable.

**Dependency-backed CI, 2026-09-25:** Integration skinning run 36202048620 installed successfully and reported attribute-node swizzle typing errors plus a nullable skeleton palette. This commit explicitly constructs uvec4/vec4 nodes around the typed attributes and checks the actual bone matrix palette before updating/reading it. No any cast, disabled strict check or dropped test is used. The rerun must establish full-build/Three-test success. This does not prove GPU shadow/velocity behavior.

A focused PR workflow runs the command because examples are outside root Vitest. Formal capability tools, installed audit/lockfile, Biome, full repository suite and independent review remain open. Keep draft. The standalone Three pin does not apply the framework renderer patch. No iOS claim.

## References

- [Implementation and commands](../../../examples/integrations/skinning/README.md)
- [Donor research](https://github.com/agargaro/instanced-mesh)
- [Original planning revision](https://github.com/ThreeNativeHQ/threenative/blob/df2f34fe5c000b5df6a65da9c1ff6fbfc028a126/docs/PRDs/threejs-integrations/PRD-threejs-instanced-skinning.md)
- [Charter](../../architecture/CHARTER.md)
