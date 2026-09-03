# PRD-317 rock-ridge admission evidence — 2026-09-02

PRD: docs/PRDs/feature-mining/PRD-317-watertight-rock-masses-are-generated-render-source.md

The intake was admitted as generated game source. The upstream repository was
maxliebscher/threejs-procedural-rocks-cliffs at 647839c884456a4d1b6a1a7d520cbce331794538
(MIT). No upstream code or assets were copied. The generated starter owns the scalar field, seed,
bounds, material handoff and quality tiers. The extractor owns only renderer-independent lattice
work and the final-array audit.

## Live path

The three structural columns in scenery.ts remain unchanged. The nine horizon ridge blocks and
four midground spire blocks are gone. The live path is:

    Play.enter → createScenery → createRockRidge → buildImplicitSurface
    → one attached Mesh using the existing ridge material

The preview is attached synchronously. A classic Blob Worker refines the same seed and replaces the
preview only after the final positions and indices pass a second audit.

## Resolved integration ledger

The source PRD is outside this lane and was not edited. Its implementation placeholders resolve to
these non-test callers and checks:

| # | Live implementation | Negative control recorded here |
|---|---|---|
| 1 | `packages/create-threenative/templates/starter/src/render/rockRidge.ts:79-84`, reached by `scenery.ts:35` | independent blocks removed; source and look gates fail |
| 2 | `packages/create-threenative/templates/starter/src/render/rockRidge.ts:14-38`, seeded at `scenery.ts:34-35` | smooth field replaced by box minimum; source gate fails |
| 3 | `packages/create-threenative/templates/starter/src/render/rockRidge.ts:58-60,143-145` | duplicate seam reports `boundaryEdges=4` |
| 4 | `packages/create-threenative/templates/starter/src/render/rockRidge.ts:103-111,113-171` | delayed stale generation remains invisible |
| 5 | `packages/create-threenative/templates/starter/playtests/look.playtest.json:10-120` | restored block caller fails the named ridge assertions |
| 6 | `packages/create-threenative/templates/starter/AGENTS.md:79-82` | deleting the paragraph fails `looks.spec.ts` |
| 7 | `packages/create-threenative/templates/starter/src/render/rockRidge.worker.ts:42-67`, exercised by the web and desktop scenarios | omitted native dispatch leaves `preview`, generation `0`, and the old hashes |

## Fixed-seed topology and determinism

Command:

~~~sh
pnpm exec tsx -e 'import { buildImplicitSurface } from "./packages/create-threenative/templates/starter/src/render/implicitSurface.ts"; import { sampleGraniteField } from "./packages/create-threenative/templates/starter/src/render/rockRidge.ts"; const bounds = { maxX: 54, maxY: 18, maxZ: -42, minX: -54, minY: -24, minZ: -74 } as const; for (const seed of [20260821, 11, 99]) { const result = buildImplicitSurface({ bounds, cellSize: 2.1, latticeCap: 100000, closed: true, protectBoundary: true, sample: (x, y, z) => sampleGraniteField(x, y, z, seed, bounds) }); console.log(JSON.stringify({ seed, ...result.report })); }'
~~~

Raw output:

~~~text
{"seed":20260821,"boundaryEdges":0,"degenerateTriangles":0,"signedVolume":32904.697827332144,"windingConflicts":0,"triangles":15544,"vertices":7774,"buildMs":253,"cellSize":2.1}
{"seed":11,"boundaryEdges":0,"degenerateTriangles":0,"signedVolume":33216.305081505496,"windingConflicts":0,"triangles":15588,"vertices":7796,"buildMs":249,"cellSize":2.1}
{"seed":99,"boundaryEdges":0,"degenerateTriangles":0,"signedVolume":34350.047855920006,"windingConflicts":0,"triangles":16040,"vertices":8022,"buildMs":230,"cellSize":2.1}
~~~

The focused source test also compares the final position and index bytes for the same seed and
requires a changed position byte sequence for a changed seed:

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "build deterministic watertight granite from the live field"
~~~

~~~text
✓ packages/create-threenative/__tests__/looks.spec.ts (16 tests | 15 skipped)
✓ should build deterministic watertight granite from the live field
Test Files 1 passed (1)
Tests 1 passed | 15 skipped (16)
~~~

## Focused green gates

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts
~~~

~~~text
Test Files 1 passed (1)
Tests 16 passed (16)
~~~

