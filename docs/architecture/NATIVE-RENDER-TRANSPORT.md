# The native render transport

**How the frame gets from three.js to the GPU on native, what is built, and the one rule it must not
break.** Budget and priorities live in
[NATIVE-PERF-BOTTLENECKS](NATIVE-PERF-BOTTLENECKS.md); this page is the design.

**Status, 2026-08-28.** The op stream ([PRD-227](../PRDs/PRD-227-the-frame-crosses-once.md) Change 1)
is working-tree code with no verification record. **Nothing here is evidence until gate P1 lands.**

## What is built

```mermaid
flowchart TD
  A["three.js<br/>unchanged, upstream WebGPURenderer"] -->|"hot encoder and queue methods<br/>are JavaScript appenders"| R["frame-op-stream.js<br/>one packed ArrayBuffer per frame<br/>ids, not pointers"]
  R -->|"one drain per frame<br/>endDawnFrame"| C["replayPackedFrameOpStream<br/>bindings.cpp — reads bytes,<br/>calls wgpu directly"]
  C --> W["wgpu-native / Dawn"] --> G["GPU"]
```

- **The appenders are JavaScript** — the condition that decides whether any of this is real. If they
  were native functions writing into a buffer, every crossing would still be there and the win would
  be imaginary. `device.createCommandEncoder`, every render- and compute-pass method, the four
  copies, `clearBuffer` and all `queue` entry points (`writeBuffer`, `writeTexture`,
  `copyExternalImageToTexture`, `submit`) write little-endian records into one growing `ArrayBuffer`
  (magic `0x544e4652`, version 1).
- **Resource creation still crosses per call.** Anything returning a value three.js needs
  immediately stays a conventional native call; only steady-state per-frame commands are recorded.
- **Handles, not pointers.** `_bufferId`, `_bindGroupId`, `_pipelineId`, `_textureId`,
  `_textureViewId`, `_renderBundleId`, `__tnCommandBufferId`, each resolved through a registry in
  `BindingsState` and erased on release. An unknown id throws.
- **Fail-closed by construction.** Bad magic, version or declared length; a malformed record header;
  non-zero padding; an operation-count census mismatch; or a frame ending with unfinished GPU
  objects all throw, and the replay releases what it created. The failure mode this repository
  exists to avoid — a frame that renders almost correctly and reports success — is held by the
  format, not by review.
- **Uploads are eager-copied** at record time. The replay test's negative control mutates the source
  array after `writeBuffer` and asserts the recorded bytes survived.
- **One crossing per frame.** The drain runs in `endDawnFrame` after all rAF callbacks and before
  `clearFrameHandles` (`src/runtime.cpp`), while descriptors and upload payloads are still live.
  `frameOpStreamDirectCommandCalls` counts steady-state commands that bypassed the stream; the
  replay contract test asserts zero.

## What is not built

- **Change 2 — fixed-shape wrappers** (`ObjectTemplate` + internal fields, predicted −8.9 ms on
  device). Not started, and where the cross-engine risk concentrates: the recorder is
  engine-agnostic JavaScript, but `ObjectTemplate` is a V8 API, so the QuickJS and JSC lanes must be
  **exercised, not compile-checked**. Change 1 and Change 2 are predicted to be worth ~nothing
  apart, which is why PRD-227 refuses to ship half.
- **A native render thread.** JS recording frame N+1 while a native thread submits frame N. The
  whole frame is on the JavaScript thread and the GPU is idle, so there is nothing on the critical
  path to move off it yet. The thread model is an owed **correctness** gate (`Worker` is a
  main-thread polyfill) — build it because it is owed, not because it is fast.
- **AOT compilation** (`shermes`). The one idea that would stop iOS's no-JIT rule being the binding
  constraint. Unmeasured; a feasibility spike.

## The line that must not move

