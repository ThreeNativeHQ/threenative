# PRD-479 — Fluid particle motion and sampling regressions

**Status:** PARTIAL — source regressions repaired; runtime qualification pending.
**Owner:** Core / particle-fluid regression follow-up.
**Depends on:** Merged [PR #389](https://github.com/ThreeNativeHQ/threenative/pull/389).

## Problem and scope

The fluid solver shipped by [PRD-476](../done/PRD-476-fluid-lab-particle-water-at-60-fps.md)
still contains three reproducible correctness defects at develop `569fdb267538c5eae9472760fd71be59745b9a24`:

- An 18 m/s particle starting at x=-1.05 crosses the default 0.1 m dam gate in a single
  1/60 s endpoint-only prediction. Its endpoint x=-0.75 lies beyond the gate's expanded
  interval [-1.0468, -0.7532], so endpoint projection misses it.
- Component-wise velocity clipping permits vector speed sqrt(3) times `maxSpeed`, and
  collider projection can produce an over-limit final velocity.
- `sample` extends boundary water outside the tank, while a valid one-column volume can
  never satisfy the fixed four-column minimum and incorrectly reports the floor.

The actual merged source matches blob `44159cd07db98a88bc5d0e3b4d46bd542d574dba`.
The new generated-WGSL/sampler regressions fail three tests against those exact bytes;
the repaired source passes all 15 fluid tests. The numeric collision still requires a
real GPU readback before it is qualified.

This is a focused regression follow-up with its own PR. It does not rewrite the merged
PRD, redesign the solver, change its neighbor passes, add public API, or qualify new
frame-rate claims. The original PRD's recorded 16.8 ms presented p95 is not a passing
measurement for a literal 16.7 ms limit; no limit is relaxed here.

## Implementation

Use vector-magnitude clamping before prediction and after confinement. Subdivide the
predicted displacement into radius-sized segments and project each one using the
existing collider routine; the default worst case is four projections in the same
compute dispatch. This repairs the reproduced stationary gate case, not exact swept
collision detection for arbitrary grazing contacts or teleported colliders.

Keep the sampler's existing averaging policy, return the floor outside its authored
bounds, and admit fewer than four samples only when the whole volume has fewer columns.
The look remains game-owned. Reuse the public playtest bridge and the existing native
host for rendered evidence, with actual particle-buffer readbacks and no CPU solver copy.

## Execution phases

### Phase 1 — Repair the source contracts

- [x] Generated prediction and confinement shaders apply vector speed limits and radius-sized prediction segments. proof: `pnpm exec vitest run packages/core/__tests__/fluid-particles.spec.ts` — all 15 pass after the original merged source fails the new shader contract.
- [x] Surface sampling returns the floor outside bounds and the observed height for valid small volumes, excluding covered columns. proof: the same fluid suite — both new sampler regressions fail on merged source and pass after repair; `gpu-readback.spec.ts` also passes 11/11.

### Phase 2 — Qualify actual GPU behavior

- [x] Browser WebGPU keeps the default-speed particle on the correct side of the gate and preserves unobstructed motion and both speed limits. proof: [run 37054997796](https://github.com/ThreeNativeHQ/threenative/actions/runs/37054997796) at `b149762d`; actual SwiftShader readbacks pass all 11 positive assertions and the missing-gate control fails only `collisionPassed`. All nine source hashes and four screenshots match the [retained provenance](../../verification/prd479/b149762d-browser/provenance.json). Software correctness only.
- [ ] Linux native executes the same authored four-arm probe with the same numeric bounds. proof: `node --import tsx scripts/verify-fluid-collision-native.ts` in the maintained `Linux native fluid correctness` hosted job, with the current-source fixture and runtime hash.

### Phase 3 — Preserve the existing consumer

- [ ] The existing browser dam-break and coupling scenarios pass their unchanged state and nonblank-image criteria on this source. proof: `sh scripts/xvfb.sh pnpm exec tsx scripts/verify-fluid-consumers.ts`, which runs `fluid-particles.playtest.json` and `fluid-particles-coupling.playtest.json` unchanged through the public runner.

## Acceptance criteria

- [ ] The four-arm GPU fixture verifies the regression repair on both qualified runtimes with finite actual buffer values and the specified speed bounds. proof: completed Phase 2 browser/native results above, with exact source and image hashes.
- [ ] The public fluid API and existing dam-break/coupling behavior remain compatible. proof: completed Phase 3 results plus full core tests, typecheck and unchanged API-surface validation.

## Verification notes

The missing-gate fixture is an assertion check, not another feature or acceptance box:
it must fail only `resource.FluidCollision.collisionPassed`. Every unexpected diagnostic,
including software device loss, invalidates the capture. Software adapters may establish
correctness but cannot establish hardware performance. Root CI must be green for the
exact final source before this PR is eligible to merge.

Initial `256059b2` local checkpoint: core 2,223 passed / 2 skipped; focused fluid/readback/proof tests 39/39 and CI structure/needs 141/141 pass. Package builds, full root/workspace typecheck, API/capability validation and lint pass (warnings remain). The ordinary root `pnpm test` launcher is blocked before execution by the local `tsx` Unix-socket restriction; this is not a full-suite pass. Independent review cleared the source and fail-closed proof routes. All runtime boxes remain open until hosted execution produces exact-source images and measurements.

First hosted diagnostic: [run37047774012](https://github.com/ThreeNativeHQ/threenative/actions/runs/37047774012) at `256059b2` reached actual GPU readbacks. Gate x=-1.046800017, free x=-0.75, diagonal travel0.300000029m and final speeds18.000000916/18m/s satisfy the fixed numeric checks. Qualification nevertheless failed `TN_CAPTURE_BLANK`: the original flat marker/gate image has only three colors. The unchanged [before](../../verification/prd479/256059b2-diagnostic/before.png), [after](../../verification/prd479/256059b2-diagnostic/after.png) and [minimal provenance](../../verification/prd479/256059b2-diagnostic/provenance.json) preserve this failure. The marker now draws the actual GPU position as a shaded sphere at `spacing * 0.44`, the solver collision radius; the gate geometry, numeric assertions and capture guard remain unchanged. A geometry/material regression passes. New positive/control and native/consumer execution remain pending; no runtime box is ticked from the diagnostic alone.

The next qualification source also reconciles develop `42fa306c0c46417afb4cafda23f55d09a557f860`, preserving its WorldCells/TerrainTiles/VirtualShadowNode changes. The fluid solver and numeric predicates remain byte-identical to the first diagnostic; only the physically sized particle visualization changes. Combined-source core build/declarations, full root/workspace typecheck and lint pass (1,014 warnings, no errors). The affected world/fluid/proof suite passes 203 tests with two skips. The real documentation/evidence budgets pass. Actual browser/native/consumer qualification still needs the new head; these local gates are distinct from the earlier runtime diagnostic.

The clean hosted rerun at `8c832dc0` ([run 37054144046](https://github.com/ThreeNativeHQ/threenative/actions/runs/37054144046)) stopped before rendering: the new physical-view test imports the public core package, but its build output was absent. The collision job now builds core before executing those contracts. CI structure/needs and view/proof tests pass 148/148 locally; no runtime acceptance is inferred from this prerequisite correction.

Browser checkpoint `b149762d`: the correctly sized sphere visibly remains against the gate; the missing-gate control travels through its wireframe boundary. The archive digest and all four PNG hashes were independently recomputed, and both after-images inspected. Native and unchanged consumer qualification remain pending. Develop `840d3530` is reconciled with no changes to core, playtest, native, the fluid example, proof scripts or the lockfile; its shooter-decal work is preserved unchanged. Final-source CI and remaining runtime criteria are still required.

The existing temporary-directory guard exposed one unregistered test fixture directory. Its sole failure is fixed using the shared `makeTempDir` helper while retaining explicit cleanup; guard and native proof-contract tests pass 8/8. This test-only correction does not alter the qualified runtime inputs. Documentation link/citation tests pass, and the actual 70.7 MB evidence tree remains under its 72 MB cap; two evidence-budget subprocess tests are locally blocked by the known `tsx` IPC restriction, not reported as passing.

The remaining `b149762d` hosted gates failed honestly. ARM64 QuickJS/wgpu built, but native startup reached the unchanged 120,000 ms bridge deadline (`TN_PLAYTEST_BRIDGE_MISSING`); artifact `11248008778` SHA-256 `79a9639f7ff8f4975433befc38a57b89f937079deec86d4d3c78b9acaac717c3`. The dam consumer passed all nine assertions and retained its four authored images; coupling reached falling/splash captures, then failed `TN_PLAYTEST_OPERATION_TIMEOUT`. Consumer artifact `11249751145` SHA-256 `2e55658d1c9280122921ed63e9698be7687a9763118ff3ca924cef0fd0de7153` is attached to the same run and currently expires 2026-12-31. No native or complete-consumer box is checked.

The next checkpoint changes diagnostic retention only: an early native failure retains the existing driver console through its supported factory seam and emits bounded allowlisted technical fields; consumer failures retain only recognized codes and an allowlisted operation/numeric budget parsed from the actual diagnostic. Missing channels remain explicitly unavailable. The fixture, solver, scenarios, timeout budgets and assertion gates are unchanged. Independent review cleared this diagnostic delta; 20 focused tests and root TypeScript pass. Develop `af7e253331a045b9d8fb5145d31e6b7adc715d32` is reconciled, preserving its documentation, scaffold hashes and tooling settings. A fresh hosted run is required to observe the failure cause rather than infer it.

Native validation follow-up: the retained `9da46881` diagnostic identifies an actual WGSL validation failure, rather than an unavailable adapter: concise `() => Return()` callbacks both append and return the terminal node, generating consecutive `return; return;`. The fluid guard callbacks now return void while preserving the same conditional early exits. The new generated-WGSL regression fails on the original source (1 failed / 15 passed) and passes after repair; the fluid/readback/browser-native proof contract suites pass 46/46. The repaired source still requires fresh native, browser and unchanged-consumer execution before qualification.

The first repaired native diagnostic reaches clean actual NVIDIA RTX 2080 readbacks and numeric assertions, but correctly fails the required baseline-image read because the shared device runner ignored `screenshots: "before-after"`. The runner now captures `before.png` after readiness and the initial sample, before measured advancement, using its existing nonblank capture gate. The real desktop-runner regression fails before repair and passes with tick-0/tick-3 captures; all 39 desktop tests pass. Independent review clears both bounded repairs. This diagnostic used an existing host and is not exact-source native qualification; fresh source-built-host and browser/consumer proofs remain required. The browser attempt queued behind another worker's capture lease and stopped at its existing 120-second deadline; no lease was overridden.

At `4627dfcd5`, the original positive/control browser proof, an independently source-built Linux V8/Dawn native host, and both unchanged consumers pass on the NVIDIA RTX 2080; 16 exact-source screenshots and all hashes were independently audited. The additional exact-source QuickJS/wgpu probe then reproduces a distinct portability defect: `wgpuDeviceCreateTexture` rejects `Texture usages TextureUsages(RENDER_ATTACHMENT) ... dimensions D3`. The existing Three patch now omits that unused flag only for compute-only 3D storage textures; 2D storage, ordinary 3D textures, explicit render targets and render-pass mipmaps retain their original usage. An actual descriptor regression fails before repair (1 failed / 2 passed), then passes; 49 focused fluid/readback/proof tests and all four patch-upgrade tests pass. The patch and normal pnpm lock hash change require new runtime qualification; no final-source native or consumer completion is claimed yet.

Full pre-patch root units execute 7,206 passing tests, with three unchanged time-budget failures in WorldCells GPU-scene, the build mutation arm and pristine-template typechecks. These are being rerun serially without changing their limits. Native package contracts execute 1,528 passing tests with two stale pinned-dependency SBOM receipt failures and a loaded conformance dry-run timeout; no complete native-package pass is claimed.
