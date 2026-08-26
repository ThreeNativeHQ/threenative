# PRD-222 native Android FPS reassessment — 2026-08-26

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

## Related records, in reading order

| Record | Why it matters |
| --- | --- |
| [PRD-222 performance targets](../PRDs/PRD-222-performance-targets-per-platform.md) | Defines parity, the 30/58 fps Bayview bars, thermal validity, and device gates. |
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
Until then, the honest status is: **engine scaling defect confirmed; exact removable mechanism not
yet isolated; no new Android FPS improvement from the current cycle.**
