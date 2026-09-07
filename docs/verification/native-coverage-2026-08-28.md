<!-- native-coverage-generated:start -->
# Native coverage — 2026-08-28

Configuration: `tn-linux-coverage` with clang source-based coverage. Executed
38 native contract targets; 2 configured
targets could not be built and are named below.

| Subsystem | Instrumented lines | Covered | Line coverage |
| --- | ---: | ---: | ---: |
| `src/async/` | 73 | 60 | 82.19% |
| `src/audio/` | 1051 | 897 | 85.35% |
| `src/canvas/` | 1172 | 954 | 81.40% |
| `src/cli/` | 1599 | 820 | 51.28% |
| `src/fs/` | 235 | 189 | 80.43% |
| `src/http/` | 410 | 377 | 91.95% |
| `src/js/` | 2626 | 1693 | 64.47% |
| `src/platform/` | 1050 | 619 | 58.95% |
| `src/raytracing/` | 458 | 152 | 33.19% |
| `src/runtime.cpp` | 2268 | 1548 | 68.25% |
| `src/screenshot_gate.cpp` | 27 | 24 | 88.89% |
| `src/storage/` | 327 | 286 | 87.46% |
| `src/utils/` | 0 | 0 | 0.00% |
| `src/vfs/` | 239 | 195 | 81.59% |
| `src/webgpu/` | 8227 | 5152 | 62.62% |
| `src/webtransport/` | 1391 | 991 | 71.24% |
| `src/workers/` | 615 | 524 | 85.20% |
| **TOTAL** | **21768** | **14481** | **66.52%** |

Source digest: `sha256:f86526d78703ddbe83794809deab5adb632435bce36cd73fa7efa1084523fd72`

The default `pnpm budgets` gate reads this committed measurement without configuring or compiling
the native host. Any native source, native C++ test, CTest registration, or coverage aggregation
change requires this opt-in command to refresh the record.

| Coverage floor | Minimum |
| --- | ---: |
| `src/async/` | 72.60% |
| `src/audio/` | 57.37% |
| `src/canvas/` | 48.39% |
| `src/cli/` | 0.00% |
| `src/fs/` | 37.45% |
| `src/http/` | 43.53% |
| `src/js/` | 38.23% |
| `src/platform/` | 21.87% |
| `src/raytracing/` | 13.10% |
| `src/runtime.cpp` | 38.88% |
| `src/screenshot_gate.cpp` | 88.89% |
| `src/storage/` | 86.54% |
| `src/utils/` | 0.00% |
| `src/vfs/` | 73.22% |
| `src/webgpu/` | 33.82% |
| `src/webtransport/` | 5.19% |
| `src/workers/` | 9.05% |

## Not compiled in this configuration

- `src/debug/debug_server.cpp`
- `src/gltf/gltf_loader.cpp`
- `src/js/jsc_engine.mm`
- `src/js/quickjs_engine.cpp`
- `src/physics/native_bindings.cpp`
- `src/platform/android_main.cpp`
- `src/platform/surface_android.cpp`
- `src/platform/surface_metal.mm`
- `src/raytracing/dxr_rt.cpp`
- `src/raytracing/metal_rt.mm`
- `src/raytracing/vulkan_rt.cpp`
- `src/utils/cgltf_impl.cpp`
- `src/video/async_capture.cpp`
- `src/video/gpu_readback_recorder.cpp`
- `src/video/screen_capture_kit.mm`
- `src/video/video_recorder.cpp`
- `src/video/windows_graphics_capture.cpp`
- `src/video/windows_graphics_capture_impl.cpp`

## Blocked targets

- `threenative-physics-actuation-bindings-test`: TN_ENABLE_NATIVE_PHYSICS=OFF
- `threenative-video-recorder-state-test`: TN_ENABLE_VIDEO=OFF
<!-- native-coverage-generated:end -->

## Floor changes

**This section lives below the generated marker on purpose.** It sat inside the generated block
until 2026-08-29, where every `native:coverage` run silently deleted it — the ratchet-release
history this file calls rare and important was one regeneration away from being lost each time.
Keep hand-authored provenance below the marker.