The scaffolded starter performance run was first red at the refinement resolution because the
render budget observed 36023 triangles against a 9800 maximum. The game-owned refined tier was
then set to cellSize 8; the final starter run passed all 23 scaffolded scenarios:

~~~sh
TN_TEMPLATE_ONLY=starter pnpm test:templates
~~~

~~~text
starter-look ... pass
play ... pass
starter: scaffolded playtests passed.
~~~

The required starter-only matrix was rerun after the repository test fixture was given an idle
classic Worker double. That double only lets the allocation probe enter the scene; it does not
complete refinement or change the production fail-closed path:

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/template-runtime-cost.spec.ts
~~~

~~~text
Test Files 1 passed (1)
Tests 4 passed (4)
~~~

The complete unit gate then passed:

~~~sh
pnpm typecheck
pnpm lint
pnpm test
~~~

~~~text
typecheck: exit 0
lint: exit 0; Found 509 warnings.
Test Files 326 passed | 1 skipped (327)
Tests 3304 passed | 4 skipped (3308)
~~~

The declared package build command names a package that does not exist in this manifest:

~~~sh
pnpm --filter @threenative/create-threenative build
~~~

~~~text
No projects matched the filters in "/home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901"
~~~

The manifest-correct command passed:

~~~sh
pnpm --filter create-threenative build
~~~

~~~text
ESM Build success
DTS Build success
All good!
~~~

The unfiltered template matrix was attempted twice and remained red in unrelated generic
scenarios while the starter look passed. The first run reported `play` console diagnostics,
`starter-react-restart` console/runtime diagnostics and a screenshot protocol error; the second
reported the same screenshot protocol error after `starter-area-monitoring` diagnostics. The
observed runner errors were:

~~~text
locator.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot
starter-area-monitoring: 3 browser console errors; blank screenshot
~~~

The feature-owned matrix is green and was run separately:

~~~sh
TN_TEMPLATE_ONLY=starter pnpm test:templates
~~~

~~~text
template audit starter: 23 scenarios
starter: scaffolded playtests passed.
~~~

The full unfiltered matrix remains UNVERIFIED because of those unrelated runner/resource failures;
no generic template files were changed.

The remaining declared gates passed:

~~~sh
pnpm budgets
pnpm sync:agents --check
~~~

~~~text
budgets ok: 10 framework packages, 14 example workspaces, 48361/15000 framework LOC, 116529/100000 native runtime LOC
agent docs in sync: 17 CLAUDE.md mirrors
~~~

## Declared negative controls

Each mutation below was applied temporarily, run, and restored before continuing. The output is
the observed red, not a retrospective assertion.

### Protected boundary shell disabled

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "protect a boundary-touching surface"
~~~

~~~text
1 failed | 15 skipped
TN_IMPLICIT_SURFACE_TOPOLOGY_INVALID: TN_IMPLICIT_SURFACE_TOPOLOGY_INVALID: boundary=18, degenerate=0, winding=0.
~~~

### Smooth union replaced by a box-style minimum

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "replace the block horizon"
~~~

~~~text
AssertionError: expected ridge source to contain 'field = smoothMin(field, lobe, 0.22)'
1 failed, 15 skipped
~~~

### Seed input ignored

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "build deterministic watertight granite from the live field"
~~~

~~~text
AssertionError: expected [hash] not to be [same hash]
1 failed, 15 skipped
~~~

### Preview changed to the refined showcase resolution

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "replace the block horizon"
~~~

~~~text
AssertionError: expected ridge source to contain 'cellSize: 10'
1 failed, 15 skipped
~~~

### Independent block ridge restored

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "replace the block horizon"
~~~

~~~text
AssertionError: expected scenery source to contain 'createRockRidge'
1 failed, 15 skipped
~~~

### Duplicate seam vertex supplied to the topology audit

~~~sh
pnpm exec tsx -e 'import { auditImplicitSurface } from "./packages/create-threenative/templates/starter/src/render/implicitSurface.ts"; const positions = new Float32Array([0,0,0,1,0,0,0,1,0,0,0,1,0,0,0]); const indices = new Uint32Array([4,2,1,0,1,3,0,3,2,1,2,3]); const report = auditImplicitSurface(indices, positions); console.log(JSON.stringify(report)); if (report.boundaryEdges !== 0) { console.error("RED: boundary-edge assertion failed"); process.exitCode=1; }'
~~~

