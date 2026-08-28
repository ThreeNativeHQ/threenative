# Native C++ coverage — first measurement, 2026-08-28

**What this is:** a scouting run, not a gate. It exists because
[PRD-229](../PRDs/refactor-2026-08-28/PRD-229-the-native-host-is-provable-before-it-is-moved.md) plans a
coverage instrument for `packages/runtime-native` and a plan that names a baseline it has never
taken is a plan built on a guess. This run establishes that the toolchain works here, and what the
number is today. It is **not** the PRD's Phase 1 deliverable — there is no script, no gate, no
committed build option, and no negative control was exercised.

**Executed:** 2026-08-28 on this Linux workstation, repository at `7b729e2d`, working tree carrying
another lane's uncommitted `webgpu_compat.h` edit.

## How it was produced

```sh
cmake -S . -B build/tn-linux-coverage -G Ninja \
  -DCMAKE_BUILD_TYPE=Debug -DCMAKE_C_COMPILER=clang -DCMAKE_CXX_COMPILER=clang++ \
  -DCMAKE_CXX_FLAGS="-fprofile-instr-generate -fcoverage-mapping -g -O0" \
  -DCMAKE_EXE_LINKER_FLAGS="-fprofile-instr-generate" \
  # remaining cache variables copied from the tn-linux preset
cmake --build build/tn-linux-coverage --target <25 threenative-*-test targets> -j 20
# each executable run with its own LLVM_PROFILE_FILE, then:
llvm-profdata merge -sparse prof/*.profraw -o merged.profdata
llvm-cov report <each executable as -object> -instr-profile=merged.profdata \
  -ignore-filename-regex='(third_party|\.runtime|/usr/|/opt/|sdl3-build)'
```

Toolchain: clang 22.1.8, `/usr/bin/llvm-cov`, `/usr/bin/llvm-profdata`. The shipping build is
unchanged — it still uses gcc 16.1.1 in `build/tn-linux`.

## What ran, and what did not

| Outcome | Count | Detail |
| --- | ---: | --- |
| Test targets requested | 25 | every `threenative-*-test` in `CMakeLists.txt` |
| Built | 24 | — |
| **Failed to link** | 1 | `threenative-physics-actuation-bindings-test` — needs `TN_ENABLE_NATIVE_PHYSICS=ON`, which the `tn-linux` preset sets OFF |
| Ran and exited 0 | 21 | — |
| Skipped by their own contract | 1 | `threenative-handle-lifetime-test` exits `77` with `SKIP: quickjs is not compiled in` — a skip encoded as an exit code, invisible to any runner that only checks for zero |
| Not invokable bare | 1 | `threenative-shutdown-lifetime-test` prints `usage: … http \| timer-watch <path>` — it takes an argument the vitest wrapper supplies; this run did not |
| **Failed** | 1 | `threenative-render-pass-class-table-test` — see below |

### The render-pass class-table contract does not hold in this build

```
FAIL: render pass methods are prototype members, not per-instance own properties
FAIL: render pass method identities are shared across instances
FAIL: detached end() reports the missing receiver by name, got: Cannot read properties of undefined (reading 'call')
render-pass-class-table contract: 3 failure(s)
```

The same executable built from the same source in `build/tn-linux` (gcc, Release) exits `0` and
prints `render-pass-class-table: prototype=shared receivers=resolved pairing=map-resolved
runtime=wired`. Both runs acquired a real adapter (`NVIDIA GeForce RTX 2080`, Vulkan backend), so
this is not a headless-adapter difference.

**Cause unattributed.** The two builds differ in compiler (clang vs gcc) *and* in optimization
(`Debug -O0` vs `Release`), and this run did not separate them. Recording it as observed, not
explained.

**Why it matters to PRD-229:** a coverage build and a sanitizer build are *different
configurations*, and at least one C++ contract currently produces a different verdict in one. A
coverage gate that runs a configuration where a contract fails for configuration reasons is a gate
that cries wolf. PRD-229 Phase 1 must either match the shipping configuration except for
instrumentation, or attribute and fix this first. This is the phase's first real blocker and it
was found by taking the measurement rather than by planning it.

## The number

**39.19% of instrumented executable lines in the `tn-linux` configuration**, from 24 executables.

