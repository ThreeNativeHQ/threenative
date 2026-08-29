# What the host's packed-frame replay is actually made of — 2026-08-28

**Target:** desktop Linux x64, wgpu-native on Vulkan, NVIDIA RTX 2080, `mystral` built from
`build/tn-linux-wgpu-profile` with `-DTN_ANDROID_JS_PROFILE=ON`.
**Scene:** `examples/native-smoke`, `THREENATIVE_JS_PROFILE_MESHES=800`,
`THREENATIVE_JS_PROFILE_MATERIALS=distinct`, 1280×720, Xvfb.
**Sample:** frames 226–899, n=674 per run, medians.

**This is not a phone measurement.** One physical Pixel 8 carries every device number in this
repository and none of them are here. What this lane establishes is the *shape* of
`frameReplay` — which terms exist and how they scale — not its magnitude on a device.

## Why it was measured

[`native-frame-is-cpu-bound-after-the-pixel-budget-2026-08-28.md`](../bugs/native-frame-is-cpu-bound-after-the-pixel-budget-2026-08-28.md)
ranks "take the host replay off the JS critical path" first, worth a predicted −3.9 ms/frame. It
prices the *whole* of `frameReplay` and never says what is inside it. A term that is host
bookkeeping can be deleted in place; a term that is wgpu doing real encoding work can only be
moved. Nothing distinguished the two.

## The instrument

`ProfiledRenderCommand` timed nine per-draw commands and left the replay's own boundary work
untimed, so `frameOpReplayNs` had a remainder nothing accounted for — 0.247 ms of 1.363 ms, 18 %.
`BeginRenderPass`, `Submit` and `DevicePoll` close it. After the change the timed sum slightly
*exceeds* `frameOpReplayNs` (1.355 vs 1.173 ms), which is the instrument's own cost: two
`steady_clock` reads per timed op across ~1,500 ops a frame. Read the per-op columns as a
decomposition of the shape, not as a budget that must sum to the total.

## The decomposition

802 draw candidates (the projection declined to batch: `"projecting would draw 802 of 802
candidates, which is not worth its own cost"`), 4 render passes, 4 submit operations.

| op | calls | ms/frame | ns/call | share |
| --- | ---: | ---: | ---: | ---: |
| `endRenderPass` | 4 | **0.623** | 155,844 | 53 % |
| `submit` (`wgpuQueueSubmit`) | 4 | **0.378** | 94,493 | 32 % |
| `setBindGroup` | 739 | 0.288 | 389 | 25 % |
| `drawIndexed` | 733 | 0.028 | 39 | 2 % |
| `beginRenderPass` | 4 | 0.007 | 1,776 | <1 % |
| `setPipeline` | 4 | 0.004 | 1,031 | <1 % |
| `setVertexBuffer` | 7 | 0.003 | 486 | <1 % |
| `setIndexBuffer` | 5 | 0.003 | 522 | <1 % |
| `writeBuffer` | 3 | 0.002 | 825 | <1 % |
| `devicePoll` | 4 | 0.001 | 271 | <1 % |
| **`frameOpReplayNs`** | | **1.166** | | |

**`endRenderPass` and `submit` are 85 % of replay across four calls each. The 1,472 per-draw
calls between them cost 0.316 ms.** wgpu records draws cheaply and does the real work — barrier
and state resolution, backend command-buffer construction — at pass end and at submit.

Two consequences, both immediate:

- **There is no host-bookkeeping term to delete.** Registry lookups, the packed-stream parser,
  the per-record padding check and the six per-frame `unordered_map`s are inside the 15 % that
  is everything other than the two dominant terms. Micro-optimising the replay loop cannot
  reach 3.9 ms, or 1 ms.
- **`devicePoll` after every submit is 271 ns.** It reads like redundant work — `endDawnFrame`
  polls once more per frame anyway — and it is worth 0.001 ms. Priced and dropped.

## The per-pass floor, and the lever it killed

A second arm with `MATERIALS=shared` collapses the same 800 meshes into 4 `drawIndexed` while
keeping 4 passes and 4 submits:

| arm | `drawIndexed` | `endRenderPass` ns/call | `submit` ns/call | replay ms |
| --- | ---: | ---: | ---: | ---: |
| shared, low draw | 4 | 37,875 | 84,942 | 0.327 |
| distinct, high draw | 733 | 155,844 | 94,493 | 1.166 |

Fitted across the two points, `endRenderPass` reads as ~37 µs per pass plus ~632 ns per draw, and
`submit` as ~85 µs plus ~69 ns per draw. **The 85 µs term was read as a fixed per-call cost, and
that reading was wrong.** It was tested rather than trusted.

**Pre-registered:** if the ~85 µs is charged per `wgpuQueueSubmit` call, coalescing a frame's
submit operations into one call saves it once per coalesced submit. A probe counted how many of
the 4 submits per frame are separated by an operation the queue can observe (`writeBuffer`,
`writeTexture`, `copyExternalImageToTexture`, and the two destroys): **4 submits collapse to 2
safe runs in 2,855 of 2,865 frames.** Predicted saving 2 × 85 µs ≈ 0.17 ms/frame.

