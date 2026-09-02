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
