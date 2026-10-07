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

## Active performance repair

Complexity: 5 → MEDIUM; engine render preparation and the existing browser benchmark cross the native/Wasm build boundary. Continue in the existing `feat/native-engine` checkout and PR #438; preserve the recovered uncommitted changes.

1. Reproduce at 4k, 16k and 64k objects with the existing heterogeneous workload. Use native warm-cache preparation and 120-frame browser probes for iteration; retain 600 frames and three interleaved repeats for the final comparison.
2. Profile game, boundary, transforms, projection/batching and encode/submit separately. Fix the dominant shared engine/compiler path; retain material edits, matrix queries, draw ordering and frame parity. Target at least 2× lower CPU than the optimized current arm across the three sizes; never waive the 18× warm-cache scaling check.
3. Rerun affected native and Perry tests, then browser frame comparisons and the complete benchmark. Keep phase 1's web box open until the final measurements support it; promotion and option A remain unqualified.

Recovery: Claude session `41400f88-99d0-4e9e-8705-f9942dc8e223`; interrupted Codex thread `01a11466-2d69-7fc0-b68a-43f7c4f93ea0`. Rebuilt preparation fails at 0.3960/2.2504/14.9926 ms (37.86×). The 4k browser baseline is current 2.715/4.855 ms, Wasm-JS 1.605/3.920 ms, Wasm-Perry 1.420/2.430 ms (p50/p95), with frame parity; host noise reaches 37.3% on Wasm-JS. The pinned Perry cache was restored; Node 24 runs the benchmark tests 12/12. The native registry snapshot still drifts. These are local diagnostic results, not promotion evidence.


Fast iteration (2026-10-07): use the existing harness, without a second renderer or relaxed workload.

1. Run the affected native CTest cases before opening a browser. `TN_UPDATE_OBJECTS=65536` limits the existing scaling executable to one size for CPU profiling; the unmodified scaling gate still checks 4k/16k/64k and requires ≤18×.
2. Rebuild only `tn-native-engine-wasm-assets` after engine edits. Browser linking retains optimized function names with `--profiling-funcs`.
3. Run `sh scripts/xvfb.sh pnpm bench:engines -- --target web --arms current,wasm-js,wasm-perry --objects 65536 --warmup 30 --frames 120 --profile`. It executes each arm once, starts CDP sampling after warmup, saves `current.cpuprofile`, `wasm-js.cpuprofile` and `wasm-perry.cpuprofile` beside `artifacts/engine-load-test/web/web-report.json`, and retains frame/adapter checks. Its verdict is `profile only`; profiling spans include rAF idle time and sampling overhead, so use active samples for attribution, not qualification timing.
4. After a candidate wins the focused probe, rerun without `--profile`, with `--warmup 120 --frames 600`; normal mode still requires three interleaved repetitions. Pin CPU-only before/after probes to the same core, alternate order, and compare unchanged stages as noise controls. Never overlap final timing with builds.

The 64k hardware-WebGPU diagnostic measured current 60.740/68.240 ms, Wasm-JS 43.550/56.035 ms and Wasm-Perry 45.220/49.260 ms (p50/p95). Perry's active self samples concentrate in world-matrix publication (~24%), bulk transforms (~17%), projection (~15%) and material equivalence (~10%); encode/submit is ~1.6 ms. This identifies CPU work as the first optimization target, not a 2× qualification result. SIMD matrix publication had overlapping alternating timings and was removed. Whole-object prefetch deletion reduced native cache misses ~13% but did not establish a timing gain and was restored. Preserve both rejections rather than repeat them.

A malformed native Ninja dependency journal also caused repeated 377-file rebuilds. The exact corrupt journal was preserved as `.ninja_deps.recovery-backup` in the existing native build directory before regeneration. The compiler cache was restored under `TN_NATIVE_TS_CACHE=/tmp/tn-recovery-perry-cache` after the shared cache disappeared. Benchmark/Perry tests pass 12/12; profile start and diagnostic verdict are covered. Root TypeScript checking currently fails in unchanged starter texture files because `@types/three` is unavailable from that package; no passing full typecheck is claimed.


Retained repairs: paired fdlibm sine/cosine reduction in `Quaternion::setFromEuler` keeps the scalar result bits (native and Wasm: explicit edge values plus 10,000 deterministic random patterns). Alternating pinned 4k probes reduce bulk p50 from 0.3555/0.3484 ms to 0.2641/0.2614 ms; 16k reduces ~1.55 ms to ~1.22 ms. These measure bulk transforms, not whole-frame speed. Runtime member pointers in fixed-axis rotation proxies were replaced by compile-time fields: SyncedEuler/SyncedQuaternion each shrink from 112 to 80 bytes natively and from 72 to 56 in Wasm (4 MiB/2 MiB less transform storage at 64k), with value assignment, notification and clone tests. Their public nested proxy types are now templates; explicitly typed external C++ consumers may require source changes as well as a rebuild. The cold-field reorder was rejected and restored under severe host contention.

