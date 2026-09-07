# PRD-277 Merged Geometry Tint Verification

Date: 2026-09-07
Branch: `astra/prd277-merged-geometry-tint-20260907`
Baseline: `234a1bfdf0df05d0fa216e5b236455ba3a63d443`
PRD: `docs/PRDs/done/useful-defaults/PRD-277-merged-geometry-keeps-its-per-part-tint.md`

## Scope

Layer: engine bug.

Reason: repeated primitive-merge plumbing in generated games had to normalize indexed and
non-indexed buffers, preserve per-part color attributes, and convert `mergeGeometries()` `null`
results into named errors. The helper owns only mechanism. Geometry, matrix placement, color values,
and material choice remain game-owned.

## Current-Main Caller Census

Command:

```sh
git grep -n "mergeGeometries\|BufferGeometryUtils" 234a1bfdf0df05d0fa216e5b236455ba3a63d443 -- packages/create-threenative/templates examples packages/core/src
```

Baseline real callers found:

| Caller | Evidence |
| --- | --- |
| `packages/create-threenative/templates/starter/src/render/hero.ts` | import at line 8, call at line 75, null check at line 87 |
| `packages/create-threenative/templates/action-rpg/src/render/shapes.ts` | import at line 2, call at line 23, null check at line 35 |
| `packages/create-threenative/templates/defense/src/render/shapes.ts` | import at line 12, call at line 76, null check at line 88 |
| `packages/create-threenative/templates/racing/src/render/shapes.ts` | import at line 28, calls at lines 183 and 441 |
| `examples/native-cpu-load-test/src/main.ts` | import at line 1, call at line 448 |

The selected first caller is `packages/create-threenative/templates/starter/src/render/hero.ts`.
It is a generated starter character built from many rounded-box meshes and already carried local
merge normalization code.

## Capability Search

Before the package source change, the engine MCP-backed manifest search found no existing
merge/tint helper. Related hits were `InstancedBatch`, which only batches repeated copies of one
geometry.

After `pnpm capabilities:sync`, `mergeParts` appears in the generated capability manifests and
reference docs.

Evidence:

```text
capability manifest generated: 276 entries and 4 notOwned rows
capability reference: 276 entries -> packages/create-threenative/agent-docs/references/capability-reference.md
```

Post-sync search log: `/tmp/astra-afk-tn-20260907-2205/prd277-capability-postsync-search.log`

## Implementation Map

| File | Purpose |
| --- | --- |
| `packages/core/src/merge-parts.ts` | Adds `mergeParts(parts, { label })` with clone-first flattening, optional all-or-none color, index normalization, attribute stripping, named null-to-throw errors, and recomputed normals |
| `packages/core/src/index.ts` | Exports `mergeParts` and its types with capability manifest tags |
| `docs/architecture/CHARTER.md` | Adds the required Charter capability line for the new core export |
| `packages/create-threenative/templates/starter/src/render/hero.ts` | Replaces local merge boilerplate with an injected merger, keeping render source free of `@threenative/*` imports |
| `packages/create-threenative/templates/starter/src/entities/Player.ts` | Supplies core `mergeParts` to the starter hero caller |

Generated files refreshed by `pnpm capabilities:sync`:

```text
packages/core/capabilities.json
packages/create-threenative/capabilities.json
packages/create-threenative/agent-docs/references/capability-reference.md
```

## TDD Truth

The original Claude session artifact was searched at:

```text
/home/joao/.claude/projects/-home-joao-projects-threenative-threenative-engine--worktrees-astra-prd277-merged-geometry-tint-20260907/bd42986a-50c2-469a-92a8-23fd8b696d76.jsonl
```

No original AC2/AC3/AC4 red output was preserved. The following red evidence is reversible mutation
evidence, not original test-first evidence.

### Mesh Input Mutation

Temporary mutation: changed `placementMatrix()` back to `part.updateMatrix(); return part.matrix;`.

Command:

```sh
set -o pipefail; pnpm exec vitest run packages/core/__tests__/merge-parts.spec.ts -t "should place each part" 2>&1 | tee /tmp/astra-afk-tn-20260907-2205/prd277-no-mutation-mutation-pipefail.log
```

Red:

```text
Test Files  1 failed (1)
Tests  1 failed | 6 skipped (7)
AssertionError: expected ... to deeply equal ...
-   0,
+   10,
packages/core/__tests__/merge-parts.spec.ts:50:34
```

Restored fix: compose a temporary matrix from Mesh position/quaternion/scale when
`matrixAutoUpdate` is true, and use the existing matrix only when auto-update is disabled.

