# PRD-325 review round 2 — Phase 0 visibility and seam evidence

Date: 2026-09-02

This receipt includes the final-review correction. The source PRD remains absent/legacy and was not
edited. Shared lifecycle source changed in the engine, and a bounded visibility meter plus its
scenario changed in the linked Bayview sandbox lane.

## Phase 0 decision — no new visibility surface

Finding 3 closes without a new visibility export, now on the delivered algorithm rather than a
different physics query. Bayview uses `BoxOccluders.clear`; only a box-blocked segment falls back to
`ctx.raycastAll` against the town's hittable solids. `PhysicsDirectSpaceState3D.intersectRay` is not
on that path, and its earlier numbers are withdrawn as evidence for this decision.

Proof subject: `playtests/visibility-path-cost.playtest.json` in sandbox commit `6eed88e`, with the
real town scene, five soldiers, 143 town colliders, and setup applied before `Play.enter()`. The
scenario places the player and first soldier on opposite sides of a building so the exact fallback
must run; it then measures 200 fixed ticks. Its fail-closed assertions require the visibility call
count and actual `raycastAll` fallback count to increase, require 143 boxes, and bound the existing
five-soldier `squad.canSee` peak to 16.3 ms.

| Delivered-path observation | Measured value |
| --- | ---: |
| Fixed ticks | 200 |
| `BoxOccluders.clear` calls | 72 |
| Box-blocked calls | 72 |
| Actual `ctx.raycastAll` fallbacks | 72 |
| Fallbacks reporting a solid blocker | 72 |
| Total exact-path time | 41.2 ms |
| Amortized exact-path time per measured tick | 0.206 ms |
| Mean per invoked exact-path call | 0.572 ms |
| Worst exact-path call | 12.2 ms |
| Worst five-soldier `canSee` frame | 12.4 ms (76.1% of 16.3 ms) |

The worst measured five-soldier visibility frame stayed below the 16.3 ms Phase 0 bound, while the
200-tick amortized cost was 0.206 ms/tick. Phase 3 is therefore not run and `BoxOccluders` remains
game-owned. The meter is bounded aggregate state (counters, total, mean and peak); it stores no
per-frame series.

Before the meter existed, the committed scenario failed closed:

```text
FAIL component.visibility.calls.value
observed before=undefined after=undefined
FAIL component.visibility.raycastFallbacks.value
observed before=undefined after=undefined
```

After the meter and pre-entry placement, the focused run was:

```text
tools/capture-lock.sh node <engine-worktree>/packages/playtest/dist/runner/cli.js \
  playtests/visibility-path-cost.playtest.json --target browser \
  --url http://127.0.0.1:4175 --browser-recipe webgpu --headed \
  --server-command "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175 --strictPort" \
  --artifacts artifacts/prd325-visibility-green --timeout 60000
```

Observed result:

```text
pass=true target=web runtime=web
setup requested/applied player=(12,1.9,15.7), enemy=(0,0,12)
boxes=143 calls=72 boxBlocked=72 raycastFallbacks=72 raycastBlocked=72
totalMs=41.2 averageMs=0.572 peakMs=12.2 squad.canSee=12.4
rendererKind=webgpu adapter.architecture=turing adapter.vendor=nvidia
diagnostics consoleErrors=0 networkErrors=0 runtimeDiagnostics=0 runtimeReady=true
```

## Final staircase proof — fresh web and desktop

The final scenario is:

```text
/home/joao/projects/threenative/sandbox/.worktrees/prd-325-three-seams/prd259-bayview-current-20260830/playtests/camera-tracks-body-vertically.playtest.json
```

Fresh post-correction web receipt:

```text
tools/capture-lock.sh node <engine-worktree>/packages/playtest/dist/runner/cli.js \
  playtests/camera-tracks-body-vertically.playtest.json --target browser \
  --url http://127.0.0.1:4175 --browser-recipe webgpu --headed \
  --server-command "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175 --strictPort" \
  --artifacts artifacts/prd325-camera-lifecycle-green --timeout 60000

pass=true target=web runtime=web
positionY 1.899275302886963 -> 2.364098310470581
cameraLagPeak 0 -> 0
diagnostics consoleErrors=0 networkErrors=0 runtimeDiagnostics=0 runtimeReady=true
rendererKind=webgpu adapter.architecture=turing adapter.vendor=nvidia
setup requested/applied spawn={x:25,y:1.9,z:-4.4} aim={yaw:pi,pitch:0.82}
```

