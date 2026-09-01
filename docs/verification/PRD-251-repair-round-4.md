# PRD-251 repair round 4 verification

Date: 2026-08-31

Baseline SHA: `b1d4f44419388f0ed3eeace21f1a2e7954b79ce8`

Branch: `linchpin/lane-251-r4-20260831`

Scope: resident-byte accounting, topology/render identity, temporal LOD evidence, and the
quality-record capture statement. The source PRD and the blocked worktree remain untouched.

## Red probes before implementation

The focused regressions were added against the clean baseline and run before changing the
implementation. Each failure names the defect it protects.

### 1. Retained topology bytes were absent from the cap

```text
Command: pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 1
Failure: TerrainTiles > counts retained topology storage against the hard byte cap
AssertionError: expected [Function] to throw an error
Location: packages/core/__tests__/world-terrain-tiles.spec.ts:37:48
Tests: 12 total, 3 failed, 9 passed
```

### 2. Topology and resident tiles used separate sampler output

```text
Command: pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 1
Failure: TerrainTiles > uses the topology field's stored samples for resident tile rendering and collision
AssertionError: expected 153 to be 72 // Object.is equality
Location: packages/core/__tests__/world-terrain-tiles.spec.ts:70:43
Tests: 12 total, 3 failed, 9 passed
```

The regression uses a sampler whose result changes on every call. The topology field receives
sample `72` at the compared coordinate while the independently generated resident tile receives
sample `153`.

### 3. LOD evidence measured an instant swap, not a temporal transition

```text
Command: pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 1
Failure: TerrainTiles > keeps both LOD surfaces visible for a measurable multi-frame transition
AssertionError: expected 1 to be 2 // Object.is equality
Location: packages/core/__tests__/world-terrain-tiles.spec.ts:95:23
Tests: 12 total, 3 failed, 9 passed
```

The failed first observation is the visible-child count immediately after the LOD change: the
baseline implementation has already hidden the previous level.

### 4. Quality evidence claimed inspection after `--no-screenshots`

```text
Command: pnpm exec vitest run scripts/__tests__/primary-docs.spec.ts
Exit: 1
Failure: primary documentation agrees with the shipped surfaces > should not call a no-screenshot run visually inspected
AssertionError: expected '# PRD-251 quality comparison\n\nDate:…' to contain 'No screenshot was captured'
Location: scripts/__tests__/primary-docs.spec.ts:264:21
Tests: 6 total, 1 failed, 5 passed
```

The direct contradiction probe independently returned:

```text
Command: node -e "const fs=require('fs'); const s=fs.readFileSync('docs/verification/PRD-251-quality.md','utf8'); const bad=/inspected|visual inspection|capture.*(?:produced|at)/iu.test(s) && /--no-screenshots/u.test(s); console.log(JSON.stringify({contradiction:bad, hasNoScreenshots:/--no-screenshots/u.test(s), hasInspected:/inspected/iu.test(s)})); process.exitCode=bad?1:0"
Exit: 1
Output: {"contradiction":true,"hasNoScreenshots":true,"hasInspected":true}
```

The first combined attempt also exposed an unbuilt workspace prerequisite (`@threenative/assets`
had no `dist/` entry); after the package build, the documentation regression reached its intended
assertion and produced the red result above.

## Evidence classification

No browser, native desktop, Android, iOS, Pixel 8, or screenshot run is claimed by this record.

## Green repair regressions

The focused repairs pass after implementation:

```text
Command: pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts
Exit: 0
Tests: 12 passed (12)

Command: pnpm exec vitest run packages/playtest/__tests__/world-gameplay.spec.ts scripts/__tests__/primary-docs.spec.ts
Exit: 0
Tests: 13 passed (13)

Command: pnpm exec vitest run packages/core/__tests__/world-terrain-tiles.spec.ts packages/playtest/__tests__/world-gameplay.spec.ts scripts/__tests__/primary-docs.spec.ts
Exit: 0
Test Files: 3 passed (3)
Tests: 25 passed (25)
```

The three core regressions now prove, respectively, that the retained topology allocation makes a
too-small byte cap throw, topology samples equal the resident render/collider field samples, and
an LOD change remains observable for three `process()` frames. The playtest evaluator regression
rejects resident and peak bytes above the declared cap. The documentation regression requires the
actual `--no-screenshots`/`captureMethod: page.screenshot` distinction and rejects the old
`inspected` claim.

## Integration and gate results

The real-input terrain scenario was executed with the same ArrowRight hold traversal:

```text
Command: sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/terrain.playtest.json --url http://127.0.0.1:5182/?terrain --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5182 --strictPort" --browser-recipe webgpu --headed --no-screenshots
Exit: 1
```

The run's repair assertions passed: resident bytes `19,985,992 <= 20,000,000`, resident tiles
`9 <= 9`, `topologyBytes` `16,810,000`, `maxLodTransitionFrames` reached `3`, LOD transitions
changed, visibility passed, and movement/path-length/axis assertions passed. The scenario still
fails closed on the existing `power-spectrum-slope`, `median-64m-relief`, and
`horton-strahler-order` topology floors. This is not claimed as a terrain quality pass, native
run, or visual inspection.

Final checks:

```text
pnpm --filter @threenative/playtest build                 Exit 0
pnpm --filter threenative-engine-mcp build                Exit 0
pnpm --filter @threenative/core build                     Exit 0
pnpm --filter @threenative/physics build                  Exit 0
pnpm --filter @threenative/ui build                       Exit 0
pnpm typecheck                                            Exit 0
pnpm lint                                                 Exit 0; 499 existing complexity warnings
pnpm exec biome check <7 changed TypeScript files>         Exit 0; 3 existing warnings
pnpm test:playtest                                        Exit 0; all five configured scenarios passed
pnpm check:docs                                           Exit 0; 1,192 links across 846 Markdown files
pnpm quality                                              Exit 0; 99 advisory findings
pnpm budgets                                              Exit 1; stale native census, 8,043 measured vs 8,030 recorded (tolerance 5)
git diff --check                                          Exit 0
```

The repository-wide `pnpm test` reached the package tests but exited `1` in
`@threenative/runtime-native`: 626 tests passed, 39 skipped, and six tests require unbuilt
`tn-linux`/`tn-linux-quickjs` C++ executables (`crash-handler-policy`, `rg11b10-renderable`, and
`timestamp-query`). The first attempt also stopped at the playtest orphan-cleanup check after a
headed run; the owned test processes were terminated and the rerun reached the native failures.
No unrelated baseline was regenerated for either gate result.
