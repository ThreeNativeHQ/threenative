# Native offscreen screenshot — `61-offscreen-screenshot` (2026-08-29)

Desktop conformance row `61-offscreen-screenshot` failed on native while the same scene passed in
the browser. This is the record of the reproduction, the layer call, the fix and the proofs.

## Layer

**Engine bug, `packages/runtime-native/`.** Not the scene, and not `@threenative/core`.

The scene does what upstream Three.js does — `renderer.readRenderTargetPixelsAsync()` — and the
browser runs it unchanged. What differs on native is the host's frame recorder: the production
WebGPU path installs a JavaScript recorder (`src/runtime-scripts/frame-op-stream.js`) that packs a
frame's GPU commands into one buffer and replays them in C++ at the frame boundary, so **the game's
`queue.submit` is recorded, not executed**. `buffer.mapAsync`, by contrast, was never recorded: it
went straight to the native binding and mapped immediately.

That is a real WebGPU violation, not a scene mistake. `mapAsync` is a synchronization point with
the queue — the map completes only after the work already submitted — and the host was completing
it over work still sitting in the recorder.

## The red

```
TN_RUNTIME=$PWD/packages/runtime-native/build/tn-linux/mystral sh scripts/xvfb.sh \
  node packages/runtime-native/conformance/run-conformance.mjs --target desktop \
  --reference $PWD/packages/runtime-native/.runtime/parity-2026-08-29-web \
  --out $PWD/packages/runtime-native/.runtime/parity-2026-08-29-desktop/report.json
```

`{"pass": 70, "fail": 2, "blocked": 2}`. Row `61-offscreen-screenshot`, `completed: false`,
`exitCode: 1`:

```
[WebGPU] Device error (Validation): [Buffer (unlabeled)] used in submit while mapped.
 - While calling [Queue].Submit([[CommandBuffer]])
[Screenshot] No rendered frame available yet
Error: Failed to save screenshot!
```

and, in the same row's recorded stdout, the scene's own assertion firing first:

```
[error] [ThreeNative conformance] failed: Error: offscreen screenshot is a single color
    at assertOffscreenPixels (.../61-offscreen-screenshot.js:78291:3)
```

Both symptoms are the same cause. Three's `WebGPUTextureUtils.copyTextureToBuffer` runs

1. `device.createBuffer(...)` — real, immediate,
2. `encoder.copyTextureToBuffer(...)` — recorded,
3. `submit(device, encoder.finish())` — recorded,
4. `await readBuffer.mapAsync(GPUMapMode.READ)` — **executed immediately**,
5. `readBuffer.getMappedRange().slice()` — reads a buffer the GPU never wrote: all zeros, hence
   "single color",
6. `readBuffer.destroy()` — recorded, so the buffer is still mapped at the frame boundary, where
   the deferred submit finally runs and the validation error fires.

## The reproduction

A native contract test, no display required, added to the existing frame-op-stream contract:
`packages/runtime-native/tests/frame_op_stream_replay_test.cpp`. It writes `[5,6,7,8]`, copies it
buffer-to-buffer, submits, and maps — all inside one `requestAnimationFrame` callback, the shape
three.js uses — then destroys rather than unmaps, exactly as three does.

Red, before the fix:

```
[WebGPU] Device error (Validation): [Buffer (unlabeled)] used in submit while mapped.
 - While calling [Queue].Submit([[CommandBuffer]])

FAIL: mapAsync sees work submitted earlier in the same frame: [0,0,0,0]
FAIL: mapAsync drains the recorded stream in its own crossing, ahead of the frame's
observed same-frame tail order: writeBuffer createCommandEncoder copyBufferToBuffer finish submit buffer.destroy
FAIL: the copy and its submit left at mapAsync, leaving only the deferred destroy
3 frame op stream assertion(s) failed
```

The same validation string the conformance row produced, from a headless binary.

## The fix

`buffer.mapAsync` flushes the recorded stream before it maps.

- `src/runtime-scripts/frame-op-stream.js` now tracks `openObjects` — command encoders, passes, and
  finished-but-unsubmitted command buffers — and remembers `safeCursor`/`safeOpCount`, the last byte
  where that count was zero. The drain closure takes a `partial` argument: passed, it emits only the
  bytes up to that cut and moves the still-recording tail into a buffer of its own (the host reads
  the buffer it was handed *after* the call returns, so those bytes must not move). The frame
  boundary passes nothing and drains everything, byte-for-byte as before.
- `src/webgpu/bindings_frame_stream.{h,cpp}` gains `flushRecordedFrameOps(state)`: call the drain
  with `partial`, replay what comes back, count the crossing, and fail closed the way the frame
  boundary does.
