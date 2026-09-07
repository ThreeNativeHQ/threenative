# PRD-354 Manifest Import Closure Verification

Date: 2026-09-07
Worktree: `/home/joao/projects/threenative/threenative-engine/.worktrees/astra-prd354-manifest-import-closure-20260907`
Branch: `astra/prd354-manifest-import-closure-20260907`
Baseline red SHA: `234a1bfdf0df05d0fa216e5b236455ba3a63d443`
Status: PARTIAL, because the manifest acceptance criteria pass but the full workspace `pnpm test`
gate is still blocked in `packages/runtime-native`.

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
`@threenative/nope`.

AC3: PASS. Current capability check reports `27 require install instructions, 0 unresolved`; no
suppression list was added.

AC4: PASS. Removing the `@threenative/ui` dependency from a template with a UI source import fails
and names `starter`, `UiLayer`, and `@threenative/ui`.

AC5: PASS. Generated MCP detail output for `createThreeObject` includes
`npm i @threenative/raw-unreal`.

AC6: PASS. `pnpm capabilities:check` is green; both manifest copies are regenerated from source.

AC7: PASS. `git diff --name-only -- docs/benchmark docs/PRDs/agent-leverage/PRD-354-the-manifest-never-names-an-import-a-game-cannot-resolve.md`
returned no paths.

AC8: PARTIAL. `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm budgets` are green, but
`pnpm test` fails in `packages/runtime-native` on unrelated native host/test-binary requirements.

## Gates

Focused tests:

```text
pnpm exec vitest run scripts/__tests__/capability-manifest.spec.ts scripts/__tests__/generate-capability-reference.spec.ts packages/engine-mcp/__tests__/search.spec.ts
Test Files  3 passed (3)
Tests  69 passed (69)
Duration  8.86s
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
pnpm test
packages/runtime-native test: Test Files 5 failed | 100 passed (105)
packages/runtime-native test: Tests 18 failed | 824 passed | 62 skipped (904)
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @threenative/runtime-native@0.3.0 test
```

Failure location and cause: `packages/runtime-native` tests require working native host/test
binaries or endpoint output files. The log shows missing `build/tn-linux` and `build/tn-linux-quickjs`
executables for rg11b10, scheduler, Canvas2D, crash-handler, and timestamp tests, plus pump endpoint
round trips that produced no response file. This PRD does not touch `packages/runtime-native`.

Fix outside this lane: repair or rebuild the native runtime test artifacts, then rerun `pnpm test`.
Native build attempts are preserved only as unrelated environment evidence in:

```text
/tmp/astra-afk-tn-20260907-2205/logs/native-build.log
/tmp/astra-afk-tn-20260907-2205/logs/native-tests-target-tn-linux.log
/tmp/astra-afk-tn-20260907-2205/logs/native-tests-target-tn-linux-quickjs.log
/tmp/astra-afk-tn-20260907-2205/logs/native-tests-target-tn-linux-quickjs-no-ui-overlay.log
/tmp/astra-afk-tn-20260907-2205/logs/native-tests-target-tn-linux-quickjs-no-rust-libs.log
```