Read the denominator carefully: `llvm-cov` counts *executable lines that were compiled into these
binaries*, which is 18,541 — not the 40,385 physical lines in `src/`. The gap is mostly
configuration: `TN_ENABLE_RAYTRACING`, `TN_ENABLE_VIDEO`, `TN_ENABLE_DEBUG_SERVER`,
`TN_ENABLE_NATIVE_GLTF` and `TN_ENABLE_NATIVE_PHYSICS` are all OFF in this preset, so
`src/video/` (2,139 physical lines), `src/debug/` (739), `src/gltf/` (475) and most of
`src/raytracing/` (5,014) are **not compiled at all** and appear nowhere below. They are not
0%-covered; they are unmeasured.

### Per subsystem

| Subsystem | Instrumented lines | Covered | Line % | Functions | Function % |
| --- | ---: | ---: | ---: | ---: | ---: |
| `src/webgpu/` | 7,174 | 2,423 | **33.77%** | 304 | 40.79% |
| `src/js/` | 2,665 | 1,052 | 39.47% | 166 | 56.02% |
| `src/runtime.cpp` | 2,583 | 1,303 | 50.45% | 143 | 39.86% |
| `src/canvas/` | 1,357 | 815 | 60.06% | 98 | 40.82% |
| `src/audio/` | 1,283 | 727 | 56.66% | 112 | 60.71% |
| `src/platform/` | 945 | 207 | 21.90% | 80 | 45.00% |
| `src/webtransport/` | 818 | 81 | **9.90%** | 42 | 9.52% |
| `src/raytracing/` (bindings only) | 506 | 90 | 17.79% | 47 | 17.02% |
| `src/http/` | 400 | 51 | 12.75% | 30 | 23.33% |
| `src/storage/` | 261 | 226 | 86.59% | 21 | 95.24% |
| `src/vfs/` | 239 | 175 | 73.22% | 15 | 86.67% |
| `src/fs/` | 232 | 59 | 25.43% | 23 | 52.17% |
| `src/async/` | 78 | 58 | 74.36% | 10 | 90.00% |
| **TOTAL** | **18,541** | **7,267** | **39.19%** | **1,091** | **45.00%** |

### The files PRD-229 is about

| File | Instrumented lines | Covered | Line % |
| --- | ---: | ---: | ---: |
| `src/webgpu/bindings.cpp` | 5,806 | 1,866 | **32.14%** |
| `src/webgpu/context.cpp` | 799 | 161 | 20.15% |
| `src/webgpu/registration_table.cpp` | 394 | 328 | 83.25% |
| `src/webgpu/wrapper_factories.cpp` | 143 | 36 | 25.17% |
| `src/webgpu/checked_handle.cpp` | 22 | 22 | 100.00% |
| `src/runtime.cpp` | 2,583 | 1,303 | 50.45% |

### Zero and near-zero, worth naming

| File | Instrumented lines | Line % |
| --- | ---: | ---: |
| `src/http/http_client.cpp` | 106 | **0.00%** |
| `src/js/ts_transpiler.cpp` | 46 | **0.00%** |
| `src/platform/window.cpp` | 158 | **0.00%** |
| `src/js/module_resolver.cpp` | 804 | 0.50% |
| `src/js/module_system.cpp` | 505 | 2.18% |
| `src/platform/input.cpp` | 518 | 4.44% |
| `src/webtransport/webtransport.cpp` | 818 | 9.90% |

`src/js/module_resolver.cpp` at 0.50% includes a 218-line hand-written JSON parser
(`parseJsonValue`). `src/platform/window.cpp` and `src/platform/input.cpp` are near-zero because
these executables are headless contract tests that open no window — which is a fair reason and
still leaves the code unproven.

## What this run does not claim

- **No gate ran.** `pnpm budgets`, `pnpm quality` and the vitest suite were not re-run against
  this build.
- **No negative control was exercised.** Every number here is a first observation with nothing
  proving the instrument can go red. PRD-229 Phase 1 owes those controls.
- **No device, Android, iOS or Windows result.** Linux desktop only.
- **The `tn-linux-quickjs` configuration was not measured**, so the QuickJS engine paths are
  unrepresented, and `threenative-handle-lifetime-test` skipped itself for exactly that reason.

## Artifacts

`build/tn-linux-coverage/` is untracked, like every other build directory. The merged profile and
the raw `llvm-cov` report live in this session's scratch directory and are not committed; the
command block above reproduces them.
