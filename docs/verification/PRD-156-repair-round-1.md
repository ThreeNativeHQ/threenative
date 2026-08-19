# PRD-156 repair round 1 evidence

**Date:** 2026-08-18
**Lane:** `linchpin/prd-156-engine-ships-conventions-by-default`

The source PRD remains unchanged. This file records the evidence that belongs in the manager
handoff for the repair round.

## Phase 0 negative control

The gate ran after the census script and `budgets` wiring were added, but before any template
capability documentation was repaired.

```text
Command: pnpm tsx scripts/check-capability-docs.ts
Exit: 1

CAPABILITY_DOCS_MISSING: 30 public class/function exports are undocumented
- @threenative/core/hot: acceptHotUpdate; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: AnimationPlayer; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: attachToBone; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: AudioBus; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/core: CanvasLayer; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/core: createRandom; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/core: createReplayDriver; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/core: defineGame; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: GPUParticles3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/core: GroundSnap; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: normaliseToMetres; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: PathFollow3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/core: prewarm; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: replay; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: Scene; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/core: ScenePicker; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/core: Scheduler; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/core: skeletonBones; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/physics/navigation: NavigationAgent3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/physics/navigation: NavigationObstacle3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/physics/navigation: NavigationRegion3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/physics/navigation: recast; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/physics: Area3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/physics: CharacterBody3D; missing from packages/create-threenative/templates/defense/AGENTS.md
- @threenative/physics: CollisionShape3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
- @threenative/physics: interactionGroups; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/physics: Joint3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/physics: PhysicsDirectSpaceState3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/physics: rapier; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/minimal/AGENTS.md, packages/create-threenative/templates/platformer/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md, packages/create-threenative/templates/starter/AGENTS.md
- @threenative/physics: RigidBody3D; missing from packages/create-threenative/templates/action-rpg/AGENTS.md, packages/create-threenative/templates/defense/AGENTS.md, packages/create-threenative/templates/racing/AGENTS.md, packages/create-threenative/templates/shooter/AGENTS.md
```

After the documentation repair, the same scanner passes:

```text
capability docs: 32 public class/function exports documented in 7 templates
```

## Integration status

Repository-local wiring is complete for the census gate (`package.json` → `budgets`) and for
`GroundSnap` consuming `posedBounds` in `packages/core/src/grounding.ts`. The new exports
`GroundSnap`, `normaliseToMetres`, and `prewarm` have no non-test caller in this engine tree.

The proving ground at `~/projects/threenative/sandbox/fps-framework` is a separate worktree and
already contains unrelated uncommitted changes. This engine lane did not edit it, so the PRD's
production-game caller census, `Enemy.ts` deletion/integration, navigation playtest, performance
profile, first-shot timing, death playback, and full scale-check evidence remain explicit manager
evidence gaps. No fake engine caller or game workaround was added.

## Verification run

- Focused regression suite: passed, 5 files and 17 tests.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed with existing cognitive-complexity warnings.
- `pnpm sync:agents --check`: passed; all 15 mirrors are in sync.
- `pnpm budgets`: passed; the capability census reported 32 exports documented in 7 templates.
- `pnpm test`: all 151 files and 1,376 tests passed, but the root command exited 1 because its
  temporary-directory invariant changed from 74 before the suite to 73 after it.
- `pnpm test:templates`: action-rpg, defense, minimal, platformer, racing, and shooter passed.
  The starter template exited 1 after its project test returned exit 2 with
  `TN_PLAYTEST_RUNNER_FAILED: Cannot advance a stopped loop`.
