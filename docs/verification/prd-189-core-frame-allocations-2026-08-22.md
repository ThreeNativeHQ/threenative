# PRD-189 core ordinary-frame allocation verification

Date: 2026-08-22
Lane: lane-189

## Focused red-green run

Command:

```sh
pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/input.spec.ts packages/core/__tests__/state.spec.ts packages/core/__tests__/loop.spec.ts packages/core/__tests__/game.spec.ts
```

Before the implementation, the focused run was red: 6 failed and 74 passed. The failures covered vector identity, state identity, the direct gamepad scan, the stable rAF callback, and the disabled render return. After implementation and restoration of every control below, the same command passed:

```text
Test Files  4 passed (4)
Tests       80 passed (80)
```

## Declared negative controls

Each mutation was made temporarily, run with the focused test below, then restored before continuing. Every mutation produced the expected red result.

| Reuse under test | Temporary control | Command and observed red |
| --- | --- | --- |
| Stable action vector | Replace the cached vector block in `packages/core/src/input.ts` with `const vector = new Vector2()` | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/input.spec.ts -t "should reuse one vector when the same action is sampled"` — failed at `input.spec.ts:29`: `expected Vector2... to be ...` |
| Mutable immediate state snapshot | Replace the stable `current` object and `Object.assign` with `let current` and `current = {...current,...next}` in `packages/core/src/state.ts` | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/state.spec.ts -t "should keep the immediate snapshot identity stable across pre-flush writes"` — failed at `state.spec.ts:58`: `expected {score:600} to be {score:0}` |
| Allocation-free disabled render return | Change the disabled metrics branch in `packages/core/src/game.ts` to `return {}` | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/game.spec.ts -t "returns no render metrics object while diagnostics are disabled"` — source assertion failed because the branch no longer returned `undefined` |
| Stable rAF callback | Inline `(time) => this.#frame(time)` in `FixedStepLoop.start()` in `packages/core/src/loop.ts` | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/loop.spec.ts -t "should reuse one request-frame callback across 120 frames"` — failed because the callback `Set` size was `2`, not `1` |
| Direct gamepad scan | Restore `this.#source().find((item) => item !== null)` in `InputMap.tick()` | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/input.spec.ts -t "should scan the gamepad source without a per-tick find predicate"` — source assertion failed because `.find(` was present |

After restoring each implementation, the corresponding focused test passed; the final focused run was 80/80 green.

## 10,000-frame Node allocation probe

Command:

```sh
NODE_OPTIONS=--expose-gc node --import tsx/esm --input-type=module -e 'import { PerformanceObserver } from "node:perf_hooks"; import { InputMap } from "./packages/core/src/input.ts"; import { FixedStepLoop } from "./packages/core/src/loop.ts"; import { createGameStore } from "./packages/core/src/state.ts"; const target = new EventTarget(); const gamepads = []; const input = new InputMap(undefined, target, target, () => gamepads); const store = createGameStore({ frame: 0 }); let updates = 0; const loop = new FixedStepLoop({ onUpdate: () => { input.tick(); input.vector("move"); updates += 1; store.set({ frame: updates }); }, onRender: () => undefined }); let gcEvents = 0; const observer = new PerformanceObserver((list) => { gcEvents += list.getEntries().length; }); observer.observe({ entryTypes: ["gc"] }); const nextTurn = () => new Promise((resolve) => setImmediate(resolve)); global.gc(); await nextTurn(); gcEvents = 0; const before = { heapUsed: process.memoryUsage().heapUsed, gcEvents }; loop.stepFrame(0); for (let frame = 1; frame <= 10000; frame += 1) loop.stepFrame(frame * (1000 / 60)); const during = gcEvents; store.flush(); await nextTurn(); global.gc(); await nextTurn(); const after = { heapUsed: process.memoryUsage().heapUsed, gcEvents }; observer.disconnect(); input.dispose(); store.stop(); console.log(JSON.stringify({ frames: 10000, updates, before, duringGcEvents: during, after }));'
```

Observed output:

```json
{"frames":10000,"updates":10000,"before":{"heapUsed":10126608,"gcEvents":0},"duringGcEvents":0,"after":{"heapUsed":10473808,"gcEvents":2}}
```

The loop performed 10,000 updates and had zero observed GC events during the measured frame loop. The two `after.gcEvents` entries include the forced post-run collection/observer activity; heap measurements are reported rather than treated as proof of absolute zero allocation.

## Package and root gates

Setup in the fresh worktree:

```sh
pnpm install --frozen-lockfile
pnpm --filter @threenative/playtest build
pnpm --filter @threenative/ui build
pnpm --filter @threenative/physics build
```

The package gate passed:

```sh
pnpm --filter @threenative/core test
# build completed; publint: All good!
```

These root gates passed:

```sh
pnpm typecheck
pnpm lint
pnpm budgets
```

`pnpm lint` exited 0 with repository warnings and no errors. `pnpm budgets` exited 0; it reported the existing native-runtime LOC review trigger.

`pnpm test` ran 167 files and 1,596 tests: 165 files and 1,594 tests passed. Two existing network-failure fixture tests failed because the observed exit code was `2` instead of their expected `1`:

```text
packages/playtest/__tests__/fails-closed.spec.ts:83
packages/playtest/__tests__/negative-fixtures.spec.ts:57
```

No playtest files were changed for this lane.

## Browser WebGPU starter playtest

The first `pnpm test:playtest` attempt was blocked by a fresh-worktree setup issue: the starter Vite app could not resolve the unbuilt `@threenative/ui` package. `node packages/playtest/dist/runner/cli.js doctor --text` passed its environment checks, and building `@threenative/ui` resolved the issue.

After the setup fix, the exact command passed:

```sh
pnpm test:playtest
```

All three browser WebGPU scenarios passed: framework movement, framework camera, and the abyss framework movement-axis control. The capture reported an NVIDIA/Turing WebGPU adapter; movement and HUD/resource state changed during the starter run.

## Repair verification — 2026-08-23

### Reviewer defect reproduced red

Added `packages/ui/__tests__/useGameState.spec.ts`:

```sh
pnpm exec vitest run --config vitest.config.ts packages/ui/__tests__/useGameState.spec.ts
```

Before the repair, this run was red with 1 failed and 2 passed. The full-state subscriber stayed at one render:

```text
AssertionError: expected 1 to be 2
packages/ui/__tests__/useGameState.spec.ts:82
```

### Repair and green result

`createGameStore` now retains Zustand's original `getState` as `getPublishedState()`. Gameplay keeps using the mutable immediate `getState()` snapshot, while `useGameState` reads `getPublishedState()` for both client and server snapshots. The published getter is captured once when the store is created, so ordinary frame writes do not gain a per-frame allocation.

Build and focused verification:

```sh
pnpm --filter @threenative/core build
pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/input.spec.ts packages/core/__tests__/state.spec.ts packages/core/__tests__/loop.spec.ts packages/core/__tests__/game.spec.ts packages/ui/__tests__/useGameState.spec.ts
```

Observed result:

```text
CLI ESM Build success
publint: All good!
Test Files  5 passed (5)
Tests       83 passed (83)
```

### Repair negative controls

Both controls were reverted temporarily and restored before the final green run:

| Control | Command and observed red |
| --- | --- |
| Revert the React bridge to `game.state.getState()` | `pnpm exec vitest run --config vitest.config.ts packages/ui/__tests__/useGameState.spec.ts -t "should re-render a full-state subscriber after a state flush"` — 1 failed, 2 skipped; `expected 1 to be 2` at `useGameState.spec.ts:82` |
| Restore the current-state spread (`let current; current = {...current,...next}`) | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/state.spec.ts -t "should keep the immediate snapshot identity stable across pre-flush writes"` — 1 failed, 4 skipped; the identity assertion failed at `state.spec.ts:58` |

The restored bridge, immediate snapshot, retained published snapshots, and full-state React subscriber are green in the 83-test focus above.

### Repair rerun of existing gates

```sh
pnpm --filter @threenative/core test
pnpm typecheck
pnpm lint
pnpm test
pnpm budgets
pnpm test:playtest
```

Results:

- `pnpm --filter @threenative/core test`: passed; build and strict publint both reported `All good!`.
- `pnpm typecheck`: passed; root and all 15 participating workspace projects completed.
- `pnpm lint`: exited 0 with 241 repository warnings and no errors.
- `pnpm budgets`: exited 0; framework LOC was `13776/15000`, with the existing native-runtime review trigger reported.
- `pnpm test:playtest`: passed all three browser WebGPU scenarios (`framework-movement`, `framework-camera`, `abyss-framework-movement-axis`), using the NVIDIA/Turing adapter and reporting changed movement/state resources.
- `pnpm test`: remained red only in the out-of-scope playtest suite: 165 files passed, 1 failed, 1 skipped; 1,593 tests passed and 3 skipped. The failure was `packages/playtest/__tests__/e2e-runner.spec.ts:276`, where the transport-only browser-error fixture observed `runtimeDiagnostics: 0` and `reason: "not-evaluated"` instead of the expected diagnostic row. No playtest files were changed.

## Repair verification 2 — 2026-08-23 — lane-189-r2

### Second-review controls reproduced red

The focused baseline after the frozen-lockfile setup was green. Each second-review control was
then applied temporarily, run, and restored before the final green run.

| Finding | Temporary control | Command and observed result |
| --- | --- | --- |
| Retained published snapshot was checked before the second flush | Make the subscriber assign `current = state`, aliasing the mutable gameplay snapshot to Zustand's published object | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/state.spec.ts -t "should never mutate a retained published snapshot"` — exit 1; `expected { score: 2 } to deeply equal { score: 1 }` at `state.spec.ts:74` |
| Ordinary no-overlay path was not a negative control | Return `{}` instead of `undefined` from `return this.#renderMetricsEnabled ? worldMetrics : undefined;` | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/game.spec.ts -t "returns no render metrics object on either disabled render path"` — exit 1; the ordinary-path source assertion failed at `game.spec.ts:62` |

### Restored focused core result

```sh
pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/state.spec.ts packages/core/__tests__/game.spec.ts packages/core/__tests__/loop.spec.ts
```

```text
Test Files  3 passed (3)
Tests       50 passed (50)
```

### Real GameImpl 10,000-frame ordinary-path allocation probe

The prior low-level probe remains above as historical evidence. This repair adds a real
`defineGame`/`GameImpl` run: the scene samples `ctx.input.vector("move")`, writes
`ctx.state.set({ frame })`, and each frame enters the actual `GameImpl` render callback. The fake
renderer counts ordinary world renders; no CanvasLayer overlay is populated and diagnostics stay
disabled.

```sh
NODE_OPTIONS=--expose-gc node --import tsx/esm --input-type=module -e 'import { PerformanceObserver } from "node:perf_hooks"; import { defineGame } from "./packages/core/src/game.ts"; import { Scene } from "./packages/core/src/scene.ts"; const canvas = new EventTarget(); Object.defineProperties(canvas, { clientHeight: { configurable: true, value: 180 }, clientWidth: { configurable: true, value: 320 }, parentElement: { configurable: true, value: null } }); const inputTarget = new EventTarget(); let frame; let updates = 0; let sceneRenders = 0; let worldRenders = 0; class ProbeScene extends Scene { static initialState = { frame: 0 }; update(ctx) { ctx.input.vector("move"); updates += 1; ctx.state.set({ frame: updates }); } render() { sceneRenders += 1; } } const game = defineGame({ inputTarget, renderer: { canvas, preferWebGPU: false, webgl2Factory: () => ({ domElement: canvas, render: () => { worldRenders += 1; }, setSize: () => undefined, dispose: () => undefined }) }, scenes: { probe: ProbeScene }, start: "probe" }); const originalRequestFrame = globalThis.requestAnimationFrame; Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback) => { frame = callback; return 1; } }); let gcEvents = 0; const observer = new PerformanceObserver((list) => { gcEvents += list.getEntries().length; }); observer.observe({ entryTypes: ["gc"] }); const nextTurn = () => new Promise((resolve) => setImmediate(resolve)); try { await game.start(); if (frame === undefined) throw new Error("Game did not schedule a frame."); global.gc(); await nextTurn(); gcEvents = 0; const before = { heapUsed: process.memoryUsage().heapUsed, gcEvents }; const firstTime = globalThis.performance.now(); frame(firstTime); for (let index = 1; index <= 10000; index += 1) frame(firstTime + index * (1000 / 60)); const during = gcEvents; await nextTurn(); global.gc(); await nextTurn(); const after = { heapUsed: process.memoryUsage().heapUsed, gcEvents }; console.log(JSON.stringify({ frames: 10000, updates, ordinaryWorldRenders: worldRenders, sceneRenders, before, duringGcEvents: during, after })); } finally { game.stop(); observer.disconnect(); if (originalRequestFrame === undefined) Reflect.deleteProperty(globalThis, "requestAnimationFrame"); else Object.defineProperty(globalThis, "requestAnimationFrame", { value: originalRequestFrame }); }'
```

Observed output (exit 0):

```json
{"frames":10000,"updates":10000,"ordinaryWorldRenders":10001,"sceneRenders":10001,"before":{"heapUsed":18692160,"gcEvents":0},"duringGcEvents":0,"after":{"heapUsed":18930032,"gcEvents":1}}
```

The extra ordinary render is the warm-up frame before the 10,000 measured frames. The probe
observed zero GC events during those frames and reports heap measurements without treating them as
proof of absolute zero allocation. `GameImpl` keeps `onRender` private, and diagnostics-disabled
frames do not publish a metrics series, so the harness cannot inspect the callback's returned
`undefined` directly; the renderer and scene counters prove that the ordinary no-overlay callback
ran on every frame, while the focused source/runtime test guards the return contract.

### Repair 2 gate results

Fresh-worktree setup and gate commands were run as follows:

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm install --frozen-lockfile` | 0 | Installed the lockfile; generated `.mcp.json`, removed after use because it was untracked and made lint fail on formatting. |
| `pnpm --filter @threenative/playtest build` | 0 | Built the missing workspace dist required by the core package gate. |
| `pnpm --filter @threenative/core test` (before playtest build) | 1 | Setup failure: unresolved `@threenative/playtest` dist; no test body ran. |
| `pnpm --filter @threenative/core test` (after playtest build) | 0 | ESM build and strict publint: `All good!`. |
| `pnpm --filter @threenative/physics build` | 0 | Built the missing physics dist required by example typechecks. |
| `pnpm --filter @threenative/ui build` | 0 | Built the missing UI dist required by `abyss-framework` typecheck. |
| `pnpm typecheck` (before physics/UI builds) | 2 | Setup failures: unresolved `@threenative/physics`, then `@threenative/ui`. |
| `pnpm typecheck` (after prerequisite builds) | 0 | Root and all 15 participating workspace projects passed. |
| `pnpm lint` (with generated `.mcp.json`) | 1 | One formatting error in the generated untracked file plus 241 existing warnings. |
| `pnpm lint` (after removing generated `.mcp.json`) | 0 | 241 existing warnings, no errors. |
| `pnpm test` | 1 | 165 files passed; 3 unrelated playtest tests failed: `e2e-runner.spec.ts:142`, `e2e-runner.spec.ts:276`, `generated-shooter-input.spec.ts:195`; temporary-directory count changed 64 → 62. |
| `pnpm budgets` | 0 | `13776/15000` framework LOC; existing native-runtime review trigger reported. |
| `pnpm test:playtest` | 0 | All three browser WebGPU scenarios passed; movement/HUD state changed and the adapter was NVIDIA/Turing. |
