# PRD-198 verification — 2026-08-23

Status: the native raytracing refusal, capability truth, and non-vacuous browser gate are
verified. The browser raytracing row passes its standard WebGPU readiness control; this Chromium
adapter exposes no web raytracing feature, so the row makes no web raytracing support claim. The
unchanged browser cube control passes. The native desktop row passes the real refusal call.
Bounded conformance reports retain the runner's 67 unselected rows as blocked.

## 1. Contract red-green

The native gate is in `packages/runtime-native/src/raytracing/bindings.cpp`. It returns
`false` from `isSupported()` and throws from `traceRays()` before the old backend call. The
refusal is:

```text
TN_NATIVE_RAYTRACING_UNAVAILABLE: native traceRays is unavailable until buffer-to-texture copy-out interop exists.
```

The named contract command is:

```sh
pnpm --filter @threenative/runtime-native exec vitest run tests/raytracing-contract.test.mjs
```

Green result after restoration:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

Observed mutation red control: the live refusal block was temporarily removed from
`js_traceRays`:

```diff
-    if (!kNativeRayTracingResultInteropAvailable) {
-        engine->throwException(kNativeRayTracingUnavailableMessage);
-        return engine->newUndefined();
-    }
```

The same command exited 1 and reported:

```text
Error: RED observed: native traceRays refusal gate missing
```

The block was restored before continuing. The contract also checks the three copy-out TODOs:

```text
packages/runtime-native/src/raytracing/vulkan_rt.cpp:1552  TODO: Copy staging buffer data to WebGPU texture
packages/runtime-native/src/raytracing/dxr_rt.cpp:1286      TODO: Copy readback buffer data to WebGPU texture
packages/runtime-native/src/raytracing/metal_rt.mm:869     TODO: Implement WebGPU texture interop
```

## 2. Real browser and desktop conformance

The native build setup completed with `pnpm native:build`. An RT-enabled local CMake build was
then configured and built for the binding proof; the host reported that Vulkan was unavailable,
so it used the registered stub backend. The refusal is independent of hardware support.

Browser command:

```sh
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target web \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --out artifacts/prd-198-web-final-2026-08-23
```

Report: `packages/runtime-native/artifacts/prd-198-web-final-2026-08-23/report.json`.
Selected results: `01-basic-cube` pass and `98-native-raytracing-refusal` pass; `pass: 2,
fail: 0, blocked: 67`. The basic cube is the unchanged web control.

Desktop command:

```sh
TN_RUNTIME=/home/joao/projects/threenative/threenative-engine/.worktrees/prd-198-raytracing-surface-stays-dark/packages/runtime-native/build/tn-linux/mystral \
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target desktop \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --reference /home/joao/projects/threenative/threenative-engine/.worktrees/prd-198-raytracing-surface-stays-dark/packages/runtime-native/artifacts/prd-198-web-final-2026-08-23 \
  --out artifacts/prd-198-desktop-final-2026-08-23
```

Report: `packages/runtime-native/artifacts/prd-198-desktop-final-2026-08-23/report.json`.
Selected results: `pass: 2, fail: 0, blocked: 67`. For
`98-native-raytracing-refusal`, `nativeCompleted: true`, `nativeExit: 0`,
`gpuValidationErrors: []`, pixel mismatch `0.00001736111111111111`, and perceptual delta E
`0.0009414396421669794`. The native stdout contains the exact refusal above, followed by
`Rendered 300 frames` and `TN_PRESENTS:300`. The scene calls `globalThis.mystralRT.traceRays({})`
as a game call; it does not poke a contract helper directly.

## 3. Capability and registry truth

Before regeneration, this capability test was intentionally red:

```sh
pnpm exec vitest run packages/engine-mcp/__tests__/search.spec.ts
```

It exited 1 because the stale manifest did not contain the native raytracing constraint. After
the source documentation and generated files were updated, the same test passed:

```text
Test Files  1 passed (1)
Tests       12 passed (12)
```

`pnpm build` exited 0 and generated 122 capability entries. The generated diff is limited to
the `getPlatform` entry's new raytracing situation and constraint in:

```text
packages/core/capabilities.json
packages/create-threenative/capabilities.json
packages/create-threenative/agent-docs/references/capability-reference.md
```

No unrelated capability row or ctx-surface entry changed. Registry row
`98-native-raytracing-refusal` is `implemented`, `required`, `desktopGate: true`, and
`availability: unavailable-until-readback`.

## 4. Additional gates

