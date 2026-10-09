# PRD-536 — Tests close the fail-open and regression holes

**Status:** PROPOSED, filed 2026-10-07 against `d447ba99b`

**Priority:** P1 — Proposed; phase 1 closes playtest loader and evaluator paths that pass a scenario on missing or vacuous evidence.
**Complexity:** 3 (10+ files) + 2 (multi-package) = **5 → MEDIUM mode**

**Owner:** unassigned

**Source:** a coverage scout sweep on 2026-10-07. Six read-only scouts each read one area: core top-level, core render,
playtest runner, playtest evaluators, physics/ui/assets, and the small packages plus native. Two cheap arms also
ran: fix commits since 2026-07-01 that changed `src` with no spec change, and `scripts/*.ts` gates with no spec.
Each claim below comes from a symbol grep across `packages/*/__tests__` and `scripts/__tests__`. The scouts
also matched each `throw` site to the messages the specs assert. Three claims were checked again by hand
(`scene-nodes.ts:123`, `families-observation.ts:272`, `schema-validate.ts:96`).

## 1. Context

**Problem:** The line coverage number is not the risk. Coverage is dense in most packages. The real holes are in
code where a missing test lets a bug ship *silently*:

- the proof harness passes on missing evidence (fail-open),
- a trust-boundary parser or config seam drops bad input without an error,
- a fix commit landed with no test, so the regression can come back.

This PRD adds tests only there. It does not chase a percentage.

**Goal:** Every row below gets one test that fails on the bug shape. Where a test exposes a real fail-open path,
the same commit fixes the source (red → green), because a test that pins fail-open behaviour is worse than no test.

### Out of scope (owned elsewhere or not worth a test)

- [PRD-326](./PRD-326-high-churn-paths-fail-before-regressions-ship.md) owns `cli.ts:main(argv)` batch exit
  aggregation, the delayed `runtime.startup` runner trace, and the windowed `bindings.cpp`/`context.cpp` paths.
  This PRD does not duplicate them.
- Not worth a test: string markers and `*_FLAG` constants, `react-glyphs.ts` tables, `ocean/fft.ts` (40+ tests),
  `atmosphere/params.ts` (45+ tests), `scenario/errors.ts` constructors, `ueformat/src/cli.ts`, and engine-mcp
  ranking (`search.spec.ts` covers it). GPU-only output for fluids, world passes and BVH traversal belongs in the
  playtest lane, not in unit tests.

### Measurement note

The scouts' coverage runs did not produce numbers. Core (282 s and 274 s) ended with 8–10 failing spec files.
The playtest runner run timed out at 580 s on `generated-shooter-input.spec.ts`. These runs were in parallel
on a loaded machine, so the reds are **unverified** and may be load flakes (see the `root-suite-load-flakes`
memory). Box 1.1 measures the baseline in isolation.

## 2. Targets

Size: S is under 1 hour, M is 1 to 3 hours. "Fix" marks a row where the scout read a likely source bug, not only a
missing test.

### Phase 1 — the proof harness fails closed

