# WebGPU binding tables are installed per call, not per class — 2026-08-26

**Status: step 1 of the staged plan executed and measured on 2026-08-26 — `GPUCommandEncoder`
converted to a one-time per-class table. `createCommandEncoder` fell from 78,835 ns (red, this
machine) to ~3,820 ns across two runs; Chrome's rate is 919 ns. Steps 2–5 of widening remain
open below.**

Update 2026-08-26 (execution):

1. **Engine contract added** (`include/mystral/js/engine.h`): `NativeMethod` (a callback that
   receives the receiver's `setPrivateData` pointer), plus `supportsNativeMethods()`,
   `newMethod()`, `setPrototypeOf()` as gated virtuals whose defaults refuse. All three engines
   implement them: V8's trampoline resolves the receiver's private symbol
   (`v8_engine.cpp`), QuickJS reads `this_val` through its private-data map, JSC through
   `thisObject`; each mirrors its plain-callback lifecycle exactly.
2. **GPUCommandEncoder installs once** (`bindings.cpp`): `ensureCommandEncoderClassTable()`
   builds a shared prototype on first encoder creation and runs all eight method rows through the
   SAME transactional `installBindingTable` — snapshot/verify/rollback guarantees now execute once
   per class instead of per instance. Rows for `beginRenderPass`/`finish` install prebuilt
   receiver-aware functions (`prebuiltFunction` lane added to `BindingRegistration`); the other
   six never depended on the instance (they resolve `state->jsCommandEncoder` today). Instances
   get `newObject` + `setPrivateData` + `setPrototypeOf`. Engines reporting no method support fall
   back to the untouched legacy per-call path behind the same entry point — the revert is one
   commit.
3. **Direct measurement (step 2 of the plan)** — `gpubench.js`, native host vs this machine's
   recorded Chrome arm:

   | Call | Red (before) | Green (after, run 1) | Green (run 2) | Chrome |
   | --- | ---: | ---: | ---: | ---: |
   | `createCommandEncoder` | **78,835 ns** | **3,832 ns** | **3,814 ns** | 919 ns |
   | `queue.writeBuffer` (16 B) | 3,249 ns | 2,830 ns | 2,900 ns | 431 ns |
   | `buffer.size` — control | 11 ns | 11 ns | 12 ns | 21 ns |

   The falsifier is answered: the cost was binding installation, not object construction. The
   residual gap to Chrome (~4.2×) now sits in `newObject` + private-data write +
   prototype re-pointing + the wgpu-native creation call itself — a different, much smaller seam.

4. **Verification run**: engine-level contract executable
   `threenative-command-encoder-class-table-test` (added) proves shared-prototype dispatch,
   per-instance receiver resolution, detached-call null reporting and instance isolation;
   `threenative-js-engine-contract-test`, `threenative-webgpu-bindings-reentrancy-test`,
   `threenative-shader-module-metadata-test` stay green; `webgpu-bindings-contract.test.mjs`
   remains red ONLY at the documented HEAD slice failure ("all migrated WebGPU registration
   families…"), which predates this work and was left alone as instructed.

5. **Frame-level smoke (step 3, smoke tier)** — `verify-desktop-core.mjs`: 300 frames rendered
   through the real three.js loop (`beginRenderPass`/`finish` dispatch through the new
   receiver-aware methods every frame), 300 presents, non-blank screenshot
   (`artifacts/desktop-core-2026-08-26.png`). First invocation reported 299/300 presents
   (first-frame Xvfb warm-up); the re-run was clean, so treat a single missed present as a lane
   flake until it reproduces. The measured desktop A/B against the recorded 22.2 ms pair is still
   owed on a quiet machine before any widening claim.

Not yet executed: the measured desktop A/B pair on THIS build, widening to
`GPURenderPassEncoder`, the remaining classes, and the device arm. QuickJS/JSC implementations
are compile-checked only by symmetry with their existing patterns — the QuickJS preset and iOS
lanes did not run here.

Every WebGPU object the native host hands to JavaScript has its methods installed **on that
instance, on every call that creates it**, through the same transactional machinery designed for
one-time binding installation. At roughly 3,214 binding crossings per frame this is the single
largest identified term in a render phase that costs 22 ms where Chrome's costs 7.6 ms.

Evidence and the full elimination trail are in
[the PRD-222 reassessment](../verification/prd-222-reassessment-2026-08-26.md#root-cause-every-webgpu-binding-call-costs-58-70-what-chromes-costs).

## The measurement

`gpubench.js` — the same file, run in the native host and in Chrome on the same machine, against a
real adapter in both, timing 200,000 calls after a 2,000-call warm-up:

| Call | Native host | Chrome | Ratio |
| --- | ---: | ---: | ---: |
| `queue.writeBuffer` (16 bytes) | **2,519 ns** | 431 ns | **5.8×** |
| `device.createCommandEncoder()` | **64,436 ns** | 919 ns | **70×** |
| `buffer.size` — plain property, **control** | **7 ns** | 21 ns | **0.33× (native faster)** |

The control carries the argument. A plain JavaScript property read is **three times faster** in the
native host than in Chrome. Only calls that cross into the binding layer are slower, so the defect
is in the JS→native WebGPU call path and not in V8, JavaScript execution, the scene graph, or the
command stream — each of which was separately measured and eliminated.

## Mechanism

`device.createCommandEncoder()` spends 64 µs allocating one object because the handler does not only
allocate it. For each method it exposes, it calls `installBindingTable`
(`src/webgpu/bindings.cpp:5660` onward — **37 call sites in that file**), and `installBindingTable`
in `src/webgpu/registration_table.cpp` performs, **per call**:

1. `engine->newFunction(...)` per method (`registration_table.cpp:375`), each allocating a
   `NativeFunction`, a `v8::External`, a `v8::Function`, and a weak `NativeFunctionRef` registered
   for GC callback;
2. a property **snapshot** of every destination about to be written;
3. installation via `setProperty`;
4. **expected-value verification** of every installed property;
5. **rollback** machinery on failure, including a second verification pass.

`beginRenderPass` does the same and costs 155 µs per call while performing 15 `getProperty` reads of
its descriptor. Three render passes and three command encoders per frame is only ~0.2 ms of that,
but the same per-call install pattern taxes the whole surface: measured bridge time is **8.16 ms per
frame**, against roughly **1.4 ms** if each crossing were priced at Chrome's rate.

The trampoline itself is **not** the problem and must not be re-targeted: it costs **0.647 ms per
frame, 201 ns per crossing**. The cost is in what the binding bodies do after entry.

## Why this went unfound

| Lever | Targeted | Measured result |
| --- | --- | ---: |
| A — render-pass wrapper pool | wrapper identity | flat, removed |
| C — V8 property/scope fast paths | trampoline internals | −0.31 ms |
| D — borrowed callback values | argument handles | ceiling 0.647 ms |
| E — fixed-shape `ObjectTemplate` | wrapper shape | same ceiling |

All four aimed at the trampoline and wrapper identity — **0.647 ms of a 22 ms render phase**. None
touched `installBindingTable`. Every rejected lever returned a sub-millisecond result because every
one was aimed at the wrong 3%.

The measurement lane hid it too: `bindingNs` was byte-identical to the sum of ten leaf command
buckets on every frame of both archived runs, so `createCommandEncoder`, `beginRenderPass`,
`createBindGroup` and `submit` were never counted or timed.

## Fix direction

Install each class's binding table **once, on a per-class prototype**, and resolve the native handle
from the instance rather than from a closure.

The methods are identical for every `GPUCommandEncoder`; only the captured native handle differs.
The host already has the mechanism for that — `getPrivateData` appears 42 times and `setPrivateData`
19 times in `bindings.cpp`, and leaf handlers already read their operands that way, for example
`tnWebgpuHandler40` (`setBindGroup`) resolving its bind group via `getPrivateData(args[1])`.

### The real work, and the real risk

87 handlers currently receive their native handle **as a captured C++ argument**, wired through
`makeCapturedHandler` / `makeCapturedPairHandler` (`src/webgpu/bindings.cpp:1919` and `:1929`, 33
uses). For example `tnWebgpuHandler52` takes `capturedEncoderForEnd` and `capturedRenderPass`
directly. A prototype-level install cannot capture those — each handler must instead resolve them
from the receiver's private data.

That is a contract change, not a mechanical edit, and it is where this fix can go wrong:

- **Receiver identity.** Handlers become `this`-dependent. The `NativeFunction` signature
  (`include/mystral/js/engine.h`) passes `args` but no receiver; a receiver must be threaded through
  the trampoline for all three engines (V8, QuickJS, JSC), or each object must carry its handle in
  an argument-reachable slot.
- **Paired state.** `makeCapturedPairHandler` exists because some operations need two handles
  (encoder *and* pass). `state->encoderRenderPassMap` already tracks that pairing and may be able to
  serve it, but the lifetime rules must be re-derived, not assumed.
- **The transaction machinery exists for a reason.** Snapshot/verify/rollback guards binding
  installation against partial or tampered installs and produces the rejection path the binding
  tests assert. Moving installation to one-time-per-class must **keep** those guarantees at install
  time; the goal is to stop paying them per call, not to delete them.
- **Three engines.** QuickJS and JSC implement the same `Engine` interface. Any receiver or
  prototype mechanism must exist in all three or be explicitly gated, and the shared engine contract
  tests must cover it.

## Staged plan

1. **One class, reversible.** Convert `GPUCommandEncoder` only — smallest surface, largest measured
   tax at 70×. Keep the existing path behind the same entry point so the change can be reverted in
   one commit.
2. **Price it.** Re-run `gpubench.js` in both runtimes. Success is `createCommandEncoder` falling
   from 64,436 ns toward Chrome's ~919 ns. This is a direct measurement, not a frame-level inference.
3. **Frame-level check.** Re-run the desktop `TN_FRAME_BUDGET` pair. `render.p50` should move
   materially below 22.2 ms against Chrome's 7.6 ms. Desktop is a valid lane for this at ~2.9×
   signal — established in the reassessment after correcting an earlier meter mismatch.
4. **Widen only on evidence.** Extend to `GPURenderPassEncoder`, then the remaining classes, priced
   at each step. Do not convert all 87 handlers before step 2 reports.
5. **Device arm last.** By the four-cell table, native `render.p50` is ~22 ms on desktop and ~23 ms
   on the phone, so the device should track desktop rather than diverge. A device run confirms; it
   does not lead.

## Verification

Red-green, both in the same commit:

```sh
# red: price the current per-call install
<engine>/packages/runtime-native/build/tn-linux-wgpu/mystral run gpubench.js   # expect ~64,436 ns
# green: after the one-class change
<engine>/packages/runtime-native/build/tn-linux-wgpu/mystral run gpubench.js   # expect ~1,000 ns
```

`gpubench.js` is retained at
`artifacts/prd-222/frame-attribution-2026-08-26/gpubench.js`. Run the Chrome arm from a
`127.0.0.1` page — WebGPU requires a secure context and `about:blank` fails `requestAdapter`.

Every arm must also keep the existing binding-contract suite green. Note that
`webgpu-bindings-contract.test.mjs` is **already red at HEAD** for an unrelated reason — an
over-broad source slice whose end marker is absent — and that failure predates this work; do not
fold its repair into a performance arm, and do not report the suite as green.

## What would falsify this

- `createCommandEncoder` stays near 64 µs after the install is hoisted, which would mean the cost is
  in object construction rather than binding installation.
- The one-class change lands and desktop `render.p50` does not move, which would mean the per-call
  install is real but not on the frame's critical path.

Both are cheap to check at step 2, before any wide refactor is paid for.
