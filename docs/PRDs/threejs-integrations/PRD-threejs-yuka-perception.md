# PRD: Optional NPC perception and search example

**Status:** PARTIAL — actual Yuka vision adapter, editable search policy and executable tests added; playable/platform qualification open.
**Priority:** P2, example only. **PR:** #336. **Base:** develop `663de7c69fca3446303da8a39de7c8871bfe33c6`.

## Goal and ownership

An NPC acquires an unobstructed target, remembers its last observed position, searches without reading its hidden live position and eventually abandons the search. Compare the donor against simple editable TypeScript policy; keep navigation, physics, replay and fixed time authoritative in existing systems. No mandatory AI dependency, Yuka EntityManager, alternate navigation world or second movement owner.

**Ruling, 2026-09-25:** use nested standalone `examples/integrations/perception`, outside core and the frozen benchmark arm. `YukaPerception` calls real Yuka Vision with Three world transforms and a caller-supplied nearest-blocking ray query. `SearchController` owns editable deterministic memory/search policy. Both expose lifecycle cleanup without starting a loop or moving a body. The donor dependency is yuka 0.7.8 with Three 0.185.1.

## Test contract

Cover occlusion, authored forward axis, range/FOV, last-seen copies, simulation-time expiry, zero-dt pause, arrival, reacquisition, deleted targets, invalid input without partial state mutation, immutable output and repeatable traces. Integration tests use real Yuka and Three raycasts against a wall. Prove behavior in a playable navigation encounter on each claimed platform before admission; unit tests alone do not establish pathfinding or gameplay quality.

## Implementation order

### Phase 1 — baseline and dependency admission
- [ ] Search existing navigation, ray-query, scheduling and replay capabilities.
- [ ] Implement the direct state-machine baseline and pin its expected event trace.
- [ ] Pin and audit only the Yuka modules needed for the comparison.
- [x] Execute ten dependency-free policy tests after observing the stub fail: 10 passed, 0 failed on Node 22.16.0.

### Phase 2 — optional perception example
- [ ] Add failing occlusion, memory-expiry and single-movement-owner tests.
- [x] Implement the Yuka candidate without adopting its world or navigation architecture.
  Three real Yuka/Three integration tests now pass, including occlusion, authored-axis transforms and unchanged movement ownership.
- [ ] Pass replay, pause/resume, target-deletion and cleanup tests.
- [x] Strict-check search.ts with locally available TypeScript 5.8.3: exit 0.

### Phase 3 — playable platform proof
- [ ] Pass the patrol/search browser WebGPU playtest.
- [ ] Pass the same input/event trace on desktop native, naming the actual OS and adapter.
- [ ] Pass the same input/event trace on Android, naming the executed lane.
- [ ] Compare behavior, code and cost against the direct state-machine baseline.

### Phase 4 — ship as game source
- [ ] Prove a normal core-only game loads no Yuka code.
- [ ] Document editable policy and the existing physics/navigation integration.
- [ ] Run repository checks and keep the smaller solution if the donor adds no value.
- [ ] Complete a separate code review and synchronize PRD, PR and progress label.

## Acceptance criteria
- [ ] The example demonstrates occlusion-aware acquire, last-seen search and expiry.
- [ ] Search does not consult an occluded target's live position.
- [ ] Replay uses simulation time and reproduces the expected decision events.
- [ ] Exactly one existing movement/physics path controls the NPC body.
- [ ] Gameplay policy stays in editable source and core does not depend on Yuka.
- [ ] Browser WebGPU evidence is recorded.
- [ ] Desktop-native evidence is recorded.
- [ ] Android evidence is recorded.

## Verification

Executed: pure Node policy tests 10/10 and TypeScript 5.8.3 strict checking of search.ts. The complete package exposes npm test: strict TypeScript 5.9.3 build, contracts, real Yuka/Three tests. Dependency downloads were unavailable locally; no dependency-backed test/build or runtime result is reported green. The focused PR workflow runs the full command because root Vitest excludes examples. Formal capability tools, installed license/lockfile audit, Biome, repository suite, independent review and all playable GPU/native lanes remain open. Keep draft. No iOS support claim and no unmeasured improvement over direct policy.

## CI repair verification — 2026-09-26

`npm test` now passes with the pinned dependencies: strict TypeScript 5.9.3 build, 12 policy contracts and 3 real Yuka/Three integration tests (15 passed, 0 failed). Two new regression tests failed on the prior validator and pass after validating all three coordinate slots explicitly. Sparse arrays, null and undefined are rejected before the memory clock or last-seen target can change.

Applied Biome 1.9.4's captured formatting changes and its single-variable-declaration repair without changing lint policy. Fresh repository CI must validate the pushed tree; the complete repository suite and playable browser/native/Android requirements remain open. This replaces the earlier local dependency limitation, not those platform gates.

## References

- [Implementation and commands](../../../examples/integrations/perception/README.md)
- [Yuka](https://github.com/Mugen87/yuka)
- [Original planning revision](https://github.com/ThreeNativeHQ/threenative/blob/ddef035c791d144c62320f0019a08ea7764556b8/docs/PRDs/threejs-integrations/PRD-threejs-yuka-perception.md)
- [Charter](../../architecture/CHARTER.md)