| # | Target | One test asserts | Fix |
| --- | --- | --- | --- |
| A1 | `playtest/src/scenario/schema-validate.ts` root: `warmupFrames`, `subject`, `setup`, `artifacts`, `parity` | `warmupFrames:-1` and `"2"`, `setup:[]`, `subject:5` and `artifacts:{screenshots:"no"}` throw at load. Today they are silently dropped. | yes |
| A2 | `schema-accessors.ts` vacuous bounds: `performance:{}`, `frameDiff:{}`, `atSteps:[{label}]`, `atSteps:[]`, `causedBy.neverBefore:false`, `scene.*:false`, `minVisibleLights:0`, `sceneNodes.texturesLoaded:false`, `movement.rotationChanged:false` | Each one throws at load ("must set a bound"). This matches the existing `notThermallyConfounded:false` rejection. | yes |
| A3 | Ratio and unit ranges: `minNonblankPixelRatio`, `minDarkPixelRatio`, `maxLuminance` (runtime unit is 0..1, but `schema-boundaries.spec:276` pins `100` as valid), `animation.maxFootSlide`, `visibility.maxOffscreenRatio`, negative `minProjectedPixels`/`maxDistance`/`pathLength`, malformed nested movement objects, `release:"no"` | Out-of-range values throw at load. The spec that pins `maxLuminance:100` is corrected. | yes |
| A4 | Evaluators passing on no evidence: `scene-nodes.ts:123` `texturesLoaded` (`[].every`), `families-observation.ts:272` `minGapMs` with no `recentCues`, `movement-evidence.ts:31,97` with no `observed` guard | A Group with no materials, an absent cue ledger, and an unobserved entity each **fail**. | yes |
| A5 | Projection math: `three/observations.ts:projectedBounds` (box across the near plane), `measures.ts:projectedOffscreenRatio`, `render-evidence.ts:projectedPixelsForEntity` (unclamped NDC), fps p50 versus the parity upper median | A half-offscreen box gives a ratio of about 0.5 with clamped pixels. The minFps and parity paths give the same fps for an even-length series. `minFps:30` fails at 29.9967. | yes |
| A6 | Runner and perf: `perf.ts:runExecutable` ignores the host exit status, `perf.ts:readLogcat` reads stale markers without `-c`, `parsePerfArgs` (`--host-arg` with no value, `--min-fps ""` gives 0), `server.ts:waitForUrl`, `config.ts:parseStandalonePlaytestArgs` throw branches, `exitCodeForReport` with `{pass:true, assertionResults:[]}` | A host that exits 139 after 3 windows fails. Stale logcat is not fresh evidence. Bad argv throws. A server that exits 9 gives `ManagedServerError`. One test names the layer that rejects an empty assertion set. | yes (perf) |
| A7 | Gate scripts: `check-flight-cost.ts` (a parser bug gives exit 0 `measurement-only`), `content-census.ts` (unreadable files give exit 0), `generate-assertion-validators.ts` (unmapped type and `--check`), `check-native-coverage.ts` floors (`src/cli/` floor `0.00%` against measured `73.60%`; webgpu 33.82 against 76.39) | A usage error exits 2 and never exits 0. An unreadable model is visible in the exit code or in `--json`. An unmapped registry type throws. The native floors ratchet to within a set margin of the measured values, and the gate rejects a loose floor. | yes |

### Phase 2 — trust boundaries reject bad input

| # | Target | One test asserts | Fix |
| --- | --- | --- | --- |
| B1 | `assets.*` config seam: `create-threenative/src/config.ts` `validateModels`, `core/src/config.ts` `IThreeNativeModelsConfig`, and `assets/src/compile.ts` `parse*`. These are three hand-kept lists, and drift already shipped in `0e3264572`. | Every key that `loadConfig` accepts under `assets.*` is accepted by `compileAssets`, and the reverse is also true. `lightmap.{atlasSize,padding}` are included. | maybe |
| B2 | Asset passes: `lightmap.ts` `atlasSize:130` produces a KTX2 that is not 4-aligned (BC7 class). `worker-pool.ts` with a dead worker or `dispose()` leaves `waiting` jobs that never settle. Also `assertSimplifiedWithinBounds`, the lightmap error codes, `readExistingManifest` with a corrupt manifest, `passConfigurationFor` isolation for audio/other, and `audio.ts` `FADE_TOO_LONG`/`DRIFT`. | No unaligned KTX2 ships. A throwing pass in a real worker rejects with `TN_ASSETS_PASS_FAILED`, and the process exits within the timeout. `run()` after `dispose()` rejects. | yes (pool, lightmap) |
| B3 | Binary parsers: `raw-unreal/src/package-summary.ts` (`getBigInt64` before `skip`, so a bare `RangeError` escapes), version gates 504..522 (the 517–522 class), the 7 unasserted `raw-unreal` codes, `ueformat` limits and `decompressBody` (an uncapped `gunzipSync`), and the `three-adapter.ts` `INVALID_GEOMETRY` branches | A truncation sweep gives only `UAssetError`. `readPackageLayout` lands on `nameOffset` for every gated version. A gzip bomb with a small declared size is rejected without a large allocation. | yes |
| B4 | Tool and scaffold inputs: `blender-mcp` `handleToolCall` (no server spec), `engine-mcp` input guards (`scope`, `importPath`, `symbol`, duplicate `notOwned`), `metahuman` `TN_MH_WASM_CHECKSUM`, and `create-threenative` `createProject` errors after `cp`, which leave a half-written target that blocks a retry | Bad arguments return the named error and spawn no Blender. A tampered wasm rejects. A failed scaffold leaves the target absent or retryable. | yes (scaffold) |

### Phase 3 — landed fixes cannot regress silently