~~~text
{"boundaryEdges":4,"degenerateTriangles":0,"signedVolume":0.16666666666666666,"windingConflicts":0,"triangles":4,"vertices":5}
RED: boundary-edge assertion failed
~~~

### Empty-field guard removed

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "protect a boundary-touching surface"
~~~

~~~text
AssertionError: expected [Function] to throw error including 'TN_IMPLICIT_SURFACE_EMPTY' but got 'TN_IMPLICIT_SURFACE_VOLUME_INVALID: signed volume 0 is not non-trivial.'
1 failed, 15 skipped
~~~

### Framework import added to generated extractor

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "replace the block horizon"
~~~

~~~text
AssertionError: expected source not to contain '@threenative/'
1 failed, 15 skipped
~~~

### Stale-generation guard removed

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "keep Preview visible and discard stale Worker generations"
~~~

~~~text
AssertionError: expected 2 to be 1
1 failed, 15 skipped
~~~

### Atomic swap order reversed

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "replace the block horizon"
~~~

~~~text
AssertionError: expected 6106 to be less than 6044
1 failed, 15 skipped
~~~

### Previous geometry disposal removed

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts -t "starter ridge on one classic Worker path"
~~~

~~~text
AssertionError: expected controller source to contain 'previous.geometry.dispose()'
1 failed, 34 skipped
~~~

### Generated authoring paragraph deleted

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "replace the block horizon"
~~~

~~~text
AssertionError: expected AGENTS source to contain 'rockRidge.ts'
1 failed, 15 skipped
~~~

## Repair follow-up — 2026-09-02

This section records the completed repair in the existing lane. The changed layer is the
game-owned starter template render source and its generated playtest/evidence tests; native
source was not changed.

### Review defects closed

- `packages/create-threenative/templates/starter/playtests/look.playtest.json` now sends the
  140-tick `ArrowRight` input at `move-before-refinement`, before the 600-tick
  `refinement-settles` wait. Its real `assert.resources` entry observes `state.odometer` at
  that intermediate label, as well as requiring the final distance.
- `packages/create-threenative/templates/starter/src/render/rockRidge.ts` now authors
  `contactY = -20`, samples the fused field through that band, and uses `minY: -32`. The
  deterministic field remains closed/protected-boundary and the final render source is 198
  lines, below the strict 200-line budget.
- `packages/create-threenative/templates/starter/src/render/scenery.ts` now says that
  `Play.enter` imports and invokes `createScenery`; it no longer says that the live file can be
  deleted. The guidance still identifies the backdrop as game-owned visual source and leaves
  gameplay rules/colliders unchanged.

### Mutation reds, then restoration

Each temporary mutation below was applied with `apply_patch`, tested, and restored with
`apply_patch` before the next check.

#### Movement placed after the long refinement wait

Mutation: reversed the two `look.playtest.json` steps so `refinement-settles` preceded
`move-before-refinement`.

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "should drive look movement before the long refinement wait"
~~~

~~~text
 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901

 ❯ packages/create-threenative/__tests__/looks.spec.ts (18 tests | 1 failed | 17 skipped) 7ms
 × should drive look movement before the long refinement wait 6ms
   AssertionError: expected 0 to be greater than 1
 ❯ packages/create-threenative/__tests__/looks.spec.ts:205:29
 Test Files 1 failed (1)
      Tests 1 failed | 17 skipped (18)
exit_code=1
~~~

#### Intermediate odometer observation removed

Mutation: removed the entire `assert.resources` array from `look.playtest.json`.

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "should drive look movement before the long refinement wait"
~~~

~~~text
 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901

 ❯ packages/create-threenative/__tests__/looks.spec.ts (18 tests | 1 failed | 17 skipped) 9ms
 × should drive look movement before the long refinement wait 8ms
   AssertionError: expected undefined to deeply equal ArrayContaining{…}

- Expected:
ArrayContaining [
  ObjectContaining {
    "atSteps": [
      {
        "label": "move-before-refinement",
        "textIncludes": ".",
      },
    ],
    "id": "state",
    "path": "odometer",
  },
]

+ Received:
undefined

 ❯ packages/create-threenative/__tests__/looks.spec.ts:208:40
 Test Files 1 failed (1)
      Tests 1 failed | 17 skipped (18)
exit_code=1
~~~

#### Ridge contact field and bounds reverted

