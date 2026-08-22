# Module decomposition — P2-3 verification (2026-08-21)

PRD: `docs/PRDs/technical-debt-p2-2026-08-21/PRD-P2-3-decompose-verification-render-modules.md`
Lane: P2-3 (characterization-first decomposition of `packages/playtest/src/assertions.ts` and
`packages/core/src/renderProjection.ts`). Behavior was frozen first; modules moved second; five
negative controls were observed red by named mutation and each mutation was restored.

## Files

Created:

| File | Lines | Role |
| --- | --- | --- |
| `packages/playtest/src/assertion-schema.ts` | 493 | assertion/setup registries + capability preflight |
| `packages/playtest/src/assertion-report.ts` | 310 | result/diagnostic types, policy resolution, shared serializers |
| `packages/playtest/src/assertion-evaluators.ts` | 2,312 | family dispatch and evaluation (`evaluateRichPlaytestAssertions`) |
| `packages/core/src/projection-plan.ts` | 303 | pure scan of the authored scene + immutable plan (incl. `exactLaneReason`) |
| `packages/core/src/projection-apply.ts` | 672 | `ProjectionMirror`: apply, reconcile state, restoration ownership |

Modified:

| File | Lines after | Change |
| --- | --- | --- |
| `packages/playtest/src/assertions.ts` | 29 (was 3,078) | compatibility facade; every prior export re-exported unchanged |
| `packages/playtest/src/index.ts` | — | exports repointed to canonical modules; public name set unchanged; @situation tags preserved/restored |
| `packages/core/src/renderProjection.ts` | 296 (was 1,078) | `SceneRenderProjection` keeps its exact public API and delegates to plan/apply |
| `packages/playtest/__tests__/scenario.spec.ts` | +~250 | `should preserve every assertion family's result contract`, `should evaluate all registered families through the public entry` |
| `packages/playtest/__tests__/evidence-required.spec.ts` | +1 line | labeled expect for the fail-closed negative control |
| `packages/core/__tests__/renderProjection.spec.ts` | +~130 | `should restore authored objects after projection changes`, `should keep projection and authored scene reversible` |
| `packages/core/__tests__/constraints.spec.ts` | +~18 | visual-concerns exemption follows the moved projection code; same stricter no-construction assertions applied to both new modules; `isLight` recognition asserted in the plan module |

## Gates executed (all from repo root)

| Gate | Command | Result |
| --- | --- | --- |
| Focused playtest suites | `pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/scenario.spec.ts packages/playtest/__tests__/evidence-required.spec.ts packages/playtest/__tests__/three-physics.spec.ts` | exit 0, 84 passed |
| Focused core suites | `pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/renderProjection.spec.ts packages/core/__tests__/game.spec.ts` | exit 0, 68 passed (69 after phase 3) |
| Typecheck | `pnpm typecheck` | exit 0 (all workspaces) |
| Lint | `pnpm lint` | exit 0 (235 warnings: pre-existing `noExcessiveCognitiveComplexity` reports, non-fatal by `pnpm quality` policy) |
| Full unit suite | `pnpm test` | exit 0, 163 files, 1,538 tests |
| Package build + publint | `pnpm --filter @threenative/playtest build` / `pnpm --filter @threenative/core build` | both exit 0, "All good!" |
| Co-located src tests (not collected by `pnpm test`; run explicitly per package AGENTS.md) | `pnpm exec tsx --test packages/playtest/src/scenario.test.ts packages/playtest/src/reachability.test.ts packages/playtest/src/three/bridge.test.ts` | 10 tests: 8 pass, 2 fail — see "Pre-existing failure" below |
| Real playtest scenario (User Verification) | `pnpm test:playtest` | exit 0 — `framework-movement`, `framework-camera`, `abyss-framework-movement-axis` all `pass: true` on a real GPU (adapter vendor "nvidia", architecture "turing"; not SwiftShader) |

## Negative controls (all observed red, then mutation restored and green re-observed)

### NC1 — assertion family characterization (PRD: "remove one family dispatch")

Mutation: the signals family evaluation loop in `packages/playtest/src/assertions.ts` commented out.

