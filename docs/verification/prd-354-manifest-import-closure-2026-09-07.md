# PRD-354 Manifest Import Closure Verification

Date: 2026-09-07
Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/astra-prd354-manifest-import-closure-20260907`
Branch: `astra/prd354-manifest-import-closure-20260907`
Baseline red SHA: `234a1bfdf0df05d0fa216e5b236455ba3a63d443`
Status: PARTIAL, because the manifest acceptance criteria pass but the full workspace `pnpm test`
gate is still blocked in `packages/runtime-native`.

Repair review: `/tmp/astra-afk-tn-20260907-2205/reviews/prd354-sol.json`
Reviewed head: `3c3a825614254abbab45d942b02fe89b19c0f626`
Repair relation: this repair is a separate commit on top of the reviewed head; no second reviewer
was launched.

## Phase 0 Red

Source: `/tmp/astra-afk-tn-20260907-2205/logs/prd354-codex.log`

Same baseline SHA, workspace resolver:

```text
root/workspace resolver problems: 0
```

Same baseline SHA, starter scaffold dependency closure:

```text
sha: 234a1bfdf0df05d0fa216e5b236455ba3a63d443
scaffold: /tmp/prd354-scaffold-red-y6oE9s/game
template: starter
dependency closure packages: @gltf-transform/cli, @tailwindcss/vite, @threenative/assets, @threenative/core, @threenative/physics, @threenative/playtest, @threenative/ui, @types/react, @types/react-dom, @types/three, @vitejs/plugin-react, create-threenative, esbuild, playwright, react, react-dom, react-reconciler, tailwindcss, three, typescript, vite
scaffold-closure resolver problems: 27
createThreeGeometry -> @threenative/raw-unreal (@threenative/raw-unreal)
createThreeObject -> @threenative/raw-unreal (@threenative/raw-unreal)
decompressBulkData -> @threenative/raw-unreal (@threenative/raw-unreal)
decompressCompressedBuffer -> @threenative/raw-unreal (@threenative/raw-unreal)
findBulkDataHeaders -> @threenative/raw-unreal (@threenative/raw-unreal)
findCompressedBufferOffsets -> @threenative/raw-unreal (@threenative/raw-unreal)
findMeshDescriptionOffsets -> @threenative/raw-unreal (@threenative/raw-unreal)
findRawMeshBlobs -> @threenative/raw-unreal (@threenative/raw-unreal)
looksLikeMeshDescription -> @threenative/raw-unreal (@threenative/raw-unreal)
looksLikeMeshDescriptionUe4 -> @threenative/raw-unreal (@threenative/raw-unreal)
parseBulkDataHeader -> @threenative/raw-unreal (@threenative/raw-unreal)
parseCompressedBuffer -> @threenative/raw-unreal (@threenative/raw-unreal)
parseMeshDescription -> @threenative/raw-unreal (@threenative/raw-unreal)
parseMeshDescriptionUe4 -> @threenative/raw-unreal (@threenative/raw-unreal)
parseRawMesh -> @threenative/raw-unreal (@threenative/raw-unreal)
parseUAssetStaticMesh -> @threenative/raw-unreal (@threenative/raw-unreal)
readPackageLayout -> @threenative/raw-unreal (@threenative/raw-unreal)
readPackageSummary -> @threenative/raw-unreal (@threenative/raw-unreal)
resolveBulkDataPayload -> @threenative/raw-unreal (@threenative/raw-unreal)
UAssetError -> @threenative/raw-unreal (@threenative/raw-unreal)
UAssetLoader -> @threenative/raw-unreal (@threenative/raw-unreal)
createThreeGeometry -> @threenative/ueformat (@threenative/ueformat)
createThreeObject -> @threenative/ueformat (@threenative/ueformat)
parseUEModel -> @threenative/ueformat (@threenative/ueformat)
summarizeUEModel -> @threenative/ueformat (@threenative/ueformat)
UEFormatError -> @threenative/ueformat (@threenative/ueformat)
UEFormatLoader -> @threenative/ueformat (@threenative/ueformat)
```

Affected baseline count:

```text
{
  "sha": "234a1bfdf0df05d0fa216e5b236455ba3a63d443",
  "entries": 275,
  "affected": 27,
  "rawUnreal": 21,
  "ueformat": 6,
  "affectedWithRequires": 0
}
```

## Phase 0 Ruling

`@threenative/raw-unreal`: rule (b), manifest `requires`. The exports are public,
game-reachable APIs for loading or inspecting raw Unreal `.uasset` files, but no default scaffolded
game needs the dependency. Reversal condition: if a shipped template starts importing raw Unreal
assets by default, move it to that template's scaffold dependencies; if the API becomes MCP-only,
remove it from the manifest.

`@threenative/ueformat`: rule (b), manifest `requires`. The exports are public, game-reachable APIs
for `.uemodel` parsing/loading, but no default scaffolded game needs the dependency. Reversal
condition: if a shipped template starts importing UEFormat assets by default, move it to that
template's scaffold dependencies; if the API becomes MCP-only, remove it from the manifest.

## Negative Controls

AC2 fabricated unresolved package, from
`/tmp/astra-afk-tn-20260907-2205/logs/ac2-nope-red-close.log`:

```text
CAPABILITY_SCAFFOLD_IMPORT_UNRESOLVED: 1 manifest imports are unusable from scaffolded projects
- all templates: NopeCapability -> @threenative/nope (@threenative/nope); no scaffold dependency closure installs this package and the capability has no @requires install instruction
```

AC4 derived template closure, from
`/tmp/astra-afk-tn-20260907-2205/logs/ac4-ui-red-close.log`:

```text
CAPABILITY_SCAFFOLD_IMPORT_UNRESOLVED: 1 manifest imports are unusable from scaffolded projects
- starter: UiLayer -> @threenative/ui (@threenative/ui); template source imports this package but the generated package.json dependency closure omits it
```

Review repair RED, from
`pnpm exec vitest run scripts/__tests__/capability-manifest.spec.ts scripts/__tests__/budgets.spec.ts`
at reviewed head plus repair tests before the resolver fix:

```text
Test Files  2 failed (2)
Tests  5 failed | 57 passed (62)

