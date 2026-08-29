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
restored immediately after the run. The unchanged pre-release assertions then failed:

```sh
set -o pipefail
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js --scenario /tmp/threenative-defense-UTO02b/defense/playtests/pointer-placement.playtest.json --project /tmp/threenative-defense-UTO02b/defense --browser-recipe webgpu --headed --server-command 'pnpm dev --host 127.0.0.1 --port $PORT --strictPort' 2>&1 | rg -n 'pass|touch-held|towers|spent|expected|received|Assertion|failed|error|adapter'
```

Exit code: `1`. At `touch-held`, `spent` and `towers` remained `0`; the final `placed` transition
failed because the held touch transport had been removed. This confirms the pre-placement
highlight assertion depends on the shared `pointers` batch rather than synthetic hover input.

## Green evidence

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm exec vitest run packages/core/__tests__/pointer-events.spec.ts packages/core/__tests__/input.spec.ts` | 0 | 2 files, 47/47 tests passed. |
| `pnpm exec vitest run packages/core/__tests__/pointer-events.spec.ts packages/core/__tests__/input.spec.ts packages/core/__tests__/game.spec.ts packages/core/__tests__/documented-contract.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts` | 0 | 5 files, 125/125 tests passed. |
| `pnpm --filter @threenative/core typecheck` | 0 | Core typecheck passed. |
| `pnpm typecheck` | 0 | 16/17 workspace package checks completed successfully. |
| `pnpm budgets` | 0 | Budget, boundary, capability, and sync checks passed; existing LOC review notices were reported. |
| `pnpm exec biome format --write packages/core/src/input.ts packages/core/src/pointer-events.ts packages/core/__tests__/input.spec.ts packages/core/__tests__/pointer-events.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts` | 0 | Changed TypeScript files formatted. |
| `pnpm exec biome format --write packages/create-threenative/templates/defense/playtests/pointer-placement.playtest.json` | 0 | Changed JSON scenario formatted. |
| `pnpm exec biome check packages/core/src/input.ts packages/core/src/pointer-events.ts packages/core/__tests__/input.spec.ts packages/core/__tests__/pointer-events.spec.ts packages/create-threenative/__tests__/scaffold.spec.ts packages/create-threenative/templates/defense/playtests/pointer-placement.playtest.json` | 0 | No errors; 4 existing cognitive-complexity warnings. |

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
`/tmp/threenative-defense-HhBAnh/defense`.

The pointer-placement capture reported `rendererKind: "webgpu"`, target `web`, and an NVIDIA
Turing adapter in `/tmp/threenative-defense-HhBAnh/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/capture.json`.
The inspected screenshots were:

- `/tmp/threenative-defense-HhBAnh/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/hovered.png`: the target board tile is visibly bright/highlighted while the touch-held observation is asserted.
- `/tmp/threenative-defense-HhBAnh/defense/artifacts/playtest/04-playtests-pointer-placement.playtest.json/after.png`: the board is non-blank, the selected tile contains the placed tower, and the HUD shows `TOWERS 1`.

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
