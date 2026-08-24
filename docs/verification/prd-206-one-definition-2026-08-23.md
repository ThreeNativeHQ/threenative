# PRD-206 — shared behaviours have one definition — 2026-08-23

PRD: `docs/PRDs/batch-2026-08-23-tech-debt/PRD-206-shared-behaviours-have-one-definition.md`
Lane: `lane-206`

## Result

The five duplicated behaviours now have one implementation each:

1. `InputMap` uses one binding-tree helper for held and latched actions.
2. `clientToCanvas` is shared by live picking and replay pointer recording.
3. `isSmallBufferError` is exported by `plugin.ts` and imported by the native host.
4. `NavigationAgent3D.#planTarget` is shared by target issuance and reachability queries;
   finishing uses the same target predicate and tolerance.
5. Physics `sceneExit` and `dispose` delegate to one ordered teardown routine.

## Red first: baseline duplication greps

The pre-change tree showed both copies:

```text
input baseline
238: vector.set(this.#isHeld(...), ...)
295-299: this.#isHeld(...)
407-411: this.#isLatched(...)
425: #isHeld(...)
433: #isLatched(...)

pointer baseline
game.ts:468-472: getBoundingClientRect + position.x/y - rect.left/top
replay.ts:26-29: getBoundingClientRect + point[0]/[1] - rect.left/top

ABI baseline
plugin.ts:94: function isSmallBufferError(...)
native/host.ts:209: function isSmallBufferError(...)

teardown baseline
plugin.ts:289-291: sceneExit area/body disposal
plugin.ts:306-310: dispose area/body disposal

navigation baseline
NavigationAgent3D.ts:184-187 and 257-260: two findClosestPoint chains
NavigationAgent3D.ts:239 and 271: two computePath calls
```

Post-change structural counts:

```text
legacy input helpers: 0
inline pointer subtraction: 0
ABI matcher definitions: 1
teardown registry loops: 2 (one area loop, one body loop)
navigation planner calls: findClosestPoint=2, computePath=1
```

## Phase 1 — input and pointer

Focused command:

```sh
pnpm exec vitest run packages/core/__tests__/input.spec.ts packages/core/__tests__/replay.spec.ts --reporter=dot
```

Result: **PASS — 2 files, 51 tests.** The replay-drives-live proof observed identical canvas
coordinates for one pointer event:

```text
live=[12,24]
recording.input[0].pointer=[12,24]
replay=[12,24]
```

Negative control — reintroduced the latched binding walk inline:

```text
pnpm exec vitest run packages/core/__tests__/input.spec.ts --reporter=dot
FAIL: should define one binding-tree walk for held and latched actions
Tests 1 failed | 31 passed (32)
expected 2 helper call sites, got 1
```

Negative control — reintroduced replay-local client-to-canvas subtraction:

```text
pnpm exec vitest run packages/core/__tests__/replay.spec.ts --reporter=dot
FAIL: should use one client-to-canvas converter for live and replay pointer paths
Tests 1 failed | 18 passed (19)
expected one clientToCanvas( call, got 0
```

Both mutations were reverted immediately.

## Phase 2 — ABI matcher and teardown

Focused command:

```sh
pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts --reporter=dot
```

Result: **PASS — 1 file, 13 tests.** The release comparison registers one body and one area,
runs `sceneExit` or `dispose`, and requires equal body/area release counts, body count, and
simulation disposal count.

Negative control — added a second native-local ABI regex:

```text
pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts --reporter=dot
FAIL: should use one ABI buffer matcher in both adapters
Tests 1 failed | 12 passed (13)
native host no longer contained the shared import and contained function isSmallBufferError
```

Negative control — replaced `sceneExit` delegation with duplicate loops and added a fake body
only to that path:

```text
pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts --reporter=dot
FAIL: should route sceneExit and dispose through one ordered teardown
FAIL: releases the same registered set through sceneExit and dispose
sceneExit result: numBodies=1, simulationDisposeCalls=0
dispose result:   numBodies=0, simulationDisposeCalls=1
Tests 2 failed | 11 passed (13)
```

Both mutations were reverted immediately.

## Phase 3 — navigation

Focused command:

```sh
pnpm exec vitest run packages/physics/__tests__/navigation-agent.spec.ts --reporter=dot
```

Result: **PASS — 1 file, 15 tests.** The disagreement test sweeps target tolerances
`0.05, 0.1, 0.25, 0.5, 1`; each reachable target finishes after the agent moves to the
planned final point.

Negative control — shrank only the finishing tolerance to half the requested tolerance:

```text
pnpm exec vitest run packages/physics/__tests__/navigation-agent.spec.ts --reporter=dot
FAIL: should never report a reachable target that cannot finish across tolerances
tolerance=0.05: expected false to be true
Tests 1 failed | 14 passed (15)
```

The mutation was reverted immediately.

Browser WebGPU scenario command:

```sh
node packages/playtest/dist/runner/cli.js \
  examples/abyss-framework/playtests/navigation.playtest.json \
  --url 'http://127.0.0.1:5180/?navigation' \
  --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5180 --strictPort" \
  --browser-recipe webgpu --headed
```

Result: **PASS.** The scenario observed `targetReachable=true` and then
`navigationFinished=true`, with path length `9.623701493015632`, final target distance
`0.006768826545260287`, and zero console, network, or runtime diagnostics.

Desktop native navigation was **unverified**. The declared command reached the native verifier,
which reported the setup prerequisite exactly:

```text
pnpm native:verify:desktop
Error: packages/runtime-native/build/tn-linux does not exist; run pnpm native:build
```

No `pnpm native:build` was started for this lane; the required native host build was absent.

## Repository gates

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS after `pnpm build` generated local package declarations; all workspace typechecks completed. |
| `pnpm lint` | PASS; Biome reported 290 cognitive-complexity warnings and no errors. |
| `pnpm -r --filter '!@threenative/playtest' --workspace-concurrency=1 --if-present run test` | PASS; all 15 selected workspace projects completed, including native parity. |
| `pnpm exec vitest run` | 197 files passed, 1,891/1,892 tests passed; one unrelated 5-second capability-docs test timed out under the full concurrent load. The file rerun at 15 seconds passed 7/7. |
| `pnpm test` | BLOCKED by the existing playtest orphan-cleanup probe: it found Chromium children after its 5-second timeout and exited 1 before the unit phase. No lane assertion failed. |

The final focused lane suite after all mutation reverts was **PASS — 4 files, 79 tests**.