`src/runtime.cpp` 39.50% -> 38.88%, released once on 2026-08-28 when PRD-250's off-thread
Worker landed. This is not a coverage regression: covered lines in that file went **up**,
771 -> 785. The file grew 1952 -> 2019 lines, so the ratio fell while absolute coverage
rose. The same change brought `src/workers/` into this configuration for the first time -
it was previously listed under "not compiled" - which is why a new 9.05% floor appears
above and why the total moved on a larger denominator.

Releasing a floor is a ratchet release and should stay rare. The debt this records is
`src/workers/` at 9.05%: `worker_registry.cpp` and `worker_thread.cpp` compile but are
barely exercised by this configuration's tests.

## Phase 1 red-green and fail-closed evidence

The test landed before the implementation:

```text
FAIL tests/native-coverage.test.mjs
Cannot find module '../scripts/measure-native-coverage.mjs'
Test Files 1 failed (1); Tests no tests
```

The first multi-executable export emitted `41 functions have mismatched data`. Making warnings
fatal turned that into a hard failure. A unique-object export still collided on inline/template
symbols (`89 functions`). The accepted implementation exports each executable against only its own
profiles and unions LCOV source lines; the final command emits no LLVM warnings.

```text
Checked 3 files in 17ms. No fixes applied.
Test Files 1 passed (1)
Tests 9 passed (9)
```

Every successful invocation produces its own required profile. Compile truth comes from
`compile_commands.json`; `src/audio/vorbis_impl.c` and `src/utils/stb_impl.cpp` therefore remain
compiled with 0 instrumentable lines rather than being misreported as uncompiled.

The compiler negative control failed during configuration as required:

```text
TN_ENABLE_COVERAGE requires clang source-based coverage; configure with clang/clang++
Configuring incomplete, errors occurred!
```

## Phase 2 CTest evidence

The registration test was red before `enable_testing()` and the 27 primary registrations existed:

```text
FAIL should register every native executable with CTest
The input did not match /enable_testing\(\)/
Test Files 1 failed (1)
```

After registration, the focused gate and full runner were green:

```text
Test Files 2 passed (2)
Tests 15 passed (15)

100% tests passed out of 26
native-contract = 6.62 sec*proc (28 tests)
17 - threenative-physics-actuation-bindings-test (Disabled)
26 - threenative-video-recorder-state-test (Disabled)
```

CTest owns all 27 primary target names plus the second required shutdown invocation. Phase 1 now
runs those registrations one at a time so its per-invocation profiles cannot drift from the
correctness runner.

The existing-build regression check removed `build/tn-linux/CTestTestfile.cmake`, made the source
newer than the generated build, and invoked only `pnpm native:test:cpp`. Its aggregate build
regenerated CTest metadata before inventory validation, then passed all 26 runnable registrations
with exactly the same two disabled feature-off rows.

The real legacy-shape negative control was registered in a disposable CTest file and failed:

```text
RED observed: legacy wrapper shape rejected
command-encoder-class-table contract: 2 failure(s)
0% tests passed, 1 tests failed out of 1
```

## Coverage expansion verification — 2026-09-07

The reconciled native contract suite executes five additional targets covering Canvas/audio,
CLI/network/filesystem, JavaScript modules, runtime/platform behavior, and WebGPU. The CLI
executables delegate to the same entry functions exercised by the contract tests. Assertions
check script completion as well as evaluation success, and filesystem fixtures use an isolated
temporary working directory.

The coverage candidate initially made the ray-tracing stub report support when an environment
variable was set. A compiled negative control exposed that false capability before the
production override was removed:

```text
[MystralRT] No hardware RT available, using stub backend
FAIL: unavailable native ray tracing became supported through an environment variable
```

After restoring honest stub support reporting, the same compiled probe passed. The new CLI
contract retains the unsupported-capability assertion:

```text
[MystralRT] No hardware RT available, using stub backend
PASS: unavailable native ray tracing remains unsupported
```

The five added contract targets passed locally, followed by a complete `pnpm native:coverage`
measurement with all 38 runnable contract targets passing. The generated result above is
**14,481 / 21,768 lines (66.52%)**, compared with the base commit's committed **9,579 / 21,762
lines (44.02%)**. No coverage floor was lowered.

This evidence is the Linux clang/V8/Dawn configuration. Physics and video were disabled as
listed above; the optional SDL window checks skipped because the available SDL build could
not initialize a window driver. It does not establish Windows, macOS, Android, iOS, or
window-presentation coverage, and it does not meet an 80% total-coverage target.