```text
pnpm typecheck  -> exit 0
pnpm lint       -> exit 0 (291 existing warnings; no errors)
pnpm budgets    -> exit 0 (existing LOC/census review notices reported)
pnpm quality    -> exit 0 (70 findings reported; no failure)
```

The first root `pnpm test` run exposed the new conformance dry-bundle row crossing the old
60-second assertion timeout. The conformance spec now uses the runner's existing 120-second
child-process limit. The runtime-native package test then passed with 54 files, 360 tests
passed, and 31 skipped.

The final root `pnpm test` run passed 197 test files and 1,882 tests, but exited 1 on two
unrelated 5-second timeouts in `scripts/__tests__/check-capability-docs.spec.ts` under the
parallel workspace load. The same spec run alone passed 7/7 in 6.61 seconds. No source change
was made for that unrelated suite-load failure.

## 5. Repair round 1 — default no-RT native surface

The repair round read the review log at
`.linchpin/lane-198-review.log` and the source PRD at
`docs/PRDs/batch-2026-08-23-tech-debt/PRD-198-raytracing-surface-stays-dark-until-results-exist.md`.
The review defect was confirmed: `bindings.cpp` and the runtime registration were hidden behind
`TN_ENABLE_RAYTRACING`, while every shipped preset disables that option. The repair keeps
`rt_common.cpp` and `bindings.cpp` in every native build, registers the public surface in every
runtime, and leaves Vulkan, DXR, and Metal backend sources behind `MYSTRAL_USE_RAYTRACING`.

### 5.1 Contract red-green and old-gate mutation

The new no-RT contract was run before the implementation:

```sh
pnpm --filter @threenative/runtime-native exec vitest run tests/raytracing-contract.test.mjs
```

It exited 1 with 5 tests and 1 failure because the source list was still conditional. After the
CMake/runtime repair, the same command exited 0:

```text
Test Files  1 passed (1)
Tests       5 passed (5)
```

The old-gate mutation was then temporarily restored around the public source list with
`if(MYSTRAL_USE_RAYTRACING)`. The same contract command exited 1 with 5 tests and 1 failure,
reporting that the no-RT build must compile the lightweight common backend and JS bindings. The
mutation was removed, and the command returned to exit 0 with 5/5 tests passing. The contract
also checks that all three heavy backend source entries remain in the opt-in section and that the
refusal guard remains before backend dispatch.

### 5.2 Native build and real game call

The default shipped native preset was built with:

```sh
pnpm native:build
```

It exited 0 and ended with `[339/339] Linking CXX executable mystral`. The resulting cache has
`TN_ENABLE_RAYTRACING:BOOL=OFF` and `MYSTRAL_USE_RAYTRACING:BOOL=OFF`; the default object list
contains `src/raytracing/rt_common.cpp.o` and `src/raytracing/bindings.cpp.o`.

The heavy opt-in path was configured and built with:

```sh
cmake -S packages/runtime-native -B packages/runtime-native/build/prd-198-rt-on -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DMYSTRAL_USE_V8=ON -DMYSTRAL_USE_DAWN=ON -DMYSTRAL_USE_QUICKJS=OFF -DMYSTRAL_USE_WGPU=OFF \
  -DTN_ENABLE_CANVAS2D=ON -DTN_ENABLE_VIDEO=OFF -DTN_ENABLE_RAYTRACING=ON \
  -DTN_ENABLE_WEBTRANSPORT=ON -DTN_ENABLE_NATIVE_GLTF=OFF -DTN_ENABLE_DRACO=OFF \
  -DTN_ENABLE_DEBUG_SERVER=OFF -DTN_ENABLE_NATIVE_PHYSICS=OFF -DMYSTRAL_USE_LIBUV=ON \
  -DCMAKE_MAKE_PROGRAM=/home/joao/projects/threenative/threenative-engine/.worktrees/prd-198-raytracing-surface-stays-dark/packages/runtime-native/.runtime/tools-venv/bin/ninja \
  && cmake --build packages/runtime-native/build/prd-198-rt-on --parallel 2
```

It exited 0, reported `Ray tracing support enabled`, and ended with
`[383/383] Linking CXX executable mystral`. This Linux host reported `Vulkan not found`, so the
Vulkan backend was correctly left disabled in this probe; the contract test covers the Vulkan,
DXR, and Metal source entries remaining in the heavy compile path.

The browser control and default native executable were exercised through the real conformance
scene, whose game code calls `globalThis.mystralRT.traceRays({})`:

```sh
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target web \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --out artifacts/prd-198-repair1-web-2026-08-23
```