Fresh post-correction desktop receipt:

```text
SDL_AUDIODRIVER=dummy sh <engine-worktree>/packages/runtime-native/scripts/xvfb.sh \
  node <engine-worktree>/packages/playtest/dist/runner/cli.js \
  playtests/camera-tracks-body-vertically.playtest.json --target desktop \
  --executable dist-native/fps-framework \
  --artifacts artifacts/prd325-desktop-final-dummy --timeout 60000

pass=true target=desktop runtime=native
positionY 1.8988752365112305 -> 2.3633956909179688
targetsHit 0 -> 1; score=250; shots=1; cameraLagPeak=0
diagnostics consoleErrors=0 networkErrors=0 runtimeDiagnostics=0 runtimeReady=true
setup requested/applied spawn={x:25,y:1.9,z:-4.4} aim={yaw:pi,pitch:0.82}
rendererKind=webgpu adapter=NVIDIA GeForce RTX 2080 backend=Vulkan
```

The fresh web and desktop scenarios passed with setup applied before the authoritative body
transfer. The desktop artifact was rebuilt from the corrected engine bundle. Because this linked
Bayview lane's `public/assets/*.glb` files are symlinks to a measurement fixture, packaging used a
dereferenced temporary asset staging copy with all GLBs serialized using
`gltf-transform copy --vertex-layout separate`; no tracked game asset changed.

## Setup ordering and manager gates

Commit `2e2cff2b` moves the shared core gate before real `Scene.enter()`. Successful `applySetup()`
releases the gate; no-setup `describe()` also releases it, but its returned description waits for
the scene-entered promise so entity-derived `runtime.components` is complete. An apply failure
rejects the held start immediately. Default hold detection accepts both the browser runner global
and native/device `TN_PLAYTEST_ENDPOINT`; explicit `holdUntilAttached` remains authoritative.

The red regression used a real `defineGame()` and `playtest()` bridge. `Scene.load()` registered a
placeholder, `Scene.enter()` copied it into an authoritative body, and before the fix the observed
event list was already `['load', 'enter']` while attachment was still held:

```text
FAIL packages/core/__tests__/playtest.spec.ts
expected [ 'load', 'enter' ] to deeply equal [ 'load' ]
Tests: 1 failed | 15 passed
```

Focused green after the fix:

```text
pnpm exec vitest run packages/core/__tests__/playtest.spec.ts \
  packages/playtest/__tests__/setup-ordering.spec.ts
Test Files 2 passed (2)
Tests 21 passed (21)
```

The core suite records real scene entry for setup and no-setup paths, checks post-entry component
capabilities, checks immediate fail-closed setup rejection, and checks native endpoint auto-hold.
The playtest transport suite separately checks setup-before-describe on web and desktop transports
without treating `describe` itself as scene entry.

The first performance regression was red before the held-loop and renderer-metrics correction: the
minimal template's first performance sample observed 4737 triangles against its 1223-triangle
bound. A fresh run after the correction and the current-main rebase records a maximum of 4737
triangles across 202 samples; the recovery keeps that real per-frame count and pins the template cap
at 4800. The earlier 1175-triangle receipt came from the pre-rebase bundle and is not evidence for
the current engine commit.

The final manager gate sequence is recorded separately after the lifecycle correction:

```text
pnpm typecheck && pnpm lint && pnpm test — pass (330 files / 3311 tests; 1 file / 4 tests skipped)
pnpm budgets — pass (10 packages; 254-entry capability manifest fresh; 8 templates × 7 hosts current)
pnpm test:templates — pass (8 templates; 81 audited scenarios)
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
| 4 | Visibility answer | no new exported caller; sandbox `BoxOccluders` plus `ctx.raycastAll` is measured by `prd259-bayview-current-20260830/playtests/visibility-path-cost.playtest.json` | `BoxOccluders` remains the game-owned answer; no duplicate framework surface | Phase 0 forced 72 real fallbacks: 0.206 ms/tick amortized and 12.4 ms worst five-soldier frame against the 16.3 ms bound |

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
