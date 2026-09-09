# PRD-360 startup cost — learnings and suggestions

Raw material for a later PRD. Everything numbered below is either a measurement taken on a physical
Pixel 8 / an RTX 2080 desktop native host, or a source fact with its anchor. Nothing here is an
estimate unless it says so.

## 1. What the launch actually costs

```
~10.9 s to a playable world
  ~2.4 s   process start -> scene enter (assets, town, soldiers, effects)
   8.5 s   pipeline creation
```

and the 8.5 s decomposes with **nothing left for the framework**:

```
8,513 ms  =  96 distinct shader programs -> 101 pipelines  x  ~84 ms Mali compile each
```

| Group | Pipelines | Cost |
| --- | ---: | ---: |
| main materials | 67 | 7,477 ms |
| shadow | 31 | 963 ms |
| PMREM | 2 | 50 ms |
| output conversion | 1 | 23 ms |

101 pipelines, **101 unique cache keys** — no duplication. 96 distinct vertex/fragment WGSL programs
— no render-state permutation to collapse (the five programs used twice each see exactly one state).

## 2. Levers measured and rejected — do not re-run these

| Lever | Result |
| --- | --- |
| Declare the DOM loading surface a cover so the warm-up runs | **Worse.** 20,988 ms returning `{"compiled":0,"abandoned":1,"timedOut":true}`; 15,028 ms on another launch |
| `granularity: "object"` + `compileConcurrency: 4` | **Worse.** 15,012 ms, 45 of 494 never reached, timed out |
| No warm-up at all (shipped behaviour) | **8,513 ms, complete** — the best of the three |

A fourth result belongs beside these, recorded independently in the ledger's "Bayview bounded
startup experiments" section: raising the **native** compile pool from 2 to 4 workers also made the
launch slower (19,022.717 ms first frame). So both halves were tested — more native workers, and
more JS-side compiles in flight — and neither helped. The pool cannot help a loop that queues one
job, and queueing more jobs does not help when the walk itself is the cost.

**Why none could win, and this is the reusable insight:** a warm-up creates the *same* pipelines. It
never makes them cheaper. So it always costs `pipeline creation + the walk that drives it` and is
always slower in total. What it buys is **relocation** — moving the stall off the first presented
frame so a loading surface can keep animating. That is worth having when there is a cover to animate
behind, and worthless against a criterion that measures total time to playable.

Corollary: **the only ways to reduce this launch are to create fewer pipelines, or to make each one
cheaper.** Scheduling cannot.

## 3. Suggestions, ranked

### 3.1 A persistent pipeline cache — by far the biggest lever

The industry-standard fix. Vulkan `VkPipelineCache`, D3D12 PSO libraries, Metal binary archives:
compile once, serialize to disk, and every launch after the first is nearly free. Steam's
"processing Vulkan shaders" bar is this.

This investigation initially recorded it as closed because the **pinned** wgpu-native exposes no
cache-creation entry point — `pipelineCaches` appears once, as a field of `WGPURegistryReport`
(`packages/runtime-native/third_party/wgpu/include/webgpu/wgpu.h:217`). That is a **dependency
version wall, not a hardware one**: Vulkan supports it, `wgpu` exposes `PipelineCache`, and this
project owns its C++ host.

Estimated prize: takes 8,513 ms to roughly zero on launches 2..n. That is an order of magnitude more
than anything scheduling could reach, and it would bring a warm second launch well inside eight
seconds.

Work: bump wgpu-native; plumb a cache handle through
`packages/runtime-native/src/webgpu/bindings_pipelines.cpp` (which already owns a compile pool and
its deferred-promise bridge); persist per app version + driver version; re-measure a three-launch
median on a Pixel 8, cold and warm.

Risks to design for: cache invalidation on driver update, cache file size, first-launch cost
unchanged, and a corrupt-cache path that must fail open rather than block the launch.

### 3.2 Uber-shader plus material instancing — game-side, and the only way to cut the first launch

96 distinct programs means 96 structurally different graph shapes, **not** 96 different colours:
three already shares a program across materials differing only in values (the desktop probe measured
four `MeshStandardMaterial`s collapsing to two programs). So the town genuinely authors ~96 different
node-graph shapes.

One PBR graph fed by texture arrays or an atlas, varying in *data* rather than *structure*, is how a
town of props normally stays at a handful of programs. Reaching 8,000 ms needs roughly a third fewer
distinct programs.

