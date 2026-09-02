# PRD-325 review round 2 — Phase 0 visibility and seam evidence

Date: 2026-09-02

This is the verification-only review-round update. No source code or source PRD was edited.

## Phase 0 decision — no new visibility surface

Finding 3 closes without a new visibility export. The shipped
`PhysicsDirectSpaceState3D.intersectRay` query is within the 16.3 ms frame budget in the real
bayview round, so Phase 3 is not run. `BoxOccluders` remains game-owned code; this phase did not
change `sandbox/prd259-bayview-current-20260830/src/render/occlusion.ts`.

Proof subject: bayview's `five-soldiers.playtest.json`, with the real town scene, five soldiers and
143 town colliders. The temporary measurement ran one box test and one direct-space query for each
soldier on each of 200 fixed frames: 1,000 paired observations at 60 Hz.

| Tester | Total across 200 frames | Per 60 Hz frame | Share of 16.3 ms |
| --- | ---: | ---: | ---: |
| `BoxOccluders.clear` | 3.6 ms | 0.018 ms | 0.11% |
| `PhysicsDirectSpaceState3D.intersectRay` | 16.5 ms | 0.083 ms | 0.51% |

The query therefore uses 0.083 ms of the 16.3 ms budget for the five-agent sight workload. The
measurement command was:

```text
node packages/playtest/dist/runner/cli.js /tmp/prd325-bayview-measure-PdWZnz/bayview/playtests/five-soldiers.playtest.json --url http://127.0.0.1:5173 --browser-recipe webgpu --headed
```

Observed marker:

```text
TN_PRD325_VISIBILITY:{"agents":5,"boxes":143,"boxMs":3.6000000089406967,"frames":200,"queryMs":16.5,"queries":1000}
```

The fail-closed unit control was observed red when the query call was removed:

```text
FAIL packages/physics/__tests__/direct-space-state.spec.ts
Error: TN_PRD325_VISIBILITY_MISSING_QUERY_OBSERVATION
Tests: 1 failed
```

The restored focused unit run reported 1 passing test. Because the shipped query is within budget,
the Phase 0 gate records “no new surface” for Integration Ledger row 4 and stops Phase 3.

## Final staircase proof — web and desktop

The final scenario is:

```text
/home/joao/projects/threenative/sandbox/.worktrees/prd-325-three-seams/prd259-bayview-current-20260830/playtests/camera-tracks-body-vertically.playtest.json
```

Web manager receipt:

```text
node packages/playtest/dist/runner/cli.js /home/joao/projects/threenative/sandbox/.worktrees/prd-325-three-seams/prd259-bayview-current-20260830/playtests/camera-tracks-body-vertically.playtest.json --target browser --url http://127.0.0.1:5173 --browser-recipe webgpu --headed --project /home/joao/projects/threenative/sandbox/.worktrees/prd-325-three-seams/prd259-bayview-current-20260830 --artifacts /tmp/prd325-camera-web-after-timing --timeout 60000

pass=true target=web runtime=web
positionY 1.8995753526687622 -> 2.364098310470581
targetsHit 0 -> 1; shots=1; cameraLagPeak=0
diagnostics consoleErrors=0 networkErrors=0 runtimeDiagnostics=0 runtimeReady=true
rendererKind=webgpu adapter.architecture=turing adapter.vendor=nvidia
setup requested/applied spawn={x:25,y:1.9,z:-4.4} aim={yaw:pi,pitch:0.82}
climb-shot step tick=36
```

Desktop manager receipt:

```text
SDL_AUDIO_DRIVER=dummy sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js /home/joao/projects/threenative/sandbox/.worktrees/prd-325-three-seams/prd259-bayview-current-20260830/playtests/camera-tracks-body-vertically.playtest.json --target desktop --executable /home/joao/projects/threenative/prd325-desktop-proof-corrected --no-screenshots --timeout 60000

pass=true target=desktop runtime=native
positionY 1.8985751867294312 -> 2.3630950450897217
targetsHit 0 -> 1; score=250; shots=1; cameraLagPeak=0
diagnostics consoleErrors=0 networkErrors=0 runtimeDiagnostics=0 runtimeReady=true
setup requested/applied spawn={x:25,y:1.9,z:-4.4} aim={yaw:pi,pitch:0.82}
climb-shot step tick=25
```