Mutation: changed both ridge bounds occurrences from `minY: -32` to `minY: -24`, removed
`const contactY = -20`, and restored `const bottom = -22 + ...`.

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "should carry the fused ridge through its authored contact band"
~~~

~~~text
 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901

 ❯ packages/create-threenative/__tests__/looks.spec.ts (18 tests | 1 failed | 17 skipped) 5ms
 × should carry the fused ridge through its authored contact band 4ms
   Error: Rock ridge contact band is not authored in the field.
 ❯ packages/create-threenative/__tests__/looks.spec.ts:173:38
 Test Files 1 failed (1)
      Tests 1 failed | 17 skipped (18)
exit_code=1
~~~

#### Live scenery deletion guidance restored

Mutation: restored `// Generated for you. This is ordinary Three.js — edit or delete it freely.`
and the old `Delete this file and the game plays identically` paragraph.

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "should replace the block horizon with a game-owned Worker refinement"
~~~

~~~text
 RUN  v4.1.10 /home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901

 ❯ packages/create-threenative/__tests__/looks.spec.ts (18 tests | 1 failed | 17 skipped) 12ms
 × should replace the block horizon with a game-owned Worker refinement 11ms
   AssertionError: expected '// Generated for you. This is ordinar…' to contain 'Play.enter imports and invokes create…'
 ❯ packages/create-threenative/__tests__/looks.spec.ts:266:21
 Test Files 1 failed (1)
      Tests 1 failed | 17 skipped (18)
exit_code=1
~~~

#### Generated starter scaffold hash

The first full-suite run exposed the expected-tree hash as the remaining stale generated-tree
record. The recorded value was updated to the hash emitted by the repaired scaffold, then the
full suite was rerun.

~~~sh
pnpm test
~~~

~~~text
 FAIL packages/create-threenative/__tests__/scaffold.spec.ts > create-threenative > keeps every no-install scaffold tree byte-stable against the PRD parent
AssertionError: expected { …(8) } to deeply equal { …(8) }
-   "starter": "e6ebc0b4dc5d09932fac3308f4c810f757cceebbe7c1a168d427dc73cc9914a8",
+   "starter": "162e8f7e5f835e357dbcb26aed953793c1144fdf5b2702f79d70b4d771ea9f38",
Test Files  1 failed | 326 passed (327)
Tests  1 failed | 3308 passed | 1 skipped (3310)
exit_code=1
~~~

### Green verification

Focused template tests after restoring all temporary mutations and the type-only budget cleanup:

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts packages/create-threenative/__tests__/template.spec.ts
~~~

~~~text
✓ packages/create-threenative/__tests__/looks.spec.ts (18 tests) 1274ms
  ✓ deterministic ... 733ms
  ✓ stale ... 401ms
✓ packages/create-threenative/__tests__/template.spec.ts (35 tests) 21323ms
  ✓ scaffold flat agent docs ... 304ms
  ✓ typecheck a pristine scaffold ... 19868ms
  ✓ optional realism ... 1000ms
Test Files 2 passed (2)
Tests 53 passed (53)
Start ... Duration 21.77s ...
exit_code=0
~~~

The deterministic topology/bounds probe used the repaired bounds and three seeds:

~~~sh
pnpm exec tsx -e 'import { buildImplicitSurface } from "./packages/create-threenative/templates/starter/src/render/implicitSurface.ts"; import { sampleGraniteField } from "./packages/create-threenative/templates/starter/src/render/rockRidge.ts"; const bounds = { maxX: 54, maxY: 18, maxZ: -42, minX: -54, minY: -32, minZ: -74 } as const; for (const seed of [20_260_821, 11, 99]) { const result = buildImplicitSurface({ bounds, cellSize: 2.1, latticeCap: 100_000, closed: true, protectBoundary: true, sample: (x, y, z) => sampleGraniteField(x, y, z, seed, bounds) }); console.log(JSON.stringify({ seed, ...result.report })); }'
~~~

~~~text
{"seed":20260821,"boundaryEdges":0,"degenerateTriangles":0,"signedVolume":32943.68643198542,"windingConflicts":0,"triangles":15612,"vertices":7808,"buildMs":272,"cellSize":2.0833333333333335}
{"seed":11,"boundaryEdges":0,"degenerateTriangles":0,"signedVolume":33219.27163651359,"windingConflicts":0,"triangles":15644,"vertices":7824,"buildMs":263,"cellSize":2.0833333333333335}
{"seed":99,"boundaryEdges":0,"degenerateTriangles":0,"signedVolume":34352.54420530801,"windingConflicts":0,"triangles":16048,"vertices":8026,"buildMs":248,"cellSize":2.0833333333333335}
exit_code=0
~~~

