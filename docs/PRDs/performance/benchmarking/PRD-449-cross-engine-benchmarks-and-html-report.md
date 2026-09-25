# PRD-449: Reproducible cross-engine benchmarks and an auditable HTML report

**Status:** NOT STARTED — specification only; no new benchmark results are claimed.
**Date:** 2026-09-25
**Target branch:** `develop`
**Reviewed ThreeNative snapshot:** `e0aa293127feebfc07e0874b7b6b3fa8697e157d`
**Owner request:** Design precise comparisons against the relevant open-source experiments and deliver a final HTML report showing how ThreeNative compares in each experiment.

## 1. Deliverable and decision

Extend the existing `scripts/engine-load-test` runner, its parsers, and the existing performance-regression machinery. Do not build a second benchmark framework or a new engine abstraction. The implementation must produce one **self-contained, offline `report.html`** from a completed, reproducible campaign. It must include every planned experiment, not only favorable results, with uncertainty, comparability qualifications, failures, visual evidence, and traceable raw measurements.

The HTML is a measured-results deliverable, not a mockup, generated example, or restatement of upstream FPS claims. Its companion artifact bundle contains the frozen plan, source/build locks, machine metadata, normalized results, CSV, raw samples/logs, captures, and checksums. Producing this PRD does not complete any implementation phase.

The first publication target is **one explicitly identified physical desktop, one OS, one hardware GPU and driver**, shared by all competitors. Required native comparisons use ThreeNative and the upstream experiment's engine. Browser comparisons use the same machine and browser. This is not an all-platform claim. Physical Android, other desktop OSes, and Godot web are separately identified follow-up campaigns; emulators, software renderers, and virtual displays are smoke-test evidence only. Do not infer iOS support.

## 2. Existing mechanisms and gaps

These observations refer to the reviewed snapshot, not a claim that existing benchmarks were executed for this PRD.

| Existing source | Reuse | Gap this work closes |
|---|---|---|
| [CLI](../../../../scripts/engine-load-test/cli.ts) | `bench:engines`, six TN/Godot arms, collection and baseline entry points | Add workload selection and Bevy adapters. The current TN web arm starts Vite `dev`; publication needs a production build, not HMR. |
| [Workload](../../../../examples/engine-load-test/src/workload.ts) | Deterministic placements, frame-index camera, L1/L2/L3 | `positionHash` checks only the first eight placements. Add a versioned, full-fixture identity and execution-conformance checks. |
| [Report parser](../../../../scripts/engine-load-test/report.ts) | Fail-closed parsing, raw frame arrays, p50/p95, legacy equivalence | Extend with explicit metric semantics, per-run provenance, uncertainty and HTML. Preserve legacy schemas and baseline meaning. |
| [Godot fixture](../../../../benchmark/godot-load-test/load_test.gd) | An existing independently implemented competitor arm | Add selected upstream workloads, not the entire Godot harness. |
| [Regression comparator](../../../../scripts/performance-regression/compare.ts) and [lanes](../../../../scripts/performance-regression/lanes.json) | Identity checks, calibrated baseline handling | Reuse compatible primitives; cross-engine comparison is not the same verdict as TN-versus-previous-TN regression. |
| [Native benchmark protocol](../../../../.agents/skills/native-performance-loop/references/benchmarks.md) | Physical-device qualification, real-time measurement, evidence rules | Apply its distinction between synthetic throughput and actual presentations to every adapter. |

The prior [research note](benchmark-research.md) is discovery, not measured evidence. This PRD extends [PRD-117](../../done/PRD-117-engine-load-test-godot.md); it does not reopen or erase finished work. Follow the [charter](../../../architecture/CHARTER.md) and update actual runtime/core findings in [runtime-perf-state.md](../../../verification/runtime-perf-state.md), rather than creating another performance-state record.

## 3. Comparison contracts

An experiment key is `(workload, fixture revision, variant, load, rendering profile, optimization class, execution protocol)`. Its arms vary engine/runtime/backend only as declared. Different keys must not be silently joined into a speedup.

### 3.1 Optimization classes

| Class | Question | Contract |
|---|---|---|
| `default` | What does ordinary authoring get from each engine? | Same logical objects and behavior; each engine's normal automatic batching/culling is allowed and disclosed. This is the primary native comparison. |
| `independent-diagnostic` | What is the cost when a specified optimization is disabled? | Record and verify the exact switches. Disabling automatic batching does not imply every indirect-drawing, caching or culling optimization is disabled. |
| `explicit-instancing` | What does explicitly optimized authoring achieve? | Compare equivalent instanced workloads where available. Preserve required per-instance behavior. An unavailable counterpart is not a zero-time result. |

