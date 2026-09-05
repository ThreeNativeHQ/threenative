# Capability search recall — gated baseline, 2026-08-31

Recorded on 2026-09-05 from the clean PRD-297 checkout. The file name preserves the
baseline date used by the sealed brief. The gate reads the generated
packages/create-threenative/capabilities.json manifest (272 entries) and the same
manifest copied at packages/core/capabilities.json.

The sealed corpus has 58 rows:

- 46 mechanic bullets copied from the seven sealed genre briefs.
- 11 plain authoring requests.
- 1 animation-foot guard row used by the situation-tag mutation.

The 11 brief bullets that were zero-result in the historical baseline remain corpus
rows even when later manifest changes make a row return results. The budget also
records every currently recalled row, so a later ranking or tag change cannot
compensate for losing one query with a different query's gain.

## Gate proof

Command:

~~~sh
pnpm caps:recall
~~~

Observed output:

~~~text
Capability recall (58 rows)
id | scope | results | recalled | reject | returned
brief.endless-runner.1 | mechanic | 5 | yes | no | Billboard3D, NavigationAgent3D, defineGame, VirtualShadowNode, Heightfield
brief.endless-runner.2 | mechanic | 5 | yes | no | CharacterBody3D, DebugOverlay, TerrainTiles, buildStaticColliders, VirtualShadowNode
brief.endless-runner.3 | mechanic | 2 | no | no | TracerPool3D, NavigationAgent3D
brief.endless-runner.4 | mechanic | 5 | yes | no | publishUiState, useUiState, createReactOverlay, Atmosphere, Text
brief.endless-runner.5 | mechanic | 5 | no | no | sendUiIntent, useUiIntent, watchAssets, onUiIntent, parseUEModel
brief.exploration.1 | mechanic | 5 | no | no | formatPassCosts, subscribeUiState, boneLengthDeviations, VirtualShadowNode, runDesktopPlaytest
brief.exploration.2 | mechanic | 5 | yes | no | NavigationAgent3D, Heightfield, WaveField, buildStaticColliders, PointerEvents3D
brief.exploration.3 | mechanic | 2 | no | no | Scheduler, Area3D
brief.exploration.4 | mechanic | 5 | no | no | boneLengthDeviations, WaveField, GroundSnap, UiLayer, useGameState
brief.exploration.5 | mechanic | 5 | no | no | interactionGroups, VirtualShadowNode, PointerEvents3D, godrays, DesktopPlaytestDriver
brief.fps.1 | mechanic | 1 | no | no | PhysicsDirectSpaceState3D
brief.fps.2 | mechanic | 5 | no | yes | SpectralOcean, UiLayer, PointerEvents3D, PhysicsDirectSpaceState3D, subscribeUiState
brief.fps.3 | mechanic | 0 | no | no | (none)
brief.fps.4 | mechanic | 5 | no | no | TracerPool3D, connectDevicePlaytestBridge, DesktopPlaytestDriver, Billboard3D, runAndroidPlaytest
brief.fps.5 | mechanic | 5 | yes | no | attachToBone, TracerPool3D, publishHitRegions, InstancedBatch, Scene
brief.fps.6 | mechanic | 5 | no | no | VirtualShadowNode, readRenderChainReport, NavigationAgent3D, TracerPool3D, Scene
brief.fps.7 | mechanic | 5 | no | yes | defineGame, VirtualShadowNode, bloom, afterPhysics, TracerPool3D
brief.fps.8 | mechanic | 5 | no | yes | GPUReadback, WaveField, CollisionShape3D, TracerPool3D, rapier
brief.fps.9 | mechanic | 5 | yes | yes | connectDevicePlaytestBridge, ScenePicker, DesktopPlaytestDriver, clipPoseError, readRenderChainReport
brief.fps.10 | mechanic | 5 | yes | no | NavigationAgent3D, WaveField, Billboard3D, Scene, AnimationPlayer
brief.fps.11 | mechanic | 5 | yes | yes | NavigationAgent3D, Heightfield, buildStaticColliders, attachToBone, PointerEvents3D
brief.fps.12 | mechanic | 5 | yes | no | ClusteredMesh, VirtualShadowNode, buildStaticColliders, PointerEvents3D, NavigationAgent3D
brief.fps.13 | mechanic | 5 | yes | no | NavigationAgent3D, buildStaticColliders, assertJsonSafe, jsonByteLength, PointerEvents3D
brief.fps.14 | mechanic | 2 | yes | no | publishUiState, useUiState
brief.open-world.1 | mechanic | 5 | yes | no | Heightfield, PointerEvents3D, NavigationAgent3D, TerrainTiles, interactionGroups
brief.open-world.2 | mechanic | 5 | no | no | Heightfield, TerrainTiles, VirtualShadowNode, buildStaticColliders, PointerEvents3D
brief.open-world.3 | mechanic | 5 | yes | no | Billboard3D, defineGame, VirtualShadowNode, NavigationAgent3D, buildStaticColliders
brief.open-world.4 | mechanic | 5 | no | yes | WaveField, CaptureGuardError, UiLayer, formatPassCosts, boneLengthDeviations
brief.open-world.5 | mechanic | 5 | no | no | ComputeDrivenRegistry, loadAll, warmUpScene, prewarm, createThreeObject
brief.physics-puzzle.1 | mechanic | 5 | yes | yes | RigidBody3D, softBodyCollision, Heightfield, interactionGroups, FluidField2D
brief.physics-puzzle.2 | mechanic | 5 | yes | yes | RigidBody3D, CharacterBody3D, rapier, reconcileMirroredClips, boneContact
brief.physics-puzzle.3 | mechanic | 5 | no | yes | RigidBody3D, Joint3D, ensureVelocityOutput, readVelocityPreviousBoneMatrices, readVelocityPreviousMatrices
brief.physics-puzzle.4 | mechanic | 5 | yes | no | boneContact, RigidBody3D, subscribeUiState, afterPhysics, ThreePlaytestPhysicsRecorder
brief.physics-puzzle.5 | mechanic | 5 | no | yes | Scheduler, subscribeUiState, installThreePlaytestBridge, publishUiState, AnimationPlayer
brief.physics-puzzle.6 | mechanic | 5 | no | yes | RigidBody3D, CharacterBody3D, afterPhysics, rapier, denoise
brief.physics-puzzle.8 | mechanic | 5 | yes | yes | assertJsonSafe, assertJsonSafe, subscribeUiState, connectDevicePlaytestBridge, parseLaunchedPid
brief.platformer.1 | mechanic | 5 | yes | no | defineGame, VirtualShadowNode, buildStaticColliders, PointerEvents3D, NavigationAgent3D
brief.platformer.2 | mechanic | 5 | no | yes | NavigationAgent3D, buildStaticColliders, PointerEvents3D, runAndroidPlaytest, runIosPlaytest
brief.platformer.3 | mechanic | 5 | no | yes | PathFollow3D, NavigationAgent3D, onUiIntent, CaptureGuardError, sendUiIntent
brief.platformer.4 | mechanic | 5 | no | no | WorldEnvironment, solarPosition, subscribeUiState, sparkle, ComputeDrivenRegistry
brief.platformer.5 | mechanic | 5 | yes | no | createReactOverlay, Text, sendUiIntent, useUiIntent, publishUiState
brief.topdown-action.1 | mechanic | 5 | yes | yes | boneLengthDeviations, Billboard3D, defineGame, VirtualShadowNode, Heightfield
brief.topdown-action.2 | mechanic | 5 | yes | no | CharacterBody3D, ScenePicker, TerrainTiles, buildStaticColliders, VirtualShadowNode
brief.topdown-action.3 | mechanic | 4 | no | yes | runAndroidPlaytest, CaptureGuardError, runIosPlaytest, connectDevicePlaytestBridge
brief.topdown-action.4 | mechanic | 5 | no | no | GroundSnap, interactionGroups, ao, NavigationAgent3D, recast
brief.topdown-action.5 | mechanic | 5 | yes | no | publishUiState, useUiState, formatHealthReport, createReactOverlay, Text
guard.animation-feet | mechanic | 3 | yes | no | AnimationPlayer, reconcileMirroredClips, GroundSnap
request.build-racing-game | request | 15 | yes | no | PathFollow3D, afterPhysics, AnimationPlayer, attachToBone, boneContact, boneLengthDeviations, clipBoneCoverage, clipPoseError, clipTrackBindings, ensureVelocityOutput, getPlatform, GPUSceneBVH, GroundSnap, measureThreePose, normaliseToMetres
request.tower-defense-game | request | 0 | no | no | (none)
request.inventory-system | request | 0 | no | no | (none)
request.enemy-ai | request | 15 | yes | no | NavigationAgent3D, attachToBone, CharacterBody3D, recast, Heightfield, buildStaticColliders, interactionGroups, PointerEvents3D, UiLayer, boneLengthDeviations, subscribeUiState, connectUiBridge, boneContact, decompressCompressedBuffer, clipTrackBindings
request.third-person-camera | request | 0 | no | no | (none)
request.save-progress | request | 8 | no | yes | buildStaticColliders, PointerEvents3D, NavigationAgent3D, findRawMeshBlobs, Heightfield, defineGame, VirtualShadowNode, attachToBone
request.spawn-waves | request | 3 | no | yes | WaveField, Buoyancy3D, TracerPool3D
request.dialogue-npc | request | 2 | no | yes | NavigationAgent3D, recast
request.pick-up-item | request | 0 | no | no | (none)
request.multiplayer | request | 0 | no | no | (none)
request.platformer-double-jump | request | 0 | no | no | (none)