```
command: pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/scenario.spec.ts
exit: 1
FAIL  packages/playtest/__tests__/scenario.spec.ts > should preserve every assertion family's result contract
AssertionError: RED observed: assertion family result missing for 'signals': expected false to be true // Object.is equality
```

The evaluator's own fail-closed probe also fired: the result list gained `assert.signals`
(`pass: false`) in place of `signal.collected` — a removed family can never pass silently.

### NC2 — fail-closed observations (PRD: "drop an observation field")

Mutation: the observed-value guard in `evaluatePathAssertion`'s `changed` check removed
(`const observed = before !== undefined || after !== undefined; checks.push(observed && ...)` became an
unguarded push).

```
command: pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/evidence-required.spec.ts
exit: 1
FAIL  packages/playtest/__tests__/evidence-required.spec.ts > 'changed: false' fails when the value was never observed at all
AssertionError: RED observed: required observation was accepted: expected true to be false // Object.is equality
```

### NC3 — projection restoration, characterization (PRD phase 1: "Skip restoration")

Mutation: `this.#retire(seen, lights);` skipped in the projection's per-frame sweep.

```
command: pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/renderProjection.spec.ts
exit: 1
FAIL  packages/core/__tests__/renderProjection.spec.ts > SceneRenderProjection > should restore authored objects after projection changes
AssertionError: RED observed: authored object state leaked: expected [ …(300) ] to deeply equal []
```

All 300 objects the game removed were still held by the mirror — exactly the mutated seam failing.

### NC4 — phase 2 dispatch gate (PRD: "Remove a registry mapping")

Mutation: signals dispatch loop removed from the NEW module `packages/playtest/src/assertion-evaluators.ts`.

```
command: pnpm exec vitest run --config vitest.config.ts packages/playtest/__tests__/scenario.spec.ts
exit: 1 (two gates red)
FAIL ... > should evaluate all registered families through the public entry
AssertionError: RED observed: registered family has no evaluator for 'signals': expected false to be true
FAIL ... > should preserve every assertion family's result contract
AssertionError: RED observed: assertion family result missing for 'signals': expected false to be true
```

The registry-entry-removal variant fails closed one layer earlier: deleting a
`PLAYTEST_ASSERTION_REGISTRY` entry makes `loadPlaytestScenario` reject the declaring scenario with
`TN_PLAYTEST_SCENARIO_INVALID` ("Unknown key"), so an unmapped kind cannot load at all.

### NC5 — phase 3 restoration seam (PRD: "Disable restore")

Mutation: inside `ProjectionMirror.#retire` (packages/core/src/projection-apply.ts), the
batch-instance release loop AND the final per-object state backstop sweep were disabled. (With only
the batch loop disabled, the state backstop still cleaned the map `inspect` reads, so the leak was
invisible; both halves of the same restoration path were disabled so the mutated thing is what fails.)

```
command: pnpm exec vitest run --config vitest.config.ts packages/core/__tests__/renderProjection.spec.ts
exit: 1 (two gates red)
FAIL ... > should keep projection and authored scene reversible
AssertionError: RED observed: projection mutation leaked across transition: expected [ …(150) ] to deeply equal []
FAIL ... > should restore authored objects after projection changes
AssertionError: RED observed: authored object state leaked: expected [ …(300) ] to deeply equal []
```

## Characterization pins added

- `should preserve every assertion family's result contract` (scenario.spec.ts): all 21 registered
  families declared in one scenario; evaluated against crafted evidence (all 24 result ids pinned in
  exact order, all passing, zero diagnostics) and against empty evidence (23 ids, every family
  failing closed with its exact diagnostic code pinned; only `diagnostics` and `movement.distance`
  legitimately survive, both reading report-level aggregates rather than observations).
- `should evaluate all registered families through the public entry` (scenario.spec.ts): each
  registry kind evaluated standalone through `../src/index.js`, each producing a result under its
  own `resultIdPrefix` (camera rides the runner-side base probe via `report.follow`).