```text
exit 2 (bounded run: pass 2, fail 0, blocked 67)
```

```sh
TN_RUNTIME=/home/joao/projects/threenative/threenative-engine/.worktrees/prd-198-raytracing-surface-stays-dark/packages/runtime-native/build/tn-linux/mystral \
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target desktop \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --reference artifacts/prd-198-repair1-web-2026-08-23 \
  --out artifacts/prd-198-repair1-desktop-2026-08-23
```

```text
exit 2 (bounded run: pass 2, fail 0, blocked 67)
```

The selected desktop refusal report has `nativeCompleted: true`, `nativeExit: 0`, no GPU
validation errors, pixel mismatch `0.00001736111111111111`, and perceptual delta E
`0.0009414396421669794`. Native stdout contains the exact
`TN_NATIVE_RAYTRACING_UNAVAILABLE: native traceRays is unavailable until buffer-to-texture copy-out interop exists.`
message, followed by `Rendered 300 frames` and `TN_PRESENTS:300`.

### 5.3 Generated truth, TODOs, and gates

The focused capability search was rerun:

```sh
pnpm exec vitest run packages/engine-mcp/__tests__/search.spec.ts
```

It exited 0 with 1 test file and 12 tests passing. `pnpm build` exited 0 and generated 122
capability entries. The generated capability files and
`packages/runtime-native/conformance/registry.json` had no diff from the repair; registry row
`98-native-raytracing-refusal` remains implemented, required, desktop-gated, and
`unavailable-until-readback`.

The copy-out TODOs remain unchanged:

```text
packages/runtime-native/src/raytracing/vulkan_rt.cpp:1552: // TODO: Copy staging buffer data to WebGPU texture
packages/runtime-native/src/raytracing/dxr_rt.cpp:1286: // TODO: Copy readback buffer data to WebGPU texture
packages/runtime-native/src/raytracing/metal_rt.mm:869: // TODO: Implement WebGPU texture interop
```

Repair-round gate results:

```text
pnpm typecheck -> exit 0
pnpm lint      -> exit 0 (291 existing warnings; no errors)
pnpm test      -> exit 0 (198 test files, 1,884 tests passed)
pnpm budgets   -> exit 0 (pre-existing LOC/census notices reported)
pnpm quality   -> exit 0 (70 findings reported; no failure)
```

An earlier root test attempt found stale Chromium processes left by the conformance run;
`bash packages/playtest/__tests__/orphan-cleanup.sh` then reported `no orphans`, and the final
root suite above passed. `git diff --check` passed. Before staging, the tracked repair diff was
limited to the CMake source-list correction, unconditional runtime registration/cleanup, this
verification record, and the native contract test.

## 6. Repair round 2 — browser control uses only standard WebGPU readiness

The browser defect was reproduced in
`packages/runtime-native/conformance/scenes/shared/raytracing-refusal.js`: the previous repair
invented `"ray-tracing"` as a `GPUFeatureName` and requested it before `startVisualScene`. This
Chromium adapter correctly rejected that non-standard feature, so the existing web surface never
started.

The browser branch now performs an observable standard WebGPU control before rendering:

- `navigator.gpu.requestAdapter()` must exist and return an adapter.
- The adapter must expose standard `requestDevice()` and that request must succeed.
- The temporary device is destroyed, and the control returns `{ target: "web", webGpuReady: true }`.
- No browser ray-tracing feature or `requiredFeatures` claim is made; the returned detail does not
  claim that web ray tracing exists.

The contract mutation is exact:

```diff
-      ? await assertBrowserWebGpuReadiness()
+      ? ({ target: "web", webGpuReady: true })
```

The mutation makes `assertBrowserWebGpuControl` fail with:

```text
RED observed: browser WebGPU readiness is not checked before the surface
```

Restored focused contract result:

```sh
pnpm --filter @threenative/runtime-native exec vitest run tests/raytracing-contract.test.mjs
```

```text
Test Files  1 passed (1)
Tests       7 passed (7)
```

Browser execution:

```sh
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target web \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --out artifacts/prd-198-repair2-fixed-web-2026-08-23
```

Report: `packages/runtime-native/artifacts/prd-198-repair2-fixed-web-2026-08-23/report.json`.
Exit `2` with `pass: 2, fail: 0, blocked: 67`; both selected rows passed. The raytracing row
completed the browser WebGPU control, started the existing visual surface, rendered a non-uniform
1280×720 capture, and reported no page errors or GPU validation errors.

Native desktop execution:

```sh
TN_RUNTIME="$PWD/packages/runtime-native/build/tn-linux/mystral" \
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target desktop \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --reference artifacts/prd-198-repair2-fixed-web-2026-08-23 \
  --out artifacts/prd-198-repair2-fixed-desktop-2026-08-23
```

Report: `packages/runtime-native/artifacts/prd-198-repair2-fixed-desktop-2026-08-23/report.json`.
Exit `2` with `pass: 2, fail: 0, blocked: 67`. The raytracing row made the native game call and
recorded:

```text
[ThreeNative conformance] native raytracing refusal: TN_NATIVE_RAYTRACING_UNAVAILABLE: native traceRays is unavailable until buffer-to-texture copy-out interop exists.
Rendered 300 frames in 9284ms
TN_PRESENTS:300
```

It completed with `nativeExit: 0`, `gpuValidationErrors: []`, pixel mismatch
`0.00001736111111111111`, and perceptual delta E `0.0009414396421669794`.

Final checks:

```text
pnpm typecheck -> exit 0 (rerun after the build completed)
pnpm lint      -> exit 0 (291 pre-existing warnings; no errors)
pnpm build     -> exit 0
pnpm test      -> exit 0 (198 test files, 1,884 tests passed)
```

## 7. Repair round 3 — callback exception propagation and record consistency

The fresh review found that `bindings.cpp` calls `engine->throwException()` for native
`traceRays` refusal, but the JSC callback adapter did not copy that pending exception into its
`JSValueRef* exception` output. The QuickJS callback also had no explicit return of
`JS_EXCEPTION` after a native callback raised. The status paragraph above simultaneously said
the browser row failed closed while the repair-round evidence said both selected rows passed.

The new source-derived JSC/QuickJS adapter contracts and verification-record consistency check
were written and run before the implementation or status fix:

```sh
pnpm --filter @threenative/runtime-native exec vitest run tests/raytracing-contract.test.mjs
```

Red result:

```text
exit 1
Test Files  1 failed (1)
Tests       4 failed | 7 passed (11)
Error: RED observed: JSC native exception propagation missing
AssertionError: the mutation must remove JSC exception propagation
AssertionError: the mutation must remove QuickJS exception propagation
Error: RED observed: verification header contradicts the passing browser evidence
```

The two mutation checks were also red because neither adapter propagation block existed to
remove. The implementation and the record status are repaired below and the same command is
rerun green.

The repair maps each JSC context to its engine, marks exceptions raised during a native callback,
copies the pending `JSValueRef` into JSC's `exception` out-parameter, and clears the adapter marker
after handoff. QuickJS uses the same pending marker and returns `JS_EXCEPTION`; its existing
exception object remains owned by the QuickJS context.

Focused contract result after the source and record fixes:

```sh
pnpm --filter @threenative/runtime-native exec vitest run tests/raytracing-contract.test.mjs
```

```text
exit 0
Test Files  1 passed (1)
Tests       11 passed (11)
```

The complete runtime-native package gate also passed:

```text
pnpm --filter @threenative/runtime-native test -> exit 0
Vitest: 54 test files passed, 367 tests passed, 31 skipped
Physics parity: 28 web tests passed and 2 Rust tests passed
publint: All good!
```

The default native build passed again with `pnpm native:build` and ended with the existing V8
Linux executable. A separate QuickJS desktop build passed with the supported no-native-physics
configuration and ended with `[389/389] Linking CXX executable mystral`.

The browser and native conformance rows were rerun against the repaired tree:

```sh
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target web \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --out artifacts/prd-198-repair3-web-2026-08-24
```

Report: `packages/runtime-native/artifacts/prd-198-repair3-web-2026-08-24/report.json`.
The bounded command exited `2` with `pass: 2, fail: 0, blocked: 67`; both selected browser rows
completed at 1280×720 with no page errors or GPU validation errors.

The V8 desktop command wrote
`packages/runtime-native/artifacts/prd-198-repair3-desktop-v8-2026-08-24/report.json` and
exited `2` with `pass: 2, fail: 0, blocked: 67`. The selected native refusal row completed with
`nativeExit: 0`, `gpuValidationErrors: []`, pixel mismatch
`0.00001736111111111111`, perceptual delta E `0.0009414396421669794`, the exact refusal message,
`Rendered 300 frames`, and `TN_PRESENTS:300`.

The same desktop rows ran against the QuickJS executable and wrote
`packages/runtime-native/artifacts/prd-198-repair3-desktop-quickjs-2026-08-24/report.json`.
It also exited `2` with `pass: 2, fail: 0, blocked: 67`; native stdout identified `QuickJS`,
logged the refusal from the real scene call, completed 300 frames with `nativeExit: 0`, and had
no GPU validation errors. Both native rows matched the browser reference within the same pixel
and perceptual deltas.

