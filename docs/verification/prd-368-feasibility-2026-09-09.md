# PRD-368 feasibility — native pipeline-cache C API

Status: **BLOCKED before Phase 1 implementation**. The supported wgpu-native
artifacts available to this repository do not expose the C API needed to create,
serialize, attach, or read a pipeline cache.

## Layer and subject

This is an engine-layer investigation. Persistent backend compiler data belongs to
the native host; a game cannot implement it portably. The repository pins
wgpu-native `v25.0.2.2` in
`packages/runtime-native/scripts/download-deps.mjs:55`, and Android uses that
backend. The existing Dawn desktop headers are a separate backend and do not make
the Android path feasible.

The manifest search ran before any package or source authoring for this slice:
`engine_search_capabilities("native WebGPU persistent pipeline cache: create
serialize and reuse compiled render pipeline data across process relaunches")`.
It returned only unrelated asset, playtest, UI, and render-advisor capabilities;
no existing cache capability was reused or added.

## Exact evidence

The pinned v25 header contains `WGPUHubReport.pipelineCaches` as a registry report
field, but no `WGPUNativeFeature_PipelineCache`, cache descriptor, or cache C
functions:

```text
packages/runtime-native/third_party/wgpu/include/webgpu/wgpu.h:217:
    WGPURegistryReport pipelineCaches;
```

The pinned release binary identifies itself as `25.0.2.2` through the exported
`wgpuGetVersion` function:

```text
wgpuGetVersion() = 419430914
decoded version = 25.0.2.2
```

Its exported pipeline surface contains `wgpuDeviceCreateRenderPipeline` and
`wgpuDeviceCreateRenderPipelineAsync`, but no
`wgpuDeviceCreatePipelineCache`, `wgpuPipelineCacheGetData`, or
`wgpuPipelineCacheRelease` symbol.

The latest official release checked was `v29.0.1.1`. Its header adds only the
Vulkan-only feature enum (`WGPUNativeFeature_PipelineCache`, header line 601);
there is still no cache descriptor or cache C function in the header. The exact
Android arm64 release and the Linux x64 release both lack the cache symbols:

```text
Android arm64: wgpuDeviceCreateRenderPipeline
               wgpuDeviceCreateRenderPipelineAsync
               wgpuGetVersion
Linux x64:     wgpuDeviceCreateRenderPipeline
               wgpuDeviceCreateRenderPipelineAsync
               wgpuGetVersion
wgpuGetVersion() on Linux x64 = 486539521
decoded version = 29.0.1.1
```

The deliberate negative control links a program that references the required C
entry point against the v29 Linux release:

```text
/usr/bin/ld: ... undefined reference to `wgpuDeviceCreatePipelineCache'
collect2: error: ld returned 1 exit status
link_exit=1
```

The positive version probes passed, so this result is an API boundary finding,
not a missing compiler, archive, or architecture issue. The official release
headers and artifacts are the primary source for the v29 check:
<https://github.com/gfx-rs/wgpu-native/releases/tag/v29.0.1.1>.

## Decision and handoff

Do not bump the dependency or add a private C declaration: the shipped binary
does not implement the symbol. Reaching the underlying Rust pipeline-cache
implementation would require an owned wgpu-native C-API extension or fork, which
PRD-368 explicitly requires revising before introducing. No cache lifecycle,
storage, or pipeline attachment code was authored, and no cache hit is claimed.

Continue with the independent PRD-196 installation slice. Revisit PRD-368 only
after a supported release exposes and executes the required C API on the target
backend; browser caching remains browser-owned.

## Re-verification 2026-09-10

Latest upstream wgpu-native release is still `v29.0.1.1` (2026-06-23) — no newer
release since the probe above. Vendored `libwgpu_native.so` (desktop and Android
arm64) exports zero `pipelinecache` symbols; only `CreateRenderPipeline`,
`CreateRenderPipelineAsync`, `GetVersion`. Dawn headers expose only the internal
`WGPUDawnCacheDeviceDescriptor` BlobCache seam, unwired in `context.cpp`, and the
Android product default is wgpu-native regardless. **Still BLOCKED; no Phase 1
implementation started.**

## Superseded by the bounded owner route — 2026-09-10

The binary finding above remains true for the unpatched pinned releases: they export no
pipeline-cache C symbols, and the upstream-only route stays blocked. The owner-approved
follow-up instead applies a bounded four-file patch to the pinned wgpu-native source. Its
desktop Linux/Vulkan probe compiled and completed a three-process cache round trip; the
[revised PRD](../PRDs/assets/PRD-368-compiled-pipelines-survive-a-relaunch.md) now owns that
route and remains **PARTIAL**.

The [canonical prototype record](runtime-perf-state.md#prd-368-bounded-cache-api-prototype--2026-09-09)
and its [round-trip receipt](startup-measure-reduce-2026-09-09/pipeline-cache-spike/receipt.json)
show strict reload and byte-identical readback on the synthetic desktop probe. This does not
prove production host persistence, actual Bayview reuse, Android support, or a startup saving;
the disabled control was faster than the loaded control. The prior conclusion is therefore
superseded as a decision to wait for upstream, while its unpatched-symbol observation remains
the baseline for the owned patch route.
