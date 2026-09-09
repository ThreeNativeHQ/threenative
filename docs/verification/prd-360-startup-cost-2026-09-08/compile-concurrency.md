# PRD-360 — bounded compile concurrency, and what actually moved

The third and last lever in [the handoff](README.md)'s step 4: serial async scheduling. Measured on
the desktop native host with the **real Bayview scene**, which runs the same `mystral` runtime and
the same compile pool the phone does.

## Why the lever exists

three's `Renderer.compileAsync` processes its queued work one object at a time — `await
getForRenderAsync(renderObject)`, `getForRender(renderObject, pipelinePromises)`, `await
Promise.all(pipelinePromises)`, `await yieldToMain()`, per object
(`three.webgpu.js:60259`, `:60278`, `:60285`). The native host meanwhile runs a **two-thread**
pipeline compile pool, deliberately two rather than `hardware_concurrency`
(`packages/runtime-native/src/webgpu/bindings_pipelines.cpp:229`), because
`wgpuDeviceCreateRenderPipelineAsync` is `unimplemented!()` on wgpu-native and aborts the process
(`packages/runtime-native/src/webgpu/bindings_state.h:369`).

One compile is ever in flight, so one worker runs and the other idles for the whole launch.

## The change

`IWarmUpOptions.compileConcurrency`, opt-in, **default 1 — the existing serial walk, unchanged**.
At `"object"` granularity it issues that many per-object compiles before awaiting the group. Each
call keeps its own `within()` bound, so the budget check stays the only place the walk can stop.

The default is 1 rather than a guessed constant on purpose: a default nobody measured is exactly
the bug this option was added to avoid shipping.

## Measured

Desktop native host, RTX 2080 on Vulkan under a private Xvfb, real Bayview bundle, one run per arm:

| Arm | Warm-up |
| --- | --- |
| `granularity: "object"`, `compileConcurrency: 1` | 490 compiled, 21 slices, **2,291 ms** |
| `granularity: "object"`, `compileConcurrency: 4` | 490 compiled, 21 slices, **2,118 ms** |

The host pool runs at most two compile jobs (one on a host with two hardware threads or fewer), so
**4 is above the ceiling**: everything past 2 only fills the request queue. That is consistent with
the small margin measured here.
| `granularity: "scene"` (the shipped default) | **8,480 ms** |

**Concurrency is worth 7.5 %. Granularity is worth 3.7×.** The lever the handoff named is real but
small; the larger number on this host is that the shipped whole-scene `compileAsync` call costs
nearly four times what walking one representative per pipeline costs.

## On device: the lever loses there too, and the contradiction resolves

Physical Pixel 8, one cold launch per arm, same engine, differing only in whether `defineGame`
configures a warm-up. Arm B is the configuration desktop liked best.

| Arm | APK SHA-256 | `Displayed` | scene enter | warm-up |
| --- | --- | --- | --- | --- |
| A — no warm-up | `a45b8dbb226b3703fd39233a207b1d57b2f7c279ed85a358d1ba9e6714ec41de` | 377 ms | 2,377 ms | `{"skipped":"no-startup-cover"}` |
| B — `object` + `compileConcurrency: 4` | `3e554c750650391aae752b163e9e7dcbd020820d60beab150ce14ca6f64e437a` | 531 / 709 ms | 2,795 / 5,147 ms | `{"compiled":449,"slices":19,"elapsedMs":15012,"abandoned":45,"timedOut":true}` |

Arm B **ran out of its 15 s budget with 45 of 494 representatives never reached**. Desktop did the
same walk in 2,291 ms; the phone did not finish it in 15,012 ms. The desktop/device contradiction
resolves in the device's favour.

How that 15,012 ms splits is **not** established here. Creating the pipelines is 8,513 ms of it, so
the walk adds several seconds on top — but "per-object node building dominates" is more than the
measurement supports, and separating node building from pipeline creation on device would need its
own instrumented run.

## Every warm-up shape loses to no warm-up on this device

| Shape | Cost on the Pixel 8 |
| --- | --- |
| none — the first frame compiles synchronously | **8,513 ms**, 101 pipelines, complete |
| `scene` granularity | 15,028 ms complete, or 20,988 ms and `{"compiled":0,"abandoned":1,"timedOut":true}` |
| `object` granularity, 4 in flight | 15,012 ms, `abandoned: 45`, `timedOut: true` |

Three shapes, three losses. `three`'s `compileAsync` is slower than the synchronous compilation it
exists to replace, on this device and this runtime. That is the finding; it is not a tuning problem.

## Why no warm-up shape could have won

The three losses are not three tuning failures; they follow from what a warm-up is. The 8,513 ms is
the cost of *creating 101 pipelines*, and a warm-up creates the same 101 — it does not make them
cheaper, which `warmup.ts` says in its own opening comment. So any warm-up costs

    8,513 ms of pipeline creation  +  the JS-side walk that drives it

and is therefore **always slower in total** than letting the first frame create them. What a warm-up
buys is not less time, it is *relocation*: the stall moves off the first presented frame and into a
window where a loading surface can keep animating.

That trade is worth taking when there is a cover to animate behind. Bayview has none the engine can
see, and the criterion PRD-360 measures is total time to playable, not where the stall sits. Under
that criterion no warm-up shape can win, and the measurements agree with the arithmetic: the two
that completed cost 15,028 ms and 2,291 ms + 8,513 ms of relocation, and the two that did not
complete abandoned work.

The corollary matters for the next lever: **the only way to reduce this launch is to create fewer
pipelines, or to make each one cheaper.** Scheduling cannot.

## Where the remaining time could come from, and what is closed

- **Fewer distinct pipelines.** 67 main-material pipelines cost 7,477 ms. That is a game-side
  authoring decision about how many distinct materials the town needs, and it decides how the game
  looks, so it is not the framework's to make.
- **A persistent driver pipeline cache — closed at the C API.** The pinned wgpu-native header
  exposes no cache-creation entry point; `pipelineCaches` appears once, as a field of
  `WGPURegistryReport` (`packages/runtime-native/third_party/wgpu/include/webgpu/wgpu.h:217`).
  `IWarmUpCacheOptions` remains a hint that a *driver's own* cache may have survived, not a
  serialized pipeline.
- **Per-pipeline Mali cost** — 8,513 ms / 101 = ~84 ms each. Outside this repository.

## What this does not establish

- **One run per arm.** No repeat, no median, no thermal qualification window. The rejection does
  not need one — arm B loses by more than six seconds and does not finish — but an acceptance claim
  would.
- **The desktop rows are an RTX 2080 with a desktop driver** and are kept only because they are what
  the device measurement overturned.
- **No default changed.** `compileConcurrency` ships at 1 and `granularity` ships at `"scene"`.
  Changing either needs the device measurement above.
- PRD-360 remains **PARTIAL** and unmet.