A separate real cache regression reproduced on native GPU and the built Wasm engine: alternating camera layers rebuilt 200 records over 100 ticks. The flat cache failed to mark layer-excluded records as seen. The shared fix retains those records exactly as the map cache already does. Native focused cases now pass 12/12, including rendered camera-layer isolation; benchmark/Perry cases pass 12/12, including the new Wasm layer-cache assertion (red: two unexpected rebuilds; green: zero). Existing rotation-sync and matrix-revision cases also pass when compiled as Wasm; the browser-only CMake scene-test target itself cannot link its omitted fixture-driver library, so no pass is claimed for that target. Incremental native renderer rebuilding now takes four steps instead of the repeated 377-file rebuild.

## Continued performance loop (owner, 2026-10-07)

The owner requested continued overnight profiling until an empirical ceiling is established, then the remaining native-engine PRDs and PR #438 checks. A dominant memory span alone does not establish that ceiling.

Fresh 600-frame, 120-warmup, three-interleaved-repeat browser CPU submissions (NVIDIA Turing, 1280×720):

| Objects | Current p50/p95 ms | Wasm-JS p50/p95 ms | Wasm-Perry p50/p95 ms | Current/Perry p50 |
| --- | --- | --- | --- | --- |
| 4,096 | 3.055 / 5.130 | 1.710 / 3.875 | 1.415 / 2.660 | 2.16× |
| 16,384 | 19.745 / 29.140 | 13.465 / 19.580 | 12.110 / 17.965 | 1.63× |
| 65,536 | 73.385 / 103.495 | 52.460 / 105.070 | 50.865 / 72.570 | 1.44× |

All 27 frame comparisons have zero pixel mismatch. Reports: `artifacts/engine-load-test/web/{4096,16384,65536}-report.json`. Other renderer jobs remained active; repeat spread reaches 51.1% for 64k Wasm-JS. These diagnose CPU submission under load, not presented FPS or platform promotion. Perry beats the strict Wasm-JS repeated-range rule only at 4k. Fresh profiles use the existing playtest CDP helper and start after warmup; Perry active self samples are world updates 23.9%, bulk transforms 18.2%, projection 16.6%, material comparison 9.5%, preparation 8.7%, paired trig 3.8% plus reduction 2.0%.

The flat-cache replacement ownership regression is also red-green: a warmed mesh replaced by an excluded child retained old geometry/material owners before the identity guard. Native cases pass 12/12 and benchmark/Perry/profile cases 14/14 after the guard. The existing Wasm assets playtest passes every behavior/diagnostic assertion on NVIDIA, but its screenshot gate rejects the deliberately two-color triangle; overall playtest remains failed. No assertion or capture gate was waived.

Loop contract: target the unchanged 64k browser CPU submission, with 4k/16k and native behavior as holdouts. Freeze `scripts/engine-load-test/web.ts`, `web-game.ts`, the workload and browser scene during engine trials. Diagnose via the existing CPU-only `tnw_bench_prepare` and bulk exports, using `/tmp/tn-sincos-prepare.mts` (SHA256 `2cb446cfb0de9c895396e898e6227727abbf3720db6b6fc16013154b8638d7a8`), 60 warmup + 120 samples, taskset CPU8, five alternating baseline/candidate pairs. The incumbent Wasm SHA256 is `a5eb3470fa7d67ddf8dd5d5f2a09e07048fd03bfd3e5400115005a068e2e9b6b`; preserve it under `/tmp/tn-page256-baseline`. Three A/A probes span 0.9651–1.2039 ms preparation at 4k and 31.9533–35.0068 ms at 64k; sub-band results are inconclusive. Change one cause in at most five engine files per trial; retain validation, immediate material edits, exact matrix observations/order, lifetime cleanup and pixel parity. CPU probes diagnose; a keep must survive browser end-to-end measurements. Continue in the existing task checkout/PR, preserving recovered work. Stop a lane only after three rejected/inconclusive causes with no identified removable term above noise, or after its term falls below 10%; do not call that an absolute theoretical limit.

Trial P1 rejected: `TransformPage::size` 256→64 (commit `9111a092e`, reverted). Five alternating pairs passed 12 native and 14 Wasm/Perry checks, but 4k preparation was tied (0.5047→0.5044 ms) while bulk rose 0.2540→0.2623 ms. At 64k, preparation medians were 15.6610→17.5197 ms with only one winning pair; bulk was inconclusive. Keep 256. Logs: `/tmp/tn-page-pair-<objects>-<pair>-<baseline|candidate>.log`. Native CPU sampling also attributes project 20.2%, material comparison 14.3%, batch packing/sorting 13.7%, compose 8.5% and world-update state 6.8%; game rotation is outside that preparation timer. Bulk attribution and matrix-publication results follow below. Remaining audit is pending: the PRD board reports 208/238 phase boxes, 28 archived and 11 open PRDs; PR #438's body says 53/237 and its draft rollup is empty. The latest explicit CI run 37554436342 failed; inspect its actual failures after performance saturation rather than repeatedly dispatching CI.


Bulk attribution (temporary instrumentation restored before judging): at 64k, generation/type/finite validation costs 0.65–0.74 ms versus 8.27–10.78 ms updating transforms; at 4k, 0.038 ms versus 0.214–0.217 ms. Keep transactional validation. The restored native scaling gate still fails: 0.4072 / 1.7384 / 10.4201 ms, 25.59× versus the unchanged 18× limit (`/tmp/tn-native-final-scaling.log`). No promotion is qualified.