| # | Target | One test asserts | Lane |
| --- | --- | --- | --- |
| C1 | Physics: `CharacterBody3D.moveAndSlide` uphill and downhill with `snapToGround` and the `maxFallSpeed` clamp (the slope-stall class). `NavigationAgent3D` walks a wall detour to completion. `static-colliders.ts` ceiling cull and layer/mask. `plugin.ts:244` area id and unknown id. `physicsObservations` duplicate label and sample limit. The `native/host.ts` ray hit path and its `TN_NATIVE_PHYSICS_*` codes. | A character on a 25° slope gains height for 120 steps without a freeze. `targetReached` fires once. The native mock ray returns the decoded hit. | unit (Rapier/recast WASM) |
| C2 | Core bookkeeping: `mesh-pool.ts` caps and `dropPooledFor`, `batched-velocity.ts` error and dispose paths, `atmosphere/luts.ts` resolution validation, `material-key.ts` collisions, `render-list-validate.ts` flag parsing, `virtual-shadow.ts` `adaptiveRefresh:true`, `world-topology.ts:summarizeWorldTopology`, `rig-preparation.ts:uniformYawScale`, the `world-terrain-splat.ts` throws, `softbody-topology.ts` `complete triangles`, and `projection-stability.ts` lane predicates | Pool: the 9th park of one pair and the park past 512 are refused and disposed. LUTs: zero, NaN and fractional sizes throw. Material key: equal content gives equal keys, and a changed `side`/`alphaTest`/map size changes the key. Flag: `=0`/`=false` give false. Topology: a hand-computed ridge gives the expected order, and each throw fires. Yaw scale: non-uniform or pitched gives `undefined`. | unit |
| C3 | Fix commits with no test: `runner.ts:scenarioSummary` `reasons` (`4f7afff45`), `SCREENSHOT_TIMEOUT_MS` default (`61123eb92`), `steps.ts` 10-tick batching (`4ee9dd578`), `DebugOverlay` DEV gate before hooks (`9a490f1dd`), `UiLayer` unmount empty-region publish (`9e34ce33a`), `runtime.cpp:dispatchResizeEvent` must not reconfigure the surface (`9d97912d6`), and conformance `52-skinned-mesh-animation` desktop gate with the handle count back to baseline | Each fix's behaviour is pinned. A revert of the fix turns the new test red. | unit; native contract; desktop conformance |

## 3. Phases

### Phase 1 — the proof harness fails closed

- [ ] 1.1 Record the baseline line and branch coverage per package, each run alone on an idle machine. Put the numbers in this PRD. proof: `pnpm exec vitest run packages/<pkg>/__tests__ --coverage --coverage.include='packages/<pkg>/src/**'`
- [ ] 1.2 A1–A3: the scenario loader rejects dropped, vacuous and out-of-range fields. Fix every in-repo scenario that the stricter loader rejects. proof: `pnpm exec vitest run packages/playtest/__tests__` + `pnpm test:playtest` + `pnpm test:templates`
- [ ] 1.3 A4–A5: evaluators fail on missing evidence and use clamped projection math. proof: `pnpm exec vitest run packages/playtest/__tests__`
- [ ] 1.4 A6–A7: runner, perf and gate scripts never exit 0 on a broken input, and the native floors ratchet. proof: `pnpm exec vitest run packages/playtest/__tests__ scripts/__tests__` + `pnpm budgets`

### Phase 2 — trust boundaries reject bad input

- [ ] 2.1 B1–B2: the config seam and the asset passes. proof: `pnpm exec vitest run packages/assets/__tests__ packages/create-threenative/__tests__`
- [ ] 2.2 B3–B4: binary parsers, tool inputs and scaffold errors. proof: `pnpm exec vitest run packages/raw-unreal/__tests__ packages/ueformat/__tests__ packages/blender-mcp/__tests__ packages/engine-mcp/__tests__ packages/metahuman/__tests__ packages/create-threenative/__tests__`

### Phase 3 — landed fixes cannot regress silently

- [ ] 3.1 C1–C2: physics and core bookkeeping. proof: `pnpm exec vitest run packages/physics/__tests__ packages/core/__tests__`
- [ ] 3.2 C3: fix-commit pins. Each new test turns red when its fix is reverted on a committed tree. proof: `pnpm exec vitest run packages/playtest/__tests__ packages/ui/__tests__` + the runtime-native contract lane + `pnpm parity`

## 4. Scout notes

The scout reports are not tracked. The per-row assertions above are the full test brief. If a row is unclear,
send a fresh read-only scout to that file before you write the test. Do not guess.

## Acceptance criteria

- [ ] Every row A1–C3 has a test that fails on its bug shape, or has a line under `## Decisions` that names why it was dropped. proof: this PRD
- [ ] The full board passes with the stricter loader. proof: `pnpm typecheck && pnpm lint && pnpm test` + `pnpm test:templates`

## Decisions

## Blocked on

Nothing.