scripts/__tests__/capability-manifest.spec.ts:
- fails closed when the templates root is missing: promise resolved instead of rejecting
- fails closed when no template closures are discovered: promise resolved instead of rejecting
- fails closed when a template package manifest is missing: promise resolved instead of rejecting
- fails closed when a template package manifest is unreadable or invalid: raw EISDIR instead of named unreadable error

scripts/__tests__/budgets.spec.ts:
- should reject missing template closures when budgets run: no templates-missing error was present
```

Review repair GREEN:

```text
pnpm exec vitest run scripts/__tests__/capability-manifest.spec.ts scripts/__tests__/budgets.spec.ts
Test Files  2 passed (2)
Tests  62 passed (62)

pnpm exec vitest run scripts/__tests__/capability-manifest.spec.ts scripts/__tests__/budgets.spec.ts scripts/__tests__/generate-capability-reference.spec.ts packages/engine-mcp/__tests__/search.spec.ts
Test Files  4 passed (4)
Tests  111 passed (111)
```

Repair controls added:

```text
scripts/__tests__/budgets.spec.ts:
- enforceBudgets rejects a fabricated NopeCapability import from @threenative/nope.
- enforceBudgets rejects starter importing UiLayer from @threenative/ui after @threenative/ui is removed from starter dependencies.
- The UI control also proves minimal is absent from the failure text.

scripts/__tests__/capability-manifest.spec.ts:
- checkCapabilityScaffoldImports rejects missing templates root, empty templates root, missing template package.json, unreadable template package.json, and invalid template package.json.
```

## Push-Gate Repair

Pre-push RED, from `/tmp/tn-ci-fast.1q8zLs/drift.log` and locally reproduced at clean HEAD
`28610348e299670d9109dd17a1ea10063b855103` in
`/tmp/astra-afk-tn-20260907-2205/logs/prd354-scaffold-hash-red.log`:

```text
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t "keeps every no-install scaffold tree byte-stable against the PRD parent"
Test Files  1 failed (1)
Tests  1 failed | 54 skipped (55)

packages/create-threenative/__tests__/scaffold.spec.ts > create-threenative > keeps every no-install scaffold tree byte-stable against the PRD parent
expected PRD_201_PARENT_SCAFFOLD_HASHES to equal the current scaffold hashes
Received changed for all ten templates: action-rpg, defense, minimal, platformer, puzzle, racing, runner, sailing, shooter, starter.
```

Cause: PRD-354 changes the generated capability manifest and capability reference bytes embedded
in every no-install scaffold by adding `requires` install guidance for raw-unreal and UEFormat
imports. The repair updates only the scaffold hash fixture and its explanatory comment; no template
content changed to chase hashes.

Push-gate GREEN:

```text
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t "keeps every no-install scaffold tree byte-stable against the PRD parent"
Test Files  1 passed (1)
Tests  1 passed | 54 skipped (55)

