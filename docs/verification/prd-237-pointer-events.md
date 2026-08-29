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

## Repair round 1 — 2026-08-28

This section records the repair for pointer edges between input ticks, the defense touch-batch
scenario, and the generated `ctx.pointer` instructions.

### Red regression observed before the fix

Command:

    pnpm exec vitest run packages/core/__tests__/pointer-events.spec.ts packages/core/__tests__/input.spec.ts packages/core/__tests__/game.spec.ts packages/core/__tests__/documented-contract.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts

Result before the edge latch was added:

    FAIL packages/core/__tests__/pointer-events.spec.ts (12 tests | 1 failed)
    AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
    Test Files 1 failed, 4 passed; Tests 120 passed, 121 total

The pointerdown and pointerup had left `raw.pointers` empty by dispatch time, and the legacy
`raw.pointer` value had no pointer id. The regression test now drives both events through
`InputMap`, publishes the next tick, and asserts exactly one `pointerPressed`,
`pointerReleased`, and `tapped` event with pointer id 7.

### Additional red scenario found during repair

The first run of the rewritten `pointers` touch scenario placed the tower but then failed the
existing `placed` tile assertion. The old hover record (pointer id 0) was retired after the new
touch record (pointer id 1) entered, so its exit callback cleared the preview. Pointer cleanup
now runs before latched-edge dispatch, while edge ids remain protected for the current dispatch.

### Green results

| Check | Result |
| --- | --- |
| focused Vitest command above | PASS — 5 files, 122 tests |
| `pnpm typecheck` | PASS — all workspace typechecks |
| `pnpm budgets` | PASS — all invariant checks; existing LOC review notices only |
| `pnpm sync:agents` | PASS — 16 mirrors, 14 written |
| defense verifier command above | PASS — all 7 generated defense playtests |
| `adb devices` | PASS — probe ran, no devices attached |

The defense pointer scenario now keeps the hover step, presses with the complete held-pointer
set `{ id: 1, buttons: 1, x: 0.31678, y: 0.41783 }` for `holdTicks: 2`, releases with
`pointers: []` and `waitTicks: 1`, and passes the existing placement assertions. The scenario
continues to use the shared browser/Android `pointers` transport; no schema or transport was
added.

### Browser visual evidence

Command:

    sh scripts/xvfb.sh pnpm exec tsx scripts/verify-one-template.ts defense

The final run scaffolded the defense project and passed with an NVIDIA WebGPU adapter. The
captured screenshot was:

    /tmp/threenative-defense-H7gb13/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/hovered.png

That PNG was opened for visual inspection. It was nonblank and showed the defense board with the
build tile highlighted before placement. The pointer placement assertions reported `spent = 40`,
`towers = 1`, and `build-preview.placedTile = build-tile-2-3`, with zero console, network, and
runtime diagnostic errors.

### Android status

Fresh device probe:

    $ adb devices
    List of devices attached

Android execution remains **UNVERIFIED**: no physical device or emulator was attached, so the
defense scenario was not run with `--target android` and no Android pass is claimed.