**Implemented, measured, and refuted.** Replay was changed to accumulate command buffers and
issue one `wgpuQueueSubmit` per run, closing the batch before any queue-visible operation, with
the `frame_op_stream_replay_test` contract extended to assert the coalescing (red first, then
green). Interleaved control/candidate pairs, `measure-desktop-frame-pair.mjs`, 3 runs per arm:

| arm | queue submissions | `submit` ns/call | `submit` ms/frame | replay ms |
| --- | ---: | ---: | ---: | ---: |
| control run 2 | 4 | 94,493 | 0.378 | 1.166 |
| candidate run 2 | **2** | **188,634** | 0.377 | 1.213 |
| control run 3 | 4 | 98,453 | 0.394 | 1.208 |
| candidate run 3 | **2** | **180,693** | 0.361 | 1.112 |

The call count halved exactly as designed and **the per-call cost doubled, leaving the total
flat.** `wgpuQueueSubmit` is proportional to the command buffers handed to it; its apparent
fixed term is per-pass baking, not per-call overhead. The change was reverted — it buys nothing
and it lets a queue-visible write be reordered ahead of a pass if the guard is ever wrong.

The whole-frame `workNs` medians moved 6.076 → 5.891 ms, which looks like a win and is not one:
the candidate's own two runs read 6.291 and 5.491 ms, a spread four times the difference being
claimed. **At n=2 eligible runs per arm this lane cannot resolve 0.2 ms.** Any future arm here
needs more runs per arm than the difference it wants to claim.

## The model this leaves

Both dominant terms have a per-pass floor and a per-draw slope:

```text
replay ≈ passes × ~120 us  +  draws × ~0.7 us
       ≈ 4      × 120 us   +  733   × 0.7 us
       ≈ 0.48 ms           +  0.51 ms        = 0.99 ms   (observed end+submit: 1.00 ms)
```

At this scale **a pass costs what ~170 draws cost.** The bug doc's lever 2 prices a walked
candidate by dividing the fixed frame cost by the candidate count (7.15–22.2 µs); this lane
measures the replay half of that directly at ~0.7 µs of host CPU per draw, and adds a term that
arithmetic missed entirely — the count of render passes. Bayview's dynamic shadow map is a
whole pass.

## What it means for lever 1

The lever survives, and its reasoning is now evidence rather than inference: 85 % of
`frameReplay` is wgpu encoding work that has to happen on some thread, so it can be **moved but
not deleted**, which is exactly what "take the host replay off the JS critical path" proposes.

One constraint any overlap arm has to solve, recorded here so it is not discovered late.
`replayPackedFrameOpStream` reads `bufferRegistry`, `textureRegistry`, `textureViewRegistry`,
`renderPipelineRegistry`, `bindGroupRegistry`, `computePipelineRegistry`, `querySetRegistry` and
`renderBundleRegistry`, mutates `uploadStaging`, `currentTexture`/`currentTextureView`/
`surfaceRenderEncoder`/`surfaceRenderPassEnded`, and calls `state->engine->throwException` on
failure. Every one of those is written by JS binding calls on the main thread. Replaying frame N
on a worker while frame N+1's JavaScript runs is a data race on all of them, and reporting a
replay failure into V8 from a non-JS thread is not allowed at all. The surface adds a second
constraint: a swapchain image cannot be acquired for frame N+1 before frame N has presented, so
the overlap cannot simply be "replay N while JS runs N+1" without moving surface acquisition.

## Reproducing

```sh
cmake -S packages/runtime-native -B packages/runtime-native/build/tn-linux-wgpu-profile -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DMYSTRAL_USE_V8=ON -DMYSTRAL_USE_WGPU=ON -DMYSTRAL_USE_DAWN=OFF \
  -DTN_ANDROID_JS_PROFILE=ON
cmake --build packages/runtime-native/build/tn-linux-wgpu-profile --target mystral --parallel

THREENATIVE_JS_PROFILE_MESHES=800 THREENATIVE_JS_PROFILE_FRAME_WINDOW=900 \
THREENATIVE_JS_PROFILE_MATERIALS=distinct THREENATIVE_NATIVE_BACKEND=enabled \
  pnpm --filter threenative-native-smoke build

sh scripts/xvfb.sh env SDL_VIDEODRIVER=x11 \
  packages/runtime-native/build/tn-linux-wgpu-profile/mystral \
  run examples/native-smoke/dist/native-smoke.js --width 1280 --height 720
```

`mystral-tools` does not link in this configuration — `libswc.a` and `libwgpu_native.a` each
carry a Rust `std`, and they collide on `rust_eh_personality`. It fails the same way before any
change here and `mystral` itself links; the Dawn preset (`tn-linux`), which is where the
`frame_op_stream_replay_test` contract builds, is unaffected.