This decides how the game looks, so it belongs to the game, not to `packages/`. But the framework
could **help**: a diagnostic that names which materials produce distinct programs, and why, would
turn a vague "use fewer materials" into a list.

### 3.3 Put the diagnosis in `threenative doctor` (owner idea)

Every number in this investigation required a bespoke instrumented APK. All of it is available to the
runtime at launch:

- pipeline count, and distinct vertex/fragment program count
- per-pipeline compile time, and the total
- the group split (main / shadow / PMREM / output)
- whether a warm-up ran, what it covered, and what it left to the first frame
- duplicate cache keys, if any

A game whose launch is slow should be able to ask why without anyone writing a probe. The hooks
already exist in `artifacts/prd360-followup/compile-probe/src/instrument.js` and are small: patch
`backend.createRenderPipeline`, `backend.createProgram`, `backend.beginRender`, and the device's
`createRenderPipeline`/`createRenderPipelineAsync`/`createShaderModule`.

### 3.4 Does compile cost track shader size? — one run, currently unmeasured

The attribution "~84 ms per pipeline is the driver's" is untested against shader **size**. The same
scene builds fragment sources from ~800 bytes to **~56 KB** of generated WGSL. If cost tracks size,
the engine's node graph owns part of that 84 ms and a leaner graph is a framework lever after all.

Deciding it: correlate each pipeline's recorded `ms` against its fragment hash length — the census
already captures both.

## 4. Engine defects found on the way, worth fixing regardless of PRD-360

1. **`warmUpScene`'s reported `pipelines` count is wrong in both directions.** It reported 494 where
   the device built 101. `pipelineKey` (`packages/core/src/warmup.ts`) keys on material object
   identity plus a few flags, so it over-discriminates on materials that share a program, and
   under-discriminates by omitting real pipeline inputs — depth/blend state, target formats,
   topology, clipping, detailed geometry layout. A loading bar driven by that number counts
   something other than pipelines. **Fixed direction:** key on the shader-stage identity three
   itself uses, plus backend render state.
2. **The framework warm-up switched itself off silently.** A game with a DOM loading surface never
   sets `canvasLayer.opaque`, so `startupCoverActive()` is false and no warm-up runs — with nothing
   in any log saying so. Fixed in this lane; the marker is now
   `TN_STARTUP_WARMUP:{"skipped":"no-startup-cover","opaque":false}`.
3. **A green warm-up report hid synchronous first-frame work.** `compileAsync` walks the main render
   list only, so the shadow pass and the output conversion were always built inside the first drawn
   frame while the report said `abandoned: 0, timedOut: false`. Fixed in this lane via
   `firstUseRender`; the first drawn frame now builds 0 pipelines instead of 2, pixel-identical.
4. **`compileConcurrency` has a hard ceiling of 2** and callers cannot see it. The host pool runs at
   most two jobs — one on a host with two hardware threads or fewer
   (`packages/runtime-native/src/webgpu/bindings_pipelines.cpp:229`). Anything above 2 only
   lengthens the request queue. Documented on the option in this lane.

## 5. Method notes for whoever picks this up

- **Counts are scene-determined; costs are device-determined.** The pipeline census, the group split
  and the program count can all be taken on desktop. Only per-pipeline milliseconds need the phone.
  That distinction saves a lot of device time.
- **Counts need no thermal qualification window.** Timing claims do.
- **The desktop native host runs the real game bundle.** `pnpm build:desktop` emits
  `.threenative/build/game.js`; copy it beside `dist/` (so assets resolve) and run
  `sh scripts/xvfb.sh packages/runtime-native/build/tn-linux/mystral run <bundle> --frames N`.
  This gives a real Vulkan adapter without a device, and it is how §2's arms were pre-screened.
- **Desktop and device disagreed by 6.5x on the same walk** — object granularity was 2,291 ms on an
  RTX 2080 and did not finish in 15,012 ms on the Pixel. Pre-screen on desktop, but never conclude
  there.
- **Instrument the real game, not a probe scene.** The probe's six-pipeline scene said shadow/output
  coverage was 2 of 6 — 33 %. The real game said 986 ms of 8,513 — 11.6 %, and pointed elsewhere.
- **A second reviewer caught a real over-claim.** "The walk's cost is JS node building, not pipeline
  creation" was not supported by the measurement; it was withdrawn. Worth building that check in.