- `src/webgpu/bindings_resources.cpp` calls it as the first statement of
  `handleGpuBufferMapAsync` — before the registry lookup, because the replay can retire a deferred
  `buffer.destroy()` and invalidate the iterator.
- `src/webgpu/bindings_state.h` carries the re-entrancy flag.

Cutting at the last clean boundary is what keeps the fix safe for every other scene. The C++ replay
fails closed on `frame ended with unfinished GPU objects`, so a flush in the middle of a
half-recorded encoder would turn a working frame into a hard error; the cut is placed before that
encoder was created, and the tail drains whole at the frame boundary. A second contract case proves
exactly that: it maps with a render pass open and asserts the tail replays
`createCommandEncoder beginRenderPass render.end finish submit` intact.

## The green

Contract test, `packages/runtime-native/build/tn-linux/threenative-frame-op-stream-replay-test`:

```
frame op stream replay contract passed
exit=0
```

(The three `Frame op stream replay failed: …` lines in its output are the file's own fail-closed
negative controls for malformed streams, and are expected.)

Whole native contract suite, `ctest` in `packages/runtime-native/build/tn-linux`:

```
100% tests passed out of 30
```

Recorder unit tests, `packages/runtime-native/tests/frame-op-stream.test.mjs` — two cases added for
the partial drain and the split around an open encoder:

```
Test Files  1 passed (1)
     Tests  10 passed (10)
```

Row 61 alone, on the rebuilt host:

```
{"target": "desktop", "mode": "execution",
 "summary": {"pass": 1, "fail": 0, "blocked": 73, "planned": 0, "validated": 0}}
```

Package test suite, `pnpm exec vitest run --config vitest.config.ts` in
`packages/runtime-native`:

```
Test Files  87 passed (87)
     Tests  627 passed | 33 skipped (660)
```

Full desktop conformance, the same command as the red:

```
{"target": "desktop", "mode": "execution",
 "summary": {"pass": 71, "fail": 1, "blocked": 2, "planned": 0, "validated": 0}}
```

70 → 71 pass, 2 → 1 fail. Row `61-offscreen-screenshot` now reads

```
"61-offscreen-screenshot" pass  completed=True exit=0
  pixelMismatchRatio 0.00724 (tolerance 0.01)
  perceptualDeltaE   0.00400 (tolerance 3)
  gpuValidationErrors []
```

— a real pixel comparison against the browser reference, not merely a run that stopped erroring.
The two blocked rows (`90-multitouch-input`, `99-scroll-input`) are blocked on this target before
and after, and the one remaining failure is `25-camera-parented-overlay`, below.

## Revert check

Delete the `if (!flushRecordedFrameOps(state))` guard at the top of `handleGpuBufferMapAsync`
(`src/webgpu/bindings_resources.cpp`) — the three lines that are the whole fix on the C++ side —
rebuild `threenative-frame-op-stream-replay-test`, and the red returns verbatim, now on both
contract cases:

```
[WebGPU] Device error (Validation): [Buffer (unlabeled)] used in submit while mapped.
FAIL: mapAsync sees work submitted earlier in the same frame: [0,0,0,0]
FAIL: mapAsync drains the recorded stream in its own crossing, ahead of the frame's
observed same-frame tail order: writeBuffer createCommandEncoder copyBufferToBuffer finish submit buffer.destroy
FAIL: the copy and its submit left at mapAsync, leaving only the deferred destroy
FAIL: mapAsync flushes the submitted copy while an encoder is still open: [0,0,0,0]
observed split tail order: writeBuffer createCommandEncoder copyBufferToBuffer finish submit createCommandEncoder beginRenderPass render.end finish submit
FAIL: the half-recorded encoder stayed behind and drained whole at the frame boundary
5 frame op stream assertion(s) failed
```

Restoring the three lines and rebuilding returns exit 0.

## Still open: `25-camera-parented-overlay`

Investigated and **not the same root cause**. That row completes (`exitCode: 0`, screenshot written)
and fails on comparison, with a different validation family:

```
[WebGPU] Device error (Validation): The depth stencil attachment [TextureView of Texture
(unlabeled 1024x768 px, TextureFormat::Depth24Plus)] size (width: 1024, height: 768) does not match
the size of the other attachments' base plane (width: 1280, height: 720).
```

The scene walks four viewports; on each `setSize` the depth attachment is recreated at the new size
while the colour attachment is still the 1280x720 surface texture. That is a surface
reconfiguration ordering question, unrelated to buffer mapping or to the frame op stream, and is
left for its own lane.
