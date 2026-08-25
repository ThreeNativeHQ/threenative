# PRD-198 verification — 2026-08-25

Status: the native raytracing surface refuses honestly until buffer-to-texture copy-out interop
exists. The selected browser and desktop conformance rows pass; unselected registry rows remain
blocked and are not claimed here.

## 1. Contract red-green

The live gate is in `packages/runtime-native/src/raytracing/bindings.cpp`. Native
`isSupported()` returns `false`, and `traceRays()` throws before backend dispatch:

```text
TN_NATIVE_RAYTRACING_UNAVAILABLE: native traceRays is unavailable until buffer-to-texture copy-out interop exists.
```

The focused contract is:

```sh
pnpm --filter @threenative/runtime-native exec vitest run tests/raytracing-contract.test.mjs
```

Before the gate, the same contract was red with `RED observed: native traceRays refusal gate
missing`; the registry/capability assertions were also red. After the gate and registry update:

```text
Test Files  1 passed (1)
Tests       4 passed (4)
```

The negative control removes this live block:

```cpp
if (!kNativeRayTracingResultInteropAvailable) {
    engine->throwException(kNativeRayTracingUnavailableMessage);
    return engine->newUndefined();
}
```

The focused contract then fails with `RED observed: native traceRays refusal gate missing`.
The test also keeps the Vulkan, DXR, and Metal copy-out TODOs present for the future un-gate.

## 2. Real browser and desktop conformance

The standard native build passed `[394/394]`. The raytracing-enabled V8 desktop build passed
`[350/350]`; Vulkan was unavailable on this Linux host, so the native RT backend reported its
stub state. The refusal is independent of hardware RT support.

Browser control and refusal row:

```sh
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target web \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --out artifacts/prd-198-web-2026-08-25
```

The bounded command exits `2` because 67 unselected rows are blocked. Its report records
`pass: 2, fail: 0, blocked: 67`; both selected rows completed at `1280x720`, with no page or GPU
validation errors. The browser keeps the existing WebGPU visual path and makes no native RT claim.

Desktop control and refusal row:

```sh
sh scripts/xvfb.sh node packages/runtime-native/conformance/run-conformance.mjs \
  --target desktop \
  --only-tests 01-basic-cube,98-native-raytracing-refusal \
  --reference artifacts/prd-198-web-2026-08-25 \
  --out artifacts/prd-198-desktop-2026-08-25
```

The bounded command also exits `2` with `pass: 2, fail: 0, blocked: 67`. The native refusal row
called `globalThis.mystralRT.traceRays({})` from the real conformance scene, logged the exact
`TN_NATIVE_RAYTRACING_UNAVAILABLE` message, rendered 300 frames, and emitted `TN_PRESENTS:300`.
It completed with `nativeExit: 0`, no GPU validation errors, pixel mismatch
`0.00001736111111111111`, and perceptual delta E `0.0009414396421669794`.

Reports:

- `packages/runtime-native/artifacts/prd-198-web-2026-08-25/report.json`
- `packages/runtime-native/artifacts/prd-198-desktop-2026-08-25/report.json`

Android, iOS, and hardware raytracing execution were not available on this Linux host and are not
claimed. The 67 unselected registry rows remain blocked.

## 3. Discovery truth and scaffold parent hashes

The source documentation for `getPlatform` adds the situation `can I raytrace on native` and the
constraint that native raytracing is unavailable until readable result interop exists. `pnpm build`
regenerated the capability manifests; the focused engine-MCP search passes:

```text
Test Files  1 passed (1)
Tests       12 passed (12)
```

Registry row `98-native-raytracing-refusal` is `implemented`, `required`, `desktopGate: true`, and
`availability: unavailable-until-readback`.

The night-batch steering note requires this capability-truth change to refresh the PRD-201 parent
scaffold hashes in the same lane. All seven hashes in
`packages/create-threenative/__tests__/scaffold.spec.ts` were refreshed from the generated
scaffolds. The focused scaffold contract is green:

```text
Test Files  1 passed (1)
Tests       26 passed (26)
```

`pnpm census` refreshed the native runtime record to `99,290` total lines, and `pnpm budgets`
passes after that generated evidence update.

