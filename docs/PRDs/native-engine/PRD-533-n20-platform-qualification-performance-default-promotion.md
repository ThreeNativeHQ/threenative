# PRD-533 — Platform qualification, performance and default promotion (N20)

**Status:** PARTIAL
**Complexity:** 5 — release-scale qualification on real hardware with explicit investment gates
**Owner:** João
**Work package:** N20 — [native-engine batch](README.md)
**Depends on:** [PRD-534 (CP1)](PRD-534-cp1-the-native-engine-earns-the-port.md) passed; every N00–N16, N18 and N19 PRD the declared capability profile requires. Gate T ([PRD-530 (N17)](PRD-530-n17-strict-native-typescript-game-packaging.md)) is not required for promotion (owner decision 2).

## Context

§15.3 compares against current optimized ThreeNative (projection and batching included), not vanilla
Three.js, and separates the native C++ driver from the native-AOT game driver to isolate binding and
compiler cost. §15.4 sets investment gates (targets, not forecasts). §19 defines completion for a
declared capability profile. Desktop Windows/macOS/Linux and physical Android are the qualification
targets (§2.3); software adapters and virtual displays are not performance evidence. Existing meters:
`pnpm bench:engines` (`scripts/engine-load-test/cli.ts`), playtest `perf`, and the measured record in
`docs/verification/runtime-perf-state.md`, which §3 says must be reproduced natively before it counts.

## Solution

1. Workloads (§15.3): heterogeneous renderables, a moving skinned crowd, streaming Machinefall content,
   and a GPU-heavy visual holdout. Assets, resolution, quality, shaders, camera path and presented
   workload are held equal between arms.
2. Meters: frame p50/p95/p99, CPU stage time, GPU timestamps, startup, peak and steady memory,
   allocations, input latency, scene load/unload, shader compilation, binary size, build time and
   adapter overhead; cold and warm caches reported apart; long frames attributed.
3. Gates (§15.4): about 2× lower CPU in the identified hot paths on two CPU-heavy workloads; about 20%
   better end-to-end frame time on a CPU-bound real game beyond noise; no unexplained GPU-time or
   visual regression; no memory growth across repeated load/unload; AOT binding overhead measured
   against the C++ driver.
4. A perf win never waives a failed compatibility or JS-free gate. If the gates are not met, stop and
   investigate before promotion.
5. Promotion makes `native` the default engine profile with the legacy profile still explicitly
   selectable; retiring legacy is [PRD-535 (N21)](PRD-535-n21-the-js-engine-is-deleted.md), one release later (owner decision 10). The web default moves to the Wasm engine in the same promotion (owner decision 4).

## Out of scope

- iOS (§2.3). Deleting the legacy engine ([PRD-535 (N21)](PRD-535-n21-the-js-engine-is-deleted.md)).

## Execution Phases

#### Phase 1: Benchmark harness
**Status:** NOT STARTED
**Files:** `scripts/engine-load-test/`, `docs/verification/runtime-perf-state.md`
- [ ] The four workloads run under both the current-ThreeNative arm and the native arm with identical presented workload. proof: `pnpm bench:engines -- --arms current,native --workloads all`
- [ ] The native C++ driver and the native-AOT driver run the same workload, so binding overhead is reported. proof: `pnpm bench:engines -- --arms native-cpp,native-aot`
- [ ] The web build runs one workload under three arms — current three.js, the Wasm engine with JavaScript game code, and the Wasm engine with Perry-to-Wasm game code — with identical presented work, and the result decides between options B and A of decision 12. proof: `pnpm bench:engines -- --target web --arms current,wasm-js,wasm-perry` (new arms)

#### Phase 2: Artifact qualification
**Status:** PARTIAL
**Files:** `.github/workflows/native-platforms.yml` (Linux), `.github/workflows/native-release.yml` (Windows/macOS matrix in the existing workflow)
- [ ] The Linux desktop artifact on the native engine passes engine-only JS-free inspection and its playtest journey. proof: `native-platforms` CI job `native-engine-linux`
- [x] The Windows desktop artifact on the native engine passes engine-only JS-free inspection and its playtest journey. proof: `native-platforms` CI job `native-engine-windows` — the job lives in `.github/workflows/native-release.yml` (native-engine-windows / native-engine-macos, dispatchable with `-f native_engine=true`), per the rule that a feature adds a job to an existing workflow. 2026-10-06: green in CI run 37523665137 (`gh workflow run native-release.yml --ref feat/native-engine -f native_engine=true`, job native-engine-windows): the JS-free player built with MSVC inspects `JS_FREE_OK` (PE imports) and the inspect, input and capture scenarios pass. Adapter: Microsoft Basic Render Driver (WARP, software): this proves build, JS-freedom and the journey, not performance.
- [x] The macOS desktop artifact on the native engine passes engine-only JS-free inspection and its playtest journey. proof: `native-platforms` CI job `native-engine-macos` — the job lives in `.github/workflows/native-release.yml` (native-engine-windows / native-engine-macos, dispatchable with `-f native_engine=true`), per the rule that a feature adds a job to an existing workflow. 2026-10-06: green in CI run 37523665137 (job native-engine-macos): built with AppleClang, `JS_FREE_OK` (Mach-O), the three player scenarios pass on Metal (Apple Paravirtual device). The first run (37522884766) failed to compile: Apple's libc++ has no floating-point `from_chars`; fixed in `json.h`.

Windows/macOS implementation: dispatch `native-release.yml` on the candidate branch with
`native_engine=true`; it selects only these two legs, builds `tn-native-engine-player` with
`TN_ENGINE_ONLY=ON`, inspects the binary, and runs the existing inspect/input/capture scenarios.
Windows retains its MSVC linker map and records the observed adapter, including D3D12 WARP.
Both qualification boxes remain open until their hosted builds and journeys execute successfully;
MSVC/AppleClang compilation and GPU journeys were not run locally.
Local validation: CI structure/needs specs **204 passed**, inspector **6 passed, 1 optional binary
test skipped**, release-proof controls **61 passed**, Biome **passed**, and directly compiled
geometry `out_of_range` **passed**. Node subprocess pipes return `EPERM` in this sandbox; the suites
ran with temporary file-backed subprocess I/O, preserving their real commands and assertions.
`actionlint` is not installed. Full local CMake regeneration encountered the other lane's
in-flight, missing `tests/native-engine/world/world_cells_test.cpp`; that lane was left untouched.

#### Phase 3: Promotion
**Status:** NOT STARTED
**Files:** `packages/create-threenative/` (default profile)
- [ ] New projects scaffold with the native engine profile and can select legacy explicitly. proof: `pnpm test:templates`
- [ ] New web builds run on the Wasm engine and pass every template journey. proof: `pnpm test:templates` (web arm)
- [ ] Switching a project back to legacy restores the previous behaviour with no other edit. proof: `pnpm exec vitest run packages/create-threenative/__tests__/native-profile.spec.ts`

## Blocked on

- §15.4 performance verdicts: physical desktop and Android hardware runs by the owner (João); Xvfb and SwiftShader numbers do not count (§15.3).
- The Android native-engine artifact on a physical device: the owner's attached device.
- The promotion decision itself, once the gates are measured: owner decision (João).
