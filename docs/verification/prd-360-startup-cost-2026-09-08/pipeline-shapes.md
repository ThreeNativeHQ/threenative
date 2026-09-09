# PRD-360 — is 101 pipelines the right number?

The last question left after [every warm-up shape lost](compile-concurrency.md): the launch spends
8,513 ms creating 101 pipelines, and scheduling cannot move that. So is 101 the honest count, or is
the framework manufacturing pipelines out of render-state permutations it could collapse?

Measured on a physical Pixel 8, one cold launch, using the probe's backend hooks as a temporary
plugin, grouping every created pipeline by the hash of its **vertex and fragment WGSL text** and by
the render state it was baked against.

```
TN_PRD360_SHAPES:{"pipelines":101,"distinctPrograms":96,
                  "programsUsedMoreThanOnce":5,"pipelinesFromReusedPrograms":10,
                  "statesPerReusedProgram":{ …all 1… }}
```

**101 pipelines come from 96 distinct shader programs.** Five programs are used twice — ten
pipelines between them — and each of those five sees exactly one render state, so even the small
amount of reuse is not a state permutation the framework could fold away. There is nothing to
deduplicate.

The count is a faithful reflection of how many genuinely different shaders this game authors. It is
an authoring quantity, not a framework artefact.

## What that settles

The launch cost decomposes with nothing left over for the framework to take:

```
8,513 ms  =  96 distinct shader programs → 101 pipelines  ×  ~84 ms of Mali compile each
```

- **Scheduling cannot help** — three shapes measured, all slower than not warming up at all, and a
  warm-up creates the same pipelines so it can only relocate the stall.
- **Deduplication cannot help** — 96 of 101 pipelines are unique programs.
- **A persistent pipeline cache is unavailable** — the pinned wgpu-native exposes no cache-creation
  entry point (`packages/runtime-native/third_party/wgpu/include/webgpu/wgpu.h:217` is a report
  field).
- **What is left is the game's material count and the driver's per-pipeline cost.** Both are
  outside `packages/`: how many distinct materials Bayview's town needs decides how it looks, and
  ~84 ms per pipeline belongs to Mali.

## Status of the eight-second criterion

Unmet, and now shown to be gated by two things the framework does not own. Reaching 8,000 ms from
the measured ~10.9 s to a playable world needs roughly a third fewer distinct shader programs, which
is an authoring decision about the game's appearance.

This is a finding, not a completion. Recorded here so the next lane does not re-run the three
rejected levers.

## Left unmeasured, and filed rather than assumed

Compile cost was never tested against **shader size**. The programs this scene builds vary enormously
— the census recorded fragment sources from ~800 bytes to **~56 KB** of generated WGSL. If the
~84 ms per pipeline tracks that size, then the engine's node graph owns part of the number attributed
above to the driver, and a leaner graph would be a framework-side lever after all.

Deciding it is one instrumented run: correlate each pipeline's recorded `ms` against its fragment
hash length, which the census already captures. Nothing in this investigation depends on the answer,
but the attribution "the per-pipeline cost is the driver's" is only safe until someone checks.

## The standard techniques, and which are actually open

Asked plainly — what do games do about this? — the answer reopens one line this record had closed.

1. **A persistent pipeline cache. This is the industry-standard fix**, and the biggest lever here:
   Vulkan `VkPipelineCache`, D3D12 PSO libraries, Metal binary archives. Compile once, serialize,
   and every launch after the first is nearly free. It would take this 8,513 ms to roughly zero on
   launches 2..n.

   This record earlier called it "closed" because the **pinned** wgpu-native exposes no
   cache-creation entry point. That was too quick. Vulkan supports it, `wgpu` exposes
   `PipelineCache`, and this project owns its C++ host — so the wall is a dependency version, not
   the hardware. **Reopening it is a wgpu-native bump plus host plumbing, and it is the highest-value
   remaining work on this launch.**

2. **Uber-shader plus material instancing.** 96 distinct programs means 96 structurally different
   graph shapes, not 96 different colours — three already shares a program across materials that
   differ only in values (the desktop probe measured four `MeshStandardMaterial`s collapsing to two
   programs). One PBR graph fed by texture arrays or an atlas, varying in data rather than in
   structure, is the standard way a town of props stays at a handful of programs. Game-side work.

3. **Compiling behind a real loading screen** is relocation only; this investigation measured that
   it does not reduce total time, and it needs an opaque cover the game does not currently declare.

4. **Baking shaders at build time** is awkward here because three generates WGSL from node graphs at
   runtime.

## Follow-up worth doing (owner idea, 2026-09-08)

Fold this diagnosis into `threenative doctor`: pipeline count, distinct shader programs, per-pipeline
compile cost, whether a warm-up ran and what it covered. Every number above took a bespoke
instrumented APK to obtain, and all of it is available to the runtime at launch. A game whose launch
is slow should be able to ask why without anyone writing a probe.
