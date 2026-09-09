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
