# PRD-198 verification — 2026-08-23

Status: the native raytracing refusal, capability truth, contract mutation, and targeted
browser/desktop conformance evidence are verified. The bounded conformance commands exit 2
because the runner intentionally reports the 67 unselected registry rows as blocked; both
selected rows pass.

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