Render-source formatting and budget check:

~~~sh
pnpm exec biome format --write packages/create-threenative/__tests__/looks.spec.ts packages/create-threenative/templates/starter/playtests/look.playtest.json packages/create-threenative/templates/starter/src/render/rockRidge.ts packages/create-threenative/templates/starter/src/render/scenery.ts
pnpm exec biome check packages/create-threenative/__tests__/looks.spec.ts packages/create-threenative/templates/starter/playtests/look.playtest.json packages/create-threenative/templates/starter/src/render/rockRidge.ts packages/create-threenative/templates/starter/src/render/scenery.ts
wc -l packages/create-threenative/templates/starter/src/render/rockRidge.ts packages/create-threenative/templates/starter/src/render/scenery.ts
~~~

~~~text
Formatted 4 files in 4ms. Fixed 1 file.
Checked 4 files in 12ms. No fixes applied.
198 packages/create-threenative/templates/starter/src/render/rockRidge.ts
46 packages/create-threenative/templates/starter/src/render/scenery.ts
244 total
exit_code=0
~~~

The first `TN_TEMPLATE_ONLY=starter pnpm test:templates` invocation hit a browser page-closed
navigation diagnostic in the generic `seed` scenario. The identical command was rerun; the
feature-owned scenarios and the complete 23-scenario starter matrix then passed:

~~~sh
TN_TEMPLATE_ONLY=starter pnpm test:templates
~~~

~~~text
template audit starter: 23 scenarios; 23 assume start in play; 0 declare an explicit start.
starter: scaffolded playtests passed.
exit_code=0
~~~

The final required typecheck was:

~~~sh
pnpm typecheck
~~~

~~~text
Scope: 24 of 25 workspace projects
packages/create-threenative typecheck: Done
examples/abyss-framework typecheck: Done
exit_code=0
~~~

The final full repository test was rerun after refreshing the generated starter scaffold hash
in `packages/create-threenative/__tests__/scaffold.spec.ts`:

~~~sh
pnpm test
~~~

~~~text
Test Files  327 passed (327)
Tests  3309 passed | 1 skipped (3310)
suite temporary directory count unchanged in '/tmp/threenative-suite.ySGmA9': 1
exit_code=0
~~~

The final lint run also passed:

~~~sh
pnpm lint
~~~

~~~text
Checked 1649 files in 569ms. No fixes applied. Found 509 warnings.
exit_code=0
~~~

### Real web look capture

The generated starter project was built with `pnpm build`, then the real installed project runner
was invoked from that generated project with the WebGPU recipe:

~~~sh
sh /home/joao/projects/threenative/threenative-engine/.worktrees/feature-mining-317-rock-ridge-20260901/scripts/xvfb.sh node node_modules/@threenative/playtest/dist/runner/cli.js --scenario playtests/look.playtest.json --url http://127.0.0.1:5187 --server-command "pnpm dev --host 127.0.0.1 --port \$PORT --strictPort" --browser-recipe webgpu --headed --project . --artifacts artifacts/prd-317-web-look-repair-generated --timeout 30000 > artifacts/prd-317-web-look-repair-generated/playtest.log 2>&1
~~~

~~~text
playtest_exit=0
"odometer": 4.680037493906315
"id": "resource.state.odometer.atSteps"
"pass": true
"id": "component.scenery.ridge.topology.boundaryEdges"
"pass": true
"pass": true,
"runtime": "web",
"scenario": "starter-look"
~~~

The new capture is at:

`/tmp/threenative-prd-317-repair-rqEV36/starter/artifacts/prd-317-web-look-repair-generated/after.png`

Its companion artifacts are in the same directory. `capture.json` records a 1280×720 WebGPU
capture on the NVIDIA Turing adapter. The inspected `after.png` is nonblank and shows the fused
ridge, player, pickup/crate/flag, and HUD; the `before.png`/`after.png` frame-diff assertion also
passed. The report observed `state.odometer` at `4.680037493906315` at the
`move-before-refinement` label and `4.680988741227935` after settling, with final ridge
`boundaryEdges: 0`.