zeroResultRate: 0.120690 (7/58)
recallAtK: 0.431034 (25/58)
rejectHits: 19
rowCount: 58

Misses (33)
- brief.endless-runner.3: Spawn an unbounded-feeling sequence of obstacles and collectibles with increasing pace.
- brief.endless-runner.5: Make a collision restart the run without a page reload.
- brief.exploration.1: Use a third-person camera and a compact hub that leads to at least two distinct areas. Name the starting area the literal `hub`; the proof compares `state.area` against that word.
- brief.exploration.3: Load or reveal a different arrangement of props in each area, with a clear transition.
- brief.exploration.4: Keep a journal or objective panel that records the inspected points of interest.
- brief.exploration.5: Make the world readable through deliberate lighting, landmarks, and a restrained palette.
- brief.fps.1: First person. Eye height 1.66 m, walking 5.6 m/s, sprinting 8.2 m/s while not aiming.
- brief.fps.2: Vertical field of view 70°, narrowing to 22° while aiming down the sights, and mouse look is half as sensitive while aimed. Pitch is clamped roughly −66° to +72°.
- brief.fps.3: Health starts at 100 and never regenerates. There is no jump, no crouch and no stamina.
- brief.fps.4: Spawns at the firing line facing down the range, with the nearest target on the crosshair.
- brief.fps.6: Magazine 30, reserve 90. Reload moves rounds from the reserve into the magazine; the sights drop for about 0.7 s while it happens.
- brief.fps.7: Hitscan along the exact camera forward axis out to 60 m. No spread, no bloom, no recoil kick, no damage falloff.
- brief.fps.8: 10 damage a round; 4× in the top 12% of a body's height, 0.7× below a third of it.
- brief.open-world.2: Stream or reveal terrain and content while the player travels across at least three chunk boundaries.
- brief.open-world.4: Include at least two landmarks or points of interest that are separated by the traversal.
- brief.open-world.5: Keep the first playable screen visible without a user account or external asset service.
- brief.physics-puzzle.3: Include one body class that the controlled character passes through and another that blocks the controlled character; make the distinction visible in the scene.
- brief.physics-puzzle.5: Run the same input sequence twice with a fixed seed and fixed-step simulation, and expose whether the final state matched on both runs.
- brief.physics-puzzle.6: Use an angled camera and a readable HUD so the controlled character, stack, pass-through body, and destination remain legible on the first screen.
- brief.platformer.2: Make the player run, jump, collect a visible line of coins, and reach a goal.
- brief.platformer.3: Include at least one raised platform, one gap, one enemy or hazard, and a restart path.
- brief.platformer.4: Match the reference's bright sky, saturated green platforms, warm wood, and rounded toy-like silhouettes.
- brief.topdown-action.3: Include three enemy targets, a short cooldown or reload feedback, and a win condition.
- brief.topdown-action.4: Build the arena from a few walls, floor markings, and pickups with a clear color hierarchy.
- request.tower-defense-game: tower defense game
- request.inventory-system: make an inventory system
- request.third-person-camera: third person camera follow
- request.save-progress: save the player progress
- request.spawn-waves: spawn waves of enemies
- request.dialogue-npc: dialogue with an NPC
- request.pick-up-item: pick up an item
- request.multiplayer: multiplayer
- request.platformer-double-jump: make a platformer with double jump
~~~

