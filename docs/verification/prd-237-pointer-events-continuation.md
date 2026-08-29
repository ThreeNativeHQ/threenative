# PRD-237 pointer-events continuation verification

Date: 2026-08-28
Base: `b4f335840c8e1f474e5eb2f2e58978b4f5b1b28a`

## Red evidence

### Queued edge coordinates and cancellation

Before the implementation fix, this focused command exited `1`:

```sh
pnpm exec vitest run packages/core/__tests__/pointer-events.spec.ts packages/core/__tests__/input.spec.ts
```

Vitest ran 2 files and 47 tests: 44 passed and 3 failed.

- The input regression expected a `cancel` edge but received `up`.
- The queued-coordinate regression expected `pointerPressed` on object A once but received zero calls.
- The cancellation regression expected no `pointerReleased` callback but received one call.

These failures reproduce the three code-path defects before the fix: cancellation was classified as
release, and a queued edge reused the live pointer's later hit.

### Defense shared-pointers transport control

For the negative control, the final `touch-held` input step in the generated defense scenario was
temporarily changed from its shared `pointers` batch to `pointers: []`; the source scenario was
restored immediately after the run. The unchanged pre-release assertions then failed. This is the
exact clean-copy command and filtered output:

```sh
set -o pipefail
red_output=$(mktemp /tmp/pointer-red-clean.XXXXXX)
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js --scenario /tmp/threenative-defense-9UshKW/defense/playtests/pointer-placement.playtest.json --project /tmp/threenative-defense-9UshKW/defense --browser-recipe webgpu --headed --server-command 'pnpm dev --host 127.0.0.1 --port $PORT --strictPort' >"$red_output" 2>/dev/null
red_status=$?
printf 'output_file=%s\nexit=%s\n' "$red_output" "$red_status"
jq '{pass,diagnostics:[.diagnostics[] | {code,message}],steps:[.observations.componentSeries[] | select(.label=="hover" or .label=="clear-hover" or .label=="touch-held" or .label=="release" or .label=="placed") | {label,hovered:.snapshots["build-preview"].hovered,tile:.snapshots["build-preview"].tile,placedTile:.snapshots["build-preview"].placedTile}],assertions:[.assertionResults[] | select(.id=="resource.state.spent.atSteps" or .id=="resource.state.towers.atSteps" or .id=="component.build-preview.hovered.value.atSteps" or .id=="component.build-preview.tile.value.atSteps" or .id=="component.build-preview.placedTile.value.atSteps") | {id,pass,samples:.details.samples}]}' "$red_output"
test "$red_status" -eq 1
```

Exact output:

```text
output_file=/tmp/pointer-red-clean.Fi0TN1
exit=1
{
  "pass": false,
  "diagnostics": [
    { "code": "TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED", "message": "Resource 'state' path 'spent' did not match the expected labeled-step transition." },
    { "code": "TN_PLAYTEST_RESOURCE_TRANSITION_ASSERTION_FAILED", "message": "Resource 'state' path 'towers' did not match the expected labeled-step transition." },
    { "code": "TN_PLAYTEST_COMPONENT_TRANSITION_ASSERTION_FAILED", "message": "Component 'hovered' on entity 'build-preview' did not match the expected labeled-step transition." },
    { "code": "TN_PLAYTEST_COMPONENT_TRANSITION_ASSERTION_FAILED", "message": "Component 'tile' on entity 'build-preview' did not match the expected labeled-step transition." },
    { "code": "TN_PLAYTEST_COMPONENT_TRANSITION_ASSERTION_FAILED", "message": "Component 'placedTile' on entity 'build-preview' did not match the expected labeled-step transition." }
  ],
  "steps": [
    { "label": "hover", "hovered": true, "tile": "build-tile-2-3", "placedTile": "" },
    { "label": "clear-hover", "hovered": false, "tile": "", "placedTile": "" },
    { "label": "touch-held", "hovered": false, "tile": "", "placedTile": "" },
    { "label": "release", "hovered": false, "tile": "", "placedTile": "" },
    { "label": "placed", "hovered": false, "tile": "", "placedTile": "" }
  ],
  "assertions": [
    {
      "id": "resource.state.spent.atSteps",
      "pass": false,
      "samples": [
        { "expected": { "equals": 0, "label": "hover" }, "pass": true, "value": 0 },
        { "expected": { "equals": 0, "label": "touch-held" }, "pass": true, "value": 0 },
        { "expected": { "equals": 40, "label": "placed" }, "pass": false, "value": 0 }
      ]
    },
    {
      "id": "resource.state.towers.atSteps",
      "pass": false,
      "samples": [
        { "expected": { "equals": 0, "label": "hover" }, "pass": true, "value": 0 },
        { "expected": { "equals": 0, "label": "touch-held" }, "pass": true, "value": 0 },
        { "expected": { "equals": 1, "label": "placed" }, "pass": false, "value": 0 }
      ]
    },
    {
      "id": "component.build-preview.hovered.value.atSteps",
      "pass": false,
      "samples": [
        { "expected": { "equals": true, "label": "hover" }, "pass": true, "value": true },
        { "expected": { "equals": false, "label": "clear-hover" }, "pass": true, "value": false },
        { "expected": { "equals": true, "label": "touch-held" }, "pass": false, "value": false }
      ]
    },
    {
      "id": "component.build-preview.tile.value.atSteps",
      "pass": false,
      "samples": [
        { "expected": { "equals": "build-tile-2-3", "label": "hover" }, "pass": true, "value": "build-tile-2-3" },
        { "expected": { "equals": "build-tile-2-3", "label": "touch-held" }, "pass": false, "value": "" },
        { "expected": { "equals": "build-tile-2-3", "label": "placed" }, "pass": false, "value": "" }
      ]
    },
    {
      "id": "component.build-preview.placedTile.value.atSteps",
      "pass": false,
      "samples": [
        { "expected": { "equals": "build-tile-2-3", "label": "placed" }, "pass": false, "value": "" }
      ]
    }
  ]
}
```

