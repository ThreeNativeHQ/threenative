# PRD-237 verification — object pointer events

Date: 2026-08-28

Status: Web and unit evidence PASS. Physical Android evidence is unverified because no
device was attached. Repository-wide lint, test, and all-template gates retain unrelated
baseline/environment failures recorded below.

## Verified

| Check | Result |
| --- | --- |
| pnpm install --frozen-lockfile | PASS — repository dependencies bootstrapped |
| pnpm build | PASS — capability manifest regenerated with 152 entries; package builds passed |
| pnpm typecheck | PASS — root and workspace typechecks |
| changed-file Biome check | PASS — 14 files, no errors |
| pnpm exec vitest run | PASS — 241 files, 2,361 tests |
| pnpm budgets | PASS — capability docs complete (58 exports), manifest/reference in sync |
| git diff --check | PASS |
| defense consumer gate | PASS — all 7 generated defense playtests |

The focused pointer unit tests cover hover enter/exit, two touch pointers, zero registered
raycasts, root bubbling from a child mesh, drag capture after leaving the object, drag end
without a tap, and release-off-object tap suppression.

## Web evidence

Command:

    sh scripts/xvfb.sh pnpm exec tsx scripts/verify-one-template.ts defense

Result:

    defense: scaffolded playtests passed at /tmp/threenative-defense-Xa0ZWn/defense

The pointer scenario ran with WebGPU on the NVIDIA adapter and passed these consumer
assertions:

    hover: build-preview.hovered = true
    hover: build-preview.tile = build-tile-2-3
    placed: spent = 40, towers = 1
    placed: build-preview.tile = build-tile-2-3
    placed: build-preview.placedTile = build-tile-2-3
    diagnostics: consoleErrors = 0, networkErrors = 0, runtimeDiagnostics = 0

Screenshot evidence:

    /tmp/threenative-defense-Xa0ZWn/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/hovered.png

## Android evidence

The required device probe found no attached device:

    $ adb devices
    List of devices attached

The runner therefore failed closed before executing the scenario:

    TN_PLAYTEST_RUNNER_FAILED: adb shell rm -f /sdcard/Android/data/com.threenative.defense/files/tn-playtest-request.json failed: adb: no devices/emulators found

No Android pass is claimed.

## Observed red checks required by the integration ledger

Each temporary control was restored before the final green runs.

| Temporary change | Observed red result |
| --- | --- |
| Remove ctx.pointer from the context literal | game.spec.ts and documented-contract.spec.ts failed; core tsc reported Property 'pointer' is missing ... but required in type 'ICtx'. |
| Remove the PointerEvents3D @situation tag | pnpm budgets failed with Capability manifest is stale ... run pnpm build to regenerate it. |
| Remove Defense's pointerEntered registration | pointer placement failed: component.build-preview.hovered.value.atSteps and component.build-preview.tile.value.atSteps were false. |
| Delete packages/core/src/pointer-events.ts | core game/documented-contract suites failed to resolve ./pointer-events.js; the defense verifier failed during core build with Could not resolve "./pointer-events.js". |

## Unrelated gate results

pnpm lint exits 1 on four existing errors outside this change:

    packages/playtest/__tests__/perf.spec.ts — lint/style/noUnusedTemplateLiteral
    packages/runtime-native/src/runtime-scripts/frame-op-stream.js — lint/complexity/useOptionalChain (2)
    packages/runtime-native/tests/timestamp-query.test.mjs — lint/style/useNamingConvention

pnpm test stops in its documentation-link phase on these existing links:

    docs/PRDs/done/PRD-228-the-pixel-budget-is-the-engines.md -> ../verification/runtime-perf-state.md
    docs/PRDs/refactor-2026-08-28/PRD-232-profiling-is-a-component-not-a-smear.md -> ../PRD-228-the-pixel-budget-is-the-engines.md
    docs/PRDs/refactor-2026-08-28/README.md -> ../PRD-228-the-pixel-budget-is-the-engines.md

pnpm test:templates passed action-rpg, defense, minimal, platformer, and racing, then
failed in the existing shooter scenarios because Chromium reported TN_CAPTURE_BLANK for
input-look-right.png and after.png. Defense passed independently and in that run.