Repository gates:

```text
pnpm typecheck -> exit 0
pnpm lint      -> exit 0 (291 pre-existing warnings; no errors)
pnpm build     -> exit 0 (122 capabilities generated)
pnpm budgets   -> exit 0 (existing LOC/census notices reported)
```

The root `pnpm test` orchestration was not green in this shared checkout: it stopped in the
playtest orphan guard after the asset package's 7 files and 58 tests passed. The prescribed
orphan probe was retried; concurrent workspace activity produced stale Chromium, exit 137 during
the five-second probe, and then a shared `/tmp` test-directory count race (`135` before, `134`
after). No source test failure was reported. The direct runtime-native package gate above is the
applicable green test evidence for this repair.

Unexecuted targets and rows:

- JSC/iOS execution was unavailable on this Linux host; the JSC adapter has source contracts only,
  and no iOS simulator or physical iOS run is claimed.
- Android physical-device and emulator runs were not executed.
- The 67 registry rows excluded by `--only-tests` remain blocked; they are not claimed as passed.
- The native conformance host reported the stub raytracing backend; no hardware raytracing support
  or future result interop is claimed.

## 8. Repair round 4 — QuickJS callback exceptions bind to their context

The fresh review found that `packages/runtime-native/src/js/quickjs_engine.cpp:838` uses the
process-global `engineInstance_` to consume a native callback's pending exception. A second
QuickJS engine overwrites that pointer, so a callback created by the first engine can return
`undefined` instead of `JS_EXCEPTION`.

The two-engine regression and its focused contract assertion were added before the engine repair.
The focused contract was red against the handoff commit:

```sh
pnpm --filter @threenative/runtime-native exec vitest run tests/raytracing-contract.test.mjs
```

```text
exit 1
Test Files  1 failed (1)
Tests       1 failed | 11 passed (12)
Error: RED observed: QuickJS callback exception ownership is not context-local
```

The executable regression was built and run against the same unmodified engine implementation:

```sh
cmake --build packages/runtime-native/build/prd-198-quickjs \
  --target threenative-quickjs-context-test --parallel 2
packages/runtime-native/build/prd-198-quickjs/threenative-quickjs-context-test
```

It exited 1 after creating both QuickJS engines:

```text
FAILED: first context returned a value instead of JS_EXCEPTION
```

The repair stores `this` in the QuickJS context opaque slot at context creation and resolves that
owner from the callback's `ctx`. The process-global `engineInstance_` remains only for the existing
`performance.now()` helper. The existing JSC context mapping is unchanged.

Focused contract result after the repair:

```sh
pnpm --filter @threenative/runtime-native exec vitest run tests/raytracing-contract.test.mjs
```

```text
exit 0
Test Files  1 passed (1)
Tests       12 passed (12)
```

The native two-context regression was rebuilt and passed:

```sh
cmake --build packages/runtime-native/build/prd-198-quickjs \
  --target threenative-quickjs-context-test --parallel 2
packages/runtime-native/build/prd-198-quickjs/threenative-quickjs-context-test
```

```text
[QuickJS] Error: InternalError: first-engine exception
PASS QuickJS: first context propagated its exception after the second engine existed
```

Native and repository gates for this repair:

```text
pnpm --filter @threenative/runtime-native test -> exit 0
  Vitest: 54 files passed, 368 tests passed, 31 skipped
  Physics parity: 28 web tests passed and 2 Rust tests passed
  publint: All good!
pnpm native:build -> exit 0
  Default Linux native build configured V8 + Dawn and reported no work to do.
pnpm typecheck -> exit 0
pnpm lint -> exit 0 (291 pre-existing warnings; no errors)
pnpm budgets -> exit 0 (existing LOC/census review notices reported)
pnpm quality -> exit 0 (70 findings reported; no failure)
```

The root test orchestration reached the package suites and build phase, then exited 1 in the
Playwright orphan guard. The guard reported Chromium processes left by its five-second teardown;
the direct prescribed probe reproduced the same orphan result. No source test failure was
reported. The generated build phase completed with 122 capability entries.

The following remain explicitly unverified in this repair: JSC execution and iOS simulator or
physical-device execution; Android physical-device and emulator execution; the 67 conformance
rows excluded by the selected raytracing run; and hardware raytracing/result interop. The native
QuickJS regression is the executed desktop QuickJS control.