## 4. Gate results

The initial manager bundle completed with exit 0:

- `pnpm check:docs`: 808 relative links across 659 Markdown files.
- `pnpm build`: capability manifests/reference regenerated at 146 entries; workspace builds and
  `publint` completed successfully.
- `pnpm typecheck`: all scoped projects completed successfully.
- `pnpm lint`: completed with 426 pre-existing complexity warnings and no errors.
- `pnpm test`: 218 files passed, 1 skipped; 2,178 tests passed, 3 skipped.
- `pnpm budgets`: passed at 99,200/100,000 native-runtime lines; the 22,432/15,000 framework
  LOC review trigger remains advisory and is recorded by the budget command.

The complete output is recorded in `.linchpin/lane-198-manager-gates.log`.

## 5. Review round 1 repair and final lane evidence

Sol's read-only round-1 review requested three changes before delivery:

- compile the common raytracing bindings and initialize/cleanup path in every native preset, including the normal no-RT build;
- propagate native callback exceptions through both QuickJS and JSC callback adapters instead of returning an ordinary JavaScript result;
- move the completed PRD from the active batch directory to `docs/PRDs/done/` and mark the batch row done.

The first repair build exposed a stale `MYSTRAL_HAS_RAYTRACING` include guard in
`packages/runtime-native/src/runtime.cpp` (`rt has not been declared`). Removing that guard made the
normal shipping build green:

```text
pnpm --filter @threenative/runtime-native native:build
[237/237] Linking CXX executable mystral-tools
```

The repair contract now covers the always-present refusal surface and both callback adapters:

```text
Test Files  1 passed (1)
Tests       6 passed (6)
```

The RT-configured build also compiles the same bindings and backend contract:

```text
cmake --build build/tn-linux-raytracing-repair --parallel
[395/395] Linking CXX executable mystral-tools
```

Vulkan was unavailable on this host, so that build used the stub backend. The updated default
shipping desktop run still proves the no-RT refusal path, and the RT-configured run proves the
same refusal surface under `TN_ENABLE_RAYTRACING=ON`. Each bounded run reports `pass: 2, fail: 0,
blocked: 67`; the exit code is `2` solely because the 67 unselected registry rows remain blocked.
Both selected runs completed the native refusal row with `nativeExit: 0`, rendered 300 frames, and
emitted `TN_PRESENTS:300`. The RT-configured row logged:

```text
[MystralRT] Bindings initialized (backend: none)
[ThreeNative conformance] native raytracing refusal: TN_NATIVE_RAYTRACING_UNAVAILABLE: native traceRays is unavailable until buffer-to-texture copy-out interop exists.
```

Its comparison remained within the recorded tolerance: pixel mismatch
`0.00001736111111111111`, perceptual delta E `0.0009414396421669794`, and zero GPU validation
errors. The repair reports are:

- `packages/runtime-native/artifacts/prd-198-web-repair-2026-08-25/report.json`
- `packages/runtime-native/artifacts/prd-198-desktop-repair-2026-08-25/report.json`
- `packages/runtime-native/artifacts/prd-198-desktop-rt-repair-2026-08-25/report.json`

JSC and QuickJS propagation are covered by the source contract; this Linux host did not execute an
iOS/JSC lane. Android, iOS, and hardware raytracing execution remain unclaimed. The completed PRD
now lives at `docs/PRDs/done/PRD-198-raytracing-surface-stays-dark-until-results-exist.md`, and the
batch README links it as done.

The repair manager bundle completed with exit 0 after the final contract adjustment:

- `pnpm check:docs`: 808 relative links across 660 Markdown files.
- `pnpm build`: capability manifests/reference regenerated at 146 entries; workspace builds and
  `publint` completed successfully.
- `pnpm typecheck`: all scoped projects completed successfully.
- `pnpm lint`: completed with 426 pre-existing complexity warnings and no errors.
- `pnpm test`: 219 files passed or skipped; 2,178 tests passed and 3 skipped.
- `pnpm budgets`: passed at 99,290/100,000 native-runtime lines; the 22,432/15,000 framework
  LOC review trigger remains advisory.

The complete repair output is recorded in `.linchpin/lane-198-repair-manager-gates.log`.
