# PRD: Optional NPC perception and search example

**Status:** NOT STARTED — planning-only seed for one draft implementation PR.
**Priority:** P2 — example only.
**Base:** `develop` at `663de7c69fca3446303da8a39de7c8871bfe33c6` (2026-09-25).
**Donor:** `Mugen87/yuka`.
**Scope of this commit:** this PRD only; no implementation, dependency or runtime changes.

## Goal and adoption decision

Ship an editable example where a patrol sees a target, remembers its last known position,
searches after losing sight and eventually returns to patrol. Evaluate Yuka's perception,
memory and decision primitives against a small direct TypeScript state machine. Do not make
Yuka mandatory engine architecture. The demonstration must make a game better, not merely
show that another library can be imported.

## Source findings and overlap

Yuka advertises renderer-independent game AI and its inspected manifest declares MIT.
That does not mean all its utility loaders or clocks are suitable for a native game; qualify
the selected import graph. ThreeNative already owns the loop, seeded random/replay surface,
physics and Recast navigation. Those remain authoritative. Do not adopt a second navmesh,
entity hierarchy, snapshot format or transform-synchronization loop.

## Design and file ownership

Keep decisions in `examples/abyss-framework/src/gameplay/perception-patrol.ts`; put the
fixture's appearance in `examples/abyss-framework/src/render/perception-patrol.ts`.
Use an example-local dependency and a proposed
`packages/physics/__tests__/perception-navigation-integration.spec.ts` for the movement seam.
The main core entry never imports Yuka. Agent instructions can point to editable example
source only after it works; no engine-owned enemy presets are introduced.

All updates receive the existing simulation dt and game clock. Patrol routes, hostility,
field of view, range, memory expiry and search policy are ordinary game data. Yuka decisions
produce an intent/target, not a world transform. Existing navigation and CharacterBody3D own
path following/collision; the simulation writes the body once. Read positions back after the
physics step instead of writing a second donor vehicle transform over the result.

Visibility combines an authored cone/range with an actual occlusion query. Define masks and
exclude the observer itself. A target behind a wall is not seen merely because it is nearby.
Acquire/lost transitions are edge-triggered. Memory timestamps use simulation time; pause,
resume and replay do not consume wall-clock expiry. Scene exit cancels search tasks and drops
references. Deleted targets never remain targetable through a stale handle.

Schedule expensive perception at an explicitly game-authored cadence with stable ordering,
not a library's independent timer. Bound remembered entities and queries per tick; report
skipped work and resulting sensing latency rather than silently pretending complete coverage.
The initial example has no combat, networking, remote AI service or hidden player omniscience.

## Test contract

The synthetic scene has a patrol corridor, occluding wall and one target. Fixture settings
are explicit: 60-degree cone, 25 m range, 5 simulation seconds of last-seen memory and a 1/60 s
simulation step. Script the target entering the cone, going behind the wall, moving while
occluded, reappearing and being deleted. Search uses the last observed location, never the
unseen live position. After expiry, the patrol resumes through the existing navigation path.

Tests cover cone boundaries, near/far limits, line-of-sight obstruction, target deletion,
pause/resume, fixed-seed replay and repeated scene entry/exit. Decisions/events must match
across repeated runs of the same seed and input trace. Add an assertion that exactly one
movement owner writes the body. Compare the direct state-machine and Yuka versions for code,
allocation, query counts and decision-time distributions at 1, 32 and 128 agents.
Do not treat fewer observations or delayed sensing as a free speedup.

## Implementation order

### Phase 1 — baseline and dependency admission
- [ ] Search existing navigation, ray-query, scheduling and replay capabilities.
- [ ] Implement the direct state-machine baseline and pin its expected event trace.
- [ ] Pin and audit only the Yuka modules needed for the comparison.

### Phase 2 — optional perception example
- [ ] Add failing occlusion, memory-expiry and single-movement-owner tests.
- [ ] Implement the Yuka candidate without adopting its world or navigation architecture.
- [ ] Pass replay, pause/resume, target-deletion and cleanup tests.

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

## Stop conditions and rollback

If Yuka needs a parallel entity world or is larger/harder than the direct solution without
measurable reuse, retain the example's simpler implementation and record the donor rejection.
Do not change the charter to justify importing a gameplay framework. Removing Yuka must not
require replacing navigation, physics, replay or a serialized game format.

## References

- [Upstream](https://github.com/Mugen87/yuka)
- [Donor manifest](https://github.com/Mugen87/yuka/blob/master/package.json)
- [Existing scheduling and replay surface](../../../packages/core/src/index.ts)
- [Current navigation dependency](../../../pnpm-workspace.yaml)
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
