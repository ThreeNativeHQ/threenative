<!-- native-coverage-generated:start -->
# Native coverage — 2026-08-28

Configuration: `tn-linux-coverage` with clang source-based coverage. Executed
25 native contract targets; 2 configured
targets could not be built and are named below.

| Subsystem | Instrumented lines | Covered | Line coverage |
| --- | ---: | ---: | ---: |
| `src/async/` | 73 | 53 | 72.60% |
| `src/audio/` | 1043 | 603 | 57.81% |
| `src/canvas/` | 996 | 482 | 48.39% |
| `src/cli/` | 1549 | 0 | 0.00% |
| `src/fs/` | 232 | 87 | 37.50% |
| `src/http/` | 402 | 175 | 43.53% |
| `src/input/` | 33 | 0 | 0.00% |
| `src/js/` | 2595 | 992 | 38.23% |
| `src/platform/` | 965 | 211 | 21.87% |
| `src/raytracing/` | 458 | 60 | 13.10% |
| `src/runtime.cpp` | 2019 | 785 | 38.88% |
| `src/storage/` | 260 | 225 | 86.54% |
| `src/utils/` | 0 | 0 | 0.00% |
| `src/vfs/` | 239 | 175 | 73.22% |
| `src/webgpu/` | 6930 | 2507 | 36.18% |
| `src/webtransport/` | 770 | 40 | 5.19% |
| `src/workers/` | 409 | 37 | 9.05% |
| **TOTAL** | **18973** | **6432** | **33.90%** |

Source digest: `sha256:b1cf4766584709bc4f00723e8aa785797e18bb99a0483ee362faa9ce0e3b40bd`

The default `pnpm budgets` gate reads this committed measurement without configuring or compiling
the native host. Any native source, native C++ test, CTest registration, or coverage aggregation
change requires this opt-in command to refresh the record.

| Coverage floor | Minimum |
| --- | ---: |
| `src/async/` | 72.60% |
| `src/audio/` | 57.81% |
| `src/canvas/` | 48.39% |
| `src/cli/` | 0.00% |
| `src/fs/` | 37.50% |
| `src/http/` | 43.53% |
| `src/input/` | 0.00% |
| `src/js/` | 38.23% |
| `src/platform/` | 21.87% |
| `src/raytracing/` | 13.10% |
| `src/runtime.cpp` | 38.88% |
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
- `src/platform/surface_win32.cpp`
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

- `threenative-physics-actuation-bindings-test`: TN_ENABLE_NATIVE_PHYSICS=OFF: native physics bindings are not linked
- `threenative-video-recorder-state-test`: TN_ENABLE_VIDEO=OFF: the video recorder target is not configured
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