Trial P2 hypothesis: native annotation shows redundant identity initialization of the fast branch's stack matrix before out-of-line `compose()`, which overwrites all 16 fields. Probe one dedicated `static thread_local Matrix4` in `updateMatrixWorldSelf`; preserve every comparison/copy/revision and all general branches. Review rejected global `scratchM1` reuse because `attach()` keeps it live across virtual calls; a nested-update attachment regression guards that alias. Per-thread storage prevents a shared scratch race, without promising safe concurrent mutation of one object. Wasm LTO may already remove initialization, so retain only with measured end-to-end gain; evaluate five alternating incumbent/candidate CPU pairs before any browser trial. Focused native checks pass 12/12 including nested attachment, and Wasm/Perry/profile checks pass 14/14; timing verdict rejected: five Wasm pairs improve 4k preparation 0.5094→0.4966 ms, but 64k overlaps (18.0845→17.3940 ms, only two of five pair wins) and native 4k is tied. Native 64k also overlaps contention. Reverted rather than retain per-thread state without a repeatable primary-target win. Logs: `/tmp/tn-tls[-native]-pair-<objects>-<pair>-<baseline|candidate>.log`.

Trial P3 hypothesis: stable depth radix currently makes up to eight histogram/scatter passes. Probe 11-bit digits (six passes) with a 2048-bucket histogram, retaining unsigned 64-bit keys, stable ID ties, zero normalization, varying-bit skips and nonfinite comparator fallback. Only the sort digit changes; at the final shift 55 the remaining nine bits fit. Increased histogram work may regress 4k; compare the same five CPU pairs and retain only with browser end-to-end proof. Existing reversed-scene depth/ID/color check remains, extended with mixed-sign depths, zero inputs and infinity fallback; baseline and candidate pass. Native focused checks pass 12/12 and Wasm/Perry/profile checks 14/14. CPU diagnosis: CPU8 became busy (39%, sibling 33%); repeat on newly sampled CPU11. Its five 64k pairs regress overall despite cheaper sorting. An extended 20-pair alternation on CPU11 shows batching lower in all 20 pairs; medians 3.2062→2.7239 ms. Whole preparation remains load-sensitive. Bulk/world/material function bodies are byte-for-byte identical in disassembled Wasm; unchanged stages expose host variation. Browser ABBA completed: four normal 600-frame/120-warmup, three-repeat comparisons, pinned identically to CPUs9,11,21,23, using preserved incumbent/candidate asset pairs. All 36 comparisons have zero pixel mismatch on NVIDIA/Turing. Perry block p50 is 59.56 / 45.87 / 59.28 / 69.51 ms; unchanged current control is 89.02 / 57.76 / 91.34 / 103.60 ms. Raw pooled repeat medians favor the candidate (67.79→49.84 ms), but per-repeat Perry/current median moves adversely (0.685→0.802); large control movement prevents attribution. Reject P3 rather than retain an unproven whole-frame gain; restore 8-bit digits, retaining the independently passing depth-order edge tests. This bounds the sorting experiment, not the overall ceiling. Logs: `/tmp/tn-radix11-extended-<pair>-<variant>.log` and `/tmp/tn-radix11-browser-service-<variant><repeat>-report.json`.


Correctness checkpoint queued after P3 timing: fused traversal caches slot types across raw `scene.children` reorder and bypasses `updateMatrixWorld()` overrides. Review reproduced the installed Three.js matrix-update/project ordering: a later geometry-changing update hook runs before **every** mesh is projected, so both earlier/later meshes see the replacement attribute. The recovered two-resource-snapshot test expectation is incorrect. Fix the shared engine layer, not the benchmark: recompute eligibility before updates using existing `flatPlainMeshes_`, require exact built-in scene/camera/child types and empty child vectors, and fall back for custom matrix hooks, shadows or custom/parented directional/spot targets. This avoids another identity cache and catches raw reorder/replacement/subtrees. Regressions will cover warmed Mesh/light reversal, virtual mesh/light/root/camera updates, nested replacement and geometry-hook ordering. Compare safe fusion against ordinary two-pass traversal before retaining its complexity. Capability search/detail confirmed the existing `MatrixWorldPass`/`renderer.matrixWorld` contract explicitly preserves matrix overrides; the C++ engine must honor that same behavior.

P3 browser execution: the first ABBA shell process received SIGTERM before producing a report; no result is credited. Doctor passes Node24/Playwright/Xvfb. Assets were explicitly restored and their candidate SHA checked. Retry uses a task-owned transient user service `tn-native-engine-radix-abba.service`; its initial startup lacked pnpm on the service PATH (exit127), corrected by including the installed pnpm directory after Node24. The supervised retry completed with exit0; the transient unit exited and was collected (not loaded afterward). The EXIT trap restored the candidate assets with verified SHA before the rejected source probe was reverted. Source/workload and normal sample counts remained unchanged. Rebuild incumbent assets before the next run.

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