pnpm capabilities:check
capability manifest fresh: 275 entries and 4 notOwned rows at /home/joao/projects/threenative/threenative-engine/.worktrees/astra-prd354-manifest-import-closure-20260907/packages/create-threenative/capabilities.json
capability scaffold imports: 271 of 271 package-backed entries resolvable or documented across 10 template closures (27 require install instructions, 0 unresolved)

git diff --check
passed

pnpm ci:fast
lint         pass    1s
docs         pass    1s
agents       pass    1s
drift        pass   50s
```

AC8 remains PARTIAL: this push-gate repair proves the branch-attributable scaffold drift without
rerunning native build/CMake/Ninja or the full `pnpm test` chain that is still blocked by the
runtime-native artifact issue recorded below.

## Green

Current affected count:

```text
entries 275
affected 27
raw-unreal 21
ueformat 6
requires 27
nope 0
```

`pnpm capabilities:check`, from
`/tmp/astra-afk-tn-20260907-2205/logs/capabilities-check-close.log`:

```text
capability manifest fresh: 275 entries and 4 notOwned rows at /home/joao/projects/threenative/threenative-engine/.worktrees/astra-prd354-manifest-import-closure-20260907/packages/create-threenative/capabilities.json
capability scaffold imports: 271 of 271 package-backed entries resolvable or documented across 10 template closures (27 require install instructions, 0 unresolved)
```

Generated MCP `engine_capability_detail` for `createThreeObject`, from
`/tmp/astra-afk-tn-20260907-2205/logs/ac5-mcp-detail-close.log`:

```json
{
  "importPath": "@threenative/raw-unreal",
  "package": "@threenative/raw-unreal",
  "requires": [
    "npm i @threenative/raw-unreal"
  ],
  "symbol": "createThreeObject"
}
```

## Acceptance Criteria

AC1: PASS. Same-SHA red pair recorded: workspace resolver `0`, scaffold closure `27`.

AC2: PASS. Fabricated `@threenative/nope` entry fails closed and names `NopeCapability` plus
`@threenative/nope`. Review repair added `enforceBudgets` coverage, so this now exercises the
budgets-bound mechanism instead of only `checkCapabilityScaffoldImports`.

AC3: PASS. Current capability check reports `27 require install instructions, 0 unresolved`; no
suppression list was added.

AC4: PASS. Removing the `@threenative/ui` dependency from a template with a UI source import fails
and names `starter`, `UiLayer`, and `@threenative/ui`. Review repair added `enforceBudgets`
coverage and asserts `minimal` is not named.

AC5: PASS. Generated MCP detail output for `createThreeObject` includes
`npm i @threenative/raw-unreal`.

AC6: PASS. `pnpm capabilities:check` is green; both manifest copies are regenerated from source.

AC7: PASS. Sealed corpus content is untouched:
`git diff --name-only -- docs/benchmark/genres docs/PRDs/agent-leverage/PRD-354-the-manifest-never-names-an-import-a-game-cannot-resolve.md`
returned no paths. Repair note: `docs/benchmark/SCREENSHOT-RETENTION.md` was regenerated because
this verification record changed its generated citation counts.

AC8: PARTIAL. At the repaired diff, `pnpm typecheck` and `pnpm lint` are green, but the exact
required chain `pnpm typecheck && pnpm lint && pnpm test && pnpm budgets` stops at `pnpm test`.
The repair rerun reduced the observed runtime-native failure to two missing QuickJS test binaries.
`pnpm budgets` was then run separately: first it failed on stale generated
`docs/benchmark/SCREENSHOT-RETENTION.md`; after regenerating that file, `pnpm budgets` passed.

## Gates

Focused tests:

```text
pnpm exec vitest run scripts/__tests__/capability-manifest.spec.ts scripts/__tests__/generate-capability-reference.spec.ts packages/engine-mcp/__tests__/search.spec.ts
Test Files  3 passed (3)
Tests  69 passed (69)
Duration  8.86s

repair rerun:
pnpm exec vitest run scripts/__tests__/capability-manifest.spec.ts scripts/__tests__/budgets.spec.ts scripts/__tests__/generate-capability-reference.spec.ts packages/engine-mcp/__tests__/search.spec.ts
Test Files  4 passed (4)
Tests  111 passed (111)
```

Targeted package typechecks:

```text
pnpm --filter @threenative/core --filter create-threenative --filter @threenative/raw-unreal --filter @threenative/ueformat typecheck
packages/core typecheck: Done
packages/raw-unreal typecheck: Done
packages/ueformat typecheck: Done
packages/create-threenative typecheck: Done