The recorded budget is:

~~~json
{
  "recallAtK": 0.43103448275862066,
  "rejectHits": 19,
  "rowCount": 58,
  "version": 1,
  "zeroResultRate": 0.1206896551724138
}
~~~

budget.json additionally stores the 25 recalled row IDs as recalledRows.

The build-and-chain proof was run as:

~~~sh
pnpm build && pnpm budgets
~~~

Observed output excerpts:

~~~text
capability manifest generated: 272 entries
Capability recall (58 rows)
zeroResultRate: 0.120690 (7/58)
recallAtK: 0.431034 (25/58)
rejectHits: 19
rowCount: 58
capability manifest fresh: 272 entries
budgets ok: 11 framework packages, 16 example workspaces, 59329/15000 framework LOC, 121751/100000 native runtime LOC, 107 PRD files, largest template 5457 LOC, no compiled texture manifests found
MCP host configs current: 10 templates × 7 hosts
exit=0
~~~

## Integration proof

The caller census found the non-test consumer inside the pre-existing budgets chain:

~~~sh
$ grep -n "capability-recall" package.json
17:    "budgets": "... && tsx scripts/capability-recall.ts && ...",
19:    "caps:recall": "tsx scripts/capability-recall.ts",
~~~

The shipping check found no corpus content in either generated manifest:

~~~sh
$ grep -rn "endless runner\|firing line\|Magazine 30" packages/create-threenative/capabilities.json packages/core/capabilities.json
$ echo $?
1
~~~

The command produced no stdout. The corpus is read at gate time and is not copied
into a shipped artifact.

## Observed red controls

Each control was run against a temporary mutation and restored before the positive
gates and commit.

### Situation deletion

The real @situation stop a walking character's feet from sliding or spinning line
was deleted from packages/core/src/index.ts; pnpm build still completed and
regenerated the 272-entry manifest. The following gate then failed:

~~~text
Capability recall (58 rows)
zeroResultRate: 0.120690 (7/58)
recallAtK: 0.413793 (24/58)
rejectHits: 19
rowCount: 58

Regressions
- recallAtK: recallAtK 0.413793 is below floor 0.431034
- recalledRows: 1 previously recalled row no longer reaches an expected symbol
rows: guard.animation-feet
~~~

### Row-count floor

Deleting request.platformer-double-jump from the corpus produced:

~~~text
Capability recall (57 rows)
Regressions
- rowCount: rowCount 57 is below floor 58
rows: corpus
~~~

### Source-pointer resolution

Renaming the template:action-rpg#Start every change heading produced:

~~~text
TN_CAPABILITY_RECALL: guard.animation-feet: source 'template:action-rpg#Start every change renamed' no longer resolves
~~~

### Empty corpus

Replacing the corpus with a valid empty object produced:

~~~text
TN_CAPABILITY_RECALL: .../scripts/fixtures/capability-recall/corpus.json: corpus has no rows
~~~

The exit code was 1; it did not report a vacuous 100% recall.

### Stale manifest

Pointing THREENATIVE_CAPABILITIES_MANIFEST at a hand-written manifest with no
entries produced:

~~~text
TN_CAPABILITY_RECALL: brief.endless-runner.1: symbol 'defineGame' is absent from manifest .../scripts/fixtures/capability-recall/stale-manifest.json
~~~

The override was read and failed before any cached budget number could pass.

### Lowered zero-result floor

Temporarily changing budget.json's zeroResultRate floor from
0.1206896551724138 to 0 produced:

~~~text
Regressions
- zeroResultRate: zeroResultRate 0.120690 exceeds floor 0.000000
rows: brief.fps.3, request.tower-defense-game, request.inventory-system, request.third-person-camera, request.pick-up-item, request.multiplayer, request.platformer-double-jump
~~~

### Gate removal / revert check

Temporarily removing scripts/capability-recall.ts and running pnpm budgets
produced exit code 1 at the in-chain caller:

~~~text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../scripts/capability-recall.ts'
~~~

The script was restored before the successful pnpm budgets run.

## Unit proof

~~~sh
pnpm exec vitest run scripts/__tests__/capability-recall.spec.ts
~~~

Observed: 1 test file passed, 9 tests passed.

The read-only candidate helper also runs:

~~~sh
pnpm caps:recall --harvest
~~~

Observed: Harvest candidates (115), exit code 0. It never edits
corpus.json or invents expected/rejected symbols.
