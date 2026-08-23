# PRD-190 projection workspace verification — 2026-08-23

Repair commit: recorded after `f73358789d27b22c5ce2a7fa46b29269a92999b3` and before the repair commit.

## Red controls

The focused controls were observed red before the repair.

Whole-group mutation and scan-pool retention command:

```sh
pnpm exec tsx -e 'import { BoxGeometry, Mesh, MeshStandardMaterial, Scene, Sprite, SpriteMaterial } from "three"; import { SceneRenderProjection } from "./packages/core/src/renderProjection.ts"; import { createProjectionScanWorkspace, scanProjection } from "./packages/core/src/projection-plan.ts"; const scene=new Scene(); const geometry=new BoxGeometry(); const firstMaterial=new MeshStandardMaterial(); const secondMaterial=new MeshStandardMaterial(); const meshes=[] as Mesh[]; for (let index=0; index<250; index+=1) { const mesh=new Mesh(geometry, firstMaterial); scene.add(mesh); meshes.push(mesh); } const projection=new SceneRenderProjection(scene,{minMeshes:8}); projection.reconcile(); for (const mesh of meshes) mesh.material=secondMaterial; projection.reconcile(); console.log(JSON.stringify({emptyBatchControl:{batches:projection.report.batches,drawCandidates:projection.report.resultDrawCandidates}})); projection.dispose(); const retainedScene=new Scene(); const retainedGeometry=new BoxGeometry(); const retainedMaterial=new MeshStandardMaterial(); const retainedMeshes=[] as Mesh[]; for (let index=0; index<8; index+=1) { const mesh=new Mesh(retainedGeometry,retainedMaterial); retainedScene.add(mesh); retainedMeshes.push(mesh); } const sprite=new Sprite(new SpriteMaterial()); retainedScene.add(sprite); const workspace=createProjectionScanWorkspace(); const firstScan=scanProjection(retainedScene,8,workspace); const group=firstScan.plan.action === "project" ? firstScan.plan.batchGroups[0] : undefined; const pooledExact=workspace.exactEntryPool[0]?.object; for (const mesh of retainedMeshes) retainedScene.remove(mesh); retainedScene.remove(sprite); scanProjection(retainedScene,8,workspace); console.log(JSON.stringify({retentionControl:{inactiveBatchMembers:group?.members.length,exactPoolRetainsSource:workspace.exactEntryPool[0]?.object===pooledExact}}));'
```

Result: `emptyBatchControl={ batches: 2, drawCandidates: 2 }` and
`retentionControl={ inactiveBatchMembers: 8, exactPoolRetainsSource: true }`.
- Removing the old-batch release and running
  `pnpm exec vitest run packages/core/__tests__/renderProjection.spec.ts -t "should reclassify a material swap in the same frame"`
  left the pre-repair test green, while the repaired assertion fails the same control with
  `expected 1, received 2` matching instance matrices.

The declared allocation controls were also run as temporary negative configurations and restored:

| Control | Command | Observed red result |
| --- | --- | --- |
| Fresh scan workspace | `pnpm exec vitest run packages/core/__tests__/renderProjection.spec.ts -t "should reuse projected-plan storage across settled frames"` | `{ maps: 20, sets: 10 }` instead of zero |
| Legacy batch-key join | same focused command | `batchKeyJoins=2500` instead of zero |
| Fresh light membership set | `pnpm exec vitest run packages/core/__tests__/renderProjection.spec.ts -t "should retire removed lights with reused membership storage"` | `sets=1` instead of zero |
| Missing old-batch release | `pnpm exec vitest run packages/core/__tests__/renderProjection.spec.ts -t "should reclassify a material swap in the same frame"` | `2` matching instance matrices instead of `1` |

## Focused green verification

Command:

```sh
pnpm exec vitest run packages/core/__tests__/renderProjection.spec.ts
```

Result: 52 tests passed, 0 failed.

The repaired suite covers zero-member batch disposal, exact-entry and inactive-member cleanup, and
the material-swap old-batch assertion. The existing settled-frame and decline coverage remains green.

## Allocation and reconcile benchmark

Command, run once before the repair at `f73358789d27b22c5ce2a7fa46b29269a92999b3` and once after:

```sh
pnpm exec tsx -e 'import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from "three"; import { SceneRenderProjection } from "./packages/core/src/renderProjection.ts"; const cases=[0,250,2000]; for (const count of cases) { const scene=new Scene(); const geometry=new BoxGeometry(1,1,1); const material=new MeshBasicMaterial(); for (let index=0; index<count; index+=1) scene.add(new Mesh(geometry,material)); const projection=new SceneRenderProjection(scene,{minMeshes:8,onReport:()=>{}}); for (let frame=0; frame<60; frame+=1) projection.reconcile(); const originalMap=globalThis.Map; const originalSet=globalThis.Set; let maps=0; let sets=0; const CountingMap=class extends originalMap { constructor(...args:any[]){super(...args); maps+=1;} }; const CountingSet=class extends originalSet { constructor(...args:any[]){super(...args); sets+=1;} }; globalThis.Map=CountingMap as typeof Map; globalThis.Set=CountingSet as typeof Set; const times:number[]=[]; for (let frame=0; frame<300; frame+=1) { const started=performance.now(); projection.reconcile(); times.push(performance.now()-started); } globalThis.Map=originalMap; globalThis.Set=originalSet; times.sort((a,b)=>a-b); const p95=times[Math.ceil(times.length*0.95)-1]??0; const report=projection.report; console.log(JSON.stringify({count,maps,sets,p95Ms:Number(p95.toFixed(4)),maxMs:Number((times.at(-1)??0).toFixed(4)),lastReconcileMs:Number(report.timings.lastReconcileMs.toFixed(4)),drawCandidates:report.resultDrawCandidates,projected:report.projectedObjects,projecting:report.projecting})); projection.dispose(); }'
```

Each row samples 300 settled frames after 60 warmup frames. `maps` and `sets` are constructor
samples during the 300-frame window.

| Meshes | Phase | Maps | Sets | p95 reconcile (ms) | Max (ms) | Last (ms) | Draw candidates | Projected |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | before repair | 0 | 0 | 0.0007 | 0.0232 | 0.0044 | 0 | 0 |
| 0 | after repair | 0 | 0 | 0.0022 | 0.0407 | 0.0073 | 0 | 0 |
| 250 | before repair | 0 | 0 | 0.1168 | 0.2204 | 0.0948 | 1 | 250 |
| 250 | after repair | 0 | 0 | 0.1057 | 0.2974 | 0.0654 | 1 | 250 |
| 2,000 | before repair | 0 | 0 | 0.8281 | 1.7339 | 0.7808 | 1 | 2,000 |
| 2,000 | after repair | 0 | 0 | 0.6798 | 1.1351 | 0.5095 | 1 | 2,000 |

The samples are timing diagnostics, not a claim of statistically significant latency improvement.
The settled-frame allocation control is zero at all three populations before and after the repair.

## Browser WebGPU scenario

Command:

```sh
pnpm profile:native-cpu -- --objects 250,2000 --render-mode scene-projection --passes 1 --hierarchy flat --dirty 0 --visibility all-visible --repeats 1 --samples 300 --warmup-frames 60 --warmup-ms 0 --allow-software --output-dir /tmp/prd-190-native-cpu-profile-repair-20260823
```

Artifact: `/tmp/prd-190-native-cpu-profile-repair-20260823/profile-1787470745458.json`.

This is the browser WebGPU harness with software fallback explicitly allowed. Both runs reported
the same adapter identity: `vendor=google`, `architecture=swiftshader` (software adapter).

| Meshes | Settle frames | Stable samples | Stable draw calls | Draw candidates | Projected | Move followed | Hide dropped | Remove gone | Still projecting |
| ---: | ---: | ---: | --- | ---: | ---: | --- | --- | --- | --- |
| 250 | 1 | 300 | `[2]` | 1 | 250 | true | true | true | true |
| 2,000 | 1 | 300 | `[2]` | 1 | 2,000 | true | true | true | true |

The harness also reported `addedDrawn=true`, `recolouredLive=true`, and `streamedUploaded=true` in
both runs. Its unrelated reparent probe remains `reparentedFollowed=false`; the required move,
hide, remove, and projection assertions above passed.

## Repository gates

| Command | Result |
| --- | --- |
| `pnpm exec biome check packages/core/src/projection-plan.ts packages/core/src/projection-apply.ts packages/core/src/renderProjection.ts packages/core/__tests__/renderProjection.spec.ts` | Passed; no diagnostics |
| `pnpm typecheck` | Passed; root and workspace typechecks completed |
| `pnpm lint` | Exit 0; existing repository complexity diagnostics were warnings, with no repair-file diagnostic |
| `pnpm test` | Passed on rerun: 166 files, 1,589 passed, 3 skipped; temporary-directory count unchanged at 60 |

The first full-suite attempt also passed its 166 files and 1,589 tests but the wrapper observed a
temporary-directory baseline change from 69 to 60; the same command passed from the stable baseline
on rerun. No source or generated file outside this lane's four core files and this verification
record was changed.
