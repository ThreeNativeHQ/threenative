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
**Status:** PARTIAL
**Files:** `scripts/engine-load-test/`, `docs/verification/runtime-perf-state.md`
- [x] Heterogeneous renderables run under the current-ThreeNative arm and the native arm with identical presented workload. proof: `pnpm bench:engines -- --arms current,native --workloads heterogeneous` — 2026-10-07 on the loaded desktop (load average ~30, NVIDIA/Turing, Xvfb, `--objects 256 --frames 40 --warmup 10`): both arms present 256 cubes and 3,075 triangles (`assertEqualPresentedWork`: objects and triangles reported by each arm, a missing or unequal figure fails closed, unit-tested in `scripts/__tests__/engine-load-test-workloads.spec.ts`); `native` is the V8 game driver. Timing is noise (hot path p50 5.99 against 2.54 ms) and gives no verdict. The `current` arm ran on the legacy `mystral` host copied from the epic checkout's build, which is not built in this one.
- [x] The moving skinned crowd runs under the current-ThreeNative arm and the native arm with identical presented workload. proof: `pnpm bench:engines -- --arms current,native --workloads skinned-crowd` — 2026-10-07, same machine, `--frames 60 --warmup 20`: both present 64 rigs and 35,328 rig triangles (12 bones, 12 x 22 cylinder, set on the page by `bones`/`radial`/`heightSegments` and by `SkinnedCrowd(false)`, the native crowd without its four refusal cases); `current` is the page's projected arm (hardware adapter enforced), `native` the C++ crowd (`tn-native-engine-host --crowd`, there is no V8 crowd script). The renderers' own counts are reported apart and not compared: three's `renderer.info` counts the shadow pass (70,659), the native renderer's does not (35,331). Poses differ by design (sine against animation mixer), both write every bone every frame. Timing is noise (hot path 3.60 against 1.07 ms).
- [ ] The GPU-heavy visual holdout runs under the current-ThreeNative arm and the native arm with identical presented workload. proof: `pnpm bench:engines -- --arms current,native --workloads holdout`
  No holdout scene is defined, so `--workloads holdout` (and `all`) fails with `TN_BENCH_WORKLOAD_UNDEFINED`. It needs a scene both arms load (the cooked starter with its post chain now renders natively: `pnpm visuals -- --native-engine`) and a per-frame meter on the native render driver, which draws one frame today.