A replay of what it was told is a **transport**. The moment it starts deciding what to draw —
culling, LOD selection, visibility — it is a custom C++ renderer with its own semantics, and a scene
that renders differently on native than in the browser is a fork **no gate in this repository would
catch**. That is why GPU-driven culling, however attractive the frame times, belongs upstream in
three.js rather than here. The current replay executes what was recorded and decides nothing.

## Layer verdicts

The original 2026-08-10 sketch — three.js on top, a JS shim, a command stream, a JS runtime, a
render thread — was reviewed layer by layer and declined. It was reactivated in part on 2026-08-27.

| Layer | Verdict | Why |
|---|---|---|
| Normal three.js code on top | **Agree, permanently** | Not a layer to build; the constraint every other layer must survive |
| Upstream `WebGPURenderer`, unmodified | **Agree** | Already true, and the reason a shim is possible at all: the object three.js gets from `beginRenderPass()` is already ours |
| Pure-JS WebGPU shim | **Built** | Declined in 2026-08 as worth ~0.5 ms; reinstated when the seam was measured whole |
| Command stream / arena | **Built** | The physics precedent was always real — `step()` and `readVisibleTransforms(Float32Array)`, one coarse crossing per frame. Rendering was the outlier |
| JS runtime (V8 · Hermes · AOT) | **Not a layer** | A variable the stack is measured *against*. Swapping QuickJS for V8 was the single largest win in this document and cost one build flag |
| Native render thread | **Disagree, for now** | Cannot start before the arena exists, and there is no work off the critical path to hide. An owed correctness gate, not a perf lever |
| Dawn / wgpu-native → GPU | **Agree, trivially** | Idle on every subject measured |

**Why the verdicts on rows 3 and 4 flipped.** They were declined on PRD-068 §1.2's ~2% — an
instrument that timed only the *interiors* of six native handlers. The trampoline, the per-crossing
V8 API scaffolding, the allocator churn and the megamorphic inline caches three.js pays for our
dynamically-shaped wrappers all sat outside it. Measured whole, the seam is 22.3 ms of the Pixel 8's
37.7 ms frame. The design was right and the price was wrong.

## What a transport still cannot fix

**Per-object JavaScript work in three.js** — render-list build and sort, node and binding refresh,
matrix updates, frustum culling. No box in any transport diagram touches it. The two levers that do
are unglamorous: **submit fewer objects** (instancing, merged geometry, LOD, all in the game's own
`src/render/`, plus `SceneRenderProjection` mirroring an authored scene into instanced draws), or
**run the same JavaScript on a faster engine**, which is already spent.

**The draw-count knee** — the ~20 ms step between 500 and 1,000 draws — is also untouched by a
transport aimed at the linear term, and still has no named mechanism.

## Where each piece lives

| Piece | Home |
|---|---|
| Recorder | `packages/runtime-native/src/runtime-scripts/frame-op-stream.js`, installed at `requestDevice` |
| Replay | `replayPackedFrameOpStream` in `packages/runtime-native/src/webgpu/bindings.cpp` |
| Handle registries | `packages/runtime-native/src/webgpu/bindings_state.h` |
| Desktop pair harness | `packages/runtime-native/scripts/measure-desktop-frame-pair.mjs` |
| Instancing, merged geometry, LOD | the game's `src/render/` — always. Deciding what a scene contains is the user's |
| Engine choice, AOT spike | `packages/runtime-native/src/js/` |
| "What is slow in this scene" | the playtest `diagnostics` surface. It reports; it never rewrites a scene |

## Status of every claim here

**Measured:** the desktop ablation split and its 0.09 ms cross-check, the 5,713-crossing /
15,005-argument frame, the 22.3 ms device seam, Chrome's 59.99 fps on the same phone, the draw-count
knee, and the GPU sitting idle on every subject run.

**Built but unverified:** the op stream. Gate P1 has no record, so no prediction above is claimed as
met.

**Not measured:** what the remaining JavaScript term is made of, the knee's mechanism, cold start
under V8, and what a crossing costs on a varied-material scene.

**No claim here applies to iOS.** No Apple hardware is attached to this repository and the hosted
runner produces simulator-class evidence only.