The failed `touch-held` assertion proves the transition is not inherited from mouse hover; the
generated scenario was restored to the shared touch batch before the green run.

## Green evidence

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm exec vitest run packages/core/__tests__/pointer-events.spec.ts packages/core/__tests__/input.spec.ts packages/core/__tests__/game.spec.ts packages/core/__tests__/documented-contract.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts` | 0 | 5 files, 125/125 tests passed. |
| `pnpm typecheck` | 0 | Root typecheck and all 16/17 workspace package checks completed successfully. |
| `pnpm budgets` | 0 | Budget, boundary, capability, and sync checks passed; existing LOC review notices were reported. |
| `pnpm exec biome check packages/create-threenative/__tests__/scaffold.spec.ts packages/create-threenative/templates/defense/playtests/pointer-placement.playtest.json` | 0 | 2 files checked; no fixes or errors. |

The repository-wide gates remain baseline-limited:

- `pnpm lint` exited `1` on unrelated existing complexity diagnostics across examples and
  `packages/assets`; no changed-file diagnostics were reported.
- `pnpm test` exited `1` in the existing `check:docs` phase for broken PRD-228/PRD-232 links:
  `docs/PRDs/done/PRD-228-the-pixel-budget-is-the-engines.md`,
  `docs/PRDs/refactor-2026-08-28/PRD-232-profiling-is-a-component-not-a-smear.md`, and its
  `README.md`.

## Defense WebGPU consumer result

```sh
sh scripts/xvfb.sh pnpm exec tsx scripts/verify-one-template.ts defense
```

Exit code: `0`. All 7 scaffolded defense playtests passed at:
`/tmp/threenative-defense-9UshKW/defense`.

The focused pointer-placement run on the restored generated scenario also exited `0`:

```sh
set -o pipefail
green_output=$(mktemp /tmp/pointer-green-restored.XXXXXX)
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js --scenario /tmp/threenative-defense-9UshKW/defense/playtests/pointer-placement.playtest.json --project /tmp/threenative-defense-9UshKW/defense --browser-recipe webgpu --headed --server-command 'pnpm dev --host 127.0.0.1 --port $PORT --strictPort' >"$green_output" 2>/dev/null
green_status=$?
printf 'output_file=%s\nexit=%s\n' "$green_output" "$green_status"
jq '{pass,diagnostics:[.diagnostics[] | {code,message}],steps:[.observations.componentSeries[] | select(.label=="hover" or .label=="clear-hover" or .label=="touch-held" or .label=="release" or .label=="placed") | {label,hovered:.snapshots["build-preview"].hovered,tile:.snapshots["build-preview"].tile,placedTile:.snapshots["build-preview"].placedTile}],assertions:[.assertionResults[] | {id,pass}]}' "$green_output"
test "$green_status" -eq 0
```

Exact output:

```text
output_file=/tmp/pointer-green-restored.M2Nqq3
exit=0
{
  "pass": true,
  "diagnostics": [],
  "steps": [
    { "label": "hover", "hovered": true, "tile": "build-tile-2-3", "placedTile": "" },
    { "label": "clear-hover", "hovered": false, "tile": "", "placedTile": "" },
    { "label": "touch-held", "hovered": true, "tile": "build-tile-2-3", "placedTile": "" },
    { "label": "release", "hovered": true, "tile": "build-tile-2-3", "placedTile": "build-tile-2-3" },
    { "label": "placed", "hovered": true, "tile": "build-tile-2-3", "placedTile": "build-tile-2-3" }
  ],
  "assertions": [
    { "id": "resource.state.spent.atSteps", "pass": true },
    { "id": "resource.state.towers.atSteps", "pass": true },
    { "id": "component.build-preview.hovered.value.atSteps", "pass": true },
    { "id": "component.build-preview.tile.value.atSteps", "pass": true },
    { "id": "component.build-preview.placedTile.value.atSteps", "pass": true },
    { "id": "diagnostics", "pass": true }
  ]
}
```

The pointer-placement capture reported `rendererKind: "webgpu"`, target `web`, and an NVIDIA
Turing adapter in `/tmp/threenative-defense-9UshKW/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/capture.json`.
The inspected screenshots were:

- `/tmp/threenative-defense-9UshKW/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/hovered.png`: the mouse-hover proof capture; the target board tile is visibly bright and the HUD shows `TOWERS 0`.
- `/tmp/threenative-defense-9UshKW/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/touch-held.png`: the pre-release touch-held proof capture; the same target tile is visibly bright, with no tower placed and `TOWERS 0`.
- `/tmp/threenative-defense-9UshKW/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/after.png`: the post-release capture; the board is non-blank, the HUD shows `TOWERS 1`, and the placement transition reports `build-tile-2-3`.

## Platform limits

```sh
adb devices
```

Exit code: `0`, with no attached devices listed. Android execution is `UNVERIFIED`; no Android
result is claimed and no device playtest was run.

## Commit integrity

```sh
git diff HEAD^ HEAD --check
```

Exit code: `0` for the committed lane.