- [x] The native C++ driver and the native-AOT driver run the same workload, so binding overhead is reported. proof: `pnpm bench:engines -- --arms native-cpp,native-aot` — 2026-10-07 on the loaded desktop (load average ~30, NVIDIA/Turing, Xvfb, `--objects 256 --frames 40 --warmup 10`): both drivers present 256 cubes and 3,075 triangles (asserted), `native-aot` is the heterogeneous L4 scene as Perry-compiled game code (`examples/engine-load-test/native-engine/l4-workload-aot.ts`, built by `tools/native-typescript/bench-aot.mjs` with the pinned Perry v0.5.1520 and the render bridge, metered by `tools/native-typescript/three/tn_three_bench.cpp` with the host's own meters), its pose math shared with the other arms through `src/l4-pose.ts`. The report prints binding overhead (native-aot minus native-cpp): hot path 2.017 ms p50, 5.62x, with 770 C ABI crossings per frame against 0, which is noise-dominated on this machine and no verdict. The facade grew `PerspectiveCamera`, `PlaneGeometry`, `DirectionalLight`, `Euler`, `Color`, `Vector3.set` and `lookAt`; the five three-importing corpus cases still pass natively. Only the heterogeneous workload has an AOT driver; the crowd's AOT arm is not asked for by this box.
- [x] The web build runs one workload under three arms — current three.js, the Wasm engine with JavaScript game code, and the Wasm engine with Perry-to-Wasm game code — with identical presented work, and the result decides between options B and A of decision 12. proof: `pnpm bench:engines -- --target web --arms current,wasm-js,wasm-perry` (new arms) — 2026-10-07, P28 engine `258d8ed4…`, Brave hardware WebGPU on NVIDIA/Turing, 600/120 frames, 3 interleaved repeats, all captures zero pixel mismatch: Wasm-JS and Perry tie at 4k/16k/64k (64k p50 23.17/23.47 vs 23.41/22.47 ms), so **option B stays** and option A remains unqualified. Reports `artifacts/native-engine-perf/p28-abba/`, `p28-sizes/` (local, ignored).

#### Phase 2: Artifact qualification
**Status:** DONE
**Files:** `.github/workflows/native-platforms.yml` (Linux), `.github/workflows/native-release.yml` (Windows/macOS matrix in the existing workflow)
- [x] The Linux desktop artifact on the native engine passes engine-only JS-free inspection and its playtest journey. proof: `native-platforms` CI job `native-engine-linux` — 2026-10-07: green in CI run 37554433163 on `1927c86bc` (`gh workflow run native-release.yml --ref feat/native-engine -f native_engine=true`, job native-engine-linux): the JS-free player inspects `JS_FREE_OK` (ELF) and the inspect, input and capture scenarios pass. Adapter: llvmpipe (software): this proves build, JS-freedom and the journey, not performance.
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
- [ ] Every template's frames on the Wasm engine pass its existing visual baseline. proof: `pnpm visuals` (web arm, Wasm engine)
- [ ] A paired blind before/after bundle (legacy engine before, Wasm engine after, same templates) finds no template scoring worse beyond the bundle's measured resolution; the before/after captures go on the PR. proof: `pnpm visuals:ab`
- [ ] Switching a project back to legacy restores the previous behaviour with no other edit. proof: `pnpm exec vitest run packages/create-threenative/__tests__/native-profile.spec.ts`

## Decisions

2026-10-07 (coordinator brief, one box one claim): phase 1's first box named four workloads under one proof and could never be ticked while Machinefall's source is missing. It is split into one box per workload (heterogeneous, skinned crowd, visual holdout); Machinefall moves to `## Blocked on`. `native` in `--arms current,native` is each workload's shipping-shape native game driver (V8 for the heterogeneous scene, the C++ crowd for the crowd, which has no V8 script), reported per arm as its `driver`.

## Blocked on

- Streaming Machinefall content as a benchmark workload: Machinefall's source is not in this repository (PRD-498 owner blocker); João supplies it. `--workloads machinefall` fails with `TN_BENCH_WORKLOAD_BLOCKED`.
- §15.4 performance verdicts: physical desktop and Android hardware runs by the owner (João); Xvfb and SwiftShader numbers do not count (§15.3).
- The Android native-engine artifact on a physical device: the owner's attached device.
- The promotion decision itself, once the gates are measured: owner decision (João).

Traversal correction verified locally: the new native regression first failed the geometry-order assertion and then segfaulted on warmed Mesh/light reversal (`/tmp/tn-safe-flat-red.log`). Rechecking exact built-in eligibility every prepare, without the stale hierarchy/type cache, restores normal update/project ordering for authored hooks, camera children, parented/custom light targets and shadows. Focused native cases pass 12/12. The exact `uniformBatchPreparation` body extracted from the existing test and linked against the rebuilt Emscripten libraries passes under Node24 as well (including virtual C++ hooks); benchmark/Perry/profile cases pass 14/14 after supplying the verified Perry cache environment. Browser assets rebuild successfully. No GPU journey is claimed from this CPU-only Wasm test. Next compare guarded fusion with ordinary two-pass traversal, then profile the corrected winner; the overall ceiling remains open.

Trial P4: compare corrected guarded fusion (`3e61a55cb`) against the ordinary two-pass lane, forcing `flat=false` only in this temporary control. Preserve both Wasm factories and native scaling binaries; keep identical public behavior, immediate checks and sort digits. Five alternating pairs at 4k/64k use the unchanged CPU probe on CPU11 before a browser judge. If safe fusion does not earn a repeatable advantage, delete it rather than add another cache. Timing and browser verdict pending.

P4 CPU result: guarded fusion wins 5/5 pairs at both sizes in both runtimes. Wasm ordinary→guarded preparation medians: 4k 0.8622→0.5466 ms; 64k 58.4437→30.5129 ms (paired median ratio 0.522). Native: 4k 0.5001→0.4221 ms; 64k 24.5911→16.1859 ms. Both native lanes pass 12 focused cases; the guarded Wasm virtual-hook case also passes. Single-size `PASS scaling` is diagnostic only, not the full18× scaling gate. Preserve guarded fusion pending browser validation. Logs: `/tmp/tn-safe-flat[-native]-pair-<objects>-<pair>-<ordinary|guarded>.log`.

Trial P5 hypothesis (native only): native sampling still shows out-of-line compose/material work, whereas Wasm already inlines compose/copy in worldSelf. Probe supported Release IPO for foundation, scene, renderer and scaling executable using a temporary deferred CMake include, preserving exact floating-point flags and excluding vendor targets/sanitizers. This changes build configuration only, not tracked CMake source. Evaluate paired native scaling and correctness before considering any shipped build-setting change. Wasm full LTO is not justified by the already-inlined compose/copy evidence alone.

P5 rejected: IPO removes worldSelf copy calls but leaves compose out of line. All 12 focused cases pass. Five paired native medians are 4k 0.4284→0.4242 ms; 64k 25.1132→24.5629 ms, only3/5 winning large pairs and broad overlap. Full scaling fails in both binaries: baseline 0.4264/2.8551/16.3864 ms (38.43×), IPO 0.4149/3.3833/21.9925 ms (53.00×), unchanged limit18×. No attributable primary improvement or qualification gain; remove the temporary top-level CMake include and rebuild ordinary Release flags. Initial include placement ran inside SDL; top-level placement also requires deferring the IPO support check until compilers exist. Both setup errors were corrected before any timing. Logs: `/tmp/tn-native-ipo-pair-<objects>-<pair>-<baseline|candidate>.log`, `/tmp/tn-native-ipo-full-<variant>.log`.


P4 browser ABBA completed in a task-owned transient service without overlapping builds: ordinary1, guarded1, guarded2, ordinary2, each with the unchanged 600 measured frames, 120 warmup and three interleaved repeats on CPUs 9,11,21,23. All 36 image comparisons have zero pixel mismatch on NVIDIA/Turing. Median per-repeat Perry CPU submissions are 80.160 / 45.822 / 44.565 / 63.852 ms; corresponding current controls 67.773 / 56.483 / 55.340 / 63.798 ms. Normalizing each repeat to its current control gives ordinary median 1.099 and guarded 0.824 (25.0% lower); guarded repeats span 0.743–0.850, ordinary 0.652–1.281, so one ordinary outlier overlaps/inverts the advantage. Keep corrected guarded fusion provisionally: its CPU-only five-pair wins in both runtimes and browser median support it, while whole-frame qualification beyond every noisy repeat remains open. This is not the requested overall ceiling. Logs: `/tmp/tn-safe-flat-browser-<ordinary|guarded><1|2>-report.json`. The service exited successfully and restored the guarded factory SHA256 `30c3241531f76f6f4041268c80fd11f98436fb9fad7848de2189080db67b0e8a`.

P6 diagnostic gap: the current web profile has no GPU duration or measured rAF cadence, so CPU submission alone cannot establish the end-to-end ceiling. Extend only `--profile`, reusing the renderer's timestamp queries and existing `FrameBudget`; keep normal timing/sample rules unchanged. Report capability separately from absent/fresh GPU observations, exclude warmup/stale IDs, drain Three's warmup query pool, retain long diagnostic gaps and label instrumented cadence rather than qualification FPS. Native coverage is scene-through-output (canvas blit excluded); Three coverage is its summed render passes. Source review corrected missing-sample handling and warmup-pool exhaustion before applying. Regression red: both normal cases pass; six profile cases fail because GPU/rAF metadata is absent (`/tmp/tn-gpu-profile-red.log`). Green/browser measurements pending; no qualification box ticked.

P6 local green: all 21 benchmark/Perry/profile tests pass, the focused TypeScript project passes, and Biome has no errors (seven complexity warnings). The first full test invocation lacked emcc/wasm-dis on PATH; sourcing the installed Emscripten SDK corrected that environment failure before the passing rerun. The browser fixture rebuilds successfully. Hardware profile is running; normal benchmark qualification remains open.

P6 hardware profile passed on NVIDIA/Turing: all three captures satisfy the existing tolerance (Wasm mismatch ratio 0.00000543, deltaE 0.000645). GPU p50: current 3.44 ms (120 fresh samples), Wasm-JS 1.49 ms (43 fresh, 77 stale), Wasm-Perry 1.73 ms (50 fresh, 70 stale). GPU coverage differs as explicitly reported above; no canvas-blit timing is claimed. Instrumented rAF p50 is 129.24 / 48.41 / 63.23 ms, with 119 intervals each; Three's awaited timestamp resolution materially affects this cadence, so these are not qualification FPS. Diagnostic CPU p50 is 74.730 / 48.150 / 62.825 ms; host drift prevents a one-repeat performance verdict. GPU duration is small beside CPU submission. Perry active self samples remain world publication 22.4%, projection 16.0%, bulk 15.4%, prepare 13.9%, material equivalence 10.8%; game execution is below 3%. Continue with a material-comparison probe before bounding the overall lane. Artifacts: `/tmp/tn-gpu-profile-hardware/` (copies of existing harness report and CDP profiles); service exited 0. No full qualification or ceiling claimed.

P7 hypothesis: the current Wasm material comparison emits scalar branches for 27 floating fields. Probe a Wasm-SIMD pair reduction inside the existing `sameUniforms`, using explicit field values rather than layout/alias assumptions. Preserve the scalar fallback, short-circuit type/flag checks, nodes/maps, NaN inequality, signed-zero equality and immediate material edits. This differs from the rejected material-layout trial: no Material layout changes. Extend the existing numeric oracle to every field before timing five alternating CPU-only pairs at 4k/64k against the preserved P6 factory; run browser comparisons only if those support a gain. At 10.8% active self samples, eliminating this term entirely could improve this diagnostic by at most about 1.12×; this is one bounded lane, not an overall ceiling.

P7 local checks pass before timing: native focused 12/12, existing benchmark/Perry/profile tests 21/21, and the exact expanded `uniformBatchPreparation` body linked against the Wasm libraries passes under Node24. Each of 27 numeric fields is independently changed and checked for signed-zero equality, equal infinities and NaN inequality. The reduction lambda emits 13 f64x2 equality operations, 12 mask ANDs and one all-true reduction. Initial inspection counted zero `replace_lane` instructions, but missed the `v128.load64_lane` constructions; it also selected the out-of-line lambda rather than the wrapper. No claim of zero lane overhead is retained. World-update, bulk-transform and quaternion function bodies are byte-identical to P6. Baseline factory is preserved at `/tmp/tn-material-simd-baseline/` (SHA256 `453ee1f0394e187ebf6f3b3d43ccb99e1f00de6d63e6c267080348665d4a7673`). Timing pending; no qualification tick.

P7 rejected: five alternating CPU11 pairs show 4k preparation medians 0.5239→0.5254 ms (3/5 wins, paired ratio 0.996), 64k 16.0481→16.0673 ms (2/5 wins, paired ratio 1.001). Projection paired median ratio is 0.999/0.994; unchanged bulk moves more than the primary result (large paired ratio 0.946). Fewer comparison instructions did not remove measurable frame work. Restore scalar comparison instead of carrying an unproven SIMD branch, retaining the independently passing 27-field numeric oracle. Logs: `/tmp/tn-material-simd-pair-<objects>-<pair>-<baseline|candidate>.log`. No browser rerun is justified for this rejected candidate; the overall ceiling remains open pending examination of remaining matrix-composition work.

P7 follow-up diagnosis: the SIMD numeric lambda remains an out-of-line function, carrying closure/call overhead, and the pair construction uses `v128.load64_lane`. The smaller reduction body alone did not prove cheaper execution. After scalar rollback verification, P8 will isolate forced inlining of the local SIMD numeric lambda (the pair lambda is already inlined), then inspect the actual wrapper/caller before timing. Avoid Material layout changes and unsafe cross-member pointer arithmetic. The emitted caller must be checked before attributing a cost to that call.

P7 rollback verified: ordinary scalar source rebuilt for native and Wasm; native 12/12, TS/Perry/profile 21/21 and the expanded Wasm numeric/virtual-hook oracle pass. The extra SIMD code is removed; only the independently useful numeric regression remains.

P8 emitted-code correction: P7 inlined the outer wrapper and called its numeric lambda, so it did not add a second call. Its caller nevertheless creates a 16-byte closure containing both material pointers and the lambda reloads them. Forced numeric-lambda inlining removes the closure but leaves one direct wrapper call; the 26 lane loads remain. This is an inline-placement/closure probe, not a wider-load claim. Read-only review confirms the source/caller interpretation. Native 12/12, TS/Perry/profile 21/21 and the expanded Wasm oracle pass. Time three variants (scalar incumbent, P7 SIMD, P8 inline SIMD) in rotated order at each size; primary keep still requires beating the scalar incumbent, not merely P7.

P8 rejected at the primary size: five rotated triples give scalar/P7/P8 4k preparation medians 0.5137/0.5208/0.5047 ms; P8 wins 5/5, paired ratio 0.982. At 64k medians 15.8041/14.1597/15.8494 ms; P8 wins 1/5, paired ratio 1.010. Unchanged bulk paired ratio is 1.007 for P8. Restore scalar source. P7 unexpectedly wins all five large comparisons in this block (paired ratio 0.900, projection 0.879, unchanged bulk 0.974), unlike its earlier inconclusive block. This is evidence to investigate, not a keep or ceiling: extend the existing CPU probe to 20 rotated triples at 64k, comparing all three preserved factories and unchanged stages. No new source tuning until that contradiction is resolved. Logs: `/tmp/tn-material-inline-pair-<objects>-<pair>-<baseline|simd|candidate>.log`.

P8 rollback verified: restored scalar source rebuilds successfully in native and Wasm, with 12 native and 21 benchmark/Perry/profile cases passing. The numeric oracle is retained; no forced-inline or SIMD implementation remains in source.

P7 extended contradiction check: 20 CPU11 triples cover all six permutations of scalar/P7/P8. Scalar/P7/P8 preparation medians are 16.0196/14.8097/16.5807 ms. P7 wins 14/20 paired comparisons, median ratio 0.927; all six order-group medians favor P7 (0.915–0.958). Projection paired ratio is 0.897, unchanged batching 1.005 and bulk 1.031. P8 preparation ratio is 1.039 with 5/20 wins. The P7 signal now warrants further diagnosis/browser validation; initial rejection is superseded by conflicting blocks, not silently discarded. Logs: `/tmp/tn-material-extended-pair-65536-<1..20>-<baseline|simd|candidate>.log`; service completed successfully in 6m33s. Before source restoration, a temporary diagnostic copy retains chronological 30-frame windows and compares default tiering with Node24 `--no-liftoff`, six rotated triples each. The original probe/judge remains frozen. Tiering is a hypothesis, not an established cause. Overall ceiling and qualification remain open.

P7 tier diagnostic completed: six triples per compilation mode, all permutations, same 180 frames/60 warmup, chronological 30-frame windows. Default P7 preparation/projection paired ratios are 0.967/0.931 (4/6 preparation wins), unchanged bulk/batching 1.026/1.028. Optimized-only (`--no-liftoff`) ratios are 0.991/0.955 (4/6 preparation, 5/6 projection wins), unchanged bulk/batching 1.096/1.058. Default first/last window preparation ratios are 1.041/0.930, optimized-only 0.879/1.029; unchanged-stage windows also move substantially. Thus the smaller projection term survives optimized-only compilation, but host drift prevents attributing window changes solely to tiering. Neither warmup artifact nor robust steady-state whole-frame gain is proved. Logs: `/tmp/tn-material-tier-<default|optimized>-<1..6>-<baseline|simd|candidate>.log`; service exited successfully in 5m29s. Restore P7 provisionally for renewed correctness checks and unchanged normal browser ABBA; no keep, ceiling or qualification tick yet.

P7 restoration verified: native focused 12/12, TS/Perry/profile 21/21, expanded exact-body Wasm numeric/virtual-hook oracle PASS. Rebuilt Wasm SHA256 `c4e4076e41c7a84d51f58f505a5f9cfb00d6ce2029d1364da0e05e73274874db` exactly matches the preserved P7 factory. Browser ABBA now runs scalar1/P7-1/P7-2/scalar2 with unchanged normal 600-frame/120-warmup, three-repeat judge and hardware Brave, CPUs9,11,21,23. No builds/tests/commits overlap its active timing; source remains a provisional probe until whole-frame results.

P7 browser follow-up rejected as an unproved whole-frame gain: scalar1/SIMD1/SIMD2/scalar2 completed in 27m, 600 measured/120 warmup and three interleaved repeats each, all 36 captures zero pixel mismatch. Median per-repeat Perry submissions: 51.260/50.930/44.520/49.410 ms; current controls: 68.8325/67.5425/51.8325/59.090 ms. Pooled repeat medians favor SIMD 50.6138→48.2000 ms, but per-repeat Perry/current median worsens 0.8120→0.8430 (+3.8%), with overlapping ranges. CPU-only projection evidence is retained, yet whole-frame attribution fails; restore scalar comparison and keep the 27-field oracle. Reports: `/tmp/tn-material-browser-<scalar1|simd1|simd2|scalar2>-report.json`.

Environment diagnosis before further engine tuning: CPUs9,11,21,23 are only two physical cores (siblings9/21 and11/23). Owned-service `/proc` samples showed GPU process ~174% aggregate CPU and renderer ~101%; a thread sample placed renderer99.7% on21, compositor59.8% on9 and GPU main95.8% on23. This observes competing sibling threads, not their causal timing penalty. CPUs8/9/10/11 are four distinct cores (IDs10/11/12/13), all L3 ID1. After scalar rollback verification, hold the engine fixed and run existing profile-only ABBA on two versus four physical cores, same120 measured/30 warmup and GPU/CDP/rAF settings. Any effect initially applies to instrumented diagnostics and needs unchanged normal600/120 confirmation. No ceiling or qualification tick.

P7 final scalar rollback verified: native focused12/12, TS/Perry/profile21/21 and expanded Wasm numeric/virtual-hook oracle PASS. An initial TS run overlapped factory relinking and failed four instantiations with mixed JS/Wasm assets; rerunning only after the build completed passed all21. Future factory-consuming tests must depend on build completion. Scalar Wasm SHA256 again matches preserved P6 `453ee1f0394e187ebf6f3b3d43ccb99e1f00de6d63e6c267080348665d4a7673`. Environment ABBA uses that fixed scalar engine.

Environment profile ABBA completed in3m29s on unchanged scalar SHA453ee1f0. Two-core1/four-core1/four-core2/two-core2 per-run median CPU submissions: current77.443/75.692/67.133/63.035 ms; Wasm-JS53.637/59.655/50.375/50.650; Perry57.595/50.322/49.530/49.768. First-to-last current drift18.6% exceeds the apparent allocation effect; no consistent large cross-arm gain is established, so no normal-run environment speedup claim. Main renderer/GPU/Viz threads inherited the intended masks; a GPU disk worker widened its own mask. GPU durations range0.30–3.48ms and remain small beside CPU; native has41–51 fresh observations per120, current120, all119 diagnostic rAF intervals present. All12 captures meet existing tolerance (max mismatch0.00000543). Profiles/reports: `/tmp/tn-browser-core-profile-<dual1|quad1|quad2|dual2>/`. Future engine browser comparisons will use four distinct cores8/9/10/11 consistently on both sides to avoid intentional sibling sharing; this is experimental setup, not a shipped engine optimization. Overall ceiling remains open.

Iteration diagnostic queued: a temporary copy of the existing180/60 CPU probe adds a frame permission barrier before game update, outside timers, and logs chronological stage samples. A Python parent pins both separate Node isolates toCPU11, resumes only one frame at a time, waits for the next readiness marker and confirms SIGSTOP via waitpid(WUNTRACED), alternating order each frame. This changes cache/TLB residency and is only a paired diagnostic; uninterrupted and browser judges remain required. Before A/B, require three identical-factory A/A runs with contiguous-block bootstrap95% intervals for paired preparation ratios inside[0.98,1.02], checking order strata. No candidate result before calibration.

Next engine hypothesis: P10 precomputes every active8-bit radix histogram in one key walk before existing stable scatters, avoiding activeDigits−1 indirect histogram walks without changing radix width or ordering. Counts are permutation-independent. Retain ID ties, zero normalization and nonfinite fallback; clear scratch pergroup and skip all histogram work for varying==0. Reuse the renderer scratch-storage pattern with a lazy vector of8 rows instead of an8–16KiB stack frame. Extend existing ordering coverage to consecutive groups with different active digits before timing. Batching remains a measured13–16% term, so the ceiling is not yet justified. No implementation or qualification tick yet.

Paired-frame diagnostic rejected after all three identical-factory A/A calibrations failed. Optimized-only preparation paired medians1.0015/1.0180/1.0456; contiguous20-frame-block bootstrap95% intervals[0.9779,1.0122]/[0.9998,1.0455]/[1.0287,1.0679]. First/second-order preparation ratios are1.0244/0.9501,1.0357/0.9999,1.0676/1.0178; bulk order effects are larger. The doubtful assumption is comparable cache/TLB residency across paused separate heaps; counterbalancing does not remove the observed bias. Stop this diagnostic rather than tune its gate or use it for candidate claims. Logs/consumed samples: `/tmp/tn-framepairs-aa-<1..3>{.json,-0.log,-1.log}`. Keep the existing uninterrupted CPU preflight and normal browser judge. No engine change from this experiment.

P10 baseline oracle passes before implementation in native and exact-body Wasm. Existing depth cases now include two interleaved2048-member groups whose high/low active digits swap between frames, plus an equal-depth group, while preserving signed-zero ties and infinity fallback. Packed matrices and per-instance colours are compared to independent depth/id ordering; original material/position fields are restored before subsequent invalidation/hook regressions. PRD progress remains0/3 phases,2/9 boxes,prd:25%. No artificial red or qualification tick.

P10 candidate verification: histogram accumulation now walks keys once for all active8-bit digits, then keeps existing stable scatters. Expanded ordering cases additionally change group sizes2048/2048→2730/1366 between frames, exercising scratch growth/shrink and different digit sets. Native focused12/12 pass; the unequal-size case rerun and exact-body Wasm oracle pass; benchmark/Perry/profile21/21 pass after the Wasm build completes. Candidate is provisional pending five alternating CPU pairs at4k/64k in both runtimes and, only if supported, normal browser comparison. No qualification tick or overall ceiling claim.

P10 CPU preflight: all five batching comparisons win at both sizes in both runtimes. Wasm4k batching0.0863→0.0754ms (paired0.873),64k2.7949→2.3792ms (0.863); native4k0.0843→0.0717ms (0.836),64k2.6380→2.3633ms (0.894). Total preparation4k improves in all five pairs (Wasm0.5416→0.5317ms; native0.4257→0.4141ms). Large preparation remains inconclusive: Wasm18.3655→18.5643ms, paired0.998 with3/5 wins; native13.3183→13.9021ms, paired1.031 with2/5 wins, while unchanged native records/matrix/other move+5.2/+7.4/+10.9%. Preserve the candidate provisionally for unchanged normal browser ABBA on four distinct cores8–11. Stage gain is not a whole-frame claim or overall ceiling. Logs: `/tmp/tn-histograms-<wasm|native>-pair-<4096|65536>-<1..5>-<baseline|candidate>.log`.

P10 normal browser ABBA completed in30m with identical game SHA and all36 zero-mismatch captures, four distinct cores8–11, unchanged600/120 and three interleaved repeats. Baseline1/candidate1/candidate2/baseline2 median per-repeat Perry submissions55.947/75.165/42.345/39.090ms; current controls66.880/85.325/52.298/53.090ms. Pooled per-repeat Perry/current medians0.7840→0.8122 (+3.6% adverse), broad overlap. Median within-frame batching/projection ratios0.13968→0.11486 (-17.8%), supporting a bounded stage improvement while whole-frame retention remains unproved. The identical candidate changes75.165→42.345ms across blocks; elapsed noise is not a ceiling. Reports: `/tmp/tn-histograms-browser-<baseline1|candidate1|candidate2|baseline2>-report.json`.

P12 diagnostic: add two profile-only console timestamp markers and collect CDP Performance ThreadTime/ProcessTime/Timestamp deltas over the measured phase. Main-thread CPU includes synchronous Wasm, profiler and other renderer work; process CPU includes renderer background threads but excludes GPU process. Wall includes inter-frame rAF/GPU waits. Report means per frame, not p50/FPS; process counter retrieval failure is null. Missing/duplicate/invalid markers or counters fail. Reuse existing profile report and CDP surface; no generic runner or normal-timing change. Source semantics: [Chromium Performance agent](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/inspector/inspector_performance_agent.cc). Regression first fails for missing calculation; implementation and fixture checks22/22 pass, focused TypeScript passes, Biome has seven warnings/no errors. Vitestconsole lacks timeStamp, so the browser fixture supplies/restores it explicitly. Review requires page.close in finally even when CDP detach fails; applied. Hardware smoke and64k counter diagnosis pending; no qualification tick.

P12 hardware smoke passes on NVIDIA/Turing:4k,10warmup/30measured, all three captures zero mismatch; all marker/counter checks succeed. Measured-phase mean main-thread CPU is8.220/2.220/2.351ms per frame (current/Wasm-JS/Perry), with positive renderer-process CPU counters. This short instrumented smoke validates plumbing only; current phase wall includes slow timestamp-query resolution.22focused checks rerun pass after cleanup change. Standard report preserved at `/tmp/tn-cpu-consumption-smoke-report.json`. Next profile64k with preserved baseline/candidate factories in ABBA order, same120/30 diagnostics and four physical cores; normal judge remains unchanged.

P12 64k counter ABBA passes all12 existing image tolerances (max mismatch0.00000543), same120/30 instrumented diagnostics. Baseline1/candidate1/candidate2/baseline2 Perry main-thread mean CPU52.357/63.909/50.743/43.873ms per frame; phase wall53.219/67.328/51.819/44.301ms. Current mean CPU69.504/109.080/75.107/51.695ms. Native main-thread CPU occupies~95–99% of these phase wall spans; off-CPU delay alone does not explain drift. Identical source still varies materially in CPU consumption, so CPU counters do not manufacture a primary gain. Active self-sample rankings remain world publication22.6–24.6%, bulk14.9–18.2%, projection14.8–16.4%, prepare11.7–13.5%, material9.0–10.4%; these are sample shares, not weighted CPU-time fractions. Artifacts: `/tmp/tn-histograms-cpu-profile-<baseline1|candidate1|candidate2|baseline2>/` (existing report/CDP files). P10 remains provisional, and the overall ceiling remains open. Next use existing perf PMU counters on the unchanged uninterrupted probes to quantify instructions/cycles/cache trends rather than attribute CPU drift to frequency or memory without evidence.

P13 PMU diagnostics: task-owned native five-pair4k/16k/64k probes schedule every counter100%; native64k preparation paired0.9421,5/5 wins. Native counts cover the existing300-frame program plus setup/teardown. Generic Ryzen5900X cache events are L2 requests/misses, not LLC or bandwidth ([kernel mapping](https://raw.githubusercontent.com/torvalds/linux/master/arch/x86/events/amd/core.c), [Zen3 events](https://raw.githubusercontent.com/torvalds/linux/master/tools/perf/pmu-events/arch/x86/amdzen3/cache.json)). For Wasm, perf controls enable exactly after60warmup and disable after120 measured frames, excluding startup/compilation; no-inherit counts only Node main-thread game/update/prepare work. The installedperf acknowledgement includes a trailing NUL; its reader was corrected before calibration. Three identical-factory runs differ0.00009% in instructions despite13% CPU variation. Raw demand-fill events distinguish same-CCX L3/peer-L2 from DRAM/IO sources, not pure L3 hits or DRAM-only traffic ([definitions](https://raw.githubusercontent.com/torvalds/linux/master/tools/perf/pmu-events/arch/x86/amdzen3/memory.json)).

P13 initial five-pair Wasm PMU block supports64k CPU paired0.9351,5/5, but16k preparation worsens1.0416,2/5. Extended20pairs resolve the holdout:16k CPU0.9792,14/20; preparation0.9780,15/20; batching0.8715,20/20. At64k CPU0.9321,19/20; preparation0.9664,14/20; batching0.8704,20/20; unchanged bulk0.7942,20/20; DRAM/IO-source fills0.8382,19/20. Instructions change only~0.1%, so do not attribute the20% bulk shift to fewer bulk instructions. Baseline4k→64k instruction count grows15.88× but cycles29.61×; mean counted clock increases4.20→4.38GHz and IPC drops3.095→1.660. Demand-fill source distribution changes sharply with size. This supports a cache-sensitive execution-cost diagnosis, not proof of pure memory saturation or an overall ceiling. Logs: `/tmp/tn-histograms-pmu-{native,wasm}-<objects>-<pair>-<variant>.{stat,log}`, `/tmp/tn-histograms-pmu-extended-<16384|65536>-<1..20>-<baseline|candidate>.{stat,log}`.

P14 layout control: P10 shifts incumbent RenderDatabase fields and Wasm globals. World-publication emitted code is byte-identical; bulk instruction text differs only in globals shifted+16bytes. Move histogram storage to the class end with uint64_t alignment, restoring every incumbent field offset while preserving P10sizeof (native928, Wasm592; baseline904/576). Compiler layout dumps verify both targets; P10/P14 bulk instruction text, including global addresses, is now identical. This controls member placement without claiming a cause for bulk changes. Native12/12, exact-body Wasm ordering oracle and TS/Perry/profile22/22 pass before timing. Compare all three preserved factories in six fully balanced orders at4k/16k/64k; no qualification tick.

P14 balanced six-order triples completed, all PMU counters100% scheduled. Wasm64k paired CPU P10/baseline0.9609 (4/6 wins), tail/baseline1.0262 (2/6), tail/P10 0.9946; bulk0.9660/0.9861 versus baseline. The earlier20% bulk shift does not repeat. At16k both histogram layouts regress amid large unrelated-stage/refill shifts; instructions remain essentially identical between layouts. Native64k paired CPU0.8647/0.9118, batching0.8128/0.8511 (5/6 and6/6 wins), but projection also changes materially. Member placement does not identify a stable causal explanation; whole-frame retention remains unproved. Logs: `/tmp/tn-histograms-layout-<wasm|native>-<4096|16384|65536>-<1..6>-<baseline|candidate|tail>.{stat,log}`. No ceiling or qualification tick.

P15 isolated probe: compute the existing normalized IEEE depth key in addBatchMesh while depth is already live; delete the later full batch-member reread/key walk. Clear key scratch at both member-clear sites. Preserve all depth arithmetic, zero normalization, fallback sorting, stable radix and ID ordering. Compare against preserved P14, measuring combined projection+batching and whole preparation because work moves between stages; a batching-only win is insufficient. Existing mixed/unequal-group, nonfinite, signed-zero and callback oracle covers lifecycle/order.

P15 pre-timing verification: native focused12/12, exact-body Wasm ordering/callback oracle PASS, TS/Perry/profile22/22. Both factories/binaries preserved independently. Run six alternating uninterrupted pairs at4k/16k/64k in both runtimes; source remains provisional pending combined-stage and whole-preparation results.

P15 rejected: six alternating pairs at each size, all counters100% scheduled. Wasm4k/16k/64k combined projection+batching paired1.0765/1.0470/1.0132 (0/6,3/6,3/6 wins); large-scene instructions rise0.668%. Native paired1.0115/1.0022/0.9582 (1/6,3/6,4/6), instructions rise~0.105% at every size. Per-append capacity/loop effects outweigh the removed walk in Wasm; a batching-only interpretation would be wrong. Restore pre-P10 scalar/radix source (008c90028), retaining expanded ordering tests. P10 histogram stage gains are real but its unchanged normal browser whole-frame comparison remains unproved, so remove provisional P10/P14 as well rather than count their CPU-only effects as shipped gains. Logs: `/tmp/tn-depth-append-<wasm|native>-<4096|16384|65536>-<1..6>-<baseline|candidate>.{stat,log}`.

Focused retained-P14 native cycles profile (`/tmp/tn-determinant-baseline.perf`,28k samples,no lost samples) attributes determinant2.11%, compose5.14%, sameUniforms16.48%, project17.75%, batching12.47%. A guarded affine determinant predicate could preserve >0 semantics with finite magnitude bounds, but even complete deletion is below10% and guard costs remain; do not implement it speculatively. Remaining large paths still require immediate material observation, projection/packing and world publication. Next isolate Three material-check policy with existing everyFrame option; the frozen normal judge remains unchanged. Overall ceiling remains open pending that evidence.

P10/P14/P15 final rollback verified: native12/12, exact-body Wasm ordering/callback oracle PASS, TS/Perry/profile22/22; Wasm SHA453ee1f0394e187ebf6f3b3d43ccb99e1f00de6d63e6c267080348665d4a7673 exactly matches the preserved pre-histogram baseline. P16 diagnostic uses the existing constructor projection.materialChecks option on Three only, spread/everyFrame/everyFrame/spread, fixed engine,64k,30warmup/120measured, hardware Brave,four physical cores. A temporary entry copy includes the final public projection report and asserts mode/staleness128 versus0 outside measured markers, then restores the original entry on exit. This isolates Three policy cost, not native policy cost, and cannot redefine normal performance qualification.

P16 profile ABBA completed: all12 captures pass existing tolerance(max0.00000543); final public reports prove spread512checks/frame,128staleframes versus everyFrame0staleframes. Spread1/every1/every2/spread2 current main-thread mean CPU80.485/153.657/160.142/66.708ms; unchanged Perry52.040/51.357/49.316/49.877ms. This large Three policy cost is a diagnostic, not native savings or normal qualification. The temporary benchmark entry is restored. Normal600/120 ABBA is prepared for later confirmation.

P17 measured hypothesis: warm-window V8 JIT cycles profile(170k samples,no lost samples) attributes20.23% to worldSelf. Its inlined compose including operand loads/stores occupies7.02% of local samples(~1.42% total), arithmetic alone2.27%(~0.46% total); no SIMD compose probe is justified.60.78% of local samples land on the stack store immediately after the first object matrixAutoUpdate load; skid prevents assigning exact latency to one instruction, but this localizes a candidate near object metadata access. Native already has prefetch; Wasm has none. Probe lookahead16 ordinary flag reads into a volatile stack sink on the guarded flat loop, without using early values for decisions. Preserve fresh reads after authored hooks and inspect generated machine code to ensure V8 retains the demand load. No class/global scratch allocation or native change. Profile: `/tmp/tn-wasm-world-pc.Esk2um/`. Overall ceiling remains open because this newly localized term could exceed10%.

P17 pre-timing checks: native12/12, future-load exact-body Wasm oracle PASS, TS/Perry/profile22/22; same guarded current-load control oracle PASS. Restored future build matches archived factory byte-for-byte. Emitted Wasm retains load8_u offset160 through the future child pointer, followed by store8 into stack offset1216. Neither early pointer nor value survives for later rendering decisions. Compare original/current/future in all six balanced orders at4k/16k/64k; inspect optimized V8 code too because a demand load can move the stall rather than hide it.

P17 rejected: optimized V8 preserves the future load and dependent stack store. Samples shift worldSelf20.23→9.21% and project16.27→31.55%;54.80% of project samples land immediately after the future flag load, consistent with moving the wait rather than hiding it. Six balanced triples retain100% PMU coverage. Restore original renderer source; neither extra load ships. A targeted flags/reference reorder was reviewed: the required pivot engagement check remains on the later line, so it has no demonstrated line-removal mechanism and overlaps the prior cold-layout trial. No further speculative reorder. RawJIT profile `/tmp/tn-wasm-world-pc.76my7f/`; triples `/tmp/tn-read-ahead-<4096|16384|65536>-<1..6>-<baseline|current|future>.{stat,log}`. Exact ratios follow with rollback verification.

P17 final64k ratios versus original: current/future CPU1.00055/1.06250(3/6,2/6 wins), preparation1.00801/1.07936(2/6,1/6), projection1.01547/1.12518(1/6,1/6), unchanged bulk1.00121/0.99591. Future/current CPU1.04247, preparation1.05328.4k/16k ratios are mixed and do not justify retaining extra work. Rollback verified native12/12, exact-body Wasm oracle PASS, TS/Perry/profile22/22; Wasm SHA453ee1f0 restored exactly. No read-ahead code remains. Final P16 normal-timing ABBA uses600measured/120warmup,three interleaved repeats per block,samehardware/fourcores and fixed engine; only Three material policy differs, with explicit final report assertions. No builds/tests/commits overlap active timing. This checks policy attribution and actual retained runtime ratios before closing the bounded engineering loop; it is not a substitute for N20 qualification.

P16 normal ABBA completed in37m,600measured/120warmup,three interleaved repeats per block,all36 captures zero pixel mismatch. All four reports have the same game and engineSHA453ee1f0; the original benchmark entry is restored byte-for-byte. Default spread first/last block median per-repeat Three/Perry ratios1.2898/1.3133; pooled six-repeat median1.2959(range1.1230–1.3885). Strict everyFrame blocks3.1051/3.0412; pooled median3.0732(range1.8842–5.0526). Compare per-repeat ratios rather than dividing separately pooled timing medians amid host drift. Final reports prove128stale frames at512checks/frame versus0strict; native policy never changed. Strict-policy3.07× is a separate diagnostic, not the frozen default judge or a2×qualification claim. Reports: `/tmp/tn-material-policy-normal-<spread1|every1|every2|spread2>/web-report.json`.

Performance stopping decision: the tested optimization search reached its engineering ceiling for this frozen workload, hardware and compatibility contract. Rejected exactness-preserving instruction, SIMD, radix, layout, IPO, histogram, depth-pass and demand-read-ahead hypotheses are recorded above; retained repairs pass their focused native/Wasm checks. No audited short, contract-preserving removal with evidence of a remaining≥10% whole-frame gain remains. Compose arithmetic is~0.46% of sampled Wasm cycles; determinant~2.11% native; large aggregate paths include required immediate field observation, world publication and packing. This is a bounded engineering stopping point, not a numerical upper bound, absolute optimality or proof of hardware saturation. Default normal gain remains~1.30× at64k; the differing Three material policy explains a substantial comparison cost. Keep N20web/default promotion unqualified and the scaling18×gate failure open. Resume remaining PRDs and PR438missingchecks as requested; do not loosen either performance gate.


## Reopened 2× target (owner, 2026-10-07)

The owner explicitly prioritizes the 2× target over the remaining PR/PRD checks. The previous
stopping decision closes the short instruction-level search; it does not close this renewed
campaign. Keep the default Three material policy, workload, pixels, sample counts and 18× scaling
gate fixed. A 1.30× incumbent needs approximately 35% lower CPU submission time to reach 2×.

P18 hypothesis: object/material heap placement is an untested part of the measured cache-sensitive
cost. Probe the standard library's per-type pool allocation on an otherwise unchanged copy of the
existing native scaling fixture, linked to the same engine libraries. This diagnostic changes only
allocation placement, not source object values, traversal, comparisons, ordering or renderer code.
Alternate baseline/pool at 4k/16k/64k, recording unchanged stages and allocation spacing. No product
allocator or performance claim until this supports a repeatable gain and survives the browser arm.
The existing compatibility/coverage edits are preserved separately. Coverage refresh is pending
(the existing engine aggregate omits `native_engine_gate_e`); no coverage record was restamped.


P18 rejected: separate-binary 64k preflight favored pooling by 6.3% median (4/5 pairs), but a
single-binary allocation-mode control removes code-placement differences and fails the holdouts.
Five alternating pairs per size give pooled/baseline preparation ratios 1.0024 / 1.0180 / 1.0465
at 4k/16k/64k (2/5, 0/5, 0/5 wins). No product allocation change is retained. Logs:
`/tmp/tn-2x-pool-control-<objects>-<pair>-<baseline|pooled>.log`; both modes use binary SHA256
`4e2de64f39aa8046ad1b3fa1d560878d6b649801f46cb50881ab0b44ce060264`.


P19 hypothesis and scope: first measure a native-only parallel world-update split on the exact,
childless Mesh fast lane. Join before serial projection and skip its duplicate matrix composition;
keep lights, callbacks, immediate material checks, grouping and the global depth/ID sort serial.
This targets roughly 20% of sampled CPU and cannot alone provide the missing 35%. Use a temporary
copy of the current renderer with standard-library async tasks as a feasibility probe, not a new
shipped worker framework. Reject if lost fusion locality/task overhead erases the gain. A retained
threaded implementation would additionally need prestarted workers, full compatibility cases,
matching Perry shared-memory imports and threaded Wasm build/deployment proof. The read-only
medium checkpoint review identified these requirements; existing VM workers cannot be reused in
the JS-free engine. No threading product change or qualification box is claimed.

P19 rejected: the same-binary mode control keeps renderer code layout fixed. Five alternating
native pairs per size give four-worker/original preparation ratios 0.9774 / 0.9710 / 1.1252 at
4k/16k/64k (5/5, 5/5, 1/5 wins); serial split/original is 1.0101 / 1.0433 / 1.1965.
Splitting world publication from projection loses locality at 64k; parallelizing that small span
recovers only part of the loss. This is diagnostic under shared-machine load, not qualification.
Exact ordering/material edits/hooks/reordering checks (`uniform_batch_preparation`) and directional
light checks pass in all three modes. A broader instancing draw-count check fails identically in
the original product binary (2 versus expected 10 separate draws), while pixels match; no candidate
fix is inferred. Logs `/tmp/tn-2x-world-<objects>-<pair>-<workers>.log`; probe binary SHA256
`7164f7998801e8ac658eaf1c58f65e9db8e2ff97cacf66b41253fc0abdf10076`. No product edit retained.

P20 hypothesis: preserve more per-object locality within the worker. In a temporary native renderer
copy, combine world publication with disjoint warm-record validation, compact eligibility,
comparison against one held representative material, depth calculation and float matrix/color
packing. Join before the original serial grouping, callbacks and global depth/ID sort. A per-child
result is consumed only after exact current-frame checks; cold, hidden, layer-excluded, callback,
noncompact and nonrepresentative grouping cases retain the existing path. No shared map/vector,
rebuild counter or diagnostic is mutated by workers. This attempts to move roughly 40–50% of
preparation CPU together, targeting at least 20% lower preparation time; it cannot establish 2×
whole-frame performance by itself. Use the same frozen fixture and correctness oracle first.

P20 rejected: all nine unchanged CPU compatibility checks pass. Five alternating native pairs per
size give four-worker/original preparation ratios 0.8838 / 1.0808 / 1.4134 at 4k/16k/64k
(5/5, 0/5, 0/5 wins). Serial preprocessing/original is 1.1515 / 1.4846 / 1.9641. The first
source Mesh is the ground; its material differs by identity from the main group's first material,
so the exact-operand guard repeats uniform comparisons for that group. Serial grouping also
rereads scattered source metadata after workers have streamed it. Logs
`/tmp/tn-2x-precompute-<objects>-<pair>-<workers>.log`; binary SHA256
`4d5a0931b0c29fdd9a52a36e13a3ca368c4e58bfaad4334e41acf0cdb162866c`. No product edit retained.
Two split-processing probes regress at 64k. Stop changing that design and re-attribute native
cycles/instructions before selecting a further candidate; per-object parallelism alone does not
establish a speedup.

P20 re-attribution: whole-program native cycle sampling (including the fixture's untimed game
updates) puts sameUniforms at 12.61% in original mode and 35.21% with four-worker preprocessing.
The worker body is 18.63%, serial addBatchMesh 9.82%, batchMeshes 8.37%. These are sampled CPU
shares across all threads, not frame-time deltas. This supports the duplicate-comparison diagnosis
and prevents treating per-object threading as a proven gain. Profiles `/tmp/tn-p20-{0,4}.perf`.

P21 hypothesis: change only P20 representative selection. Before resetting prior-frame scratch,
retain the material from the earliest scene-order member of the largest prior batch group. The
original exact-operand guard remains; if grouping sees any different material, it still performs
the original comparison. Preserve source ownership until serial grouping finishes and release the
temporary owner before authored callbacks. Cold frames keep P20's fallback selection. This removes
P20's duplicated comparison for the dominant stable group without assuming material immutability
across frames or changing grouping equality. Reuse the same compatibility cases and paired probes.

P21 rejected for the large workload: all nine CPU compatibility checks pass. Five alternating
native pairs per size give four-worker/original preparation ratios 0.7150 / 0.9267 / 1.3440 at
4k/16k/64k (5/5, 4/5, 0/5 wins). Serial preprocessing/original is 0.9990 / 1.4602 / 1.9554.
The exact representative guard improves the smaller working sets, but does not remove the 64k
regression. Logs `/tmp/tn-2x-representative-<objects>-<pair>-<workers>.log`; final binary SHA256
`0d1cd069e47edcc2d7d4a41b98c513ec13b16332cc947e7f4e8bc58e06011f37`. No product edit retained.
The doubtful assumption after these three threading probes is that offloading calculations is
sufficient while the serial merge still rereads and prefetches the original scattered metadata.
Re-profile that merge before another implementation; do not count small-scene gains as 2× proof.

P21 re-attribution: four-worker whole-program cycle shares remain sameUniforms 27.46%, worker
body 18.74%, serial addBatchMesh 12.51%, project 7.15%. Annotated sameUniforms samples cluster
at/after operand loads (including 26.85% at one numeric load); instruction skid prevents assigning
precise latency to that load. A concrete omitted mechanism is visible in source: the incumbent
native fused traversal prefetches future object, material and transform data, while P19–P21 workers
perform those scattered loads without its read-ahead.

P22 hypothesis: reuse the incumbent native traversal's existing prefetch block inside P21's worker
loop, with the same distances and no evaluator changes. This tests an omitted latency-hiding
mechanism before adding snapshot formats or worker infrastructure. Preserve original serial
prefetches for this isolated probe. It is native-only; no browser claim follows from it. Reject if
five paired large-scene runs still fail; re-attribute rather than tune distances to this fixture.

P22 fails the large-scene screen: all nine CPU compatibility checks pass; every large-scene
four-worker pair remains slower than original. The smaller working sets improve: four-worker/original
4k/16k ratios 0.7252 / 0.8705, both 5/5 wins. The 64k four-worker/original ratio is 1.2713 (0/5 wins), serial/original 1.5838; detailed ratios are in
`/tmp/tn-2x-worker-prefetch-pairs.log`; no product edit retained. Native probe SHA256
`582132c9af1b8b6c4a7ecc22f3ca815e42f9c4ef118f6337315d234aa41af49a`.

P23 hypothesis: the main merge should consume exact current-frame group metadata already read
by workers, rather than revisiting the source Mesh/Material/Record cache lines. Add those scalar
and pointer snapshots to temporary per-child outputs; compare the identical geometry/buffer,
order, shadow and material-type predicates from them. Keep exact-operand uniform fallback and
serial group/map/vector mutation. Worker writes Record.seen only in its disjoint successful slot;
draw reset stays serial. Skip redundant source prefetch only for successful prepared children.
A correctness gap in all prior threading prototypes is also identified before shipping: a public
scene.children vector can repeat a Mesh pointer. Require unique current pointers before launching
workers, caching only an exactly equal pointer vector and rechecking all original type/parent guards
on every frame. Changed vectors are sorted and checked for duplicates; duplicates use the serial
path. Add that raw-duplicate case to the temporary oracle. No threading change is in product code.

P23 diagnostic advance, not a keep: all nine CPU checks pass. Review corrected the supplemental
raw-duplicate case to duplicate scene.children.front() after reversal, so the entries span worker
chunks; the corrected oracle passes all three modes. Its draw assertion verifies compatibility,
not independently the absence of races; uniqueness fallback is inspected and sanitizer proof is
still required before shipping. Five alternating native pairs give four-worker/original ratios
0.6215 / 0.7101 / 0.9558 at 4k/16k/64k (5/5 wins each); serial snapshot/original is
0.9433 / 1.0418 / 1.2413. Large-scene gain is only 4.4%, below the campaign's needed 35%.
Scaling probe SHA256 `f5cfebd43ea4579d2022060cd1b24e85ed41c86b3c560f2e0433ffb56c12e0ac` is
unchanged after the oracle-only correction. Logs `/tmp/tn-2x-snapshot-<objects>-<pair>-<workers>.log`.

P24 hypothesis: test P23 on the actual Wasm execution target. Native's arithmetic/memory balance
is insufficient to infer Wasm threading gains. Build an isolated pthread-enabled Wasm prototype
with prestarted workers, the same source-header overlay for all consumers, and the exact CPU
ordering/mutation/hook oracle. Compare zero/one/four-worker modes within that same artifact and
against preserved incumbent unthreaded bytes. Only then decide whether browser/Perry integration
is justified. No product CMake, Perry import, public thread policy or qualification change yet.

P24 harness finding: a synchronous Node diagnostic loop prevents Emscripten pthread-cleanup
messages from running. It creates hundreds of replacement worker threads and reports invalid
steady-state preparation around 155 ms. Yielding outside the timed prepare between frames lets
the pool recycle; the 90-frame diagnostic then reports 16.7446 ms preparation (10.5889 projection,
4.1915 batching), bulk 7.7827 ms. ENV confirms mode 4 and CPU tick deltas show three active Wasm
worker threads. This is a diagnostic harness correction, not a product/evaluator change; default
browser rAF already yields. Preserve this distinction and compare every Node arm with the same yield.
Threaded Wasm SHA256 `44c6b766fc7dd1025b1adfe087a8dacc2f2f002f88c82464463e313dbb4d6b27`;
incumbent SHA256 `1de91030dd97ed42288a5c02a540fc2d1174dc1ff148ec909cc63d8c394b117c`.

P24 rejected for the large workload: the exact Wasm CPU mutation/order/hook oracle passes modes
0/1/4. Five interleaved yielding Node pairs per size give shared-memory mode 0/incumbent combined
bulk+prepare ratios 1.0620 / 1.0902 / 1.0130 at 4k/16k/64k (0/5, 0/5, 1/5 wins). Four-worker ratios
are 0.9533 / 0.8919 / 1.0911 (5/5, 5/5, 1/5 wins). The 64k arm regresses by 9.1%, with bulk around
7.6–8.3 ms and prepare 16.6–17.2 ms versus incumbent bulk 6.1–6.5 ms and prepare 15.9–16.2 ms.
These are CPU diagnostics under shared-machine load, not Perry/GPU qualification. Logs
`/tmp/tn-2x-wasm-pairs.log`; no product threading change retained.

P25 attribution hypothesis: before introducing cross-frame material-cache state, measure the
maximum removable cost of sameUniforms in the unchanged synthetic workload. A temporary renderer
copy replaces only the compact grouping equality call with true; all fixture materials have equal
non-color uniforms, but this deliberately cannot preserve general mutation semantics and cannot
ship or qualify. Reuse existing unthreaded Wasm build objects and the same yielding CPU diagnostic,
compare five interleaved pairs, then restore incumbent build output. No frozen evaluator edit.
Only proceed to a sound ABI mutation/version cache if this upper bound justifies its overhead.
Existing setters bump Material.version, but uniform color aliases and native scene escapes can
bypass that version; those paths must conservatively retain immediate comparisons.

P25 initial upper-bound result is contradictory: five paired combined elided/incumbent ratios
are 0.9284 / 0.9476 / 1.1701 at 4k/16k/64k (4/5, 5/5, 0/5 wins). The 64k projection grows from
about 10.4–11.8 ms to 14.4–14.7 ms despite removing comparisons. No cache implementation is
justified by these measurements. Before attributing that regression, directly compile/link an
unchanged renderer through the identical temporary-object route and compare all three arms;
link placement/code generation must be controlled. Elision Wasm SHA256
`6f6657db5336e6e7f223b5e580adafb4179f868b5fe54cbb43015e655c4dc961`;
logs `/tmp/tn-2x-material-upper-pairs.log`. Incumbent files were never replaced.

P25 link control: the unchanged-source direct-link artifact SHA256
`3422813ba7f1e900df0761e9a9496c2ca2b69c90fd7fb9512b63e0a29c20c87c`
has five-pair median combined/incumbent 1.0010 (2/5 wins), while elision is 1.1654 (0/5).
The last two control runs also show drift; nonetheless all five elision runs regress. Simple link
placement does not explain the result. Next collect measured-phase JIT-symbolized Wasm cycle
samples and inspect generated call boundaries before another cache design; no product keep.

P25 re-attribution: measured-phase JIT-symbolized cycle samples confirm sameUniforms disappears;
projection self share grows 17.50%→28.18%. World-update Wasm text and all static data segments are
byte-identical, and addBatchMesh is inlined in both, ruling out the proposed call-boundary change.
Three paired PMU probes, all counters 100% scheduled, show instructions ratio 0.9101 in every pair,
cycles 1.0667/1.1389/1.0430 and DRAM/IO demand-fill ratios 1.1489/1.2334/1.0532. Fewer operations are offset by
worse memory execution. These raw0x43 counters describe L3/peer-L2 and DRAM/IO demand fills, not L2 misses or bandwidth saturation.
Profiles `/tmp/tn-2x-material-profile-<control|elided>-root`; counters
`/tmp/tn-2x-material-pmu-<1..3>-<control|elided>.stat`. Defer cache machinery and attack allocation
locality. This is a rejected diagnostic direction, not a correctness-qualified optimization.

P26 hypothesis: P18 tested allocator locality only in native code. Wasm has different pointer and
object sizes and must be measured directly. A temporary copy of the two binding constructors uses
per-type std::pmr::synchronized_pool_resource with allocate_shared for Mesh/Material only. A single
artifact selects original/pooled allocation before scene construction, preserving all per-frame
validation and immediate fields; compare five pairs at 4k/16k/64k and preserved incumbent control.
The temporary resources have process lifetime; do not ship that lifetime policy without audit.
No product allocator or evaluator edit. Reuse existing Wasm object libraries, replacing only the
two binding objects at link time; same binary original/pooled comparison isolates allocation.

P26 passes CPU screening: five paired pooled/incumbent combined ratios are 0.9556 / 0.9125 /
0.7367 at 4k/16k/64k, all 5/5 wins. Same-binary pooled/original ratios are 0.9543 / 0.8692 /
0.7215, also all 5/5. The original-allocation control/incumbent is 0.9992 / 1.0133 / 1.0240.
Wasm SHA256 `93c22eecfd17b9b3b35c19a34a25faad73fecf14402d938413595678b5952d9d`;
logs `/tmp/tn-2x-wasm-pool-pairs.log`. Both modes keep two submitted candidates, one batch and
65,536 members at 64k. This is not browser/Perry qualification or a 2× claim.

P26 lifetime refinement: retain a process-lifetime resource identity, but return its chunks when
its last allocate_shared control block (including weak references) is deallocated. Use a counted,
locked std::pmr::memory_resource around the measured synchronized_pool_resource, and separate the
per-type singleton from argument forwarding. Test final release, surviving weak owners, allocation
and constructor exceptions, over-alignment and reuse before timing the refined implementation.
Scope if qualified: engine ABI allocation only, Wasm-only default, three implementation files
(two constructor call sites plus private allocator header). Complexity 3 → LOW; risk override none;
performance checkpoint review obtained because allocator lifetime can cross context ownership.
No product code yet. Browser end-to-end judge and native/Wasm ABI compatibility remain required.

P26 reclamation prototype passes: allocation/constructor-failure, weak-control-block lifetime,
over-alignment and reuse checks pass natively, under ASan+UBSan and in Wasm. The retained-pool
control fails the last-control-block reclamation assertion, as intended for this actual lifetime
requirement. Five refined pooled/incumbent CPU ratios 0.9386 / 0.7909 / 0.7597 at 4k/16k/64k
(4/5, 5/5, 5/5 wins). Original-allocation control drift increased materially under shared host load;
these remain diagnostics. Refined artifact SHA256
`eeecf765e8b0dbfdb49fa39a14d857a3c3dcfae01fb2689ed93df18203bb98f3`;
logs `/tmp/tn-2x-wasm-pool-reclaim-pairs.log`.

P26 provisional product implementation uses private `abi/pooled_shared.h`, both binding constructor
call sites and the existing ABI lifetime case. Review required explicit process-lifetime
new_delete_resource upstream; applied. PMR declarations and pool-specific unit assertions are
excluded from native Apple builds, which use make_shared; this avoids imposing newer system PMR
symbols on their deployment targets ([LLVM availability contract](https://raw.githubusercontent.com/llvm/llvm-project/release/18.x/libcxx/include/__availability)).
Final native ABI/C11 10/10 and Wasm ABI 9/9 pass; actual allocator-header ASan+UBSan check passes;
web/Perry harness checks 20/20 pass. Frozen judge/workload/scene diff and whitespace checks are clean.
Final product Wasm SHA256 `cfa2ecf9da1dbb09b563eaae0f66cc14b09f13fb461deda2023f26b2733bcbe2`;
JS SHA256 `395819667f0184509822af882046f2d90e1a6b496c048d6a3a236c500f4f8a4b`.
Five paired CPU screens of these final bytes are running before normal browser ABBA. No keep,
2× qualification, full-platform test or native scaling pass is claimed.

P26 final-byte CPU screen passes: five paired candidate/incumbent combined ratios are 0.9661 /
0.6945 / 0.6975 at 4k/16k/64k (4/5, 5/5, 5/5 wins); all measured frames retain the expected batch
and zero record rebuilds. Logs `/tmp/tn-2x-wasm-pool-product-pairs.log`. Start the unchanged 64k
browser judge in baseline/pool/pool/baseline order, 600 measured/120 warmup and three interleaved
repeats per block, physical cores 8–11, preserved engine hashes and existing hardware/image checks.
No builds/tests overlap its active timing. The first service launch lacked a user bus environment;
no browser started. Explicit existing /run/user/<uid>/bus environment corrected it. Owned transient
unit `tn-native-engine-pool-abba.service` is active; its EXIT trap restores final product bytes.
Product performance is provisional until this normal browser comparison finishes.


P26 browser interruption: journal evidence shows the owned ABBA unit was stopped externally at
09:54:39local after baseline1 completed; no pool browser verdict was produced. Its completed report
is preserved at `/tmp/tn-2x-pool-browser-interrupted-baseline1-report.json`. A fresh unchanged ABBA
attempt passes doctor but fails before launching Chromium: the managed execution environment
blocks X11 socket binding (`scripts/xvfb.sh`). Candidate product bytes were restored by the trap.
Requested restored local execution or the unchanged existing script in a normal terminal; no GPU
assertion, performance gate or browser recipe was relaxed.

P26 cycle/cache re-attribution succeeds without browser sockets. Existing measured-phase Wasm/JIT
profiling and three alternating PMU pairs use120measured/60warmup and physical cores8–11, no
concurrent builds/tests. All counters are100% scheduled. Pool/incumbent median ratios: instructions
1.0000, cycles0.6629 (pairs0.6629/0.7161/0.5518), taskCPU0.6684, L3/peer-L2 demand fills0.7777,
DRAM/IO demand fills0.3686. This supports allocation locality rather than instruction elimination;
it does not prove bandwidth saturation or a browser2× gain. Event-name audit corrected P25's
old L2 label: raw0x43/0x02 is L3/peer-L2 demand fills,0x43/0x48 combines local/remote DRAM/IO
fills ([Linux Zen3 event definitions](https://raw.githubusercontent.com/torvalds/linux/master/tools/perf/pmu-events/arch/x86/amdzen3/memory.json)).
Profiles: `/tmp/tn-2x-material-profile-pool-audit-<baseline|pool>-root`; counters:
`/tmp/tn-2x-pool-pmu-verified-<1..3>-<baseline|pool>.stat`. An initial zsh label loop grouped both
labels; those three files are baseline-only controls and were not used as candidate evidence.
The corrected Bash pairs above are the valid comparison. On the pooled heap, bulk/prepare
CPU screening places batching around25% of combined cost; test that newly significant term
before declaring the renewed campaign's ceiling. No qualification box ticked.

P27 hypothesis: after P26 changes heap locality, batching is now about25% of combined CPU screening cost. Revisit one-pass active8-bit histograms on this changed working set in a temporary same-binary mode control, preserving stable scatters, depth/id ties, zero normalization and nonfinite fallback. Use8KiB Wasm stack scratch only for the diagnostic to avoid changing RenderDatabase layout; neither mode ships. Compare unchanged pool artifact, temporary original path and histogram path before any product edit. Existing expanded ordering oracle must pass both temporary modes. No evaluator change; archived P26 browser artifact stays fixed. `pnpm prd:progress` encountered denied tsx CLI IPC; executing the same existing script through `node --import tsx` reports0/3phases,2/9boxes,prd:25%.

P27 rejected as an unproved combined-cost gain. Both same-binary modes pass the exact current ordering/mutation oracle, including unequal groups, signed-zero ties, nonfinite fallback and callbacks. Six fully counterbalanced triples per size keep expected draw/batch/member counts and zero rebuilds. Histogram/control combined ratios4k/16k/64k are0.9946/1.0497/1.0419 (3/6,2/6,1/6 wins);64k batching alone improves0.8977 (5/6). Control/preserved-pool combined medians0.9951/0.9819/0.9739 have wide drift. Preserve P26 and retain no renderer edit from this diagnostic. Probe SHA14004d2b8f75a99d4c3c1f1a8ec801922df3664e2436614496d5ac54f337ccf0; logs `/tmp/tn-2x-pool-hist-pairs.log`. The SDK cache lock was read-only in this environment; a cache under `/tmp/tn-managed-emscripten-cache` permits ordinary compilation without writing outside allowed roots. Next inspect actual Wasm allocation sizes/strides before proposing another locality change.


P28 hypothesis: actual Wasm layout shows Mesh256bytes, Material384bytes, but both allocate_shared pools stride512bytes (2016/2047 adjacent pairs). Transform fields remain in their existing separate pages. Mesh plus its control block crosses the libc++ power-of-two pool class; test stdlib separate Mesh/control-block allocation in a temporary same-binary construction mode, retaining the existing pool and ordinary shared ownership. This avoids a custom slab allocator. Compare unchanged P26, same-binary original and split mode with the existing CPU screen before any product edit. No browser qualification or ceiling claim.

P28 CPU screen passes: six fully counterbalanced triples per size give split/control combined ratios4k/16k/64k0.6551/0.7381/0.8021, all6/6 wins at every size.64k projection ratio0.6842, prepare0.7567; bulk1.0610 and batching1.0228 do not improve. Split/preserved-P26 combined medians0.7135/0.7102/0.7923 (5/6,6/6,5/6 wins); original-mode/preserved-P26 controls1.2521/1.0409/1.0512 show substantial host/artifact drift. The same-binary result isolates constructor allocation mode; no browser2× or product keep claimed. Wasm SHA136de752a1bfb1edfd5223f209a465b945e17e0de8f66cf8d2a6c1c1e0379670; logs `/tmp/tn-2x-pool-split-pairs.log`. The stdlib split-allocation lifetime check passes in Wasm, including enable_shared_from_this, surviving weak references, constructor/upstream allocation exceptions, alignment and reuse. Unlike allocate_shared, object-pool chunks can return at final strong release while the separate weak control block remains alive; its deleter retains the process-lifetime allocator identity. Product remains unchanged while measured-phase PMU pairs check instruction work and cache demand fills.

P28 measured-phase PMU confirms locality: all five hardware events100% scheduled in three alternating pairs. Split/control median cycles0.7068, instructions1.0000015 (third pair1.00645), taskCPU0.7055, true L2 data-demand misses0.7516, L3/peer-L2 demand fills1.0231, DRAM/IO demand fills0.5423. Event0x64/0x08 is the L2 data-demand miss counter; raw0x43 definitions remain as corrected above. Logs `/tmp/tn-2x-pool-split-pmu-<1..3>-<control|split>.stat`. Apply the minimal provisional product refinement in the existing private makeShared template: separate allocation only for Wasm Mesh, allocate_shared for Material, native make_shared unchanged. Add actual-factory shared_from_this/weak-reuse coverage in the existing ABI lifetime case. Rebuild and qualify these final bytes before any keep. No custom allocator or public API.

P28 product checks pass: native ABI/C11 10/10, Wasm ABI/C11 10/10, web/Perry harness20/20. Actual-header split branch passes address+undefined sanitizer checks (isolated Mesh ownership/alignment/constructor-failure/reuse exercise); LeakSanitizer itself cannot complete under this sandbox's ptrace/process restrictions, so leak checking is unverified and the rerun explicitly uses detect_leaks=0. Actual Wasm factory layout confirms Mesh stride256 (2016/2047 adjacent pairs), Material remains512. Final product Wasm SHA258d8ed4023e70357f09e250bc697a75e00d1b04c3f748acba151019ec4d25cd; JS SHA025ac71d564f9312a4d577e7912fcf52f143c56cc5176c2c7a5f001752329be4. Preserved at `/tmp/tn-2x-wasm-pool-split-product/`. Begin six counterbalanced triples of incumbent/P26/P28 final bytes at all three sizes, with no concurrent builds/tests. Normal browser judge script for these final bytes is `/tmp/tn-2x-pool-split-browser-abba.sh`; configuration, assertions and baseline remain unchanged. It requires restored local execution; no end-to-end2× or ceiling claimed.

P28 final-byte CPU screen passes at medium/large sizes: six counterbalanced incumbent/P26/P28 triples give final/P26 combined ratios4k/16k/64k0.9979/0.8359/0.8347 (4/6,5/6,5/6 wins). Final/incumbent ratios0.9341/0.6496/0.5496 (5/6,6/6,6/6 wins); P26/incumbent0.9193/0.7949/0.6682. Thus the prototype's large4k incremental gain did not survive the product build; retain no such claim. Final bytes preserve all frame-shape/zero-rebuild assertions. Logs `/tmp/tn-2x-pool-split-product-pairs.log`; code/data placement and host drift mean ratios from different screens must not be multiplied. The45% CPU-only large-scene gain is relative to incumbent Wasm, not ThreeJS and not Perry browser2×. Re-profile the final P28 artifact and preserved P26 before choosing another dominant-path change. No browser sockets available; keep performance/default-promotion boxes open.

P28 final re-attribution: fresh measured-phase JIT cycle captures have zero lost samples. P26→P28 self shares: worldSelf22.85→9.82%, project27.46→24.34%, prepare19.22→24.70%, sameUniforms4.96→5.50%, sincos6.70→9.48%, its argument reducer3.37→4.84%. These are compositional shares, not direct per-function speedup ratios. Candidate combined CPU screen in this profile is about17.54ms, with bulk4.6662, prepare12.8740, projection8.1902 and batching3.3055. Profiles `/tmp/tn-2x-material-profile-pool-split-final-<control|candidate>-root`. Generated-code annotation localizes21.41% of prepare samples near sorted packed-matrix loads,10.19% near type/parent eligibility loads and9.84% near record/frame checks; sampling skid prevents exact per-instruction latency claims. Existing BatchTransform and Record are already alignas(64); no alignment patch is justified. Other residuals include required immediate material observation and exact scalar trigonometry. Do not infer hardware saturation, a final optimization ceiling or end-to-end2× from these CPU-only observations. The concrete next qualification is the unchanged normal GPU ABBA using `/tmp/tn-2x-pool-split-browser-abba.sh`; it remains blocked by managed X11 socket restrictions. The requested PR/PRD audit stays deferred until that performance decision is supported.

P28 normal browser judge completed (2026-10-07, local execution with X11). The `/tmp` inputs were lost, so the lane was rebuilt under ignored `artifacts/native-engine-perf/`: the incumbent Wasm rebuilt from `3ceb162a6` source reproduces SHA `1de91030…` byte for byte, and P28 (commit `b8f66ecf2`) reproduces `258d8ed4…`. Perry v0.5.1520 was reprovisioned through `tools/native-typescript/provision.mjs`. A first ABBA under host load (load average 19; local CI runner containers on the judge cores) was discarded. The accepted runs fence CCD1 (CPUs 6–11, 18–23, one L3) for the judge on CPUs 8–11: the CI runner containers and the user `app.slice` were pinned to CPUs 0–5,12–17 for the run and restored afterward (`artifacts/native-engine-perf/fenced.sh`). Workload, judge, sample counts and browser recipe are unchanged: Brave, hardware WebGPU on NVIDIA/Turing, 600 measured/120 warmup frames, three interleaved repeats.

64k ABBA (incumbent / P28 / P28 / incumbent): per-repeat current/Perry p50 ratios pool to 1.395 for the incumbent (n=6, 1.145–1.692) and 2.552 for P28 (n=6, 2.492–2.766). The ranges do not overlap. Perry engineUpdate falls from 47.60/43.3 ms to 17.82/17.04 ms per frame; game 1.45 ms and boundary 2.35 ms do not change. The closing baseline block failed once on a Playwright `locator.screenshot` timeout and passed on rerun. All captures have zero pixel mismatch.

P28 size sweep (same fence and judge): current/Perry per-repeat medians 1.871 at 4k (1.739–1.891), 2.632 at 16k (2.357–2.841), 2.552 at 64k. Wasm-JS and Perry tie at every size (64k p50 23.17/23.47 against 23.41/22.47 ms), so the three-arm result keeps option B; option A stays unqualified. 2× against the optimized current arm holds at 16k and 64k and fails at 4k, where fixed per-frame work (boundary 0.17 ms, encodeSubmit 0.25 ms) is about a third of the 1.30 ms Perry frame. Next: profile 4k and remove a measured fixed cost. Reports: `artifacts/native-engine-perf/p28-abba/`, `p28-sizes/`.

Performance stopping decision (2026-10-07): the renewed 2× campaign stops at P28. Against the optimized current arm, per-repeat current/Perry p50 medians are 2.552 at 64k (n=6, 2.492–2.766), 2.632 at 16k (n=3, 2.357–2.841) and 1.970 at 4k (n=9, 1.739–2.187; three runs). 2× holds at 16k and 64k. At 4k the Wasm frame is stable (1.30–1.36 ms) and the result sits at 2× within the current arm's run-to-run spread (2.42–2.85 ms); a strict ≥2× claim at 4k is not made. The 4k CDP profile (120 frames, idle excluded) attributes `RenderDatabase::project` 21.5% inclusive, bulk transforms 10.3% (`sincos` 4.7%, `__ieee754_rem_pio2` 2.1%), `writeBuffer` 7.9%, `beginRenderPass` 4.6%, `PipelineCache::get` 1.6% (it rebuilds a string key from the full WGSL source on each draw) and unattributed `(program)` 24.6%. The frame makes 28 WebGPU calls and 2 buffer uploads. The two cheap exact candidates (inline the medium-path reducer into `sincos`; key the pipeline cache without copying WGSL) are each below this judge's 4k noise band; they are the next lever if 4k needs a strict margin. The larger project/batching levers were tried and rejected in P1–P27. This is an empirical stopping point, not a theoretical limit; the native 18× scaling gate stays open and unchanged.

Resumed performance campaign (perf arm, 2026-10-07, branch `perf/native-engine-speed`, worktree `native-engine-perf`, based on `684c26c6b`). The frozen judge, workload and sample counts are unchanged. Two instruments are new. (1) `tn-native-engine-wasm-update-screen` (EXCLUDE_FROM_ALL; `cmake --build packages/runtime-native/build/wasm-browser --target tn-native-engine-wasm-update-screen`) runs the warm-cache update case as Wasm under node with `node --no-liftoff` pinned to one core: A/A noise 0.3–0.6 % of the total, no browser or GPU, and it reproduces the browser's records phase (0.43 ms at 4k) and, with `--no-liftoff`, its batching phase (0.09 ms). Without `--no-liftoff` batchMeshes stays in Liftoff for the whole 300-frame case and reads 0.29 ms. The case now also times the per-frame transform writes (0.25 ms at 4k, the stand-in for the bulk seam). Compile layout moves unrelated stages by up to 3 % between builds at 16k, so a screen result is a hypothesis and only the whole-frame ABBA keeps a change. (2) The browser ABBA is run through `artifacts/native-engine-perf/ab.sh` (generic incumbent/candidate directories, same frozen command). The Wasm arms feel other lanes' use of the shared GPU: with a CI or emulator lane active their encodeSubmit reads 1–2 ms instead of 0.25 ms while the three.js arm does not move. A block is rerun when a Wasm arm's encodeSubmit exceeds max(0.5, 2 x current + 0.1) ms; the runs discarded this way are listed in the commit that cites them. The three.js arm also drifts 2.5–2.95 ms between blocks at 4k, so the Perry p50 in ms is reported next to the current/Perry ratio. Reports and logs: `artifacts/native-engine-perf/<trial>/`.

P29 hypothesis: the medium-size reduction branch of `__ieee754_rem_pio2` is a non-inlined call from `sincos`, and every animated angle (0–1128 rad in this workload) takes it twice per object (4k CDP profile: `sincos` 4.7 % self, reducer 2.1 %). Hoist that branch unchanged into an always-inline function used by `sincos` and by the original reducer. The arithmetic is identical. Proof of exactness: a differential hash over 40 000 000 arguments (|x| to 2e6, sin, cos and paired sincos) is byte-equal between the old and new file (`e81be137c52cdeb1`); `ieee754_test` gains 102 words read from node 20.19.6 (V8 11.3.244) at the edges of the range (3pi/4 and 2^19 pi/2 plus or minus one ulp, multiples of pi/2 that need the second and third reduction rounds, both signs) and fails when `pio2_1t` is perturbed by 1e-7 (control run). Wasm `ctest -L native-engine` 86/86. Screen (4k, 9 alternating pairs): transform writes 0.2519 -> 0.2290 ms (x0.909). Browser ABBA `p29-sincos-4k` (4k, incumbent/candidate/candidate/incumbent): Perry p50 1.305/1.330 ms (incumbent) -> 1.275/1.270 ms (-3.0 %); Wasm-JS 1.320/1.295 -> 1.260/1.265 ms; zero pixel mismatch. The first incumbent block repeated once under GPU contention before the guard existed; its p50 is a median over 600 frames and is used as measured. Kept.
