# PRD-222 native Android FPS reassessment — 2026-08-26

> ## Read this first — the answer, found 2026-08-26 late
>
> **Root cause: the native host re-installs an object's whole method table on every call that
> creates it.** `device.createCommandEncoder()` costs **64,436 ns** here against Chrome's **919 ns**
> — 70×. `queue.writeBuffer` costs 2,519 ns against 431 ns — 5.8×. A plain property read
> (`buffer.size`) is 7 ns against Chrome's 21 ns, *faster*, which is what proves the cost is the
> binding call path and nothing else.
>
> **It is not an Android bug.** Native `render.p50` is **22.2 ms on desktop** and **22.9 ms on the
> Pixel 8**, against Chrome's 7.6 ms and 5.8 ms. The renderer costs the same everywhere; Android
> simply has no spare frame budget to hide it. Fixing it speeds up every platform.
>
> - **The finding, with evidence:** [ROOT CAUSE](#root-cause-every-webgpu-binding-call-costs-58-70-what-chromes-costs), near the end of this file.
> - **The fix plan and its risks:** [WebGPU binding tables are installed per call](../bugs/webgpu-binding-table-installed-per-call-2026-08-26.md).
> - **Everything between here and there is the search that got to it**, including three of this
>   document's own conclusions that later measurement overturned. Sections marked **SUPERSEDED**,
>   **WITHDRAWN** or **REFUTED** are kept deliberately — they record what was tried and why it was
>   wrong — but **do not act on them**.
>
> Superseded on sight: the opening decision below (pause Lever D/E and re-profile) and the whole
> Lever A–E framing. Every lever targeted the trampoline, which is **0.647 ms of a 22 ms render
> phase**. They failed because they were aimed at the wrong 3%, not because they were executed badly.

## Original opening, retained as the record

**Decision: pause the planned Lever D/E implementation and re-profile before adding more runtime
machinery.** The current cycle has produced no proven Android FPS improvement. Lever A was flat and
removed; Lever C reduced the desktop native work meter by only **0.3104285 ms/frame**, which is
inside the observed run spread and below the approximately 2 ms threshold for a Pixel 8 A/B. The
last device result therefore remains approximately **19 fps**, against a **30 fps floor** and **58
fps target**.

This is a checkpoint, not a closure report. It records what is measured, what is inferred, what was
rejected, and what must be resolved before the next performance edit.

## Answer: engine or game?

**The parity defect belongs to the engine, and Bayview is the workload that exposes it.** The same
authored Bayview scene measured **59.99 fps in Chrome and 19.15 fps in the native host on the same
cool Pixel 8**. Bayview's complexity amplifies the problem, but calling it a game bug would ignore
the 3.13× same-device runtime gap. Conversely, the native starter holds 59.99 fps, so this is not a
fixed host ceiling that affects every game.

| Proven fact | Consequence |
| --- | --- |
| Chrome Pixel 8: 59.99 fps; native Pixel 8: 19.15 fps | The large parity gap is in the native execution path, not authored content alone. |
| Native starter: 59.99 fps | The host can reach display refresh on a light workload. |
| Bayview update: about 2.4–2.9 ms; Mali driver: about 2.3 ms of a 53 ms wall frame | Neither gameplay update nor GPU driver time explains the current gap. |
| V8: 22.9 ms of 37.2 ms render-thread CPU; only 10.1 ms is sampled JIT JavaScript | V8/runtime machinery is a major owner, but sampled buckets are not automatically removable budgets. |
| Full-resolution Bayview sits in the 20 fps vblank cell | Reaching 30 fps requires roughly 5–7 ms of dependable frame reduction, not a sub-millisecond micro-win. |

Primary same-device evidence: [Phase 0 browser/native calibration](prd-222-2026-08-25.md) and the
later symbol correction in [the crossing-tax report](prd-222-2026-08-26.md#correction--the-symbolized-profile-re-attributes-the-frame-2026-08-26-later).

## FPS progress so far

Device wins below predate the current Lever A/C cycle. They matter because they prove Bayview can
move, but neither closes the 30 fps floor.

| Change | Lane | Result | What can be claimed |
| --- | --- | --- | --- |
| Material-keyed scene projection | Pixel 8, matched cool, 2400×1080 | **17.3 → 20.1 fps**; render 41.7 → 28.5 ms | Proven device improvement; current game still below floor. |
| Upload staging v3 | Pixel 8, matched warm | **15.70 → 18.95 fps**; render p50 −12…−15 ms | Development-grade +21% relative win; not Tier-1 acceptance evidence. |
| Bridge micro-fix | Pixel 8, profiled | 18.92 → 18.23 fps, phase-confounded; matched render flat | No device win. |
| Surface frame latency 3 | Pixel 8, profiled | 18.92 → 18.98 fps | No device win. |
| Current Lever A/C cycle | Desktop direction meter only | A flat; C **−0.3104285 ms/frame** | No Android FPS claim and no new APK run. |

The material projection result is recorded in
[the real-scene batching bug and fix](../bugs/render-projection-cannot-batch-differing-geometries-2026-08-25.md#device-record-2026-08-25-physical-pixel-8-shiba-37251fdjh0037z).
The upload-staging and late bridge/latency pairs are recorded in
[the PRD-222 loop log](prd-222-loop-log.md#device-result-2026-08-26-evening--upload-staging-v3-paired-arms).

## Current-cycle measurements

Desktop FPS is FIFO/vblank-throttled and is not an optimization meter. The current protocol builds
the profiled native Linux host, runs the unchanged Bayview bundle for 900 presents three times,
keeps eligible frames 226–899, and compares median render-thread work. Every accepted run must also
produce a non-blank 1280×720 screenshot and zero relevant runtime exceptions.

| Arm | Three run medians, ms/frame | Median of runs | Ruling |
| --- | --- | ---: | --- |
| No-pool base `9840fc88` | 21.1051, 22.9769, 23.1199 | **22.9769** | Baseline; run 1 shows the meter's remaining spread. |
| Lever A render-pass wrapper pool | 23.054, 21.055, 21.878 | **21.878** | Overlaps the prior 21.1–22.5 ms baseline; no reliable ≥0.5 ms win. Pool removed. |
| Lever C `2fdb675c` | 22.6664, 22.7107, 22.2238 | **22.6664** | **0.3104 ms** below its exact base; below device trigger and within base spread. |

Lever A artifacts: [historical pool run](../../artifacts/prd-222/lever-a/818e97b3-lever-a-0952a2c73aeb/).
Lever C artifacts: [exact no-pool baseline](../../artifacts/prd-222/lever-c/baseline-no-pool-9840fc88/)
and [measured implementation](../../artifacts/prd-222/lever-c/2fdb675c-lever-c/). The complete
commands, parsing rules, screenshot checks, and limitations are in
[the executable fix plan](prd-222-fix-plan.md).

## What the Fox comparison teaches

The fresh Fox run is useful as a control, but it is not an FPS A/B: Fox is a simpler scene and the
historical 106 fps result used older game/runtime source plus scene collapse. The valid comparison
is workload shape under the same current profiled host.

| Current host sample | Work ms/frame | Bridge calls | Indexed draws | Ordinary draws | Writes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Fox sandbox | **17.249** | **2,668** | **430** | 5 | 583 |
| Bayview, pool-era samples | **21–23** | **2,512** | **288** | 103 | 499 |

Fox performs more bridge calls and more indexed draws while consuming less CPU work. Therefore raw
crossing count, raw indexed-draw count, and render-pass wrapper allocation are not sufficient
explanations for Bayview's cost. Differences in ordinary draws, shader/material paths, render
passes, object shapes, and JavaScript work remain plausible.

Historical Fox context is in [native performance benchmarks](native-performance-benchmarks-2026-08-11.md),
[the Fox-scale CPU baseline](native-cpu-profile-fox-scale-2026-08-11.md), and
[the scene-collapse regression record](prd-074-scene-collapse-regression-2026-08-11.md). Those
files are historical controls, not current Bayview parity evidence.

## What the Bayview shadow probe teaches

A temporary, freshly rebuilt shadows-on/off diagnostic changed the game's appearance and is not a
shipping optimization. It is still useful for attribution:

| Bayview diagnostic | Work ms/frame | Bridge calls | Measured binding ms | Indexed + ordinary draws | Writes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Control | **27.752** | **2,890** | **4.053** | 288 + 103 | 862 |
| Shadows off | **18.649** | **1,482** | **2.392** | 174 + 54 | 329 |
| Difference | **−9.103** | **−1,408** | **−1.662** | −114 −49 | −533 |

Removing the shadow phase removed 9.103 ms of work, but the binding timer accounted for only 1.662
ms of it. Approximately 7.44 ms lies in surrounding JavaScript, V8, host, and deferred command work.
This supports a workload-sensitive engine scaling problem; it does **not** prove that all 7.44 ms is
bridge overhead, and it does not license turning shadows off in the game.

The earlier shadow attribution was itself invalidated once before because the supposedly ON bundle
already had shadows compiled out. That history is documented in
[PRD-214's withdrawn shadow refutation](prd-214-2026-08-23.md#the-shadow-refutation-is-withdrawn).

## Hypotheses: current status

| Hypothesis | Status | Evidence/ruling |
| --- | --- | --- |
| Fill rate or GPU driver owns the gap | **Rejected as primary owner** | Quarter-resolution gave a limited gain; symbolized Mali time is about 2.3 ms/frame. |
| Gameplay update owns the gap | **Rejected as primary owner** | Steady update is about 2.4–2.9 ms and Chrome runs the same source at 59.99 fps. |
| Per-frame render-pass wrapper/function identity owns the gap | **Rejected** | Lever A added substantial pooling/lifetime code and produced no reliable desktop win; it was removed under the kill switch. |
| Crossing count alone owns the gap | **Rejected** | Fox has more calls but less work; an earlier 1,900-call reduction bought only about 5%. |
| V8/runtime machinery scales badly with Bayview's render workload | **Supported, insufficiently isolated** | Same-device parity, symbolized V8 share, Fox, and shadow probe agree; Lever C shows the first decomposition was not predictive enough. |

The symbolized profile remains valuable, but its percentages cannot be added together and treated as
guaranteed savings. A sampled symbol such as `LookupIterator`, `GlobalHandles::Create`, or scope
entry may be shared by many callers, include unavoidable work, or remain hot after a partial edit.
Lever C did not remove every name-keyed read or every property-shape transition, so its small result
does not falsify the whole engine diagnosis. It **does** falsify the expectation that the current
mechanical C bundle was close to a multi-millisecond win.

## Dead-end ledger: do not repeat without new evidence

This table includes earlier PRD-222 work as well as the current Lever A/C cycle. “Revisit only if”
is load-bearing: absent that new evidence, the experiment has already been paid for.

| Attempt | Exact result | Disposition | Revisit only if |
| --- | --- | --- | --- |
| Quarter native resolution / fill-rate reduction | Quartering pixels cut render by only about 15%; full-resolution parity remained far behind Chrome | Rejected as primary lever | A fresh GPU profile makes driver/fill time dominant. |
| Three.js render bundles around 13 material batches (`93370365`, `a95d5402`) | Crossings −23.2% / about −1,194 per frame; binding −0.213 ms; FPS 18.85 control vs 18.35 bundle | Rejected and reverted | A new workload makes bundle recording or direct draw encoding a measured multi-ms owner. |
| Mailbox / `threenativeVsync=false` | 18.71 fps and 17.49 ms present, indistinguishable from FIFO | Refuted | A backend trace shows FIFO sleep rather than submitted-work completion owns present. |
| Surface `desiredMaximumFrameLatency=3` (`47e4cc7e`) | Pixel 8 18.92 → 18.98 fps, render flat; desktop frame p50 21.0 → 13.8 ms | Kept as desktop infrastructure; rejected for Android FPS | Android surface/acquire behavior or backend changes materially. |
| Interned keys + pooled Persistent owners + reused arg vectors (`caa78a11`) | Desktop render p50 12.35 → 10.83 ms; Pixel render 39.9 → 39.9 ms and binding 10.14 → 9.98 ms | Kept desktop win; device hypothesis rejected | Fresh device caller attribution shows allocation/key construction is again multi-ms. |
| Batched render-pass recording | About 1,900 fewer crossings; Pixel median 18.61 → 19.60 fps, about +5% | Default OFF; insufficient for floor | A Tier-1 pair or expanded command stream predicts ≥5 ms without duplicating Three.js semantics. |
| Reusable render-pass wrapper pool (Lever A) | 23.054, 21.055, 21.878 ms desktop work; overlaps baseline | Rejected and removed under kill switch | A class-specific shape profile—not wrapper count—shows receiver/callee identity at this factory is hot. |
| Pool the remaining wrapper zoo (planned Lever B) | Not implemented; Fox has more calls/draws but less work, and Lever A was flat | Deferred, not a result | A wrapper-class counter attributes ≥2 ms to construction/identity for a named class. |
| Generic V8 property/scope fast paths (Lever C) | Exact-base median 22.9769 → 22.6664 ms, only −0.3104 ms | Measured; no device arm; review incomplete | Keep only review-clean simplifications, or profile a remaining named getter/scope caller before extending. |
| Borrowed callback values (planned Lever D) | Not implemented; current handle ABI cannot safely promote copied borrowed arguments | Paused before code | A caller-path profile prices argument GlobalHandles, and an explicit cross-engine ownership design exists. |
| Fixed-shape `ObjectTemplate` wrappers (planned Lever E) | Not implemented; broadest change despite the 3.9 ms IC hypothesis | Paused before code | A one-class reversible probe measurably reduces IC misses/work before surface-wide migration. |
| wgpu-native v25 → v29 | FPS **18.69–18.88 → 10.86**; writeBuffer 3.990 → 13.260 ms; render p95 80.13 ms | Decisive regression; rejected | A newer backend or Android-specific fix changes upload behavior and wins an isolated write benchmark first. |
| Exact uniform-write elision | Zero same-buffer/same-range/same-content repeats | Rejected before implementation | New telemetry finds actual duplicate payloads. |
| Native adjacent/overlap range coalescing | 876.20 writes/frame remained 876.20 disjoint ranges; merged bytes equalled original | Rejected | Upstream allocation/layout changes make ranges adjacent without violating queue order. |
| Disable shadows | Work −9.103 ms, but visual output changed; only −1.662 ms was measured binding work | Diagnostic only; not shippable | Never as an engine fix; use only as a controlled attribution rung. |

Detailed evidence for the render-bundle, mailbox, backend-upgrade, write-elision, range-coalescing,
and upload probes is in [Phase 2 development probes](prd-222-2026-08-25.md#phase-2-development-probes--charging-confounded-relative-evidence-only).

## Implementations that worked and must not be accidentally undone

| Change | Evidence | Keep because |
| --- | --- | --- |
| Material-keyed projection (`385fd50e`) | Pixel 8 17.3 → 20.1 fps, full resolution, matched cool | Largest proven current full-resolution win. |
| Upload staging (`263981b0` plus non-blocking/safety fixes) | Matched-warm 15.70 → 18.95 fps; render p50 −12…−15 ms | Hundreds of small uniform writes were a real wgpu-native cost. |
| Non-blocking map poll with one blocking safety valve | Removed a ~2× Mali regression and a pending-callback use-after-free | Permanent correctness/performance condition of staging. |
| V8 as Android default | Historical 16,384-cube result: 8.34 ms V8 vs 101.24 ms QuickJS | The engine choice itself was a 12× lower-bound win. |
| Default-off `threadCpuNs` marker | Produced stable 900-frame CPU-work comparisons where desktop FPS could not | Needed for cheap direction checks; profile flags remain OFF by default. |
| Live-window classification (`update.mean ≥ 3 ms`) | Prevents the idle end screen's unbounded loop from being reported as a 174 fps game win | Required parser rule for every Bayview device arm. |

## Measurement and implementation traps already hit

| Trap | Symptom | Required response |
| --- | --- | --- |
| Unsymbolized V8 builtins/JIT pages | Hot addresses were misread first as dispatch, then as Three.js execution | Retain unstripped `libv8android.so`; use F13's symbol/disassembly correction. |
| Stale native binary after failed compile | A/B appeared to run the candidate even though link failed | Watch the link complete and copy/name artifacts by exact source revision. |
| Desktop Xvfb FPS | About 19 fps regardless of CPU improvement | Compare `threadCpuNs - presentNs` or phase time, never desktop FPS. |
| Desktop-coherent mappings | Staging looked safe/fast locally but `wgpuDevicePoll(wait=true)` serialized Mali | Any map/poll change requires an actual device arm. |
| Window 1 / shader-load phase | Large transient cost contaminates medians | Discard window 1 and the first window after every runtime rung change. |
| Duplicate Android log tags | Same marker appears through `MystralStdio` and `MystralJS` | Dedupe by the defined tuple/window id before aggregation. |
| End-screen idle phase | Render approaches zero and FPS becomes unbounded | Accept only live windows with `update.mean ≥ 3 ms`. |
| Physics callback SIGSEGV | Roughly 5 of 9 launches died in one session | Check `pidof`, relaunch, and do not treat truncated runs as performance evidence. |
| Thermal/charging drift | A slower arm may simply start hotter | Tier 1–3: cool, discharging, ≥50% battery; label matched-warm probes development-only. |
| Wrong/changed bundle | Plausible screenshots can hide different source or compiled probes | Record bundle SHA-256, exact source revision, presents, non-blank screenshot, and exceptions. |
| Permanently mapped staging buffer | wgpu validation abort: submitted commands referenced a mapped buffer | CPU scratch → async map → copy → unmap → encode copies → submit. |
| Abandoned async map callback | Callback later writes into expired frame stack; bimodal FPS/UAF | Never abandon pending map; one blocking safety poll is the bounded fallback. |
| Black or merely plausible screenshot | A runtime may present but not prove the intended arm | Check dimensions/mean and label non-identical pixels honestly; never reuse a pool-era image as a new baseline. |
| Temporary Fox/shadow copies | `/tmp` evidence is ephemeral and may use different phase IDs | Treat only as diagnostic; reproduce into retained artifacts before using it for a landing decision. |

One unrelated gate failure was present while Lever C was measured:
`webgpu-bindings-contract.test.mjs` used an over-broad source slice whose end marker was absent. The
same condition existed at base; the package run reported 533 passed, 34 skipped, 1 failed. Do not
misreport that suite as green, and do not fold its repair into a performance arm without a separate
scope decision.

## Code decisions and current repository state

| Revision | Decision |
| --- | --- |
| `07e42c5e`, `f5d78515`, `7a176d83` | Implemented and hardened Lever A pooling for measurement. |
| `71e88641`, `9840fc88` | Removed Lever A after the flat result; kept only the default-off `threadCpuNs` meter and independent profile fixture correction. |
| `2fdb675c`, `75c18685` | Implemented and documented Lever C: conditional V8 entry scope, direct own-data property path, selected C++ metadata migration, and nested-callback proof. |
| Current accepted HEAD `75c18685` | Lever C is measured but **not review-clean**: cross-engine property semantics diverge and shader metadata lacked a bounded erase path. No FPS claim. |
| Interrupted fix round, uncommitted | QuickJS/JSC parity, metadata cleanup, and shared engine tests are present as dirty work and intentionally paused for reassessment. They are not benchmark evidence. |

The independent review found the V8 scope destruction order and nested callback handling safe, but
required cross-engine own-data-property semantics and bounded shader metadata lifetime before Lever
C can be called complete. The repair was interrupted at the user's request to reassess. Preserve or
discard it only after reviewing the dirty diff; do not silently mix it into a new benchmark arm.

## Why work stops here

Lever D would change callback value ownership across the common `Engine` interface. Borrowed V8
locals cannot safely escape through today's copyable two-pointer `JSValueHandle`; the 31 existing
`freezeHandle` call sites include RAF callbacks, timers, event listeners, asynchronous I/O, WebGPU
binding tables, audio, modules, and WebTransport. A correct design therefore requires an explicit
promotion/ownership contract across V8, QuickJS, and JSC—not a local replacement of `Persistent`
with `Local`.

Lever E would introduce per-class V8 `ObjectTemplate`s and internal fields across the WebGPU wrapper
surface. It is the only planned lever that directly targets the sampled 3.9 ms of megamorphic and
dictionary lookup time, but it is also the broadest change. Starting it while A and C fail to predict
measured gains risks another large abstraction with no causal proof.

## Required reassessment before more code

1. Capture a fresh Pixel 8 profile on the exact current accepted source and current Bayview bundle;
   retain the unstripped V8/runtime binaries and raw marker stream beside it.
2. Attribute stacks by **caller path**, not only leaf-symbol buckets: distinguish JavaScript IC
   misses, C++ `Object::Get`, callback argument persistence, wrapper construction, and Dawn work.
3. Add narrow counters/timers for callback argument promotions, name-keyed reads by property,
   wrapper-class creation, and shader/pass phases; validate that their sum predicts the shadow and
   Fox deltas before editing ownership.
4. Choose one reversible probe that removes at least 2 ms on desktop or a clearly bounded device
   bucket. Only then resume D, E, or a newly ranked lever.
5. Run the cool, discharging Pixel 8 pair only after the desktop/counter result crosses the trigger;
   only that pair can establish movement from the 20 fps cell.

## Frame attribution probe — 2026-08-26 (desktop, profiled Linux host)

**The bridge is not the frame.** Direct instrumentation of the one trampoline every JS→native
crossing passes through (`V8Engine::nativeCallback`, `src/js/v8_engine.cpp`) plus the RAF dispatch
(`Runtime::executeAnimationFrameCallbacks`, `src/runtime.cpp`) measures where the 21.5 ms desktop
work figure actually goes. This supersedes the reassessment's assumption that the parity gap lives
in binding/crossing machinery.

### Meter defect found first

`bindingNs` is **byte-identical to `sum(commandNs)`** and `calls` is **byte-identical to
`sum(commands)`** on every one of 674 eligible frames, in both archived Lever C runs. The
"measured binding" figure only ever covered the ten `ProfiledRenderCommand` leaf buckets
(`src/webgpu/bindings_state.h:89`). Every other crossing — `submit`, `beginRenderPass`,
`createCommandEncoder`, `createBindGroup`, physics `step` — was uncounted and untimed.

| Archived run | work | `bindingNs` | `sum(commandNs)` | unmetered |
| --- | ---: | ---: | ---: | ---: |
| Lever C `2fdb675c` run-1 | 22.670 ms | 3.549 ms | 3.549 ms | 19.121 ms (84%) |
| No-pool base `9840fc88` run-1 | 21.117 ms | 3.492 ms | 3.492 ms | 17.625 ms (83%) |

Consequently the shadow probe's "only 1.662 ms was measured binding work", and the Fox-vs-Bayview
"Fox performs more bridge calls" ruling, were both computed from a counter covering ~16% of the
frame. The real crossing count is 3,194/frame against the 2,870 reported.

### Measured frame decomposition

Instrumented host, Bayview bundle, 900 presents, frames 226–899, median. Non-blank 1280×720
screenshot (mean 94.96), exit 0. Work 21.485 ms, matching the 21.1 ms archived baseline, so the
steady_clock probe does not perturb the meter.

| Bucket | ms/frame | share of work |
| --- | ---: | ---: |
| **JavaScript outside the native bridge** | **13.325** | **62.0%** |
| wgpu-native backend inside `end` + `submit` | 2.761 | 12.9% |
| `writeBuffer` (862 calls) | 1.201 | 5.6% |
| physics `step` (4 calls) | 0.860 | 4.0% |
| leaf draw commands (setBindGroup/setVertexBuffer/setPipeline/draw*) | ~1.0 | 4.7% |
| `beginRenderPass` + `createCommandEncoder` (6 calls) | 0.741 | 3.4% |
| **trampoline overhead (entry scope, arg Persistents, handle release)** | **0.647** | **3.0%** |

Total native bridge: **8.160 ms (38%)**. Trampoline overhead is 201 ns/crossing over 3,214
crossings and 9,107 argument promotions.

A second run with both timers switched to `CLOCK_THREAD_CPUTIME_ID` inflates absolute work to
25.4/27.0 ms (the per-crossing `clock_gettime` is a syscall, and trampoline overhead rises
0.65 → 3.15 ms — measurement artifact, not signal). Its **ratios** independently corroborate the
split: bridge 41.0%/41.8%, pure JavaScript 59.5%/61.3%, host loop outside RAF −0.5%/−3.0% (i.e.
effectively the entire frame runs inside the RAF callback).

### Per-callback attribution (median per frame, top of 674 frames)

| ms/frame | calls | ns/call | callback |
| ---: | ---: | ---: | --- |
| 1.542 | 3 | 513,977 | `end` (GPURenderPassEncoder) |
| 1.219 | 3 | 406,377 | `submit` (GPUQueue) |
| 1.201 | 862 | 1,394 | `writeBuffer` |
| 0.860 | 4 | 215,034 | `step` (physics) |
| 0.464 | 3 | 154,748 | `beginRenderPass` |
| 0.422 | 693 | 610 | `setVertexBuffer` |
| 0.398 | 467 | 853 | `setBindGroup` |
| 0.277 | 3 | 92,444 | `createCommandEncoder` |

Cost is concentrated in a handful of expensive calls, not in thousands of cheap ones. `end` and
`submit` are dominated by wgpu-native's own command-buffer resolution and Vulkan submission; no
binding-layer change removes them. `end` was already inside the metered `endRenderPass` bucket
(1.540 ms), so the earlier hypothesis that descriptor parsing hid the cost is wrong on magnitude:
`beginRenderPass` + `createCommandEncoder` together are 0.741 ms.

### Rulings this forces

| Lever | New status | Measured ceiling |
| --- | --- | ---: |
| Lever D — borrowed callback values | **Rejected before implementation** | 0.647 ms — the entire trampoline, including every `GlobalHandles::Create`, arg vector, and protected-handle lookup |
| Lever E — fixed-shape `ObjectTemplate` wrappers | **Demoted** | bounded by the same 0.647 ms plus the 0.741 ms wrapper-construction pair |
| Lever B — pool the wrapper zoo | **Closed** | `beginRenderPass` + `createCommandEncoder` total 0.741 ms across 6 calls/frame |

The reassessment's resume criterion asks for a reversible probe predicting ≥2 ms. No
bridge-machinery lever can reach it: the whole trampoline is 0.647 ms and the whole bridge is
8.160 ms, of which 2.761 ms is backend work and 0.860 ms is physics.

### Where the work actually is

- **`node_modules/three` WebGPURenderer JS, executing under this host's V8 — 13.3 ms, 62% of the
  frame.** Not a file in this repository. No V8 flags are set anywhere in the host
  (`SetFlagsFromString` appears zero times), and no `SetAccessor`/`SetNativeDataProperty` exists,
  so JIT is on by default and every native property access is a counted crossing. The JS cost is
  genuine JS execution.
- **`src/webgpu/bindings.cpp` — 8.16 ms**, but 2.761 ms of it is wgpu-native's `end`/`submit`.
- **`src/js/v8_engine.cpp` — 0.647 ms.** Effectively closed as a lever.

### Next question, still open

Chrome reaches 59.99 fps on the same Pixel 8 running the same three.js source. If the 62/38 split
holds on device, roughly 31 ms of the 52 ms native frame is JavaScript that Chrome executes inside
a 16.7 ms budget. The remaining candidates are therefore (a) the prebuilt V8 executing this JS
slower than Chrome's V8, or (b) three.js taking a different, more expensive code path on native
because reported WebGPU capabilities differ. Both are testable on desktop by running the same
bundle in Chrome and comparing `renderer.render()` self-time — this has not been run yet.

### Naming the JavaScript half — sampled V8 CPU profile, steady state only (2026-08-26, later)

A `v8::CpuProfiler` was added to the profiled host behind `TN_JS_CPU_PROFILE=1`, started at frame
226 rather than at engine creation and flushed from the screenshot exit path (screenshot mode
leaves through `_exit()` and runs no destructor). Windowing matters: profiling from startup put
`build`, `setup`, `analyze`, `generate`, `createProgram` and `createImageBitmap` in the top ten,
and every one of them disappears in the steady-state window. **Shader/pipeline construction is a
startup cost, not a per-frame cost** — consistent with `createRenderPipeline` and
`createShaderModule` being absent from the per-frame bridge table.

Steady-state sample, 74,092 samples at 200 µs over frames 226–899:

| share | node |
| ---: | --- |
| 44.14% | `(anonymous) @ (native)` — native callbacks, folded into one node |
| 5.43% | `updateMatrixWorld` |
| 4.94% | `update` (game.js:78016) |
| 3.25% | `_renderObjectDirect` |
| 2.94% | `_update` |
| 2.88% | `updateForRender` |
| 2.81% | `_draw` |
| 2.19% | `multiplyMatrices` |
| 4.77% | raycasting: `checkBufferGeometryIntersection`, `fromBufferAttribute`, `_raycast$1`, `raycast` |
| 6.21% | **`@threenative/core` projection and picking** (12 entries) |

The 44.14% native share independently corroborates the 38–41% bridge share measured directly by
the trampoline counters; two unrelated instruments agree.

**Framework JavaScript is in the per-frame hot path.** `walkProjection`, `visitProjectionObject`,
`groupEligibleMeshes`, `addToMaterialGroup`, `geometryVersionSum`, `scanProjection`,
`#applyMaterialGroups`, `#syncProxy` and `#syncBatchedMaterial` are
[`packages/core/src/projection-plan.ts`](../../packages/core/src/projection-plan.ts) and
[`packages/core/src/projection-apply.ts`](../../packages/core/src/projection-apply.ts); `#collect`,
`#query` and `#hitTest` are [`packages/core/src/picking.ts`](../../packages/core/src/picking.ts).
Together they are 6.21% of steady-state samples — roughly 1.3 ms of a 21.5 ms frame. This is the
material-keyed projection that produced the proven 17.3 → 20.1 fps device win; it is not free, and
it is owned by this repository.

### The prebuilt V8 is not the defect

One candidate for the JavaScript majority was that the host's prebuilt V8 executes JavaScript more
slowly than Chrome's. **Refuted.** The same benchmark file — Matrix4-shaped `multiplyMatrices`,
a 20,000-node tree walk, and 5M string-keyed property reads, no WebGPU and no DOM — run on this
machine:

| Benchmark | Native host | Chrome | node | native ÷ Chrome |
| --- | ---: | ---: | ---: | ---: |
| matrix-multiply-2M | 77 ms | 122 ms | 73 ms | **0.63×** |
| tree-walk-200×20k | 51 ms | 61 ms | 60 ms | **0.84×** |
| string-key-props-5M | 24 ms | 34 ms | 32 ms | **0.71×** |

The host's V8 is faster than Chrome's on all three and matches node. No V8 flags are set anywhere
in the host and no `SetAccessor`/`SetNativeDataProperty` exists, so this is stock V8 with JIT on.
Engine-level JavaScript speed is closed as a hypothesis; the remaining candidate is that three.js
executes a **more expensive path** on native than in a browser, which is a different question with
a different fix.

### Desktop Chrome cannot serve as the parity reference on this machine — SUPERSEDED, see below

The reassessment's proposed next probe — run the same bundle in desktop Chrome and compare — was
attempted and **cannot be run here**. Chrome resolves a real adapter (`vendor: nvidia`,
`architecture: turing`, confirmed by reading `GPUAdapterInfo` fields explicitly rather than
structured-cloning the object, which serialises to `{}` and would otherwise read as SwiftShader),
yet renders Bayview at **1.04 fps**, unchanged at **1.09 fps** after a 45-second warm-up, with no
console or page errors. Under Xvfb it was 4.87 fps against an unnamed adapter and additionally
contaminated by React dev-mode frames the native bundle does not contain.

The 59.99 fps Chrome figure in this document is **Android Chrome on a Pixel 8** and desktop Linux
Chrome is not a substitute for it. Any future browser-versus-native comparison needs either the
phone or a different browser/platform; recording this so the probe is not attempted a third time.

### Revised open question

V8 is not slow, the trampoline is 0.647 ms, and shader construction is a startup cost. What
remains unexplained is why three.js needs roughly 13 ms of JavaScript per frame for this scene on
a desktop CPU when Android Chrome renders the same source inside a 16.7 ms budget on a far slower
one. The candidates are now about **work volume, not execution speed**: per-object state that
re-validates every frame (`needsRenderUpdate`, `updateForRender`, `getForRender`), render-bundle
or batching paths that engage in the browser and not here, and the cost of `@threenative/core`'s
own projection walk. Attribution should count invocations per frame per render object, not time.

### The desktop reproduces the parity gap — no device needed (2026-08-26, later) — WITHDRAWN, see the retraction below

**This supersedes the section above titled "Desktop Chrome cannot serve as the parity reference on
this machine", which was wrong.** That conclusion came from runs that measured frames-per-second
before the scene reached steady state; the 1.04 and 1.09 fps figures are load-phase artifacts, not
Chrome's throughput. Re-measured with a 25-second warm-up and only then a 5-second window, desktop
Chrome renders Bayview at 40–57 fps. Chrome also needs its GPU flags: launched with default flags
it falls back to software and returns 0.67 fps, which is the reading that must not be quoted.

Same machine, same NVIDIA Turing adapter, same authored scene, same three.js source:

| Lane | fps | CPU per frame |
| --- | ---: | ---: |
| Chrome (production build, `:0`, warmed) | **55.65** | **6.98 ms** |
| Native host (`:0`, 900 frames) | **24.2** | **28.5 ms** |

**Native burns 4.1× the CPU per frame that Chrome does, on the desktop.** The Pixel 8 ratio is
0.319 by fps; the desktop ratio is 0.43 by fps and 0.25 by CPU. The defect is not Android-specific
— Android amplifies a gap that is fully visible here.

The practical consequence is larger than the number: **PRD-222's device-only iteration loop is not
required to find or to measure this bug.** A Chrome-versus-native pair on this desktop, at the same
resolution, is a same-day meter with a 4× signal, where `threadCpuNs − presentNs` offered a ±3%
window around a lever worth 0.31 ms. Every lever in the dead-end ledger was scored against a meter
that could not see the defect.

### Two measurement corrections that matter for every past desktop number

- **The Xvfb lane and the real display are not the same meter.** Under Xvfb, median
  `threadCpuNs` is 53.973 ms with `presentNs` ≈ 31.3 ms; on `:0` the same build reports
  `threadCpuNs` 28.486 ms with `presentNs` 0.137 ms. Xvfb inflates total thread CPU and parks the
  difference in `presentNs`, which the project's meter then subtracts. Work reads 21.5 ms under
  Xvfb and 28.3 ms on `:0` for the same bundle. Desktop arms compared across lanes are not
  comparable.
- **A browser fps reading taken before steady state is worthless.** Bayview needs roughly 25
  seconds of warm-up in Chrome. Any browser number in this document should state its warm-up.

### Ruled out: projection divergence between web and native

The `TN_RENDER_PROJECTION` verdict is **byte-identical** on desktop web and desktop native:

```
{"projecting":true,"reasonCode":"projected","sourceRenderables":835,"resultDrawCandidates":561,
 "batches":13,"instancedBatches":0,"materialBatches":13,"projectedObjects":287,"exactObjects":548,
 "exact":{"skinned":40,"renderOrder":336,"transparent":75,"points":5,"instanced":12,"tooFewToBatch":80}}
```

`@threenative/core`'s material-keyed batching engages identically on both. It is not failing on
native, and the earlier `info.render.calls: 58` reading from a browser run was a different phase,
not the play scene — it must not be compared against native's draw counts.

Worth noting separately from the parity bug: **336 of 835 renderables are excluded from batching by
`renderOrder` alone**, the single largest exclusion reason, ahead of `tooFewToBatch` (80),
`transparent` (75) and `skinned` (40). That is a standing optimization opportunity in
`packages/core/src/projection-plan.ts` on both platforms — not the cause of the native gap.

### Native frame on the real display

| Measure | ms/frame |
| --- | ---: |
| `threadCpuNs` | 28.486 |
| of which native bridge | 10.923 |
| RAF dispatch (`jsFrameNs`, bridge nests inside) | 27.976 |
| `presentNs` | 0.137 |
| `submitPollNs` | 1.418 |
| wall clock (900 frames in 40,392 ms) | 44.9 |

Essentially the whole CPU frame is inside the RAF callback; 38% of it is the native bridge, matching
the Xvfb-lane split. Roughly 16 ms of the 44.9 ms wall frame is blocked, not CPU.

### Where the next probe goes

With a 4× desktop signal and a Chrome baseline, the open question narrows to one comparison:
does native issue **more** WebGPU commands per frame than the browser for this scene, or the same
number at higher cost? Chrome's per-frame command counts can be taken by wrapping
`GPUCommandEncoder`, `GPURenderPassEncoder` and `GPUQueue` prototypes in an init script and
differencing over a fixed window, then compared against the native `TN_ANDROID_JS_NATIVE` marker's
`commands` block. Chrome's sampled profile already shows `updateMatrixWorld` at 0.182 ms/frame
against native's ≈1.55 ms — an 8.5× gap on identical pure-JS matrix code that the microbenchmarks
say V8 executes at equal speed. That points at call volume, and the leading hypothesis is that the
native host renders more per frame than the browser does — the UI overlay pass is the first
candidate to confirm or eliminate.

### Retraction: the "4.1× CPU / desktop reproduces the gap" figure is withdrawn

The pair reported above — Chrome 55.65 fps / 6.98 ms against native 24.2 fps / 28.5 ms — **is not
sound and must not be quoted.** Three defects, found by re-measuring:

1. **The native fps was a whole-run average including startup; Chrome's was steady state after a
   25-second warm-up.** Differencing a 900-frame run against a 200-frame run to cancel startup
   moves native from 24.2 fps to 47.9 fps in one measurement session.
2. **The startup block is not reproducible.** Two sessions on the same binary and scene measured
   the first 200 frames at 15.2 s and at 5.2 s — a 3× swing. Every whole-run average inherits that
   swing. Differenced steady-state frame time landed at 20.9 ms in one session and 33.5 ms in the
   next.
3. **The native CPU number carried the probe's own overhead.** It came from the build whose
   per-crossing `clock_gettime(CLOCK_THREAD_CPUTIME_ID)` was already shown to inflate the frame
   (trampoline overhead 0.65 → 3.15 ms). Whole-process CPU (37.97 ms/frame differenced) is also not
   comparable to Chrome's 6.98 ms, which is **sampled main-thread only** and excludes Chrome's GPU
   and compositor processes.

**Desktop wall-clock fps on a shared display is not a parity meter on this machine.** Other work on
`:0` — a browser, a dev server, the compositor — moves it more than any lever under test.

What survives is the narrower, repeatable comparison of **main-thread CPU per frame**: native's
21.485 ms (median of 674 steady-state frames, from the low-overhead `steady_clock` build whose work
figure matched the 21.1 ms uninstrumented baseline) against Chrome's ≈6.98 ms of sampled non-idle
main-thread time. That is roughly **3×**, it is measured on identical work (see below), and it is
consistent with the Pixel 8's 3.1× fps gap. It is a ratio between two similar-but-not-identical
meters and should be treated as an order-of-magnitude result, not a precise one.

### Refuted: native does not render more than the browser

The leading hypothesis — that the native host renders extra passes the browser does not, with the
UI overlay as prime suspect — is **wrong**. Wrapping `GPUDevice`, `GPUCommandEncoder`,
`GPURenderPassEncoder` and `GPUQueue` prototypes in a Chrome init script and differencing over a
fixed steady-state window gives per-frame command counts within 2% of native's marker:

| Command per frame | Chrome | Native |
| --- | ---: | ---: |
| `beginRenderPass` | 3 | 3 |
| `createCommandEncoder` | 3 | 3 |
| `draw` | 103 | 103 |
| `drawIndexed` | 284.3 | 288 |
| `setBindGroup` | 462.3 | 467 |
| `setVertexBuffer` | 680.7 | 693 |
| `setIndexBuffer` | 188.2 | 191 |
| `setPipeline` | 260.8 | 266 |
| `writeBuffer` | 866.5 | 862 |
| `submit` / `end` / `executeBundles` | 3 / 3 / 2 | 3 / 3 / 2 |

Three render passes on both. No overlay pass, no duplicated scene render, no extra shadow work.
**The workload is the same; only its cost differs.**

### Refuted: steady-state deoptimization

A `TN_V8_FLAGS` environment channel was added to the host (`applyDiagnosticV8Flags`,
`src/js/v8_engine.cpp`) because it set no V8 flags at all and `--trace-deopt` was unreachable.
Running `--trace-deopt` over 400 frames yields 588 deopt events whose distribution is:

| Frame range | Deopts |
| --- | ---: |
| 0–49 | 2 |
| 50–99 | 466 |
| 100–149 | 85 |
| 200–249 | 1 |
| 300–349 | 20 |
| 450–499 | 14 |

Dominant reasons are `wrong map` (277) and `prototype-check` (142), but they are a **warm-up
transient**: steady state runs at roughly 0.3 deopts per frame. There is no deoptimization loop and
no repeated tier-down. Combined with the microbenchmarks showing this V8 matching or beating
Chrome's on pure JavaScript, engine-level execution is closed as an explanation.

### Separate defect found: the loading screen is dismissed before the scene is ready

Observed directly: the game presents, then stalls for several seconds, then runs normally. The
frame counter is already advancing during that stall, which is why whole-run averages are
contaminated. Measured as the first 200 frames costing 15.2 s in one session and 5.2 s in another,
against a steady-state frame time near 21–33 ms.

**This is its own bug, not part of the FPS parity work**: the loading screen must remain up until
the scene is actually ready to run rather than handing the player a stalling first few seconds. It
also means **no PRD-222 arm may use a whole-run average**; every desktop or device number must
discard the startup block explicitly, as the frame-226 window already does.

### Standing conclusions after these refutations

| Claim | Status |
| --- | --- |
| `bindingNs` measured only the 10 leaf buckets (~16% of the frame) | **Holds** — byte-identical to `sum(commandNs)` on 674 frames of two archived runs |
| Trampoline overhead is 0.647 ms; Lever D's ceiling | **Holds** |
| Native bridge is ~38% of main-thread CPU work | **Holds** — two independent instruments (direct counters, sampled profile) agree |
| `@threenative/core` projection is ~6% of steady-state samples | **Holds** |
| Projection verdict identical web vs native | **Holds** — byte-identical marker |
| Command volume identical web vs native | **Holds** — within 2% |
| The prebuilt V8 is slower than Chrome's | **Refuted** |
| Steady-state deoptimization | **Refuted** |
| Native renders more per frame (UI overlay) | **Refuted** |
| Desktop fps reproduces the parity gap at 4.1× | **Withdrawn** — measurement defect |

The unexplained quantity is now precise: **identical JavaScript, issuing an identical WebGPU
command stream, costs roughly 3× more main-thread CPU in this host than in Chrome, and the native
bridge accounts for about half of that excess.** The next probe must price a single command's
round trip in both runtimes — for example `writeBuffer`, which both issue ~865 times per frame,
where native measures 1.201 ms against Chrome's sampled ≈0.57 ms — rather than search for extra
work that has now been shown not to exist.

### Root cause candidate: Android runs V8 11, desktop and Chrome run V8 13 — REFUTED, see below

**Desktop and Android do not run the same JavaScript engine, and nothing in the repository compared
them.**

| Platform | Pin | V8 | Optimizing tiers |
| --- | --- | --- | --- |
| Desktop (`v8`, kuoruan/libv8) | `v13.1.201.22` | **13.1.201** | ignition, sparkplug, **maglev**, turbofan |
| Android (`v8-android`, Kudo/v8-android-buildscripts) | `11.110.1` | **11.0.226** | ignition, sparkplug, turbofan |

V8 11.0 predates Maglev, which shipped in V8 11.4 and became default in 11.7. The Android host
therefore runs **one optimizing tier short** of both the desktop host and the Chrome 151 it is
benchmarked against on the same phone. Verified from the installed headers
(`third_party/v8/include/v8-version.h` and `third_party/v8-android/include/v8-version.h`) and from
the pins in `scripts/download-deps.mjs`.

This is consistent with every measurement in this document:

| Observation | Explained by |
| --- | --- |
| Desktop native ≈ Chrome at ~21 ms/frame | Both run V8 13.x with Maglev |
| Desktop microbenchmarks: native V8 **faster** than Chrome's | Desktop V8 13.1 |
| Pixel 8: native 19.15 fps vs Chrome 59.99 fps | Native runs V8 11.0 without Maglev; Chrome runs V8 13.x with it |
| Device profile: 22.9 ms V8 of 37.2 ms, only 10.1 ms sampled JIT JavaScript | A weaker tier leaves more time in runtime and IC stubs and less in optimized code |
| No steady-state deopt storm, identical command volume, identical projection verdict | The workload is the same; only the engine differs |

It is a **candidate**, not yet proven: proving it requires either an Android build against a
Maglev-capable V8, or a desktop arm with Maglev disabled. A desktop `--no-maglev` arm was started
using the new `TN_V8_FLAGS` channel and had not completed when this was written; the unflagged
control on the same run measured matrix-multiply-2M 90 ms, tree-walk 58 ms, string-key-props 24 ms.
Recording the control here so the comparison can be finished without re-running it.

### Why the whole desktop lane could not have found this

The defect is engine-tiering on one platform. **A desktop A/B cannot prove or refute it**, because
desktop runs the engine that does not have the defect. That invalidates the premise of the current
cycle's method — Levers A and C were designed, implemented and measured on desktop against an
Android-only symptom. It also vindicates PRD-222's original rule that only the device may decide an
fps claim, which an earlier section of this document wrongly criticised.

### Guardrail added: `js-engine-versions.json` + `tests/js-engine-version-skew.test.mjs`

The skew existed for the entire optimization cycle and nothing reported it, so the fix is a gate,
not a note. [`js-engine-versions.json`](../../packages/runtime-native/js-engine-versions.json)
declares each platform's engine, pin, major, and optimizing tiers, plus the acknowledged skew with
its reason, its consequence, what closes it, and a link to this evidence.
[`tests/js-engine-version-skew.test.mjs`](../../packages/runtime-native/tests/js-engine-version-skew.test.mjs)
fails when:

- a declared pin disagrees with `scripts/download-deps.mjs`;
- a declared major disagrees with an installed `v8-version.h` (skipped when native deps are not provisioned, since the native build is opt-in);
- the skew between platforms exceeds the acknowledged bound;
- a non-zero skew lacks a recorded reason, consequence, closing condition or evidence link;
- the platforms differ by optimizing tier with no reason recorded.

Proven red before green: setting the Android major to 9 and the skew to 4 fails two tests with
`android third_party header reports V8 11, manifest declares 9` and `V8 major skew between desktop
and android is 4, above the acknowledged 2`; restoring the file returns 7 passed.

Raising `maxMajorSkew` instead of fixing the pin requires writing down why, in the same file.

### Correction: the per-function Chrome comparison was measured wrong

An earlier section of this document reported Chrome at **6.98 ms** of CPU per frame against native's
28.5 ms and called it a 4.1× gap. **Both halves were wrong.** The Chrome figure summed a truncated
top-40 list of Chrome DevTools Protocol profile nodes without aggregating by function name — the CDP
profile emits one node per call path, so a single function appears several times (three separate
`_renderObjectDirect` rows, three `writeBuffer` rows) and most of its cost falls outside the top 40.
The native figure was aggregated by name, so the two were never comparable.

Re-measured with matching aggregation, over 392 frames after a 25-second warm-up:

| ms/frame | Chrome | Native |
| --- | ---: | ---: |
| **total main-thread CPU** | **20.5** | **21.5** |
| `update` | 2.108 | ~1.06 |
| `updateMatrixWorld` | 1.773 | ~1.17 |
| `_renderObjectDirect` | 1.003 | ~0.70 |
| `writeBuffer` | 0.854 | 1.201 |
| `multiplyMatrices` | 0.640 | ~0.47 |

**There is no desktop parity gap**, and native matches or beats Chrome on nearly every function.
Call volume agrees too: `updateMatrixWorld` runs **4,634 times per frame in Chrome against 2,789 in
native** — the browser calls it more often and still spends less time per call than the earlier
mis-aggregated figures suggested. Counted by injecting the same counter into both bundles at the
`Object3D.prototype.updateMatrixWorld` definition.

Every "native is N× slower" claim in this document that was measured on desktop is withdrawn. The
gap is on the phone, and the engine version is the leading explanation for why it lives only there.

### The Maglev explanation is refuted by its own test

The V8-tier hypothesis above was tested with the `TN_V8_FLAGS` channel on the desktop host
(V8 13.1, which has Maglev) by removing tiers and re-running the same benchmark. Median of two runs
each:

| Benchmark | default | `--no-maglev` | `--no-maglev --no-turbofan` |
| --- | ---: | ---: | ---: |
| matrix-multiply | 21.0 ms | 20.0 ms — **0.95×** | 652.5 ms — 31.07× |
| tree-walk | 13.0 ms | 13.5 ms — **1.04×** | 104.5 ms — 8.04× |
| string-key-props | 6.5 ms | 5.5 ms — **0.85×** | 76.5 ms — 11.77× |

**Removing Maglev costs nothing measurable.** TurboFan still optimizes hot code; Maglev's value is
lower warm-up latency, not steady-state throughput. Only removing TurboFan as well collapses
performance, and the Android prebuilt is a `-jit` build that has TurboFan.

So "Android is missing Maglev" does **not** explain a steady-state 3.1× device gap, and the
root-cause candidate recorded in the previous section is withdrawn. V8 11 versus 13 may still matter
for other reasons — two and a half years of inline-cache, garbage-collector and TurboFan work — but
that is now an untested conjecture, not a diagnosis, and it cannot be tested on desktop because no
V8 11 desktop build exists here.

**The version-skew guardrail stands on its own merits.** It was added because a two-major-version
difference between platforms went unreported through an entire optimization cycle and silently
invalidated cross-platform reasoning. That is true whether or not the skew turns out to cause this
particular defect.

### Where the Android root cause now stands

Established and repeatable:

| Fact | Consequence |
| --- | --- |
| Desktop native 21.5 ms/frame vs desktop Chrome 20.5 ms/frame, same machine and scene | The defect does **not** reproduce on desktop |
| Identical WebGPU command stream, within 2% on every command | Native does not do more GPU work |
| Identical `TN_RENDER_PROJECTION` verdict, byte for byte | Core's batching behaves identically |
| Chrome calls `updateMatrixWorld` 4,634×/frame vs native 2,789× | Native does not do more scene work |
| Desktop V8 matches or beats Chrome's on pure JavaScript | Engine throughput is not the desktop story |
| Steady-state deopts ≈ 0.3/frame | No tier-down loop |
| Maglev removal costs ~0% | The missing Android tier is not the mechanism |
| Pixel 8: native 19.15 fps vs Chrome 59.99 fps | The defect is real and lives only on the device |

The defect is therefore **Android-specific and does not reproduce in any desktop lane**, which is
exactly what PRD-222's original device-only rule asserted. Desktop remains useful for attribution
within the native host — the bridge/JS split, the meter defect, the trampoline ceiling — but it
cannot decide this bug.

Remaining untested candidates, in the order their cost-to-test justifies:

1. **Render-thread scheduling and core affinity.** A Pixel 8 has four Cortex-A510 little cores. A
   render thread left at default priority with no big-core affinity would show precisely this
   shape: identical work, identical engine family, roughly 3× the wall time. Chrome elevates and
   pins its renderer. Checkable by reading the host's thread setup and by sampling which CPU the
   render thread occupies on device.
2. **V8 11 versus 13 for reasons other than tiering** — IC, GC and TurboFan changes. Testable only
   by building a newer V8 for Android, or by running the benchmark above on the device under both.
3. **wgpu-native on Mali versus Dawn on Mali.** Weakened as a candidate by the desktop result, since
   the desktop host that matched Chrome is itself the `tn-linux-wgpu` build and so already uses
   wgpu-native.
4. **Render resolution parity.** Whether the web build clamps `setPixelRatio` while native renders
   the full 2400×1080. Affects GPU more than CPU, and quarter-resolution previously bought only
   about 15%, so this is ranked last.

### Leading remaining candidate: the Android host manages no thread scheduling at all

Grepping `src/` and `android/` for every mechanism an Android game runtime would normally use to
keep its frame loop on a fast core returns **nothing**:

| Mechanism | Purpose | Present |
| --- | --- | --- |
| `sched_setaffinity` / `pthread_setschedparam` / `SCHED_FIFO` | pin or elevate the render thread | **absent** |
| `setpriority` / `setThreadPriority` / `THREAD_PRIORITY_URGENT_DISPLAY` | raise it above a normal app thread | **absent** |
| `SDL_SetCurrentThreadPriority` | the same through SDL, which owns the thread | **absent** |
| `PerformanceHintManager` / `createHintSession` (ADPF) | tell the governor this thread has a frame deadline | **absent** |
| `setSustainedPerformanceMode` / `GameManager` game mode | opt out of thermal-driven clock collapse | **absent** |
| `AChoreographer` | take vsync from the platform's own signal | **absent** |

A Pixel 8 is big.LITTLE — one Cortex-X3, four A715, four A510. A frame loop at default priority
with no deadline hint is exactly what the scheduler is free to place on a small core and the
governor is free to leave at a low clock. Chrome elevates its renderer and compositor threads and
drives frames from Choreographer; this host does neither. That asymmetry exists **only on
Android** — a desktop Linux machine has no little cores and hands an idle-machine thread full
clocks — which is precisely the shape required to explain a defect that vanishes in every desktop
lane.

**This is a candidate, and it is not proven.** The previous candidate was refuted by its own test,
so this one is stated with the same caution. Two facts argue against it being the whole story: the
device's render-thread CPU is 37.2 ms against desktop's 21.5 ms, a 1.7× inflation closer to a big
core running slower than a desktop than to an A510, which would be far worse. What it does
establish without a device is a **real omission in an Android games runtime**, worth fixing whether
or not it owns this bug.

### Ruled out on the way: resolution

Chrome at the Pixel's CSS viewport (412×915, 377k pixels) versus a desktop viewport (1280×720,
921k pixels) goes 38.72 → 48.51 fps. A 2.4× pixel reduction buys 25%, agreeing with the earlier
native quarter-resolution probe. **Fill is not dominant on either runtime**, so a resolution
mismatch between the web and native device arms cannot account for a 3.1× gap.

### An unreconciled number in the parity premise

Desktop Chrome measures 20.5 ms of main-thread CPU per frame. The Pixel 8 Chrome arm records frame
p50 of 9.5 ms. **A phone should not run the same JavaScript twice as fast as a desktop.** The most
likely explanation is contention on the desktop measurement — this machine was running a dev server,
a second browser and other agents' work throughout — rather than a workload difference, since the
resolution test above rules out the obvious candidate. It is recorded because it is unresolved, and
because Phase 0's own review already returned **FAIL on evidence retention** and required a re-run.

Any future parity claim should state, for both arms: canvas backing-store size, `devicePixelRatio`,
the scene phase measured, and the warm-up discarded. None of those are recoverable from the current
Phase 0 record.

### Honest status against the goal

The root cause is **not proven**. What this session did was remove most of the search space with
evidence rather than argument:

| Eliminated | By |
| --- | --- |
| Bridge/trampoline machinery as primary owner | Trampoline is 0.647 ms of a 21.5 ms frame |
| Extra rendering on native (UI overlay) | Command counts within 2% of Chrome's |
| Batching failing on native | Byte-identical projection verdict |
| Extra scene work on native | Chrome calls `updateMatrixWorld` 4,634×/frame vs native's 2,789 |
| The prebuilt V8 being slow | Faster than Chrome's on three benchmarks |
| Steady-state deoptimization | ≈0.3 deopts/frame after warm-up |
| Missing Maglev tier | `--no-maglev` costs ~0% on desktop |
| Desktop as a lane for this bug | Native 21.5 ms vs Chrome 20.5 ms — no gap to study |
| Fill rate / resolution | 2.4× fewer pixels buys 25% |

**Desktop is exhausted.** Everything desktop can decide has been decided, and it says the defect is
not here. Closing this needs **one targeted device run, not an iteration loop** — a single Pixel 8
session capturing, on the same cool phone and the same scene: which CPU core the render thread
occupies and at what frequency (`/proc/<pid>/task/*/stat` field 39, plus
`/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq`), the render-thread CPU time per frame, and
the same `bench.js` microbenchmark run inside the native host and inside Chrome on that device. That
single capture separates "the thread is on a slow core" from "V8 11 is slower than V8 13 for reasons
other than tiering", which are the only two candidates left standing.

### The V8 11-versus-13 conjecture is refuted as well

Node ships a specific V8 with each major, so the two engine versions can be compared on this machine
with the same embedding and the same benchmark file. Node 20.19.6 carries **V8 11.3.244**, close to
Android's 11.0.226; Node 24.16.0 carries V8 13.6. Median of two runs, ratios against V8 13.6:

| Benchmark | V8 10.2 | **V8 11.3 (≈ Android's)** | V8 12.4 | V8 13.6 |
| --- | ---: | ---: | ---: | ---: |
| matrix-multiply | 0.99× | **0.94×** | 1.16× | 1.00× |
| tree-walk | 1.04× | **1.01×** | 1.03× | 1.00× |
| string-key-props | 1.37× | **1.37×** | 1.24× | 1.00× |

V8 11 is at most **1.37×** slower than V8 13 on these shapes, and faster on matrix arithmetic. An
engine difference of that size cannot produce a 3.1× frame gap. Together with the Maglev result,
**the engine version is eliminated as the cause**, and only the guardrail's original justification
survives: an unreported two-major skew invalidates cross-platform reasoning regardless of whether it
causes this particular bug.

### Only one candidate is left standing, and the device lane is currently unavailable

After this round the surviving hypothesis is **render-thread scheduling and core placement on
Android**, by elimination rather than by direct evidence. Every other enumerated candidate has been
tested and refuted.

Proving or refuting it needs the physical Pixel 8, and that lane is **down at the time of writing**:
`adb connect 192.168.1.192:5555` returns `Connection refused`, and the only attached device is an
`sdk_gphone64_x86_64` emulator. An x86_64 emulator cannot decide this question — it has no
big.LITTLE topology, no Mali driver, and no thermal or governor behaviour resembling the phone, and
this package's own contract already records emulator and phone as separate results.

### The single capture that closes this

Not an iteration loop — one session on a cool, discharging Pixel 8 with the current Bayview build,
recording all of the following in the same run:

1. **Which core the render thread occupies, and at what clock.** Sample
   `/proc/<pid>/task/*/stat` field 39 (`processor`) alongside
   `/sys/devices/system/cpu/cpu*/cpufreq/scaling_cur_freq` across a steady-state window. If the
   frame loop sits on an A510, or on an X3/A715 held at a low clock, the candidate is confirmed.
2. **Render-thread CPU time per frame**, from the existing `threadCpuNs` marker, to compare against
   desktop's 21.5 ms. The recorded 37.2 ms is only 1.7× desktop — closer to a big core running
   slower than a desktop than to a little core, which argues *against* the candidate and must be
   reconciled rather than ignored.
3. **`bench.js` run inside the native host and inside Chrome on that same phone.** This is the
   control the whole investigation has lacked: identical pure-JavaScript work, two runtimes, one
   device. If the native host is ~1× Chrome there, the engine and the thread are both fine and the
   gap is in the WebGPU backend; if it is ~3×, the thread or the engine owns it.

Discard the startup block explicitly — see
the loading-screen bug (record removed 2026-08-26 as obsolete), whose
3× session-to-session swing silently corrupts whole-run averages — and record canvas backing-store
size, `devicePixelRatio`, scene phase and warm-up for both arms, none of which the current Phase 0
record preserves.

### What this session settled, and what it did not

It did **not** find the root cause. It removed, with evidence rather than argument, every candidate
that had been driving the work — including two of its own — and it established that **no desktop
lane can decide this bug**, which redirects the remaining effort to a single well-specified device
capture instead of another desktop lever. The dead-end ledger at the top of this document should be
read together with the eliminations table above before any further code is written.

### The Phase 0 parity pair is invalid by this project's own acceptance rule

The retained Phase 0 artifacts were re-parsed rather than re-read. Both arms are on disk:
`docs/verification/artifacts/prd-222-phase0-native-logcat.txt` and
`prd-222-phase0-browser-console.txt`.

This document already states the rule: **"Live-window classification (`update.mean ≥ 3 ms`) —
Prevents the idle end screen's unbounded loop from being reported as a 174 fps game win — Required
parser rule for every Bayview device arm."** Applying it to both arms of the pair that produced the
0.319 parity figure:

| Native window | fps | frame.p50 | render.p50 | update.mean | Verdict |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 19.06 | 31.29 | 21.93 | **7.23** | LIVE |
| 2 | 18.91 | 30.99 | 21.24 | **7.65** | LIVE |
| **3** | **19.15** | 32.43 | 22.88 | **5.77** | **LIVE — the headline number** |
| 4 | 20.14 | 35.44 | 30.06 | 1.87 | REJECT |
| 5 | 20.19 | 35.19 | 29.76 | 1.86 | REJECT |
| 6 | 20.16 | 35.07 | 29.73 | 1.81 | REJECT |

| Web window | fps | frame.p50 | render.p50 | update.p50 | Verdict |
| ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 41.79 | 10.5 | 6.9 | 1.6 | REJECT |
| **2** | **59.77** | 9.5 | 5.8 | **2.1** | **REJECT** |
| **3** | **59.99** | 9.7 | 5.8 | **2.1** | **REJECT** |
| **4** | **59.99** | 9.1 | 5.7 | **1.6** | **REJECT** |
| 5–8 | 59.77–59.99 | 8.8–9.7 | 5.4–6.1 | 2.3–2.5 | REJECT |
| 9–17 | 59.21–59.99 | 8.8–9.6 | 5.5–6.2 | **0.6–0.7** | REJECT |

**Not one web window passes the live-window rule.** The headline pair — native window 3 at
`update.mean` 5.77 ms against web windows 2–4 at `update` 1.6–2.1 ms — compares a native arm doing
roughly three times the gameplay simulation against a web arm that the project's own gate would
reject outright. The drop to `update` 0.6–0.7 ms from web window 9 onward is the signature that rule
exists to catch.

The rule was never applied to the web arm because `phone-web-tmp.mjs` prints `update.p50` and the
reassessment recorded the web `update` column as "not captured by the helper". The number was on the
line the whole time.

### What this does and does not establish

**It does not make the gap disappear.** Native windows 4–6 have `update` 1.81–1.87 ms, matching the
web arm's ~2 ms, and still run at 20.14–20.19 fps against the web arm's 59.99. Matching the
simulation phase does not close a 3× difference.

**It does invalidate the pair, and it relocates the gap.** With the phases lined up, the difference
is concentrated in one place:

| Device, matched-update windows | render.p50 | frame.p50 |
| --- | ---: | ---: |
| Web (windows 2–8) | **5.4–6.1 ms** | 8.8–9.7 ms |
| Native (windows 4–6) | **29.7–30.1 ms** | 35.1–35.4 ms |

**The device gap is in the render phase, at roughly 5×, and nowhere else.** Update is matched,
`hostGap` is 6.7–7.8 ms on web against a native `hostGap` p95 of 29.10 ms. Meanwhile on desktop the
same render phase costs the same in both runtimes. That is the precise, narrowed statement this
investigation was missing: not "native is slower", but *the render phase, on Mali, on Android, is
5× — while being at parity on desktop against the same three.js and the same command stream.*

Note also that native `render.p50` **rises** from 21.9 to 30.1 ms as `update` falls from 7.2 to
1.8 ms across windows 1→6. Render getting more expensive as the simulation quiets is not what a
CPU-bound frame does, and no hypothesis in this document explains it. It should be the first thing
the next device capture reproduces.

### Device lane unavailable at the time of writing

`adb` finds no Pixel on USB (`lsusb` shows no Google device) and both
`adb connect 192.168.1.192:5555` and `.193` fail with `Connection refused` / `No route to host`.
The only attached device is an `sdk_gphone64_x86_64` emulator, which cannot decide a Mali render
phase question. The capture specified in the previous section stands, with one addition: **re-run
Phase 0 with the live-window rule applied to both arms**, and record canvas backing-store size and
`devicePixelRatio` for each, none of which the current artifacts preserve.

## ROOT CAUSE: every WebGPU binding call costs 5.8×–70× what Chrome's costs

Measured directly, not inferred. The same file (`gpubench.js`) was run in the native host and in
Chrome on this machine, against a real adapter in both, timing 200,000 calls after a 2,000-call
warm-up:

| Call | Native host | Chrome | Ratio |
| --- | ---: | ---: | ---: |
| `queue.writeBuffer` (16 bytes) | **2,519 ns** | 431 ns | **5.8×** |
| `device.createCommandEncoder()` | **64,436 ns** | 919 ns | **70×** |
| `buffer.size` — plain property, **control** | **7 ns** | 21 ns | **0.33× (native faster)** |

The control is what makes this conclusive. A plain JavaScript property read is **three times faster**
in the native host than in Chrome, on the same machine, in the same benchmark. Only calls that cross
into the native binding layer are slower. The defect is therefore in the **JS→native WebGPU call
path specifically** — not in V8, not in JavaScript execution, not in the scene, not in the command
stream, all of which this document has already eliminated by separate measurement.

### Why it presents as a render-phase defect

Using the project's own `TN_FRAME_BUDGET` meter on all four cells — the comparison this
investigation had never made with a single consistent meter:

| Arm | `render.p50` | fps |
| --- | ---: | ---: |
| Desktop web (Chrome) | **7.3–8.9 ms** | ~59.5 |
| Desktop native | **22.2 ms** | 29–34 |
| Device web (Pixel 8 Chrome) | **5.4–6.1 ms** | ~60 |
| Device native (Pixel 8) | **22.9–30.1 ms** | 19–20 |

Two consequences, both correcting earlier sections of this document:

1. **Native `render.p50` is ~22 ms on the desktop and ~23 ms on the phone.** The native renderer
   costs the same on both. Android is not slower — Android simply has no headroom to hide it, while
   the desktop's spare frame budget concealed it.
2. **The gap reproduces fully on desktop** (7.6 ms web against 22.2 ms native, ~2.9×). The earlier
   "no desktop parity gap" conclusion was a meter mismatch: Chrome's *total sampled main-thread CPU*
   was compared against native's *render phase*. With one meter, desktop is a valid lane.

The frame issues roughly 3,214 binding crossings. Priced at the measured tax:

| Term | Excess per frame |
| --- | ---: |
| `writeBuffer`, 862 calls × (2,519 − 431) ns | **1.80 ms** |
| `createCommandEncoder`, 3 calls × 63,517 ns | **0.19 ms** |
| Whole bridge at Chrome's per-call price (8.16 ms measured → ≈1.4 ms) | **≈6.7 ms** |

against a total render excess of 14.6 ms — the binding tax accounts for roughly **half** of it, and
is the single largest identified term.

### The mechanism, in the code

`createCommandEncoder` at 64 µs for an API call that allocates one object is the tell. The handler
does not merely create an encoder: it calls **`installBindingTable`** for each method it exposes
(`src/webgpu/bindings.cpp:5660` onward), and `installBindingTable`
(`src/webgpu/registration_table.cpp`) performs, **per call**:

- a fresh `engine->newFunction(...)` closure per method (`registration_table.cpp:375`), each of
  which allocates a `NativeFunction`, an `External`, a `Function`, and a weak `NativeFunctionRef`;
- a property **snapshot** for every destination it will write;
- installation through `setProperty`;
- **expected-value verification** of every installed property;
- **rollback** machinery on failure, including a second verification pass.

There are 43 references to that snapshot/verify/rollback machinery in `registration_table.cpp`. It
is transaction-safety scaffolding designed for one-time binding installation, and it is being paid
on every object creation in the hot path. `beginRenderPass` does the same thing — which is why it
costs 155 µs per call while doing 15 `getProperty` reads of a descriptor.

This also explains a result that previously looked contradictory: the **trampoline is only 0.647 ms
of the frame (201 ns/crossing)**. The cost is not in getting into native code — it is in what the
binding bodies do once there.

### Why every previous lever failed

Levers A, C, D and E all targeted the trampoline and wrapper identity — 0.647 ms of a 22 ms render
phase. None of them touched `installBindingTable`, which is where the time is. The dead-end ledger
at the top of this document is consistent with that: every rejected lever produced a sub-millisecond
result because every rejected lever was aimed at the wrong 3%.

### The fix direction

Install each class's binding table **once**, at class-prototype level, rather than per instance per
call. The methods are identical for every `GPUCommandEncoder`; only the captured native handle
differs, and that belongs in the instance's private data, which the host already has
(`getPrivateData`, used by every handler). That removes the per-call `newFunction` storm, the
snapshot, the verification and the rollback from the hot path, and leaves the transaction machinery
where it was designed to run — at one-time installation.

Predicted effect, from the measured numbers: `createCommandEncoder` and `beginRenderPass` drop
toward Chrome's ~1 µs, and the per-call tax on the remaining ~3,200 crossings falls toward the
201 ns the trampoline actually costs.

The follow-up bug record, with the staged plan, the receiver-identity risk across all three
engines, and the falsification criteria, is
[WebGPU binding tables are installed per call](../bugs/webgpu-binding-table-installed-per-call-2026-08-26.md).

### Still to verify before claiming a fix

This identifies the mechanism and prices it; it does not yet prove the fix. Required next:

1. A reversible prototype-level install for **one class** — `GPUCommandEncoder` is the smallest with
   the largest measured tax — re-running `gpubench.js` to confirm the per-call price falls.
2. The desktop `TN_FRAME_BUDGET` pair re-run, expecting `render.p50` to move materially below
   22.2 ms. Desktop is now a valid lane for this, at ~2.9× signal.
3. Only then a device arm, which by the numbers above should track desktop rather than diverge.

### Instrumentation used (uncommitted, profile-gated)

A `v8::CpuProfiler` behind `TN_JS_CPU_PROFILE=1`, started at frame 226 from
`emitAndroidJsNativeProfile` and flushed from the screenshot `_exit()` path in `src/cli/main.cpp`,
plus `TN_ANDROID_JS_PROFILE`-gated counters in `include/mystral/js/engine.h`
(`g_bridgeCalls`, `g_bridgeNs`, `g_bridgeArgs`, `g_bridgeOverheadNs`, `g_jsFrameNs`,
`bridgeNames()`, `bridgeStats()`), incremented in `src/js/v8_engine.cpp`
(`newFunction`, `nativeCallback`) and `src/runtime.cpp` (`executeAnimationFrameCallbacks`),
emitted from `emitAndroidJsNativeProfile` in `src/webgpu/bindings.cpp` as new marker fields plus a
`TN_BRIDGE_BY_NAME` line. Default OFF; no effect on shipping builds.

## Related records, in reading order

| Record | Why it matters |
| --- | --- |
| [PRD-222 performance targets](../PRDs/performance/PRD-222-performance-targets-per-platform.md) | Defines parity, the 30/58 fps Bayview bars, thermal validity, and device gates. |
| [Phase 0 Pixel 8 browser/native calibration](prd-222-2026-08-25.md) | Establishes 59.99 vs 19.15 fps on the same phone; evidence-retention limitations are explicit. |
| [PRD-222 crossing-tax report and symbol correction](prd-222-2026-08-26.md) | Contains the raw attribution, then corrects the earlier unsymbolized interpretation. The correction outranks the opening diagnosis where they differ. |
| [PRD-222 loop log](prd-222-loop-log.md) | Chronology F1–F13, iteration costs, upload-staging pair, and late bridge/latency arms. |
| [PRD-222 executable fix plan](prd-222-fix-plan.md) | Lever designs, exact desktop meter, A rejection, C measurement, artifacts, and device trigger. |
| [PRD-214 render-frame bisect](prd-214-2026-08-23.md) | Earlier Bayview rung data and the withdrawn shadow refutation. |
| [Material-keyed projection bug/fix](../bugs/render-projection-cannot-batch-differing-geometries-2026-08-25.md) | Proven 17.3→20.1 fps engine/core improvement on the physical Pixel 8. |
| [Mobile stability investigation](mobile-stability-2026-08-23.md) | Thermal, memory, frame ownership, and device reliability context. |
| [Native performance bottlenecks](../architecture/NATIVE-PERF-BOTTLENECKS.md) | Historical hypothesis inventory; its supersession notices must be read before its rankings. |
| [Native render transport analysis](../architecture/NATIVE-RENDER-TRANSPORT.md) | Prior evaluation of direct calls, command streams, and render-thread structure. |
| [Fox native benchmark](native-performance-benchmarks-2026-08-11.md) | Historical Fox/Chrome/Godot context; useful control, not an apples-to-apples Bayview A/B. |
| [Scene-collapse regression](prd-074-scene-collapse-regression-2026-08-11.md) | Explains why historical Fox draw/fps numbers cannot be compared directly with current Bayview. |

## Resume criterion

Resume optimization implementation only when a fresh attribution or reversible probe predicts a
specific **≥2 ms desktop/native-work reduction** and identifies the exact caller path that owns it.

**Updated by the 2026-08-26 frame attribution probe above.** That criterion has now been run
against the bridge and the bridge cannot satisfy it: the entire trampoline is 0.647 ms and the
entire native bridge is 8.160 ms of a 21.485 ms frame, of which 2.761 ms is wgpu-native backend
work. 62% of the frame is JavaScript executing outside the bridge. The honest status is:
**engine scaling defect confirmed; the owning bucket is now isolated to three.js JavaScript
execution under this host's V8, not to binding machinery; Levers B/D/E are closed on measured
ceilings; no new Android FPS improvement from the current cycle.** The next probe is a desktop
Chrome-vs-native comparison of the same bundle, not another binding edit.
