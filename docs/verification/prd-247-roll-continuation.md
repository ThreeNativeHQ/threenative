# PRD-247 verification — billboard roll continuation

Date: 2026-08-28

Status: PASS for the scoped web and unit-test gates below. The repository-wide lint
and test commands remain blocked by pre-existing out-of-scope findings. Native
execution is explicitly unverified because no native target was run.

The engine layer owns the camera-relative billboard basis in
`packages/core/src/billboard.ts`. The shooter template is the consumer layer: its
nameplate observer now checks both facing normal and camera-relative up.

## Acceptance evidence

- An unrestricted perspective billboard keeps world `+Z` pointed at the camera and
  world `+Y` aligned with the camera's screen-up vector projected onto the billboard
  plane, including through a rotated parent.
- The existing orthographic and axis-locked contracts remain green. Axis-locked
  billboards retain their normal-only orientation contract.
- The generated shooter observes both basis vectors and passes the WebGPU playtest
  with readable nameplates and a nonblank capture.

## Required red controls

The focused tests were added before restoring the implementation. Both commands were
run against the temporarily defective normal-only implementation and failed as
required.

### `rolled-camera-billboard`

Command:

```text
pnpm exec vitest run packages/core/__tests__/billboard.spec.ts -t 'keeps camera-relative up'
```

Observed red output:

```text
RUN v4.1.10 ...
❯ packages/core/__tests__/billboard.spec.ts (6 tests | 1 failed | 5 skipped)
× Billboard3D > keeps camera-relative up when the camera rolls
AssertionError: expected 0.8266624239276917 to be close to +0
Test Files 1 failed (1)
Tests 1 failed | 5 skipped (6)
exit: 1
```

This is the expected rolled-camera up mismatch after removing the camera-relative
up basis.

### `shooter-roll-observer`

Command:

```text
pnpm exec vitest run packages/create-threenative/__tests__/shooter-per-item.spec.ts -t 'camera-relative up'
```

Observed red output:

```text
RUN v4.1.10 ...
❯ packages/create-threenative/__tests__/shooter-per-item.spec.ts (4 tests | 1 failed | 3 skipped)
× shooter per-item consumers > observes camera-relative up
AssertionError: expected source to contain "camera.getWorldQuaternion(billboardCameraQuaternion);"
Test Files 1 failed (1)
Tests 1 failed | 3 skipped (4)
exit: 1
```

This is the expected failure when the shooter consumer has no camera-relative-up
observation.

## Restored implementation: focused green evidence

```text
pnpm exec vitest run packages/core/__tests__/billboard.spec.ts -t 'keeps camera-relative up'
✓ 1 passed, 5 skipped
exit: 0

pnpm exec vitest run packages/create-threenative/__tests__/shooter-per-item.spec.ts -t 'camera-relative up'
✓ 1 passed, 3 skipped
exit: 0

pnpm exec vitest run packages/core/__tests__/billboard.spec.ts
✓ 6 passed
exit: 0

pnpm exec vitest run packages/create-threenative/__tests__/shooter-per-item.spec.ts
✓ 4 passed
exit: 0
```

The four existing billboard tests cover rotated-parent perspective, orthographic
position independence, overhead perspective, and the `y` axis lock. The new rolled
camera test covers the full basis.

## Repository gates

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS — all workspace projects typechecked after the required `pnpm build` bootstrap |
| `pnpm budgets` | PASS — all hard invariants passed; the existing LOC review triggers were reported but non-fatal |
| changed-file Biome | PASS — all four changed TypeScript files checked with no fixes |
| `git diff --check` | PASS before commit |
| `pnpm lint` | BLOCKED — 4 repository-wide complexity errors in unrelated examples/assets files; the changed files pass Biome |
| `pnpm test` | BLOCKED — the existing documentation-link check fails on three unrelated PRD links before package tests run |

The exact changed-file formatter command was:

```text
pnpm exec biome check packages/core/src/billboard.ts packages/core/__tests__/billboard.spec.ts packages/create-threenative/templates/shooter/src/scenes/Play.ts packages/create-threenative/__tests__/shooter-per-item.spec.ts
Checked 4 files in 16ms. No fixes applied.
exit: 0
```

The repository-wide failures were recorded without editing out-of-scope files:

```text
pnpm lint
Found 4 errors. Found 447 warnings.
exit: 1

pnpm test
Broken documentation links:
docs/PRDs/done/PRD-228-the-pixel-budget-is-the-engines.md -> ../verification/runtime-perf-state.md
docs/PRDs/refactor-2026-08-28/PRD-232-profiling-is-a-component-not-a-smear.md -> ../PRD-228-the-pixel-budget-is-the-engines.md
docs/PRDs/refactor-2026-08-28/README.md -> ../PRD-228-the-pixel-budget-is-the-engines.md
exit: 1
```

These failures are outside the five-file lane scope and do not identify the billboard
or shooter changes.

## Generated shooter WebGPU playtest

The generated project was built with `pnpm build`, then the real per-item scenario
was run with the WebGPU browser recipe:

```text
node packages/playtest/dist/runner/cli.js /home/joao/.cache/tn-prd247-roll-continuation-db6pmG/shooter/playtests/per-item.playtest.json --project /home/joao/.cache/tn-prd247-roll-continuation-db6pmG/shooter --url http://127.0.0.1:5197 --artifacts /home/joao/.cache/tn-prd247-roll-continuation-db6pmG/per-item-final-green --browser-recipe webgpu --headed --server-command 'pnpm dev --host 127.0.0.1 --port 5197 --strictPort'
```

Result:

```text
scenario: per-item-mechanisms
target: web
rendererKind: webgpu
adapter: nvidia / turing
diagnostics: []
assertionResults: 10 passed
pass: true
exit: 0
```

The playtest observed `nameplateFacingCamera = 1`, camera movement, the hit signal,
pickup-frame changes, and player visibility. The capture was nonblank and contained
readable target nameplates.

Before and after captures were opened and inspected at the same 1280×720 viewport:

- Before: `/home/joao/.cache/tn-prd247-repair-trash-20260828/tn-prd247-shooter-w5dhIu/per-item-final-green/after.png`
- After: `/home/joao/.cache/tn-prd247-roll-continuation-db6pmG/per-item-final-green/after.png`

Both showed the bright target nameplates and HUD over the arena; no visual regression
was observed.

## Native status

No native target was executed. Generated-project setup reported that no prebuilt
`v0.3.0` native release was published for `linux-x64` and continued without the
native runtime. Native conformance is therefore unverified, not claimed as passing.
