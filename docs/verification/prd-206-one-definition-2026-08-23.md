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

The browser probe exposes one authored `targetDesiredDistance` value (`0.5`), so the tolerance
sweep remains unit-only and is **unverified in the browser**. Adding a sweep input to this probe
was outside the repair scope.

## Repair round 1 — teardown registry coverage

The teardown proof now derives registry names from the private `teardownRegistries` registration
surface and requires every name to appear in `releaseRegistries()`. The runtime disposal order
for areas and bodies is unchanged; all six clearable registries are now named through that same
surface.

Negative control — added `scratchRegistry` to `teardownRegistries` without adding it to
`releaseRegistries()`:

```text
pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts --reporter=dot
FAIL: should route sceneExit and dispose through one ordered teardown
expected cleared registry names to include scratchRegistry
Tests 1 failed | 12 passed (13)
```

The mutation was reverted immediately. Restored focused proof:

```text
pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts --reporter=dot
PASS — 1 file, 13 tests.
```

Repair verification:

```text
pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts packages/physics/__tests__/navigation-agent.spec.ts --reporter=dot
PASS — 2 files, 28 tests.

pnpm --filter @threenative/physics typecheck
PASS

pnpm exec biome check packages/physics/src/plugin.ts packages/physics/__tests__/plugin.spec.ts
PASS — 2 pre-existing cognitive-complexity warnings, no errors.

node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/navigation.playtest.json --url 'http://127.0.0.1:5180/?navigation' --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5180 --strictPort" --browser-recipe webgpu --headed
PASS — targetReachable=true, navigationFinished=true, pathLength=9.623701493015632,
final target distance=0.006768826545260287, zero console/network/runtime errors.
```

## Repository gates

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS; all workspace typechecks completed, including the example probe URL input. |
| `pnpm lint` | PASS; Biome reported 290 existing cognitive-complexity warnings and no errors. |
| `pnpm -r --filter '!@threenative/playtest' --workspace-concurrency=1 --if-present run test` | PASS; all 15 selected workspace projects completed, including native parity. |
| `pnpm exec vitest run` | 197 files passed, 1,891/1,892 tests passed; one unrelated 5-second capability-docs test timed out under the full concurrent load. The file rerun at 15 seconds passed 7/7. |
| `pnpm test` | PASS; 198 files and 1,893 tests passed, including the playtest orphan-cleanup guard and native parity. |

The final focused lane suite after all mutation reverts was **PASS — 4 files, 80 tests**.

## Repair round 2 — planner path and structural teardown coverage

The navigation planner now uses `result.path.at(-1)` for both same-polygon and cross-polygon
targets. An empty or mismatched planner path therefore cannot report reachable while movement
rejects that path; the target tolerance remains the only reachability parameter.

Negative control — added same-polygon planner results with an empty path and with a path ending
away from the target, across tolerances `0.05, 0.1, 0.25, 0.5, 1`:

```text
pnpm exec vitest run packages/physics/__tests__/navigation-agent.spec.ts --reporter=dot
FAIL: should reject same-polygon empty or mismatched planner paths across tolerances
empty path tolerance=0.05: expected true to be false
Tests 1 failed | 15 passed (16)
```

The planner-path fix was then restored and the new test passed.

The teardown structural proof now scans the lifecycle registry declaration block for every
declared `new Map`/`new Set` and requires each name in the shared `releaseRegistries()` clear
routine. It no longer derives its expected set from the manually maintained
`teardownRegistries` object.

Negative control — declared `scratchRegistry` beside the teardown-owned registries without adding
it to the shared teardown routine:

```text
pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts --reporter=dot
FAIL: should route sceneExit and dispose through one ordered teardown
expected [ 'areaMembershipBuffers', …(5) ] to include 'scratchRegistry'
Tests 1 failed | 12 passed (13)
```

The scratch registry was reverted immediately.

Restored focused proof:

```text
pnpm exec vitest run packages/physics/__tests__/plugin.spec.ts packages/physics/__tests__/navigation-agent.spec.ts --reporter=dot
PASS — 2 files, 29 tests.

pnpm exec vitest run packages/core/__tests__/input.spec.ts packages/core/__tests__/replay.spec.ts packages/physics/__tests__/plugin.spec.ts packages/physics/__tests__/navigation-agent.spec.ts --reporter=dot
PASS — 4 files, 80 tests.
```

The browser probe accepts `targetDesiredDistance` through its navigation URL and reports the
applied value. The reachable ⇒ finishes playtest passed on browser WebGPU for every value in the
tolerance sweep `0.05, 0.1, 0.25, 0.5, 1`; each run observed `targetReachable=true` and then
`navigationFinished=true`, with zero console, network, or runtime errors. The command was:

```sh
for tolerance in 0.05 0.1 0.25 0.5 1; do
  node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/navigation.playtest.json \
    --url "http://127.0.0.1:5180/?navigation&targetDesiredDistance=$tolerance" \
    --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5180 --strictPort" \
    --browser-recipe webgpu --headed
done
```
