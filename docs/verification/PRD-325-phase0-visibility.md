# PRD-325 Phase 0 — visibility query measurement

Date: 2026-09-01

## Decision

Finding 3 closes without a new visibility export. The shipped
`PhysicsDirectSpaceState3D.intersectRay` query is well inside the 16.3 ms frame budget in the
real bayview round, so Phase 3 is not run. `BoxOccluders` remains game-owned code; this phase did
not change `sandbox/prd259-bayview-current-20260830/src/render/occlusion.ts`.

## Real-scene measurement

Proof subject: bayview's `five-soldiers.playtest.json`, with the real town scene, 5 soldiers and
143 town colliders. The temporary measurement ran one box test and one direct-space query for each
soldier on each of 200 fixed frames: 1,000 paired observations at 60 Hz.

| Tester | Total across 200 frames | Per 60 Hz frame | Share of 16.3 ms |
| --- | ---: | ---: | ---: |
| `BoxOccluders.clear` | 3.6 ms | 0.018 ms | 0.11% |
| `PhysicsDirectSpaceState3D.intersectRay` | 16.5 ms | 0.083 ms | 0.51% |

The query therefore uses 0.083 ms of the 16.3 ms budget for the five-agent sight workload. The
browser was Chromium 151 with the NVIDIA Turing WebGPU adapter, `rendererKind: webgpu`, and the
runner reported `runtimeReady: true`, zero console errors and zero network errors. Command:

```text
node packages/playtest/dist/runner/cli.js /tmp/prd325-bayview-measure-PdWZnz/bayview/playtests/five-soldiers.playtest.json --url http://127.0.0.1:5173 --browser-recipe webgpu --headed
```

Observed marker:

```text
TN_PRD325_VISIBILITY:{"agents":5,"boxes":143,"boxMs":3.6000000089406967,"frames":200,"queryMs":16.5,"queries":1000}
```

## Fail-closed control

The focused unit harness requires a nonzero query observation and throws
`TN_PRD325_VISIBILITY_MISSING_QUERY_OBSERVATION` when the direct query call is absent. The final
unit run reports 1 passing test. A temporary removal of the `space.intersectRay(...)` call was
run with the same command and observed red:

```text
FAIL packages/physics/__tests__/direct-space-state.spec.ts
Error: TN_PRD325_VISIBILITY_MISSING_QUERY_OBSERVATION
Tests: 1 failed
```

The source was restored before the passing run and before delivery.

## Phase 1 and 2 closeout

The real desktop staircase run used the existing native artifact built from the temporary bayview
project:

```text
node packages/playtest/dist/runner/cli.js /tmp/prd325-bayview-measure-PdWZnz/bayview/playtests/camera-tracks-body-vertically.playtest.json --project /tmp/prd325-bayview-measure-PdWZnz/bayview --target desktop --executable /tmp/prd325-bayview-measure-PdWZnz/bayview/dist-native/fps-framework --timeout 120000
```

The earlier desktop report with `cameraLagPeak: 5.111824870109558` was a setup/build-lane
discrepancy, not native callback ordering: the same artifact was rerun after the late scenario
placement was re-anchored, and the callback read the solved transform. The executed report was:

```text
pass=true target=desktop runtime=native scenario=camera-tracks-body-vertically frames=190
positionY before=5.942775726318359 after=0.9000864624977112 pass=true
cameraLagPeak before=0 after=0 pass=true
diagnostics pass=true consoleErrors=0 networkErrors=0 runtimeDiagnostics=0
```

The current browser staircase run is also green, and the current Lumen collision run is green:

```text
camera-tracks-body-vertically: positionY 5.427750110626221 -> 0.9000892043113708, cameraLagPeak 0
lumen-hall-walls-stop-you-and-stairs-carry-you: walkerY 1.6986752414703368 -> 2.7897262239456175, walkerZ 22 -> -18.01160430908203
```

The arcade-opening run used `buildStaticColliders` and reported `TN_STATIC_COLLIDERS:{"count":111}`;
it passed with `walkerX 2.5999999046325684 -> 12.850229263305664`. A separate stands run reached
the chancel but was not counted as green because SwiftShader emitted baseline SSR mip-level
validation errors and its triangle-budget assertion was red.

## Caller census

The new public exports have these live non-test callers:

| Export | Caller |
| --- | --- |
| `afterPhysics` | `packages/create-threenative/templates/shooter/src/scenes/Play.ts:357`; `sandbox/prd259-bayview-current-20260830/src/scenes/Play.ts:366` |
| `buildStaticColliders` | `packages/create-threenative/templates/shooter/src/scenes/Play.ts:139`; `sandbox/lumen-hall/src/scenes/Play.ts:263` |

Phase 0 added no visibility export; its direct-space query remains game-owned and its measured
caller is covered by the real-scene command above.

## Declared negative controls

Each control was run outside the two worktrees or against a temporary report; the non-zero exit is
the expected result.

```text
afterPhysics omitted: pass=false cameraLagPeak before=0.817500114440918 after=5.100119113922119
FAIL AABB_NEGATIVE: box collider sealed the arcade opening
FAIL INSTANCE_MATRIX_NEGATIVE: expected centers 7,13 but missing premultiply produced -3,3
FAIL OCCLUDER_ZERO_NEGATIVE: empty occluder set reported a through-wall sight line as clear
REMOVED_SYMBOL=VelocityNode
FAIL MANIFEST_NEGATIVE: Capability manifest is stale; run pnpm build to regenerate it.
```

The `afterPhysics` result is the staircase scenario's register-nothing control. The AABB and
instance results exercise the collider shape and world-transform branches directly. The occluder
control is the Phase 0 no-new-surface guard, and the manifest result is the PRD-324 freshness gate.