### AC2 Per-Part Color

Temporary mutation: removed `flat.setAttribute("color", new BufferAttribute(painted, 3));`.

Log: `/tmp/astra-afk-tn-20260907-2205/prd277-ac2-mutation.log`

Red:

```text
FAIL ... should keep every part's own colour in the merged geometry (PRD-277 AC2)
TypeError: Cannot read properties of undefined (reading 'itemSize')
Test Files  1 failed (1)
Tests  1 failed | 6 skipped (7)
```

### AC3 Null-To-Throw

Temporary mutation: returned `merged as unknown as BufferGeometry` instead of throwing on `null`.

Log: `/tmp/astra-afk-tn-20260907-2205/prd277-ac3-mutation.log`

Red:

```text
FAIL ... should refuse a merge it cannot normalise, naming the label (PRD-277 AC3)
AssertionError: expected [Function] to throw an error
packages/core/__tests__/merge-parts.spec.ts:97
Test Files  1 failed (1)
Tests  1 failed | 6 skipped (7)
```

### AC4 Mixed Indexed/Non-Indexed

Temporary mutation: skipped de-indexing and passed indexed and non-indexed inputs through as-is.

Log: `/tmp/astra-afk-tn-20260907-2205/prd277-ac4-mutation.log`

Red:

```text
FAIL ... should merge a non-indexed extrusion with an indexed box (PRD-277 AC4)
Error: mergeParts(hull): three.js refused the merge of 2 parts ...
Test Files  1 failed (1)
Tests  1 failed | 6 skipped (7)
```

## Green Evidence

Focused core suite:

```sh
set -o pipefail; pnpm exec vitest run packages/core/__tests__/merge-parts.spec.ts
```

Output:

```text
packages/core/__tests__/merge-parts.spec.ts (7 tests)
Test Files  1 passed (1)
Tests  7 passed (7)
Duration  585ms
```

Log: `/tmp/astra-afk-tn-20260907-2205/prd277-merge-parts-green-r3.log`

Focused core/template/scaffold suite:

```sh
pnpm exec vitest run packages/core/__tests__/merge-parts.spec.ts packages/core/__tests__/build.spec.ts packages/core/__tests__/constraints.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts packages/create-threenative/__tests__/scaffold-mcp.spec.ts packages/create-threenative/__tests__/template.spec.ts packages/create-threenative/__tests__/looks.spec.ts
```

Output:

```text
Test Files  7 passed (7)
Tests  141 passed (141)
Duration  35.74s
```

Log: `/tmp/astra-afk-tn-20260907-2205/prd277-focused-vitest-r3.log`

## Broad Gate Board

| Command | Result | Log |
| --- | --- | --- |
| `pnpm capabilities:check` | Pass; manifest fresh with 276 entries and 4 notOwned rows | `/tmp/astra-afk-tn-20260907-2205/prd277-gate-capabilities-check.log` |
| `pnpm typecheck` | Pass; 28 workspace projects completed their TypeScript checks | `/tmp/astra-afk-tn-20260907-2205/prd277-gate-typecheck.log` |
| `pnpm lint` | Pass on retry; 653 existing Biome warnings, 0 errors | `/tmp/astra-afk-tn-20260907-2205/prd277-gate-lint-r2.log` |
| `pnpm test` | Pass; 403 files passed, 2 skipped; 4,498 tests passed, 7 skipped | `/tmp/astra-afk-tn-20260907-2205/prd277-gate-test-r2.log` |
| `pnpm budgets` | Pass; emitted existing LOC review triggers and native census drift warnings, then `budgets ok` | `/tmp/astra-afk-tn-20260907-2205/prd277-gate-budgets.log` |
| `pnpm build` | Pass; regenerated manifests/reference and built all configured workspaces | `/tmp/astra-afk-tn-20260907-2205/prd277-gate-build.log` |
| `git diff --check` | Pass; no whitespace errors | terminal output, no log file |
| post-move docs lane | Pass; 1,634 links checked, 6 doc-focused files passed, 124 tests passed | `/tmp/astra-afk-tn-20260907-2205/prd277-postmove-docs-lane-r2.log` |

Earlier `pnpm test` failed because the QuickJS native executables were missing from
`packages/runtime-native/build/tn-linux-quickjs`. The fix was a QuickJS CMake configure/build for
the required native test targets; the rerun above passed.

QuickJS prerequisite logs:

```text
/tmp/astra-afk-tn-20260907-2205/prd277-quickjs-configure.log
/tmp/astra-afk-tn-20260907-2205/prd277-quickjs-build.log
```

## Starter Runtime Proof

Command:

```sh
pnpm tsx scripts/verify-one-template.ts starter
```

Result:

```text
23 scenarioSummary rows
starter: scaffolded playtests passed at /tmp/threenative-starter-uTY3lN/starter
```

The scaffolded starter playtests ran with `--browser-recipe webgpu`, no console/runtime/network
diagnostics, and a real NVIDIA WebGPU adapter in the captured reports.

Log: `/tmp/astra-afk-tn-20260907-2205/prd277-fresh-starter-verify-one-template.log`

Failed setup attempts before using the existing verifier:

```text
/tmp/astra-afk-tn-20260907-2205/prd277-fresh-starter-scaffold.log
/tmp/astra-afk-tn-20260907-2205/prd277-fresh-starter-scaffold-r2.log
```

Both failures were proof setup errors, not runtime failures in the change.

## Desktop Native Proof

First attempt:

```sh
pnpm native:verify:desktop
```

Failure:

```text
Error: packages/runtime-native/build/tn-linux does not exist; run pnpm native:build
```

Fix:

```sh
pnpm native:build
```

Result:

```text
[403/403] Linking CXX executable mystral-tools
```

Final proof:

```sh
pnpm native:verify:desktop
```

Result:

```text
Test Files  1 passed (1)
Tests  2 passed (2)
desktop core gate passed: 300 frames, 1280x720, packages/runtime-native/artifacts/desktop-core-2026-09-07.png
desktop physics playtest proof passed: 14 assertions
native contract lane passed: 35 of 35 targets
desktop loading playtest proof passed: 913920 startup loading pixels, 0 settled loading pixels
desktop loading proof artifacts: packages/runtime-native/artifacts/desktop-loading-2026-09-07T23-15-32-580Z
```

Logs:

```text
/tmp/astra-afk-tn-20260907-2205/prd277-native-build.log
/tmp/astra-afk-tn-20260907-2205/prd277-native-verify-desktop-r2.log
```

## AC Map

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 existing caller first | Pass | Baseline caller census found starter `hero.ts`; starter caller converted before any broader caller migration |
| AC2 per-part tint | Pass | `mergeParts` writes a flat `color` attribute only when every part has `color`; mutation log proves the color assertion fails if omitted |
| AC3 no silent null | Pass | `mergeParts` throws named errors for empty lists and `mergeGeometries()` `null`; mutation log proves the throw assertion fails if bypassed |
| AC4 mixed Extrude/Box | Pass | Unit test merges non-indexed `ExtrudeGeometry` with indexed `BoxGeometry`; mutation log proves skipping de-indexing fails |
| AC5 kill-switch LOC | Pass | Selected starter caller reduced `hero.ts` from 98 to 88 lines; `Player.ts` stayed 181 lines; shared core mechanism is 105 lines and serves every generated/user caller |

## LOC Evidence

Command:

```sh
wc -l packages/create-threenative/templates/starter/src/render/hero.ts packages/create-threenative/templates/starter/src/entities/Player.ts packages/core/src/merge-parts.ts
git show 234a1bfdf0df05d0fa216e5b236455ba3a63d443:packages/create-threenative/templates/starter/src/render/hero.ts | wc -l
git show 234a1bfdf0df05d0fa216e5b236455ba3a63d443:packages/create-threenative/templates/starter/src/entities/Player.ts | wc -l
```

Result:

```text
current hero.ts: 88
current Player.ts: 181
current merge-parts.ts: 105
baseline hero.ts: 98
baseline Player.ts: 181
```

`pnpm tsx scripts/count-loc.ts --help` was also run; that script emits the fixed benchmark LOC
report (`platformer template LOC`, `touch controls LOC`, `generated HUD LOC`, `cloth feature LOC`)
and does not accept arbitrary caller paths. The PRD-277 caller-specific LOC evidence therefore uses
direct line counts above.

## Platform Truth

Verified:

| Platform | Proof |
| --- | --- |
| Web | Fresh starter scaffold, 23 WebGPU playtest scenario summaries, no diagnostics |
| Desktop native | `pnpm native:build` followed by `pnpm native:verify:desktop`; 300 desktop frames, native contracts, physics proof, and loading proof passed |

Not claimed:

| Platform | Reason |
| --- | --- |
| Android phone/emulator | Not executed in this lane |
| iOS simulator/device | Not executed in this lane |
