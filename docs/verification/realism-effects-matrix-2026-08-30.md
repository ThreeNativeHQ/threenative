# Realism effects platform matrix — 2026-08-30

The matrix has one row for each of the 13 covered exports and one result for each required native
platform. `HBAOEffect` is intentionally absent because its coverage row is `not-covered`.

| Export | Desktop | Android | iOS |
| --- | --- | --- | --- |
| `SSGIEffect` | skipped-with-reason — native RG11B10UFloat render target is not color-renderable on this adapter; no qualified desktop result | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `SSREffect` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `TRAAEffect` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `TemporalReprojectPass` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `PoissonDenoisePass` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `MotionBlurEffect` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `SharpnessEffect` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `VelocityPass` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `VelocityDepthNormalPass` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `TAAPass` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `LensDistortionEffect` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `SparkleEffect` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |
| `GradualBackgroundEffect` | skipped-with-reason — native frame completed; browser reference unavailable | skipped-with-reason — missing pinned SDL3/native Android dependencies | skipped-with-reason — Linux has no Xcode/signed-app adapter |

Commands and observed evidence:

```text
node packages/runtime-native/conformance/run-conformance.mjs --target web --only-tests <13 rows> --out artifacts/conformance/web
report: fail=13, blocked=74
adapter.info: architecture=swiftshader, vendor=google
reason: TN_CONFORMANCE_HARDWARE_ADAPTER_REQUIRED

node packages/runtime-native/conformance/run-conformance.mjs --target desktop --only-tests <13 rows> --out artifacts/conformance/realism-effects-desktop-2026-08-30-v3
report: fail=1, blocked=86
SSGIEffect: native completed with WebGPU validation errors because rg11b10ufloat-renderable is unsupported
other 12 rows: native completed, uniform=false, gpuErrors=0; comparison blocked by missing browser reference PNGs

node packages/runtime-native/conformance/run-conformance.mjs --target android --only-tests <13 rows> --out artifacts/conformance/realism-effects-android-2026-08-30
report: fail=0, blocked=87
reason: TN_PARITY_ANDROID_DEPS_BLOCKED

node packages/runtime-native/conformance/run-conformance.mjs --target ios --only-tests <13 rows> --out artifacts/conformance/realism-effects-ios-2026-08-30
report: fail=0, blocked=87
reason: TN_PARITY_IOS_SKIPPED_WITH_REASON
```

No platform pass is claimed from these runs. The selected native scene subset reached a non-uniform
frame on the 12 desktop rows without GPU errors; the missing hardware/browser lane prevents a
cross-platform comparison result.