pnpm --filter threenative-engine-mcp typecheck
tsc --noEmit
```

Workspace gates:

```text
pnpm typecheck
Scope: 28 of 29 workspace projects
all listed typecheck tasks: Done

pnpm lint
recorded before pnpm test began in /tmp/astra-afk-tn-20260907-2205/logs/full-chain-green.log

pnpm budgets
budgets ok: 11 framework packages, 16 example workspaces, 60842/15000 framework LOC, 135443/100000 native runtime LOC, 108 PRD files, largest template 5666 LOC, no compiled texture manifests found
MCP host configs current: 10 templates x 7 hosts

pnpm build
recorded in /tmp/astra-afk-tn-20260907-2205/logs/build-green.log; 29 workspace build tasks reached Done, including packages/core, packages/create-threenative, packages/engine-mcp, packages/raw-unreal, and packages/ueformat.
```

Remaining full gate:

```text
pnpm typecheck && pnpm lint && pnpm test && pnpm budgets
pnpm typecheck: passed
pnpm lint: passed with existing Biome warnings
pnpm test: failed before pnpm budgets ran

packages/runtime-native test: Test Files 2 failed | 103 passed (105)
packages/runtime-native test: Tests 2 failed | 845 passed | 57 skipped (904)
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @threenative/runtime-native@0.3.0 test

failures:
- tests/rg11b10-renderable.test.mjs:45: missing build/tn-linux-quickjs/threenative-rg11b10-renderable-test
- tests/timestamp-query.test.mjs:49: missing build/tn-linux-quickjs/threenative-timestamp-query-test
```

Separate budgets rerun, because the required chain stopped before budgets:

```text
pnpm budgets
workspace package derivation ok: 11 packages
version pins ok: 11 workspace package versions cross-checked
native shim contract passed
core boundary and scaffold hygiene passed
Template convention applicability and source-call checks passed.
capability package census: 7 walked, 4 allowlisted, 10 public packages with code exports
capability built imports: 271 symbols across 32 import paths verified from built package output (4 generated-source entries skipped)
capability docs: 249 public class/function exports carry complete doc tags
evidence budget: ok
retention index is stale at docs/benchmark/SCREENSHOT-RETENTION.md; regenerate it (do not hand-edit).
```

After regenerating `docs/benchmark/SCREENSHOT-RETENTION.md`:

```text
pnpm budgets
retention index fresh: docs/benchmark/SCREENSHOT-RETENTION.md
budgets ok: 11 framework packages, 16 example workspaces, 60842/15000 framework LOC, 135443/100000 native runtime LOC, 108 PRD files, largest template 5666 LOC, no compiled texture manifests found
threenative-context supersession table in sync with capabilities.json
capability reference in sync with capabilities.json
realism-effects conformance registry: 13 covered exports registered
realism-effects platform matrix: docs/verification/realism-effects-matrix-2026-08-30.json is complete
examples: no superseded constructs across 108 files
template quality: 10 templates ship src/render/quality.ts, read it, and document it; all agree on the fail-closed tier contract (bbb998efac02)
MCP host configs current: 10 templates x 7 hosts

warnings:
native census drift: conformance/ recorded 9,142, measured 9,171
native census drift: tests/ recorded 37,462, measured 37,545
```

Failure location and cause: `packages/runtime-native` tests require working native host/test
binaries. The repair rerun now shows missing `build/tn-linux-quickjs` executables for rg11b10 and
timestamp tests. This PRD does not touch `packages/runtime-native`, and this closure pass was
instructed not to run native build/CMake/Ninja again.

Fix outside this lane: repair or rebuild the native runtime test artifacts, then rerun `pnpm test`.
Native build attempts are preserved only as unrelated environment evidence in:

```text
/tmp/astra-afk-tn-20260907-2205/logs/native-build.log
/tmp/astra-afk-tn-20260907-2205/logs/native-tests-target-tn-linux.log
/tmp/astra-afk-tn-20260907-2205/logs/native-tests-target-tn-linux-quickjs.log
/tmp/astra-afk-tn-20260907-2205/logs/native-tests-target-tn-linux-quickjs-no-ui-overlay.log
/tmp/astra-afk-tn-20260907-2205/logs/native-tests-target-tn-linux-quickjs-no-rust-libs.log
```