TN's existing L1/L2/L3 remain identifiable: independent objects, explicitly instanced authoring, and ordinary authoring with projection/collapse. They are not universal aliases for another engine's internals. Record the actual TN default at the locked revision; do not relabel a non-default configuration as default.

Do not headline TN optimized versus Bevy/Godot deliberately unbatched. Physical draw counts and submitted triangles may legitimately differ under equivalent automatic optimization. Retain the legacy exact-count gate for legacy contracts; use an explicitly versioned output-equivalence contract for these new experiments instead of weakening it globally.

### 3.2 Comparability and outcome are separate

`comparability` is `matched-task`, `qualified`, or `non-comparable`. Matched-task means equivalent inputs, required behavior, visual feature set and quality settings; it does not mean identical shaders or identical machine instructions. Differences in shading, renderer architecture and backend must remain visible. Renderer-specific shadow algorithms belong to qualified comparisons unless genuinely matched.

`runStatus` is `valid`, `invalid`, `crashed`, `timed-out`, `resource-limited`, `unsupported`, or `not-run`. A valid slower result is still valid. `unsupported` requires a demonstrated capability gap; an unimplemented adapter is `not-run`, not unsupported. `inconclusive` is a statistical comparison verdict, not a discarded run.

The report must distinguish three questions: plain Three.js browser versus TN web measures the framework configuration; TN web versus TN native measures the complete runtime/backend system; TN native versus Bevy/Godot native measures their complete engine configurations. None alone proves the JS-to-host boundary caused a difference.

## 4. Source and asset locks

Seed sources verified during planning:

| Source | Frozen upstream input |
|---|---|
| Bevy `v0.19.0` | Commit `c6f634ca9f406d68ba5109d921247b654cb42c10`; [tag](https://github.com/bevyengine/bevy/tree/v0.19.0). This is a benchmark pin, not a claim it is the latest release. |
| Godot benchmark repository | Commit `b059e38a81230a87293828bbf65ab247b6b2d2a8`; [source](https://github.com/godotengine/godot-benchmarks/tree/b059e38a81230a87293828bbf65ab247b6b2d2a8). |
| Three.js and ThreeNative | Resolve exact Three.js package bytes from the TN frozen lockfile; use the same bytes for plain Three.js and TN arms. Lock the tested TN commit separately from this planning snapshot. |
| Godot engine | Phase 1 must select a compatible released native binary, record version, download/source URL, binary SHA-256 and renderer. Do not mistake the benchmark repository SHA for the engine version. |

The execution lock must also include compilers, build flags, dependency lockfiles, Bevy features, browser build, Dawn/wgpu/backend versions when obtainable, adapter patches and their hashes, imported assets and license/attribution records. Keep source and asset licenses separate, including `Fox.glb`. Missing license provenance blocks redistribution, not a fabricated claim that all repository assets share its code license.

A moving `main`, unrecorded local patch, missing binary, or unresolved source pin is a qualification failure. A necessary compatibility change becomes a reviewed, hashed adapter patch. Never silently substitute an upstream revision. Historical published FPS and old Three.js issue results must not enter measured-result tables.

## 5. Required experiment matrix

All six families below are required. Avoid an uncontrolled Cartesian product: only the enumerated primary and diagnostic cells are required. Freeze their fully expanded identifiers before the measured campaign. Every required cell must appear in the report, including attempted failures and predeclared resource-policy stops.

| Family and upstream | Required primary cells | Required diagnostic cells | Required comparison arms |
|---|---|---|---|
| `bevy-many-cubes` — [source](https://github.com/bevyengine/bevy/blob/c6f634ca9f406d68ba5109d921247b654cb42c10/examples/stress_tests/many_cubes.rs) | Sphere layout; static and all-cubes-rotating; 1k, 10k, 50k, 100k, 400k, 1.6M; default class, shadows off | At 10k and 100k: culling disabled, independently batching disabled, and shadows enabled; each changes only its named factor | TN native and Bevy native; TN web at 10k and 100k as separately labelled runtime comparisons |
| `three-independent-meshes` | Shared geometry/material; static and all-rotating; 1k, 5k, 10k, 20k, 50k | At 20k: TN projection off/on, explicit instancing, and 64 distinct materials; do not combine switches implicitly | Plain Three.js WebGPU browser, TN web and TN native; record each optimization class |
| `bevy-many-foxes` — [source](https://github.com/bevyengine/bevy/blob/c6f634ca9f406d68ba5109d921247b654cb42c10/examples/stress_tests/many_foxes.rs) | 50, 100, 250, 500, 1,000; synchronized and deterministically staggered animation; moving rings; shadows off | At 100 and 1,000: paused animation with rings still moving, and animation enabled with directional shadows | TN native and Bevy native; TN web at 100 and 500 |
| `godot-culling` — [source](https://github.com/godotengine/godot-benchmarks/blob/b059e38a81230a87293828bbf65ab247b6b2d2a8/benchmarks/rendering/culling.gd) | 10k objects: static/basic-unshaded, translating, rotating; preserve each upstream variant's shading | Directional shadows; static/moving omni lights with shadows off/on; static/moving spot lights with shadows on; 100 lights where the source requests them | TN native and Godot native; identify Godot RenderingServer/RID authoring explicitly |
| `godot-lights-meshes` — [source](https://github.com/godotengine/godot-benchmarks/blob/b059e38a81230a87293828bbf65ab247b6b2d2a8/benchmarks/rendering/lights_and_meshes.gd) | All upstream named box/sphere 100/1k/10k, omni 10/100, spot 10/100, speed slow/fast and stress variants | Required sampled-frame checks of light visibility/energy and opposite grid rotations; no extra parameter sweep | TN native and Godot native |
| `bevy-city` — [source](https://github.com/bevyengine/bevy/tree/c6f634ca9f406d68ba5109d921247b654cb42c10/examples/large_scenes/bevy_city) | One small fixture and upstream-default fixture; each static and upstream moving behavior; common rendering profile | Upstream visual profile on the default fixture, qualified where effects differ | TN native and Bevy native; TN web on the small fixture |

For the Three.js mesh family, record a real plain-Three baseline with its normal independent `Mesh` authoring. TN projection-off versus that baseline is a diagnostic comparison; TN's actual default is a separately labelled product comparison. Add plain Three.js `InstancedMesh` as the explicit-instancing counterpart. Do not substitute its numbers for independent meshes.

### 5.1 Workload-specific correctness traps

**Cubes:** Preserve Fibonacci distribution, orientations, enclosing geometry, camera and mesh/material assignments. Bevy's `--benchmark` fixes camera stepping, but does not by itself make all rotating-cube/material updates deterministic. Patch all relevant time consumers through the fixture clock and disclose that patch. Validate actual switch effects rather than trusting option names. Count enclosing geometry separately from requested cube count.

**Foxes:** Use the same asset bytes, clips, interpolation, ring hierarchy, directions and phases. Each character needs the required independently evaluated skeleton; shared geometry is fine, replacing characters with rigid clones, impostors, or a shared pose in the staggered variant is not. Preserve and disclose upstream static-transform settings. Paused animation is a distinct control, never a substitution for the active arm.

**Godot culling:** The source creates low-level RenderingServer RID instances, not one `Node3D` per rendered object. Label this as a renderer-server workload. It cannot establish the relative cost of each engine's ordinary scene-node API. An optional Godot node-authoring variant must use a different key. Preserve primitive topology, not merely primitive names. Its omni-shadow path uses dual-paraboloid shadows; do not equate that to cubemap shadows without qualification.

**Godot lights/meshes:** `create_scattered(count)` creates `round(sqrt(count))^2` objects. Nominal 1,000 becomes 1,024; nominal 10 lights becomes 9. Preserve the upstream behavior in both arms, record requested and actual counts, and label chart axes with actual counts. A corrected exact-count generator would be a separate experiment. Preserve light toggling, energy oscillation, grid hierarchies and rotation speed. Do not infer shadows are enabled in this source.

**City:** Freeze generated mesh/index/texture/material data and the full instance hierarchy. Exporting a canonical fixture is preferred to independently recreating random generators in several languages. Export must preserve node boundaries and material diversity rather than merging the whole city. For moving variants, retain runtime movement rather than baking a static GLB. Phase 1 freezes the small fixture's generator settings and both actual censuses; never hard-code a historical approximately-55k count as observed fact.

These are rendering/animation tests, not a proof of networking, physics, AI, streaming, or complete-game performance. A representative gameplay confirmation can accompany the report but must not replace a missing required family. Unity DOTS, pure ECS throughput, physics comparisons and additional showcase scenes are out of scope.

## 6. Equivalence before timing

### 6.1 Canonical fixture contract

Each fixture carries stable object IDs, parent IDs, exact mesh/index buffers, material and texture bindings, transforms, bounds, lights, skeleton/clip data, camera projection, required update behavior and a frame schedule. Serialize numerical inputs in a documented canonical representation, with explicit byte order and float precision. Hash the complete fixture and every asset with SHA-256. Matching only the seed, first few objects, screenshot, or total triangle count is insufficient.

Do not inject precomputed final animated poses or final world matrices into a timed arm when animation evaluation or transform propagation is the work under test. The fixture supplies initial state, inputs and a verification oracle; each engine performs the required runtime work. Precomputed verification output is outside timing.

Hash equality establishes common input bytes, not correct execution. At initialization verify the complete object/mesh/material/hierarchy census. In a separate untimed conformance run inspect every object's world transform and required animation state at frames 0, 1, 60, 120, 300 and 599, plus the last measured frame and any variant-specific visibility transition. Compare floats to preregistered absolute/relative tolerances; require exact discrete IDs/counts/bindings. Phase 1 must specify numerical tolerances in the manifest and justify them from precision, not tune them after seeing speedups.

Track authored objects, independently updated objects, frustum candidates, projected instances, submitted draws and visible pixels as distinct concepts. Engine visibility counters are not automatically semantically equal. Canonical frustum tests and diagnostic object-ID/depth captures provide common reference evidence; conservative culling can submit extra invisible objects, but dropping a required visible object fails.

### 6.2 Visual and feature qualification

Capture the same scheduled frames with identical camera intrinsics/extrinsics, geometry and render dimensions. Use same-engine golden comparisons to detect accidental changes. Across engines use depth/silhouette/object-ID coverage, material/feature census and retained side-by-side shaded captures, not an unjustified universal pixel-equality threshold for different PBR implementations. Declare tolerances, edge-pixel treatment and the image-review outcome before accepting a comparison.

Required mutations include an object beyond index eight moved incorrectly, a visible object omitted, frozen animation, missing material/light, half-resolution rendering and a shadow pass removed from a shadow-enabled cell. The validator must reject them. A merely non-blank screenshot is not enough.

Capture and expensive census passes run outside the scored interval using the same hashed binaries, fixtures and rendering settings. A conformance mode may enable observation, not switch to a different renderer or workload. In timed runs retain cheap workload-progress/present counters and checks at the measurement boundary so a correct screenshot run cannot excuse an empty timed loop.

### 6.3 Common visual settings

Primary common profiles use 1920x1080 actual render attachments, DPR 1, resolution scale 1, no adaptive quality, no automatic LOD reduction, fixed exposure, no motion blur and MSAA off. Shadows are off except where a named variant requires them. Unshaded upstream variants remain unshaded. Lock FOV convention, near/far planes, color spaces, texture format/resolution, mip generation/filtering, light inputs and tone mapping; document unavoidable shader differences.

Shadow variants record resolution, cascades, ranges, caster set, update frequency, filtering and shadow algorithm. Unsupported or materially unequal techniques cannot receive an unqualified ratio. A missing feature must never be silently replaced with lower quality to complete a run. The upstream-profile city variant preserves its own declared settings and is not joined with common-profile rows.

## 7. Execution and measurement protocol

### 7.1 Frozen campaign plan and hardware

Before scoring, persist an immutable expanded plan and its hash: every cell/arm, sample schedule, repetitions, order seed, cache state, resource limits, quality settings, metrics and decision thresholds. Freeze after unscored qualification/pilots, before the scored campaign. A changed plan starts a new campaign; preserve the previous attempt history.

Use release builds without editor, hot reload, dev instrumentation or per-frame console output. Bevy release features and worker settings, Godot rendering method and thread settings, and TN native build/runtime must be recorded. Let engines use their normal workers on the same available CPU cores; do not compare Bevy single-threaded against TN unrestricted, or vice versa. Same GPU API is preferred where supported, but never describe shared WebGPU ancestry as identical backend implementation.

Record OS/kernel, CPU model/core topology, GPU/VRAM, driver, browser, display/refresh, power mode, clocks/temperatures where observable, background GPU memory and CPU/GPU load. No competing GPU workload. Establish idle/thermal limits from qualification and record pre/post-run samples. A shared or unstable machine yields an invalid environmental comparison, not an inferred performance win. Vsync requests must be checked against effective cadence; a cap-limited run cannot establish uncapped capacity.

### 7.2 Two protocols; never combine their scores

**Deterministic throughput:** Every measured frame advances the same workload time, nominally 1/60 second, and renders the same sequence of scene states. This is synthetic rendered-work throughput, not realtime gameplay speed or displayed FPS. No tight `GameLoop.advance()` loop without rendering is eligible. Native runs must submit the required render workload; browser runs must use the real rendering loop, not fabricated timestamps.

**Realtime presentation:** At one preselected representative load per family, run a 60-second wall-clock path with normal updates and a declared display/pacing target. Record actual presentations, pacing and hitches where the platform exposes them. Use matching observation semantics across engines. A render callback count is not an OS presentation count. Without platform presentation evidence, mark that metric unavailable; keep the valid throughput result. At least the 20k-mesh and 100-fox native comparisons require qualified presentation evidence for publication.

Private Xvfb, browser software fallback and emulator runs do not establish displayed FPS. A browser constrained by its compositor is presented as browser delivery behavior, not used as a native uncapped ceiling.

### 7.3 Warmup, samples and order

Smoke profile: 120 warmup frames, 600 measured frames, three runs; useful for development, never publication-grade by label alone.

Publication profile: qualify caches/JIT/shaders in an unscored pilot, then freeze a **common warmup frame count** per cell, initially at least 600 and sufficient for at least ten seconds on the fastest pilot arm. Do not warm each competitor until its numbers look favorable. Restart the workload clock to the same measured initial state after warmup without flushing the warmed caches. Report warmup separately. Persistent instability or compilation after the declared warmup is reported; do not discard slow measured frames.

Freeze a common measured frame count per cell, at least 6,000 and sufficient for at least 30 seconds on the fastest qualified pilot arm. Use a complete shared sequence. Resource-policy exceptions must be predeclared and visibly non-publication-grade; they cannot silently shorten only a slow arm. Do not stop early on reaching a desired confidence interval.

Use **seven complete randomized paired blocks** for each primary comparison, distributed across at least two sessions. A block contains one fresh-process run of every compared arm on the same cell. Balance arm order as closely as possible, use a recorded randomization seed, and pair by planned block/execution adjacency, never by similar observed load or by selecting the slowest competitor. Diagnostic cells also retain seven blocks when publishing ratios; three-run diagnostics can be labelled exploratory with no strong verdict.

Freeze startup, warmup, measurement and memory limits from pilots; record every timeout/crash/resource failure. There are no silent retries. An environmental interruption can trigger one predeclared replacement of the entire block; retain and flag the original. Engine-caused failures cannot be erased as environmental outliers. Resource-policy stops on higher rungs remain explicit rows and do not imply a measured failure at unattempted loads.

### 7.4 What each metric means

| Metric | Required semantics |
|---|---|
| Completed-work mean ms/frame | Primary throughput metric: wall time for N complete rendered frames, including asynchronous work drained once at the measurement boundary, divided by N. Start after an untimed pre-drain. Do not fence each frame. Record pipeline fill/drain policy. |
| Frame interval p50/p95/p99 | Raw successive render-producing frame intervals, including stalls; use N+1 boundary timestamps for N intervals. Label this separately from completed-work mean and presentation intervals. |
| Presented FPS/frame intervals | Platform presentation observations with timestamps and refresh/present mode; never `1000 / render CPU ms`. |
| Update/render/encode CPU | Explicit wall or thread-CPU duration and inclusive/exclusive scope. Nested shadow passes must not be double counted. Missing attribution does not invalidate a separately valid end-to-end result. |
| GPU ms | Asynchronous timestamp queries tied to frame and pass IDs, correct units and availability. Define sequential sums versus overlapping intervals; do not sum overlapping GPU work as elapsed time. |
| Work counters | Actual object/update counts, source triangles, submitted triangles/draws/passes, upload bytes and command counts, each with a definition and measurement scope. |
| Memory | Peak and steady-state process RSS; browser process-tree scope; GPU allocation/VRAM source and limitations. JS heap is not comparable to total native RSS. |
| Startup and size | Separate cold/warm-cache profiles: launch-to-first-correct-frame, launch-to-ready; executable, dependencies, assets, installed and compressed distribution bytes separately. Not part of the frame-time speedup. |

Reuse existing collectors where their semantics match. The name `profile:native-cpu` alone is not evidence of native execution; current documented behavior includes browser profiling. Instrumented stack/wrapper attribution runs are diagnostic, not scored builds. Existing window p95 values cannot be used to reconstruct frame-level p99.

The primary completed-work metric requires a supported final-completion observation on both arms. A CPU submission proxy cannot silently substitute for it. Keep GPU timestamp collection asynchronous, with bounded buffering, correct frame attribution and dropout counts. Missing GPU measurements are `null` plus a reason, never zero. Do not add JS CPU, native CPU and GPU elapsed values into a supposed frame total when they overlap.

Quantify minimal-meter overhead using instrumented/uninstrumented A/A controls. Require less than 2% median throughput change or the measured A/A noise floor, whichever is larger, and no material tail distortion. Report that floor; a noisy calibration cannot justify small-effect claims. Store raw monotonic timestamps and clock resolution. Do not force GC between measured frames, hide GC pauses or drop shader stalls.

Cold startup tests must state whether OS page caches, asset imports, browser caches and driver shader caches were cleared. A fresh process is not automatically a cold machine. Startup/footprint results are secondary and can be unavailable with an honest reason without turning a valid rendering experiment into a fake zero.

## 8. Statistics and verdicts

The independent experimental unit is the **run/block**, not each of thousands of autocorrelated frames. Compute each run's nearest-rank frame percentiles and completed-work mean. Display medians of run-level summaries explicitly as such; do not call a median of p95s the p95 of all frames. Raw series remain downloadable for reanalysis.

For paired block b, let `T_b` be TN completed-work mean and `C_b` the competitor's matching mean. The primary ratio is `R = exp(mean(log(C_b / T_b)))`; greater than one means TN completes the workload faster. Time reduction is `100 * (1 - 1/R)` percent. Do not confuse time reduction with FPS increase. Frame-percentile ratios, when offered, use the same pairing but are labelled with that metric, not substituted for the primary ratio.

Compute a reproducible 95% paired-block bootstrap interval using 10,000 block resamples and a fixed recorded seed. Resample entire multi-arm blocks, preserving within-block relationships. Never bootstrap individual frame samples as independent observations. With fewer than seven valid primary blocks, display the observations and mark the inference insufficient. Show session-specific estimates; material unexplained session drift prevents a pooled supported verdict.

Before scored runs, obtain A/A calibration from seven blocks for the representative low/high loads and each execution lane. Freeze an equivalence/noise band `epsilon = max(3%, the calibrated 95th-percentile absolute A/A paired relative difference)` for each applicable stratum. Lack of a calibration means no supported faster/slower verdict.

A pointwise interval wholly above `1 + epsilon` supports faster for that cell; wholly below `1 / (1 + epsilon)` supports slower. An interval fully inside that band supports practical equivalence at the declared resolution; otherwise the result is inconclusive. Label these as pointwise exploratory comparisons across a multi-cell suite. Do not promote them into a family-wide significance claim or cherry-picked summary winner without a separately preregistered multiple-comparison procedure.

No geometric-mean score mixing families, backends, devices or raw/default/instanced classes is required or permitted as the headline. The useful result is the curve and failure boundary for each experiment. At a declared budget such as 16.67 ms, report the largest **tested** qualifying load and the selected metric; do not interpolate an exact maximum capacity or extrapolate beyond tested rungs. OOM or crash has no finite speedup ratio.

## 9. Final HTML report contract

### 9.1 Required views

The first screen states campaign ID/date, hardware/OS/GPU/driver, exact engine/browser versions, source/build hashes, protocol, quality profile and overall coverage. Display planned, attempted, valid, qualified, invalid, failed, unsupported and not-run counts. A partial campaign must be visibly partial on first load and in print. Do not hide missing results through default filters.

The main comparison table contains **one row per experiment variant/load/optimization/protocol**, with the relevant TN native, TN web, plain Three, Bevy and Godot columns. Non-applicable engines show an explicit dash, not a zero. Include frame mean/p50/p95/p99, primary ratio and interval, practical verdict, comparability status, actual counts, run count and evidence access. There must be an obvious route to all six families without editing a query or reading logs.

Each family has a load-versus-frame-time chart whose values exactly match the table. Show uncertainty where available, units, actual load counts, quality/optimization labels and unmeasured gaps. Distinct protocols/platforms must not share a misleading series. Add raw-run distributions and hitch/pacing views on drill-down, not just FPS bars.

Experiment detail includes the upstream source link, adaptation patch, requested/actual scene census, effective engine flags, screenshots at matching frames, timing scope, all run/block results, environmental exclusions with reasons, memory/upload/draw diagnostics, and exact reproduction commands. Preserve slower TN results as prominently as wins. All metrics must resolve to their raw source records and derivation version.

### 9.2 Artifact and usability requirements

`report.html` works through `file://` with **zero network requests**, without a local server or CDN. Embed summary data, CSS, small JavaScript/SVG charts and representative compressed captures. Full raw traces may stay in the companion bundle; report interpretation and all comparison tables must work with the HTML alone. Avoid embedding gigabytes of raw samples.

Provide keyboard-accessible filters, readable table alternatives for charts, text labels in addition to color, responsive desktop/mobile layouts and useful print output. Bundle exports are `results.json`, `results.csv`, `plan.json`, `sources.lock.json`, `machine.json`, raw run records, captures, attribution/license notices and `checksums.sha256`. Re-rendering the same bundle must produce identical substantive output; isolate any generation timestamp from reproducibility checks.

Escape untrusted names/logs and script-embedded JSON, including `</script>`. Treat logs as text, reject path traversal in artifact links, and do not leak device serials, local home paths, credentials or environment secrets into a public report. Checksums establish artifact integrity, not independent authenticity.

The implementation is not complete with an HTML template, unit fixtures, screenshots alone or a report populated with historical/upstream/example numbers. It must deliver an accessible retained campaign bundle containing actual measurements from all six families. Link the HTML and bundle from the existing performance state record, within the repository's evidence-retention rules; large raw artifacts are not committed merely to satisfy this PRD.

## 10. Implementation shape and proposed interface

Keep `scripts/engine-load-test/` as owner of orchestration, workload registry, adapter dispatch and results. Keep `examples/engine-load-test/` as the TN/browser fixture entry. Extend the existing `benchmark/` directory with pinned competitor adapters where appropriate; do not create a parallel `benchmarks/` framework. Workload helpers remain benchmark-internal, not exported game-engine APIs.

Add a versioned result type and compatibility reader alongside existing `report.ts` contracts. Preserve old reports, baseline behavior and no-Bevy default development workflows. Share existing percentile, identity and regression utilities where valid. Add no heavy report/chart dependency merely for this task; prefer the existing tooling and small offline rendering code.

Minimum v2 record groups: schema and derivation versions; campaign/plan/source hashes; experiment key; arm identity/build/backend/flags; block/session/order; fixture and conformance evidence; timing definitions and raw-series references; metric availability; machine/preflight observations; outcome/reason codes; run durations and checksums. `null`, absent and zero have different meanings and must be tested. Store all attempts under immutable campaign/run IDs, never overwrite `tn-desktop.json` as the campaign history.

The following is a **proposed interface**, not commands already implemented:

```sh
pnpm bench:engines --plan --suite cross-engine --profile publish --out artifacts/engine-load-test/<campaign>
pnpm bench:engines --collect --plan artifacts/engine-load-test/<campaign>/plan.json
pnpm bench:engines --report-html artifacts/engine-load-test/<campaign>
```

Allow selecting a workload/cell for development without changing a frozen publication plan. Report generation must still work on partial/failed bundles. Separate process exit conditions: success for a complete evidence-valid campaign, nonzero for invalid/incomplete evidence, and a distinct optional regression-budget failure. TN losing a fair comparison is not a harness failure. A failed required cell is surfaced in coverage; a predeclared resource ceiling can complete an attempt, but cannot fabricate a valid comparison.

## 11. Verification strategy

Unit and fixture tests exercise logic; hardware tests establish measurements. Never substitute one for the other.

| Negative control | Required observation |
|---|---|
| Change object 9 or later while preserving the legacy first-eight hash | Full-fixture or state-equivalence rejection |
| Change a material, skeleton pose, light count, camera, resolution or required shadow pass | Conformance rejection; no speedup published |
| Emit simulation ticks without render submission/completion | Missing-work/missing-completion failure |
| Mark Chromium, SwiftShader or emulator evidence as native physical hardware | Lane identity/qualification rejection |
| Remove GPU samples or change timestamp units/frame IDs | Missing/invalid GPU metric, not zero or a valid fabricated timing |
| Mix release/dev builds, upstream revisions, backends or optimization keys | Identity mismatch or explicit non-comparable result |
| Inject deterministic CPU work or GPU load in a dedicated negative-control arm | Work counter increase and a detectable slowdown beyond its calibration floor |
| Feed identical paired data, known-ratio data and high-variance data | Correct equivalence, ratio/direction and inconclusive verdicts |
| Delete a slow run, reuse a paired run or omit a planned cell | Coverage/pairing rejection; partial report still generated |
| Load malicious names/logs or open HTML offline | No script injection, unsafe links or network request |

The slowdown sensitivity control must execute real work on the qualified lane; synthetic timestamps validate statistical code only. Its implementation and instrumentation must not leak into the scored candidate build. Test report/table/chart/CSV consistency against one canonical derived dataset. Test deterministic regeneration, legacy compatibility, empty data, timeouts, crashes and unsupported cells.

## Phase 1: Freeze sources, fixtures and the campaign contract

Open one draft implementation PR before starting this phase, following `docs/PRDs/AGENTS.md`; keep all phases in that PR. The requested planning-only commit on `develop` does not assert implementation progress.

- [ ] Resolve the Godot engine binary pin and verify its compatibility with the locked benchmark sources.
- [ ] Record the full source/build/asset lock, including required asset attribution.
- [ ] Freeze the expanded six-family matrix with exact actual fixture censuses.
- [ ] Freeze conformance tolerances and visual qualification rules.
- [ ] Freeze publication plan fields, ordering policy and resource-limit policy after unscored qualification.

## Phase 2: Extend and prove the shared measurement path

- [ ] Add the v2 result contract without changing the meaning of legacy reports/baselines.
- [ ] Collect browser publication evidence from a production build with recorded identity.
- [ ] Prove the native completed-work boundary with a render-suppression negative control.
- [ ] Prove asynchronous GPU sample attribution and missing-data behavior.
- [ ] Add full-fixture identity and reject a mutation beyond the first eight objects.
- [ ] Complete A/A calibration and retain the minimal-meter overhead measurements.
- [ ] Prove the paired-block statistics with known-ratio and high-variance fixtures.

## Phase 3: Cubes and independent Three.js meshes

- [ ] Implement the locked Bevy many-cubes adapter with deterministic updates for every timed behavior.
- [ ] Pass many-cubes execution/visual conformance against the TN fixture.
- [ ] Implement plain Three.js and TN independent-mesh variants using identical Three.js package bytes.
- [ ] Verify the actual projection/batching/instancing behavior of each labelled mesh arm.
- [ ] Retain a real hardware comparison for the many-cubes family.
- [ ] Retain a real hardware comparison for the independent-mesh family.

## Phase 4: Animation, Godot rendering workloads and City

- [ ] Pass foxes conformance with independently animated staggered skeletons.
- [ ] Retain a real hardware comparison for the foxes family.
- [ ] Pass Godot culling conformance with the RID authoring distinction documented.
- [ ] Retain a real hardware comparison for the Godot culling family.
- [ ] Pass lights/meshes conformance including requested-versus-actual counts and changing lights.
- [ ] Retain a real hardware comparison for the Godot lights/meshes family.
- [ ] Pass City conformance for both frozen fixture sizes and both movement states.
- [ ] Retain a real hardware comparison for the City family.

## Phase 5: Deliver the offline report generator

- [ ] Render every expanded plan cell with its actual coverage/outcome state.
- [ ] Prove table/chart/CSV consistency with the canonical derived dataset.
- [ ] Expose uncertainty, optimization class and comparability beside each displayed ratio.
- [ ] Link each experiment to raw runs, effective settings, source patches and matching captures.
- [ ] Pass offline `file://` testing with network requests blocked.
- [ ] Pass keyboard/table/print usability checks.
- [ ] Pass escaping/path-safety tests using malicious fixture text.
- [ ] Prove deterministic substantive regeneration from the retained bundle.

## Phase 6: Qualify the campaign and hand over actual results

- [ ] Execute the frozen required matrix on the identified physical desktop, retaining every attempt.
- [ ] Obtain seven valid paired blocks for the publication-grade primary comparisons at supported loads.
- [ ] Retain the second-session stability evidence and any resulting qualifications.
- [ ] Retain qualified native presentation evidence for the 20k independent-mesh comparison.
- [ ] Retain qualified native presentation evidence for the 100-fox comparison.
- [ ] Demonstrate actual slowdown sensitivity on the qualified measurement lane.
- [ ] Generate the final HTML containing real TN-versus-upstream measurements for all six families.
- [ ] Retain the downloadable raw-data/provenance bundle with verified checksums.
- [ ] Reproduce at least one comparison per family from the bundle's documented commands in a clean build directory.
- [ ] Link the delivered report and findings from the existing runtime performance state record.
- [ ] Run relevant repository gates and record their actual outcomes beside the implementation evidence.

A family is not complete without at least one supported load with valid TN and upstream measurements. Required high-load resource failures and genuinely unsupported feature variants remain visible and qualified; they do not authorize skipping an entire family. Open or unavailable evidence leaves its own checkbox open. Never change acceptance thresholds simply to make ThreeNative look faster.