This is fixed-viewport, authored camera-follow evidence: the scenario uses a 1280×720 viewport
and declares `camera.main` follows `player`. It is one real WebGPU run, not blinded A/B evidence,
and no silhouette-floor metric was run or claimed. No new native visual claim is made here.

## Repair continuation — authored pending observation — 2026-09-02

The previous repair left the implementation uncommitted at `930609e77044619843fe61e9ee5521a0190cd62e`.
This continuation kept the fix in the generated starter/game layer: `look.playtest.json` now has
the labeled one-tick idle `preview-pending` wait with no `allowTrivial`, so a fast Worker cannot
complete before that observation; desktop absence of touch controls is coalesced to zero before
movement can dispatch the Worker; the ridge reports
`state` and `generation` at that label; `scenery.ts` constructs the controller with
`deferRefinement: true`; and `Play.ts` invokes `scenery.rebuild()` once on the first non-zero
movement vector. Native source remains unchanged. The starter README status remains:
`PARTIAL (web + Linux desktop; fixed-camera single-run evidence; blinded A/B/silhouette floor and Android/iOS unverified)`.

### Focused red/green checks

The existing red controls above remain the mutation evidence for the fused field, topology audit,
atomic swap, stale-generation guard and disposal. The repair's focused green source/scaffold check
was:

~~~sh
git diff --check && pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts
~~~

~~~text
✓ packages/create-threenative/__tests__/looks.spec.ts (18 tests) 1284ms
✓ packages/create-threenative/__tests__/scaffold.spec.ts (49 tests) 2708ms
Test Files  2 passed (2)
Tests  67 passed (67)
exit_code=0
~~~

The requested starter-only matrix was also green within the five-minute ceiling:

~~~sh
timeout 300s env TN_TEMPLATE_ONLY=starter pnpm test:templates
~~~

~~~text
template audit starter: 23 scenarios; 23 assume start in play; 0 declare an explicit start.
{"scenarioSummary":{"diagnostics":[],"failed":[],"firstTick":78,"frames":741,"lastTick":850,"pass":true,"scenario":"starter-look"}}
starter: scaffolded playtests passed.
exit_code=0
~~~

### Clean generated starter direct run

A clean starter was generated from freshly packed local packages outside the repository:

~~~sh
timeout 300s pnpm sandbox --genre exploration --name prd-317-rock-ridge --template starter --out /tmp/threenative-prd-317-repair-20260902
~~~

~~~text
Created starter project at /tmp/threenative-prd-317-repair-20260902/prd-317-rock-ridge
sandbox ready (framework arm): /tmp/threenative-prd-317-repair-20260902
framework source readable: 0 lines — dist is types plus bundled js
exit_code=0
~~~

The feature-owned direct runner command preserved the generated project's `$PORT` by passing the
server command in single quotes to the outer shell. It saved the complete JSON report and stderr
separately:

~~~sh
RUN_ROOT=/tmp/threenative-prd-317-repair-20260902
PROJECT_ROOT="$RUN_ROOT/prd-317-rock-ridge"
SCENARIO="$PROJECT_ROOT/playtests/look.playtest.json"
ARTIFACT_ROOT="$PROJECT_ROOT/artifacts/direct-starter-look"
STDOUT_LOG="$RUN_ROOT/direct-starter-look.stdout.json"
STDERR_LOG="$RUN_ROOT/direct-starter-look.stderr.log"
timeout 300s node packages/playtest/dist/runner/cli.js "$SCENARIO" \
  --project "$PROJECT_ROOT" \
  --url http://127.0.0.1:5173 \
  --port 0 \
  --server-command 'pnpm dev --host 127.0.0.1 --port $PORT --strictPort' \
  --browser-recipe webgpu \
  --headed \
  --artifacts "$ARTIFACT_ROOT" \
  >"$STDOUT_LOG" 2>"$STDERR_LOG"
~~~

Raw runner output:

~~~text
direct_runner_exit=0
{"captureLock":{"detail":"no competing runner detected","mode":"none"}}
{"captureDisplay":{"display":":1","screen":"1600x900x24","strategy":"private-xvfb"}}
"pass": true
"scenario": "starter-look"
"runtime": "web"
"url": "http://127.0.0.1:46113"
~~~

The direct report's raw extracted summary was:

~~~text
{
  "pass": true,
  "scenario": "starter-look",
  "target": "web",
  "runtime": "web",
  "frames": 741,
  "beforeTick": 78,
  "afterTick": 853,
  "startup": {"phase":"ready","progress":1,"compileSettled":true,"rule":"sustained-frames"},
  "url": "http://127.0.0.1:46113",
  "diagnostics": [],
  "trivialityOptOutCount": 5,
  "artifactDirectory": "/tmp/threenative-prd-317-repair-20260902/prd-317-rock-ridge/artifacts/direct-starter-look"
}
~~~

The authored labeled component observations were:

~~~text
{"label":"preview-pending","tick":112,"state":"preview","generation":0,"requestedGeneration":1,"boundaryEdges":0,"degenerateTriangles":0,"windingConflicts":0,"signedVolume":24133.163043744265,"triangles":636,"vertices":320,"cellSize":10}
{"label":"move-before-refinement","tick":253,"state":"refined","generation":1,"requestedGeneration":1,"boundaryEdges":0,"degenerateTriangles":0,"windingConflicts":0,"signedVolume":25733.46177012051,"triangles":1028,"vertices":516,"cellSize":8}
{"label":"refinement-settles","tick":853,"state":"refined","generation":1,"requestedGeneration":1,"boundaryEdges":0,"degenerateTriangles":0,"windingConflicts":0,"signedVolume":25733.46177012051,"triangles":1028,"vertices":516,"cellSize":8}
~~~

The two no-`allowTrivial` transition assertions passed with these raw values:

~~~text
component.scenery.ridge.state.value.atSteps: pass=true, preview-pending => "preview"
component.scenery.ridge.generation.value.atSteps: pass=true, preview-pending => 0
component.scenery.ridge.state.value: pass=true, before="preview", after="refined"
component.scenery.ridge.generation.value: pass=true, before=0, after=1
~~~

Capture paths:

~~~text
/tmp/threenative-prd-317-repair-20260902/prd-317-rock-ridge/artifacts/direct-starter-look/before.png
/tmp/threenative-prd-317-repair-20260902/prd-317-rock-ridge/artifacts/direct-starter-look/after.png
/tmp/threenative-prd-317-repair-20260902/prd-317-rock-ridge/artifacts/direct-starter-look/capture.json
/tmp/threenative-prd-317-repair-20260902/prd-317-rock-ridge/artifacts/direct-starter-look/console.json
~~~

`capture.json` reports `rendererKind=webgpu`, `target=web`, viewport `1280×720`, NVIDIA/Turing,
and the Vulkan browser recipe. Both PNGs were inspected; the frames are nonblank and show the
fused ridge, player, pickup, crate, flag and HUD. This is fixed-camera single-run evidence only:
no blinded A/B comparison, silhouette-floor metric, Android run, or iOS run exists, and no native
evidence is claimed for the repaired generated source.

### Continuation final gates

The changed files passed the targeted Biome check:

~~~sh
pnpm exec biome check packages/create-threenative/__tests__/looks.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts packages/create-threenative/templates/starter/playtests/look.playtest.json packages/create-threenative/templates/starter/src/render/rockRidge.ts packages/create-threenative/templates/starter/src/render/scenery.ts packages/create-threenative/templates/starter/src/scenes/Play.ts
~~~

~~~text
Checked 6 files in 23ms. No fixes applied.
exit_code=0
~~~

The full workspace typecheck passed:

~~~sh
pnpm typecheck
~~~

~~~text
Scope: 24 of 25 workspace projects
packages/create-threenative typecheck: Done
examples/abyss-framework typecheck: Done
exit_code=0
~~~

The full lint gate passed with the repository's existing warnings:

~~~sh
pnpm lint
~~~

~~~text
Checked 1649 files in 552ms. No fixes applied. Found 509 warnings.
exit_code=0
~~~

The full test suite passed after the repair:

~~~sh
timeout 300s pnpm test
~~~

~~~text
Test Files  327 passed (327)
Tests  3309 passed | 1 skipped (3310)
suite temporary directory count unchanged in '/tmp/threenative-suite.UnhP9S': 1
exit_code=0
~~~

The smallest valid timing repair is therefore retained: the controller's existing default still
dispatches refinement for direct callers, while only the starter's scenery path opts into a real
preview window and the starter's first movement input starts the already-existing Worker rebuild.
No runner timing or native source was changed.
