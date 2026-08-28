# Native coverage — 2026-08-28

Configuration: `tn-linux-coverage` with clang source-based coverage. Executed
25 native contract targets; 2 configured targets could not be built and are named below. Coverage
is exported once per executable against only that executable's profiles, then unioned by source
line. Every product object in `compile_commands.json` is exported with an empty profile first, so
compiled-but-unlinked code remains in the denominator at zero hits.

| Subsystem | Instrumented lines | Covered | Line coverage |
| --- | ---: | ---: | ---: |
| `src/async/` | 73 | 53 | 72.60% |
| `src/audio/` | 1043 | 603 | 57.81% |
| `src/canvas/` | 996 | 482 | 48.39% |
| `src/cli/` | 1549 | 0 | 0.00% |
| `src/fs/` | 232 | 87 | 37.50% |
| `src/http/` | 402 | 175 | 43.53% |
| `src/input/` | 33 | 0 | 0.00% |
| `src/js/` | 2587 | 984 | 38.04% |
| `src/platform/` | 965 | 211 | 21.87% |
| `src/raytracing/` | 458 | 60 | 13.10% |
| `src/runtime.cpp` | 1952 | 771 | 39.50% |
| `src/storage/` | 260 | 225 | 86.54% |
| `src/utils/` | 0 | 0 | 0.00% |
| `src/vfs/` | 239 | 175 | 73.22% |
| `src/webgpu/` | 6908 | 2249 | 32.56% |
| `src/webtransport/` | 770 | 40 | 5.19% |
| **TOTAL** | **18467** | **6115** | **33.11%** |

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
- `src/workers/worker_registry.cpp`
- `src/workers/worker_thread.cpp`

## Blocked targets

- `threenative-physics-actuation-bindings-test`: TN_ENABLE_NATIVE_PHYSICS=OFF: native physics bindings are not linked
- `threenative-video-recorder-state-test`: TN_ENABLE_VIDEO=OFF: the video recorder target is not configured

## Red-green and fail-closed evidence

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

After implementation:

```text
Checked 3 files in 17ms. No fixes applied.
Test Files 1 passed (1)
Tests 9 passed (9)
```

The contracts preserve zero-hit lines, union disjoint hits across binaries, reject missing merged
or per-invocation profiles, separate compile truth from LLVM measurement, fail if LLVM omits a
compiled file, retain only the two accepted configuration blockers, and keep instrumentation off
by default. `src/audio/vorbis_impl.c` and `src/utils/stb_impl.cpp` compile but contain zero lines
attributed to their wrapper files; their executable regions are attributed to included third-party
headers, so they appear as compiled with 0 instrumentable lines rather than as uncompiled.

The real command completed with the table above:

```sh
pnpm --filter @threenative/runtime-native native:coverage
```

The compiler negative control also failed during configuration as required:

```text
TN_ENABLE_COVERAGE requires clang source-based coverage; configure with clang/clang++
Configuring incomplete, errors occurred!
```