- `should restore authored objects after projection changes` (renderProjection.spec.ts): a scene
  transition swaps 300 objects for 120 under a live projection; authored graph, mirror counts
  (`sourceRenderables`/`projectedObjects`/`resultDrawCandidates`) and the absence of any removed
  object from the mirror are pinned.
- `should keep projection and authored scene reversible` (renderProjection.spec.ts): lane-change
  round trip, decline/recover cycle, dispose-and-rebuild, and a mid-flight population swap must all
  reconverge to identical counts with nothing left behind.

## Public surface unchanged — proof

- `packages/playtest/dist/index.d.ts` (built after the split) exports the same public names as
  before: `PLAYTEST_ASSERTION_REGISTRY`, `evaluateRichPlaytestAssertions`,
  `resolveDiagnosticsPolicy`, `requiredPlaytestCapabilities`,
  `IPlaytestAssertionResult`, `IPlaytestDiagnostic`, `IPlaytestFramebufferCoverageObservation`,
  `IPlaytestObservations` (grepped in the built file; publint passed).
- `packages/core/src/renderProjection.ts` still exports `ProjectionReasonCode`,
  `ProjectionExactReason`, `IRenderProjectionReport`, `IRenderProjectionOptions`,
  `SceneRenderProjection`, `exactLaneReason`, `ProjectionCamera` — the class API (constructor,
  `deoptimized`, `root`, `reconcile`, `report`, `inspect`, `drawsWith`, `dispose`) is untouched, and
  `packages/core/src/game.ts` still constructs it unchanged (ledger caller `game.ts:449`).
- The capability manifest gate inside `pnpm test` re-validated every public export's `@situation`
  tags against the repointed `index.ts`.

## Caller census (non-test production consumers)

- `assertion-schema.ts` ← `src/index.ts`, `src/assertions.ts` (facade, imported by `scenario.ts`
  validation), `src/assertion-evaluators.ts`.
- `assertion-evaluators.ts` ← `src/index.ts` (which `runner/runner.ts:714` calls through),
  `src/assertions.ts` (facade).
- `assertion-report.ts` ← `src/index.ts`, `src/assertions.ts` (facade, imported by `report.ts` for
  result/diagnostic types), `src/assertion-evaluators.ts`.
- `projection-plan.ts` ← `src/renderProjection.ts` (`scanProjection`, `isRenderable`,
  `exactLaneReason` re-export), `src/projection-apply.ts` (`isLight`, plan types).
- `projection-apply.ts` ← `src/renderProjection.ts` (`ProjectionMirror`).
- No twin implementation remains: the monolith is a 29-line facade of pure re-exports, and the
  projection class holds no scan/apply logic.

## LOC

- `pnpm budgets` before: `13,183/15000 framework LOC`; after: `13,390/15000 framework LOC`
  (concurrent lanes also moved in between; playtest is excluded from the framework budget by
  policy). The core projection module family went 1,078 → 1,271 lines (+193, +17.9%): the cost of
  the plan/mirror seam (module headers, plan types, mirror accessors). `pnpm budgets` reports
  ok on hard invariants.
- Per-file counts are in the Files table above.

## Pre-existing failure found (not introduced by this lane)

`packages/playtest/src/reachability.test.ts` (a co-located `node:test` file, not collected by
`pnpm test`) fails its two `deepEqual` assertions because `evaluateRichPlaytestAssertions` always
appends the unconditional `diagnostics` health-check result. That block predates this lane — it is
present, unconditional, in the pre-split monolith at commit `48b3b8ce` — so the test's
two-element expectation could not have passed before the split either. The split moved the block
verbatim. Left as found (out of scope; the file is excluded from CI by design per
`packages/playtest/AGENTS.md`).

## Unexecuted targets

- Native build and bounded web/desktop conformance named in the PRD's phase-3 verification plan
  were **not executed** in this lane (not in the coordinator's gate list for this run; the native
  runtime census lane is active concurrently on the same tree). The projection's native behaviour
  is therefore unverified by this PRD instance; the web unit suite, the real-GPU playtest fixture
  runs and the projection unit corpus are the executed evidence.
- `pnpm test:templates` was not executed (not in this run's gate list).
