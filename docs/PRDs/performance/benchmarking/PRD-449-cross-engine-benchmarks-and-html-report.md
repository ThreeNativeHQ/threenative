# PRD-449: Reproducible cross-engine benchmarks and an auditable HTML report

**Status:** PARTIAL — Phase 1 Godot binary pin, Phase 2 v2 contract/statistics, Phase 3 independent-mesh family (all three arms measured on one hardware GPU), Phase 4 Godot-culling family (four real-GPU hardware cells retained, one of them refused as cadence-capped; the shadows-on and rotating variants blocked on named evidence), and Phase 5 partial report renderer are built or proved as stated below. The only measured results so far are the independent-mesh family's single smoke blocks and the Godot-culling family's four single-block cells; no Bevy, fox, City or publication-grade cross-engine result is claimed.
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

### Phase 1: Freeze sources, fixtures and the campaign contract

The owner waived the PR requirement on 2026-09-25: implement in the dedicated worktree and squash to `develop` once complete. The requested planning-only commit on `develop` does not assert implementation progress.

- [x] Resolve the Godot engine binary pin and verify its compatibility with the locked benchmark sources. Godot `4.7.1.stable.official.a13da4feb`, Linux x86_64; installed binary SHA-256 `32f8d7596c4b41185512b1c49d69f2da3be018fd784a53e349fa92a98a97bcde`, identical to the extracted [official release zip](https://github.com/godotengine/godot/releases/download/4.7.1-stable/Godot_v4.7.1-stable_linux.x86_64.zip), whose SHA-512 matches the release manifest. Source tag commit `a13da4feb8d8aefc283c3763d33a2f170a18d541`. At locked benchmark commit `b059e38a`, `godot --headless --path artifacts/engine-load-test/sources/godot-benchmarks --import` and one culling and one lights/meshes benchmark each exit 0. The required families parse without errors; an optional unbuilt C++ extension reports import errors. Headless uses a dummy rasterizer, so GPU throughput remains unverified.
- [ ] Record the full source/build/asset lock, including required asset attribution.
  The GitHub repository API now resolves the pinned Bevy `v0.19.0` commit to concrete blobs:
  `many_cubes.rs` Git blob `04a8f87b60fb2acc830fc650571ca97da3a7d9d7`, `many_foxes.rs`
  `cdce2603d1dc957983ed3f603bd165da1b3e2a2d`, and `Fox.glb`
  `1ef5c0d05658caea339680fe581aa2c8302b3365` (162,852 bytes). These Git blob SHA-1
  identifiers are source pins, **not** the required SHA-256 asset digest. The pinned
  [Bevy CREDITS](https://github.com/bevyengine/bevy/blob/c6f634ca9f406d68ba5109d921247b654cb42c10/CREDITS.md)
  attributes the fox model to PixelMannen (CC0) and rigging/animation to @tomkranis
  (CC-BY 4.0); retain that attribution separately from Bevy's code license. The exact pinned
  source confirms the cube sphere/Fibonacci placement, 42-seeded material/mesh selection,
  camera-only fixed-step `--benchmark` switch, and separately real-time `rotate_cubes` system;
  a deterministic-update adapter must patch the latter. The pinned City source defaults to
  seed 42/size 30 and uses a nested size-by-size block loop; imported scene expansion remains
  uncensused. The bundle reader now requires `sources.lock.json` to name both pinned upstream
  commits, the TN commit, Three/Godot/Fox digests and license attribution, plus source/build,
  dependency, compiler and patch fields for every planned **cell and arm**; run identities must match
  those locks. This allows the same arm to use distinct builds for different workload cells. It
  also requires `machine.json` with physical lane, date, CPU/GPU/driver and matching
  run identity. Missing files keep the HTML visibly partial and present files enter the checksum
  manifest; malformed files fail closed. This is a schema and unit-tested guard, **not** the actual
  source/build/asset lock. Bevy build flags, source checkout, asset bytes/SHA-256 and other lock
  fields remain open.
- [ ] Freeze the expanded six-family matrix with exact actual fixture censuses.
  A deliberately non-publishable [draft matrix](../../../../scripts/engine-load-test/plan.ts)
  now expands 73 stable cell IDs across all six families, each with seven planned paired blocks
  over two sessions. The focused test verifies family coverage, unique IDs and source-derived
  Godot counts (requested 1,000 → 1,024 objects; requested 10 → 9 lights). Its City grid counts
  derive from the pinned generator's size 8/30 loops; rendered-object censuses stay `null`. The
  built mesh fixture now records 20k independent meshes/one material in the ordinary arm, one
  `InstancedMesh`/20k instances in the explicit arm, and 20k meshes/64 materials in the material
  diagnostic; its census test failed on the old `null` counts and now passes. This box remains open until the canonical City assets,
  fixture census, exact source/build locks and qualified diagnostic choices are frozen. `pnpm exec
  vitest run scripts/__tests__/engine-load-test-plan.spec.ts scripts/__tests__/engine-load-test-stats.spec.ts
  scripts/__tests__/engine-load-test-v2.spec.ts scripts/__tests__/engine-load-test.spec.ts` passed
  114/114; root `pnpm exec tsc --noEmit -p tsconfig.json` passed.
- [ ] Freeze conformance tolerances and visual qualification rules.
- [ ] Freeze publication plan fields, ordering policy and resource-limit policy after unscored qualification.

### Phase 2: Extend and prove the shared measurement path

- [x] Add the v2 result contract without changing the meaning of legacy reports/baselines.
  New [report-v2.ts](../../../../scripts/engine-load-test/report-v2.ts) holds `IV2RunRecord` plus
  `parseV2RunRecord` and the `readResultRecord` dispatch (no `schemaVersion` or `1` → the unchanged
  `parseRunReport`, `2` → v2, anything else refused), covering §10's groups: schema/derivation
  versions, campaign/plan/source hashes, experiment key, arm backend/build/flags, block/session/
  order, fixture hash and conformance evidence, timing definition and raw-series ref, metric
  availability, machine and preflight, outcome/reason, durations and checksums. Absent rejects,
  `null` requires a reason, `0` is a real sample, and a reason on a real value is refused (the
  missing-GPU-sample trap in a zero's clothes); ids, SHA-256 shape, runStatus/comparability/
  optimization-class/protocol/lane enums, finite non-negative timings, unique metric names, integer
  counts ≥ 1 for block/session and safe relative artifact refs are all validated. `report.ts`
  changed only by exporting its four existing `require*` shape helpers, so v1 parse/compare/knee/
  baselines are the same code. No dependency, CLI, adapter or HTML change.

  After review, the two states the first version blurred are now separated honestly. A `valid` run
  owes evidence: >0 measured frames, >0 measure duration, a primary completed-work mean >0 (0 there
  means no frame completed, not a fast engine), a passing preflight, and fixture conformance `pass`
  **with** its evidence — a run with none of these used to parse as valid. Conversely a
  `not-run`/`unsupported` attempt no longer has to invent anything: `timing.rawSeries` may be `null`
  with a required `rawSeriesReason`, frames and measure duration may be 0, the primary metric may be
  `null` with its reason, and `checksums` is a ref→SHA-256 map that may be empty — where a named
  series and fixture evidence must be covered by it; a `valid` run also owes a downloadable raw
  timing series. `crashed`/`timed-out`/`invalid`/`resource-limited` keep partial raw
  evidence when there is any, and a real `0` (an observed `upload-bytes`) still passes. The
  self-referential `checksums.record` is gone — a file cannot state the checksum of the bytes
  containing it; the record's own digest belongs to the bundle's `checksums.sha256`. A
  `matched-task` comparison carrying a `comparabilityReason` is refused as contradictory. Verified:
  `pnpm exec vitest run scripts/__tests__/engine-load-test-v2.spec.ts
  scripts/__tests__/engine-load-test.spec.ts` exits 0 (11 + 97 tests), root
  `pnpm exec tsc --noEmit -p tsconfig.json` exits 0, and `pnpm exec biome check .` exits 0. The new
  valid-run, not-run, checksum and uniqueness cases were confirmed red against the pre-fix parser
  before the fix. The parser is not yet written by any producer, so a v2 record remains unit-proved
  rather than collected.

  The bundle reader now verifies the referenced raw timing series, not only its checksum. Its v1
  raw format is `{schemaVersion:1,unit:"ms",boundaries:[{frameId,monotonicMs}],finalCompletionMs,
  gpuSamples?}`. It requires `N+1` increasing render-producing frame boundaries for `N` measured
  frames, then derives the primary mean from `(finalCompletionMs - firstBoundary) / N`, including
  the single final asynchronous GPU drain. Frame p50/p95/p99 use differences between boundaries,
  a separate metric; the reader refuses a run that reports the interval mean as completed work.
  A numeric GPU mean requires one attributed `passId:"frame"` sample per frame and rejects changed
  IDs; this validates retained data, not the honesty of the timestamp producer. The v2 parser and
  paired scorer both require the
  primary metric in milliseconds. A test first proved that a checksum-valid raw file with a changed
  reported mean was accepted; it now fails. Unit, count, frame-ID and missing-GPU mutations also
  fail. The eight focused benchmark test files passed 128/128; root TypeScript and `git diff --check`
  passed. These are parser/bundle checks, not proof of an actual GPU timestamp producer.
- [ ] Collect browser publication evidence from a production build with recorded identity.
  Smoke-profile production-build evidence with full identity is retained for the independent-mesh
  family (Phase 3); the publication profile is not. Each retained arm names its adapter, three
  revision, browser arguments, display and source commit, and the collector refuses a run whose
  adapter reports nothing or names a software renderer. Still missing here: the frozen 600-warmup /
  6,000-measured frame counts, seven randomized paired blocks over two sessions, and the A/A
  calibration band without which no faster/slower verdict is supported.
- [ ] Prove the native completed-work boundary with a render-suppression negative control.
- [ ] Prove asynchronous GPU sample attribution and missing-data behavior.
- [ ] Add full-fixture identity and reject a mutation beyond the first eight objects.
  Built and unit-proved, deliberately unticked: the identity (`cubeFixtureHash`, SHA-256 over a
  documented canonical byte representation — version line, sorted `name=value` fixture parameters as
  ECMAScript `Number::toString`, `u32` count, then IEEE-754 binary64 little-endian `x,y,z` per
  placement, unquantised — over all placements plus the fixed geometry/material/camera/update
  constants that `game.ts` and `workload.ts` read from the hashed `CUBE_FIXTURE` descriptor) exists,
  and `pnpm exec vitest run scripts/__tests__/engine-load-test.spec.ts` (exit 0, 99 pass) shows that
  moving object 9 keeps `positionHash` byte-identical, changes the full identity, and is refused by
  `checkEquivalence`/`compare` under the opt-in `requireFullFixture` v2 gate, alongside repeats that
  disagree and a rung whose identity is missing from one repeat or one arm. The box stays open
  because the gate needs a *comparable measured pair* and no such pair exists yet. Godot now emits
  `fixtureHash` from its generated float64 inputs before Vector3 storage; pinned Godot 4.7.1 headless
  and the JS fixture agree byte-for-byte at 1, 256 and 1,024 cubes. A unit check also ties Godot's
  static header to the shared TS contract. The native host has no
  WebCrypto; a SHA-256 fallback now hashes the same canonical bytes, checked against Node SHA-256
  at padding/block boundaries and against the browser cube fixture digest. `native.ts` emits the
  hash before timing, but the host has not executed here. The headless Godot report parsed its new
  hashes with a dummy renderer; it is not GPU evidence. What remains: one real cross-arm comparison
  under `requireFullFixture`. Legacy default semantics are unchanged
  and tested: a current TN report with a hash still compares against a hashless Godot report.
  `positionHash` re-checked after the descriptor refactor: `94e73aef/78812d31/e9a32f01` for
  256/1024/4096 cubes, and the hashed constants are value-identical to the literals they replaced.
- [ ] Complete A/A calibration and retain the minimal-meter overhead measurements.
- [x] Prove the paired-block statistics with known-ratio and high-variance fixtures.
  [stats.ts](../../../../scripts/engine-load-test/stats.ts) pairs v2 runs by planned session/block,
  requires the frozen planned block IDs and rejects a wholly missing block, a missing arm,
  duplicate/reused or identity-mismatched runs, computes the geometric
  competitor/TN completed-work ratio and 10,000 fixed-seed whole-block bootstrap resamples,
  and reports session estimates, a calibrated A/A epsilon and pointwise verdicts. Seven blocks
  across two sessions are required for an interval; absent A/A calibration or material session
  drift blocks a supported verdict. The [focused test](../../../../scripts/__tests__/engine-load-test-stats.spec.ts)
  proves identical, 2× faster, 2× slower, high-variance/inconclusive, short, drifted and malformed
  cases. `pnpm exec vitest run scripts/__tests__/engine-load-test-stats.spec.ts
  scripts/__tests__/engine-load-test-v2.spec.ts scripts/__tests__/engine-load-test.spec.ts` passed
  112/112; `pnpm exec tsc --noEmit -p tsconfig.json` passed; targeted Biome check passed with two
  nonfatal complexity warnings. Hardware A/A collection and meter-overhead proof remain open above.

### Phase 3: Cubes and independent Three.js meshes

- [ ] Implement the locked Bevy many-cubes adapter with deterministic updates for every timed behavior.
- [ ] Pass many-cubes execution/visual conformance against the TN fixture.
- [x] Implement plain Three.js and TN independent-mesh variants using identical Three.js package bytes.
  All three arms now execute the production bundle on the hardware GPU and report the same three
  bytes. [mesh-fixture.ts](../../../../examples/engine-load-test/src/mesh-fixture.ts) defines the
  shared 1920×1080 geometry, placements, 64-material and rotation inputs; the pure scene builder
  authors independent `Mesh` objects or one explicit `InstancedMesh` plus an optional TN projection.
  The plain page imports no TN projection, while the TN page passes the package's default
  `SceneRenderProjection` for ordinary variants and explicitly omits it for the named
  projection-off/instanced diagnostics. The same builder, drain and fixture digest run under the
  owned native host. Identical bytes are now measured rather than argued: every retained arm reports
  `threeRevision` `185` and hashed chunk `three.webgpu-DEK9E5ts.js`, and only the TN pages preload
  `renderProjection-CYAqE-l3.js`.

  Three gaps closed since the groundwork commit, each with the run that proves it:
  `three`'s WebGPU backend keeps its adapter in a function-local, so `backend.adapter.info` was
  always `undefined` and every earlier mesh result carried `backend: "{}"` — the harness now reads
  the adapter the browser actually handed out, field by field, the way `main.ts` already did, and
  the collector refuses a run that reports no vendor/architecture or names a software renderer
  (`TN_BENCH_ADAPTER_UNREPORTED`, `TN_BENCH_SOFTWARE_ADAPTER`). The mesh launch also carries
  `--ozone-platform=x11 --enable-features=Vulkan`: measured on this machine's RTX 2080, the stock
  argument set reports `maxBufferSize` 1073741824 and a 1,000-mesh arm costs 51.59 ms/frame, while
  the Vulkan set reports `vendor: nvidia, architecture: turing` and the same arm costs 6.86 ms — the
  first mesh run in this PRD was a SwiftShader number and nothing in the record said so. Both arms
  now also demand a display, through `TN_BENCH_DISPLAY` or the repository's `sh scripts/xvfb.sh`.
  Finally the native host was built here (`pnpm native:build`, 409/409, `mystral` 101,551,728 bytes,
  SHA-256 `923ec604a4a6fcc292667726a931d833325cbb3258d45a9debbc915bfca41f45`, recorded per run) and
  `--mesh-arm tn-desktop` executes on it, reporting the adapter only the host can see:
  `NVIDIA GeForce RTX 2080`, `NVIDIA: 615.71.09 615.71.9.0`.

  `pnpm --filter threenative-engine-load-test build`, root `pnpm exec tsc --noEmit -p tsconfig.json`,
  `pnpm exec biome check .` (exit 0; only the pre-existing nonfatal complexity warnings),
  `git diff --check` and the ten focused benchmark suites all passed — 147/147, including the new
  `engine-load-test-mesh-compare.spec.ts`. A v2 publication record is still not produced by any
  producer; the retained mesh records are the smoke shape, which is what the box above asked for.
- [x] Verify the actual projection/batching/instancing behavior of each labelled mesh arm.
  Every labelled arm was run at the 20k diagnostic rung on the RTX 2080 and its submitted work was
  read back from `renderer.info` at the measurement midpoint, so the name is checked against what
  the engine did rather than trusted (`artifacts/engine-load-test/mesh20k-*.json`, 120 measured
  frames after 30 warmup, all exit 0):

  | arm | variant | mean ms | p50 ms | draw calls | triangles | projection |
  |---|---|---|---|---|---|---|
  | `plain-three-web` | `rotating` | 104.01 | 98.29 | 20001 | 240001 | none |
  | `tn-web` | `rotating` | 12.20 | 11.41 | 2 | 240001 | `projected` |
  | `tn-web` | `rotating-projection-off` | 98.31 | 93.19 | 20001 | 240001 | none |
  | `tn-web` | `rotating-instanced` | 5.48 | 3.55 | 2 | 240001 | none |
  | `plain-three-web` | `rotating-instanced` | 5.36 | 3.42 | 2 | 240001 | none |
  | `tn-web` | `rotating-64-materials` | 18.27 | 17.25 | 65 | 240001 | `projected` |

  The checks this box asks for all follow from that table. Independent authoring really submits one
  draw per mesh, and TN's ordinary default really collapses 20,000 renderables into one instanced
  batch — the projection's own report reads `sourceRenderables: 20000, resultDrawCandidates: 1`.
  Switching the projection off returns the identical arm to 20,001 draws and 98.31 ms, within 6% of
  the plain page, which is what identifies the projection as the cause rather than a page or build
  difference. Explicit instancing is the same work in both engines (5.48 against 5.36 ms), so the
  diagnostic is the counterpart §5 requires and not TN's number standing in for it. The 64-material
  cell produced 64 material batches, 65 draws and 64 distinct material assignments. Every arm
  submitted the same 240,001 triangles, and the six retained captures are each 1920×1080 with the
  same 117,745 non-background pixels, so no arm bought its draw count by dropping visible work. The
  64-material capture carries 65 distinct colours where the others carry 2, which is the material
  cell visible in the pixels and not only in a counter.
- [ ] Retain a real hardware comparison for the many-cubes family.
- [x] Retain a real hardware comparison for the independent-mesh family.
  One real-hardware smoke block per required arm, retained under `artifacts/engine-load-test/` with
  raw frame series, captures and identity — not publication evidence, and labelled so in the artifact
  itself. Hardware: NVIDIA GeForce RTX 2080 (TU104), driver `615.71.09`, on this machine's own
  display path; the browser arms reach it through Chromium 151's Vulkan backend and the native arm
  through the host's wgpu-native backend, and every arm's adapter, three revision, launch arguments,
  display, fixture hash and source commit are in its own record.

  The framework-configuration comparison, `plain-three-web` against `tn-web` at 20,000 rotating
  meshes: **104.01 ms against 12.20 ms per frame, an 8.53× ratio**, 20,001 draw calls against 2, on
  the identical fixture digest `80018d4c8364` and identical `nvidia`/`turing` adapter
  (`mesh20k-comparison-web.json`). The runtime comparison, `tn-web` against `tn-desktop` on the same
  fixture, reads 12.20 ms against 89.19 ms, and that 0.137× **is not a throughput result**: the
  native arm presents through a private Xvfb, so its completed-work mean contains a display-bound
  present instead of the workload. The evidence for that is in the same artifacts — the native arm
  costs 74.09 ms at 1,000 meshes and 89.19 ms at 20,000, so a twentyfold workload change moves it
  by 20%, which is a present ceiling, not a rendering cost. Both comparisons therefore carry
  `blocks: 1` and a retained `qualifications` array, and the seven-block publication requirements
  stay open in Phase 6.

### Phase 4: Animation, Godot rendering workloads and City

- [ ] Pass foxes conformance with independently animated staggered skeletons.
- [ ] Retain a real hardware comparison for the foxes family.
- [ ] Pass Godot culling conformance with the RID authoring distinction documented.
  [The headless census probe](../../../../benchmark/godot-prd449/probe.gd) loads the pinned
  upstream `culling.gd` from its source checkout, seeds exactly as its `Manager` does, and
  passes all ten named variants: 10,000 `RenderingServer` object RIDs and five primitive mesh
  sources each; the directional variant has one light node, and each omni/spot variant has 100
  light RIDs. It also checks the static/dynamic RID assignment, unshaded/rotation/shadow switches,
  the directional light's shadow flag and a controlled dynamic process step. Unknown variants
  exit 2; two identical seeded `box-100` probes emitted byte-identical census JSON. The probe
  rejects changed SHA-256 bytes for the two upstream scenes, `Manager`, `Benchmark` or project
  configuration before loading a scene, and emits the scene source digest with its census. A
  `project.godot` mutation exited 2 with the named hash error and no census output; the original
  file was restored and its SHA-256 rechecked. It does not
  yet compare sampled transforms, visibility, depth/object-ID captures,
  the matching TN scene or physical rendering, so this box remains open.
  A local ignored `artifacts/engine-load-test/godot-census.json` now retains all 23 records in
  draft-plan order, source and probe digests, and the Godot binary version/hash. Its metadata
  explicitly says `headless-dummy-renderer` and `measuredPerformance: false`; it is a fixture
  diagnostic, not a published timing result. All 23 recorded requested/actual counts matched the
  draft matrix in a direct consistency check.
  The real-GPU arm closes the transform, scene and physical-rendering clauses of that sentence and
  leaves the depth/object-ID clause open. [culling_arm.gd](../../../../benchmark/godot-prd449/culling_arm.gd)
  drives the pinned `benchmark_<variant>()` itself and never re-implements the workload; the
  counterpart arm reads the fixture the Godot arm actually rendered
  ([cull-fixture.ts](../../../../examples/engine-load-test/src/cull-fixture.ts)) instead of
  reimplementing Godot's PCG stream, so the two arms hash the same file. In the retained
  `basic_cull` pair the fixture hash, the 10,000-object census and the 0/0/0 light census are equal,
  the six sampled frames agree to `0 m` and `0` quaternion components, and both arms' independent
  motion checks pass on the real GPU. The remaining gap is depth/object-ID capture, and the
  comparison is qualified rather than matched-task for the three stated reasons it records.
- [x] Retain a real hardware comparison for the Godot culling family.
  Four real-hardware smoke cells on the RTX 2080 (TU104) through `DISPLAY=:0`, driver `615.71.09`
  — 600 measured frames after 120 warmup, both arms on the identical fixture `1283daf331d1`,
  retained under `artifacts/engine-load-test/`. Godot reported its Forward+/Vulkan device with its own
  per-frame CPU and GPU samples (its `drain` is `none-available`, and its wall mean therefore paces
  on submission); the counterpart arm reported `NVIDIA GeForce RTX 2080` through the host's
  wgpu-native backend and drained once at the measurement boundary.

  | cell | variant | TN authoring | TN mean ms | Godot mean ms | Godot GPU/CPU ms | verdict |
  |---|---|---|---|---|---|---|
  | static, unshaded | `basic_cull` | `scene-node-independent` | 19.45 | 1.07 | 0.89 / 0.66 | `qualified`, ratio 0.055 |
  | static, unshaded | `basic_cull` | `clustered-default` | 16.65 | 1.07 | — | **refused** |
  | translating | `dynamic_cull` | `scene-node-independent` | 40.34 | 6.13 | 1.26 / 3.41 | `qualified`, ratio 0.152 |
  | 100 static omni lights | `static_omni_light_cull` | `scene-node-independent` | 20.54 | 1.18 | 1.06 / 0.68 | `qualified`, ratio 0.058 |

  The refusal is the result worth having. TN's ordinary authoring at 10,000 objects puts 588 of 600
  frames on the host's 16.667 ms frame loop, so its mean is the present, not the work; the
  comparator fails closed on that (`TN_BENCH_CULL_TN_CADENCE_CAPPED`, `non-comparable`, CLI exit 2)
  and the file is retained as the proof rather than deleted. TN's ordinary authoring at 10,000
  objects is at or below one host tick on this lane, and that cap is baked into the host's embedded
  config rather than a flag, so the cell needs a lane that is not cadence-bound before it can carry
  any number at all. The diagnostic arm sits above that floor (202/600 frames on a tick,
  p50 19.6 ms) — and three runs of that same cell read 19.45, 20.42 and 35.34 ms, a spread far
  outside the 3% epsilon, so every retained ratio carries `blocks: 1`, no interval and no verdict
  of faster or slower.

  The moving cell is what proved the conformance oracle is worth having: it rejected the first pair
  with `TN_BENCH_CULL_STATE_OUT_OF_TOLERANCE` and 0.13 m of disagreement, and the cause was real on
  both sides. The pinned scene's `time_accum` is a plain member nothing zeroes, so it reached the
  arm already advanced by however long the window took to appear, and the pinned loop advances the
  clock *before* it renders — so the two arms' frame 0 were one advance apart. The Godot arm now
  zeroes the clock before the warmup and again at the scored boundary, and the counterpart renders
  frame `k` at `(k+1)·δ`; the pair then agrees to 2.4e-6 m across six sampled frames, which is
  float32 against float64, and both arms' own motion checks pass on the GPU (TN 1,075/6,128/6,183
  and Godot 1,028/5,340/5,362 changed samples at the three later captures). A static workload would
  have hidden both halves of that, because nothing moves.

  Every retained comparison is `qualified`, never `matched-task`: the competitor authors
  `RenderingServer` RIDs, each engine tessellates its own primitives (Godot/TN triangles per kind
  12/12, 4224/3968, 3456/2176, 768/256, 8/12), and the shaded environments differ. The light cell
  matches its light census exactly (100 omni, 0 spot, 0 directional) and names the shadow
  technique it does not have: Godot's dual-paraboloid omni shadows against three's cube-map point
  lights, which is why it is `omniShadowMode: dual-paraboloid` in the record rather than a
  like-for-like claim. Coverage deltas are 0.0146–0.0224 of the frame. The native host has no PNG
  encoder, so the retained visual evidence is the read-back coverage grid both arms compute on the
  same 240x135 lattice rather than a pair of image files.

  Two harness defects surfaced while trying to add the light cells, both fixed at their root and
  both confirmed by the red-green check named below. The Godot arm recognised the dynamic light set
  by indexing `dynamic_instances[0]`, which a static light variant leaves empty: the index raised
  an unhandled error inside `_run`, and because the arm extends `SceneTree` that left it running
  with nothing left to quit it, so the run hung instead of reporting anything. And
  [`runCapturing`](../../../../scripts/engine-load-test/run-desktop.ts) waited on a child that
  never reports and never exits with no bound of its own, which is how that hang became an 1,800 s
  session timeout; it is now bounded and fails with `TN_BENCH_TIMEOUT` and the child's own last
  output. The arm also now refuses a sampled state that carries no probe
  (`TN_BENCH_GODOT_STATE_UNOBSERVED`) instead of emitting a record the collector cannot read.

  What is still open in this family, named: `dynamic_rotate_cull` (the earlier prototype timed out
  and remains invalid), every shadows-on variant, and the four remaining light variants. The
  shadows-on cells are blocked on evidence, not on code: the arm's own effective-shadow probe reads
  a luma delta of 0.0001 or less for `directional_light_cull`, so that variant exits 2 with
  `TN_BENCH_GODOT_SHADOW_PASS_NOT_OBSERVED` and `TN_BENCH_GODOT_DIRECTIONAL_NOT_EFFECTIVE` before a
  single frame is compared. A mean-luma delta is too weak a detector for self-shadowing on 10,000
  small objects spread over the upstream camera's whole frustum; the next step is a changed-pixel
  count between the shadows-on and shadows-off probe captures, not a looser threshold. No number
  from any of those variants is claimed.

  [cull-compare.ts](../../../../scripts/engine-load-test/cull-compare.ts) is pure and unit-proved
  by [engine-load-test-cull-compare.spec.ts](../../../../scripts/__tests__/engine-load-test-cull-compare.spec.ts):
  9/9 pass, and each of the three checks this slice added — the capture's frame-to-frame difference,
  the cadence refusal, and the clock ordering — was confirmed red against the pre-fix code.
  The bounded capture is proved in `engine-load-test.spec.ts` (100/100). The eleven focused suites
  passed 162/162 and root `pnpm exec tsc --noEmit -p tsconfig.json` and
  `pnpm exec biome check --diagnostic-level=error` exited 0.



- [ ] Pass lights/meshes conformance including requested-versus-actual counts and changing lights.
  The same probe passes all 13 upstream `lights_and_meshes.gd` variants headless. Requested 1,000
  yields 1,024 mesh nodes; requested 10 yields nine spot/omni light nodes, while the 10,000/100
  stress variant yields 10,000/100. It checks every light's visibility/energy after a controlled
  update and checks that the mesh and light grids rotate in opposite directions at the requested
  speed. Godot `4.7.1` exits 0 on all 23 probes; an optional unbuilt C++ extension logs import
  errors and the upstream source project reports exit leaks, so these runs assert only the named
  scene properties. Matching TN, sample-frame visual/state evidence and a real GPU remain open.
- [ ] Retain a real hardware comparison for the Godot lights/meshes family.
- [ ] Pass City conformance for both frozen fixture sizes and both movement states.
- [ ] Retain a real hardware comparison for the City family.

### Phase 5: Deliver the offline report generator

- [x] Render every expanded plan cell with its actual coverage/outcome state. The draft plan's 73 cells and 169 arms all appear with explicit `not-run` status when empty; failed attempts and incomplete pairs remain visible. `pnpm exec vitest run scripts/__tests__/engine-load-test-campaign.spec.ts scripts/__tests__/engine-load-test-html.spec.ts` passed 5/5. This proves rendering, not a measured campaign.
  A later fail-closed check rejects a frozen plan that omits a required cell or comparison arm,
  changes a required experiment dimension, or leaves an actual census unresolved; replacing the
  draft fixture revision during freezing remains permitted. The focused campaign test first
  exposed the false-`COMPLETE` path, then passed with the check. A further red-green bundle test
  proved that absent publication metadata was not disclosed; the report now lists missing
  `sources.lock.json` and `machine.json` on the first screen, keeps `partial` true, and displays
  locked machine details when present. Present locks are checked against planned arms/runs and
  checksummed. The three focused report/bundle tests passed 12/12, root TypeScript passed, and
  Biome error-level checks passed with pre-existing nonfatal complexity warnings.
- [x] Prove table/chart/CSV consistency with the canonical derived dataset. A seven-block 10 ms/20 ms fixture produces the same run median in the table, load chart and CSV, with a 2.00× ratio; deterministic regeneration and empty-data cases pass in the focused tests. The bundle writer retains `plan.json`, `results.json`, `results.csv`, `report.html` and `checksums.sha256`; a CLI smoke run generated those files from the draft plan and exited 2 because it contained zero measured runs.
- [x] Expose uncertainty, optimization class and comparability beside each displayed ratio. The report shows a 95% paired-block interval or `interval unavailable`, verdict, comparability, block count, class, profile and protocol; incomplete pairs have no ratio. The draft fixture is marked `insufficient`, not faster/slower.
- [ ] Link each experiment to raw runs, effective settings, source patches and matching captures.
  Each table row now shows attempts per planned arm and a stable keyboard-linkable evidence section
  that lists run records, their checksummed artifacts, effective flags and upstream source. A
  focused red-green HTML test proved the new row link and target. A fresh CLI smoke report in
  `/tmp/tn-prd449-report-smoke` exited 2 as expected for zero runs and contains 73 cells, 169 arms,
  73 evidence links, both missing-lock gaps and no external asset tags. Source adaptation patches and
  matching captures are not yet produced or linked, so this box stays open.
  The bundle now derives a bounded per-run frame-interval histogram, p50/p95/p99/max, a count of
  intervals exceeding twice that run's median, and the separate final completion wait from validated raw
  timestamps. HTML drill-down shows these with a raw-series link and definitions; JSON retains the
  same summaries, not all frame samples. The raw-series and bundle tests first failed for the
  absent summary, then passed 11/11 after implementation. The main table and CSV now use run-level
  percentiles derived from validated raw boundaries when a run omits percentile metric fields;
  a separate red-green bundle assertion proved the table no longer shows dashes for retained
  frames. Sparse GPU samples are counted without turning missing frames into zero GPU time;
  malformed or duplicate GPU frame IDs fail even when `gpu-ms` is null or the attempt measured
  zero frames; a numeric `gpu-ms` with zero frames also fails. The report displays observed/missing GPU timestamp counts. No physical samples are
  claimed.
- [ ] Pass offline `file://` testing with network requests blocked. HTML has inline CSS/script and no external asset tags, but Chromium could not launch in this sandbox (`sandbox_host_linux.cc:41`, `Operation not permitted`) before `file://` navigation. No browser-open claim is made.
- [ ] Pass keyboard/table/print usability checks.
- [x] Pass escaping/path-safety tests using malicious fixture text. The focused HTML test injects `</script>`, an image handler, `javascript:` source URL and traversal artifact ref; output escapes the text and does not create unsafe links. Bundle tests reject a symlinked plan outside the bundle root and reject a changed raw timing file whose SHA-256 no longer matches the run record. The seven focused benchmark test files passed 123/123; root TypeScript check passed. Browser `file://` remains open above.
- [x] Prove deterministic substantive regeneration from the retained bundle. A bundle test retains
  14 valid synthetic records across seven paired blocks, their raw timing files, conformance
  artifact and plan. It regenerates the 2.00× comparison, HTML, JSON, CSV and checksum manifest;
  after replacing the generated HTML with stale text, a second generation restores byte-identical
  outputs from the retained inputs. `pnpm exec vitest run
  scripts/__tests__/engine-load-test-bundle.spec.ts` passed 4/4. This proves derivation, not a
  physical measurement or complete publication bundle.

### Phase 6: Qualify the campaign and hand over actual results

- [ ] Execute the frozen required matrix on the identified physical desktop, retaining every attempt.
- [ ] Obtain seven valid paired blocks for the publication-grade primary comparisons at supported loads.
- [ ] Retain the second-session stability evidence and any resulting qualifications.
- [ ] Retain qualified native presentation evidence for the 20k independent-mesh comparison.
  The desktop CLI's `--no-vsync` previously left the embedded 60 fps cap active. The host now
  clears that cap after reading embedded configuration. A rebuilt RTX 2080 host logged
  `Presentation cap: 0 fps`; a real-display 1,000-mesh, 120-frame smoke run measured 1.78 ms
  mean. This proves the cap fix, not the 20k publication comparison or displayed FPS.
- [ ] Retain qualified native presentation evidence for the 100-fox comparison.
- [ ] Demonstrate actual slowdown sensitivity on the qualified measurement lane.
- [ ] Generate the final HTML containing real TN-versus-upstream measurements for all six families.
- [ ] Retain the downloadable raw-data/provenance bundle with verified checksums.
- [ ] Reproduce at least one comparison per family from the bundle's documented commands in a clean build directory.
- [ ] Link the delivered report and findings from the existing runtime performance state record.
- [ ] Publish all six benchmark families and the final offline report on threenative.com/docs/benchmarks, with links to this PRD, pinned upstream sources, and the downloadable provenance bundle. The site branch `feat/prd-449-benchmarks` currently has six accurately marked in-progress entries; it is built and tested but not deployed.
- [ ] Run relevant repository gates and record their actual outcomes beside the implementation evidence.

A family is not complete without at least one supported load with valid TN and upstream measurements. Required high-load resource failures and genuinely unsupported feature variants remain visible and qualified; they do not authorize skipping an entire family. Open or unavailable evidence leaves its own checkbox open. Never change acceptance thresholds simply to make ThreeNative look faster.