Both manager-run target receipts passed with the shared setup applied before the scene release.

## Setup ordering and manager gates

Commit `acf622e8` applies scenario setup through the shared browser/native transport before
`describe()` releases a held scene. Red/green evidence is in
`packages/playtest/__tests__/setup-ordering.spec.ts:15`: red before the fix; green with 3 tests
after the fix.

The manager reran the repository gates with these results:

```text
pnpm typecheck && pnpm lint && pnpm test — exit 0
typecheck passed; lint exit 0 with existing warnings; 3308 tests passed and 4 skipped
pnpm budgets — exit 0
pnpm test:templates — exit 0; all scaffolded template playtests passed
```

The source PRD's legacy parser check remains separately recorded as a parser limitation in
`.linchpin/prd-325-gates.md`; this receipt does not claim that parser check passed.

## Caller census and Integration Ledger rows 1–4

Every live caller below is a non-test caller. Row 3 is an implementation branch of row 2, not a
new export. Row 4 is resolved as a measured no-new-surface decision rather than an export.

| # | Thing | Resolved live caller(s) | Replaces / disposition | Resolution |
| --- | --- | --- | --- | --- |
| 1 | `afterPhysics` in `@threenative/core` | `packages/create-threenative/templates/shooter/src/scenes/Play.ts:357`; sandbox `prd259-bayview-current-20260830/src/scenes/Play.ts:366` | bayview's private `src/postPhysics.ts` plugin slot; old path removed | shipped and wired; engine-ordered callback reads the solved body before draw |
| 2 | `buildStaticColliders` in `@threenative/physics` | `packages/create-threenative/templates/shooter/src/scenes/Play.ts:139`; sandbox `lumen-hall/src/scenes/Play.ts:263` | lumen-hall's hand-written `src/collision.ts`; old path removed | shipped and wired; the game supplies only its scene and predicate |
| 3 | Instance-carrier handling inside `buildStaticColliders` | same non-test callers as row 2; exercised by lumen-hall's instanced piers | hand-written proxy loop | resolved inside row 2; world-space instance transforms are premultiplied |
| 4 | Visibility answer | no new exported caller; existing sandbox `BoxOccluders` construction is `prd259-bayview-current-20260830/src/scenes/Play.ts:510`; the temporary Phase 0 query probe was `Play.ts:379` outside the delivered sandbox | `BoxOccluders` remains the game-owned answer; no duplicate framework surface | Phase 0 measured `intersectRay` at 0.083 ms/frame, so “no new surface” is the recorded decision |

Caller census for the two new exports is therefore complete: `afterPhysics` has the template and
bayview callers above, and `buildStaticColliders` has the template and lumen-hall callers above.
There is deliberately no visibility export or visibility caller to add to the manifest.

## Exact observed-red Phase 1 and Phase 2 revert controls

These are the raw controls recorded before restoration; they are not predicted outcomes.

Phase 1 — omit the `afterPhysics` registration from the staircase run:

```text
afterPhysics omitted: pass=false cameraLagPeak before=0.817500114440918 after=5.100119113922119
```

Phase 2 — replace the trimesh/world-transform implementation with the old failing branches:

```text
FAIL AABB_NEGATIVE: box collider sealed the arcade opening
FAIL INSTANCE_MATRIX_NEGATIVE: expected centers 7,13 but missing premultiply produced -3,3
```

Phase 0’s separate no-new-surface control was also observed red when the occluder set was emptied:

```text
FAIL OCCLUDER_ZERO_NEGATIVE: empty occluder set reported a through-wall sight line as clear
```

The Phase 0 result is why that control remains evidence for the game-owned `BoxOccluders` path and
does not authorize a Phase 3 visibility export.
