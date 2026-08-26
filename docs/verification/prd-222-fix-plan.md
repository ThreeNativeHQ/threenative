# PRD-222 fix plan — how to get Bayview off 19 fps on Android

Written 2026-08-26. Companion to `prd-222-2026-08-26.md` (§ Correction) and loop-log **F13**.
This file is the executable recipe: what the problem actually is, what is already in flight in
the working tree, and the exact ordered changes with their measurement protocol.

## The situation in four sentences

1. Bayview runs 59.99 fps in Chrome and ~19 fps in the native host on the **same Pixel 8** —
   the gap is the native runtime, not the game, not the GPU (Mali driver is 2.3 ms of a 53 ms
   frame).
2. The symbolized `simpleperf` profile (`bayview.perf.data` re-reported against the unstripped
   `libv8android.so`) shows **V8 owns 61.7% of the render thread (22.9 ms/frame)**, and only
   10.1 ms of that is running the game's JavaScript — the other 12.8 ms is V8 machinery.
3. That machinery is property-lookup slow paths (megamorphic stub cache 2.7 ms + name-dictionary
   lookups 1.2 ms), API scaffolding (`LookupIterator`/`Object::Get` 4.6%, `GlobalHandles` 3.2%,
   `Isolate`/`Context` re-entry 3.2%), and the scudo allocator churn they cause (~4.3 ms).
4. The cause is the bridge's object model in `src/js/v8_engine.cpp` + `src/webgpu/bindings.cpp`:
   every WebGPU wrapper is a fresh property-bag object assembled via `Reflect.set`, read back by
   name through `Object::Get`, with a `v8::Persistent` per crossed value — so Three.js sees new
   shapes and new callees every frame and its inline caches go megamorphic. **The tax is per
   value and per property, not per crossing** (F12 proved removing 1,900 crossings bought +5%).

## Measurement protocol (do this before and after every lever)

Desktop fps is FIFO-throttled and meaningless (F11). Two valid meters:

- **Desktop A/B meter** — the `threadCpuNs` field added to the `TN_ANDROID_JS_NATIVE` marker
  (render-thread `CLOCK_THREAD_CPUTIME_ID` delta per frame). Build with
  `-DTN_ANDROID_JS_PROFILE=ON`, run the Bayview bundle 900 frames under Xvfb, take the median of
  the steady last three quarters. Baseline at HEAD: **work = threadCpu − present ≈ 21.1–22.5
  ms/frame (±3% across three runs)** — tight enough to resolve a 1 ms lever, which `render.p50`
  (±15%) is not.
  ```sh
  cd packages/runtime-native/build/tn-linux-wgpu
  ~/.local/bin/cmake -DTN_ANDROID_JS_PROFILE=ON . && ~/Android/Sdk/cmake/3.22.1/bin/ninja mystral
  cd ~/projects/threenative/sandbox/fps-framework/.threenative/build
  env -u WAYLAND_DISPLAY SDL_VIDEODRIVER=x11 sh <engine>/scripts/xvfb.sh \
    <engine>/build/tn-linux-wgpu/mystral run game.js --screenshot /tmp/shot.png --frames 900
  # parse TN_ANDROID_JS_NATIVE, dedupe by (frame,bindingNs,calls,threadCpuNs), sum per frame,
  # keep frames with >=3 markers and >100 indexed draws, median threadCpuNs of the last 3/4
  ```
- **Device meter** — the loop-log protocol: profiled arm64 APK via `THREENATIVE_RUNTIME_SOURCE`,
  cold launch, live windows only (`update.mean ≥ 3 ms`), discard window 1, median fps + render.p50.
  Only the device decides fps claims; desktop decides direction and magnitude of CPU work.

Always verify the screenshot is non-blank and grep the log for exceptions — a wrapper-lifetime
bug renders plausible frames then dies quietly.

## The levers, in order

### Lever A (in flight, working tree): reuse the GPURenderPassEncoder wrapper

**Why first:** three.js begins render passes every frame; today each `beginRenderPass` builds a
fresh JS object and ~15 fresh `v8::Function`s. Every renderer call site therefore sees a new
receiver map and a new callee every frame → megamorphic ICs → the 3.9 ms/frame of stub-cache +
dictionary time, plus the `newFunction` cost itself (~0.15–0.44 ms/frame desktop, more on device).

**Design (already partially written, uncommitted):**

- `bindings_state.h`: `struct RenderPassWrapper { js::JSValueHandle object; shared_ptr<WGPURenderPassEncoder> pass; shared_ptr<WGPUCommandEncoder> encoder; }` plus
  `std::vector<std::unique_ptr<RenderPassWrapper>> renderPassWrappers;` on `BindingsState`.
- `bindings.cpp`:
  - `makeSlotHandler` / `makeSlotPairHandler`: bind handlers to the wrapper's *slots*
    (`shared_ptr` deref at call time) instead of capturing the pass by value, so a pooled
    wrapper's methods follow whatever pass it is currently bound to.
  - `acquireRenderPassWrapper(state)`: hand out a pooled wrapper only if its previous pass is no
    longer a value in `encoderRenderPassMap` (that map is maintained by begin/end/rollback);
    otherwise grow the pool. Concurrent passes never share a wrapper.
  - In `beginRenderPass`: on a fresh wrapper, `newObject()` + `freezeHandle` (it outlives the
    frame) + install all binding tables once; on reuse, only `*pass = renderPass;
    *encoder = encoderToUse; setPrivateData(jsRenderPass, renderPass)`. Rollback paths call
    `discardRenderPassWrapper()` which frees the handle only for fresh wrappers.
- Red/green test (already added, green): `android-js-engine-native-profiling.test.mjs` asserts
  `RenderPassWrapper`, `acquireRenderPassWrapper`, `makeSlotHandler` exist and the old
  `makeCapturedHandler(renderPass, &tnWebgpuHandler39)` form is gone.

**Next actions to finish it (build already compiles):**

1. Run the desktop probe A/B: 3× 900-frame runs, expect `work` to drop and, critically,
   **screenshot identical to baseline** and zero exceptions.
2. Watch two hazards: (a) `setPrivateData` on reuse must overwrite, not accumulate;
   (b) the batched-pass installer (`installBatchedPassEncoding`) must also run only on fresh
   wrappers — it re-wraps methods, so double-install would stack closures.
3. If desktop `work` moves ≥0.5 ms, build the device arm and run the paired protocol.
4. Commit with the red/green outputs pasted; the CMake/gradle profile flags stay default-OFF.

### Lever A execution record (2026-08-26)

#### Kill-switch ruling (2026-08-26)

Rejected and removed. The three valid desktop medians for the reusable render-pass-wrapper pool
were 23.054, 21.055, and 21.878 ms for `threadCpuNs - presentNs`; they overlap the recorded
21.1–22.5 ms baseline and establish no improvement. The pool, slot-bound handlers, fresh-only
installer path, lifecycle harness, and reuse-specific tests cost substantially more framework and
test code than plain captured render-pass bindings, so the abstraction fails the kill switch.
`threadCpuNs` profiling and the independently pre-existing batched-pass marker/fixture corrections
remain. Future levers must use the named post-Lever-A screenshot baseline rather than treating this
rejected path as a performance foundation.

Source: `818e97b3-lever-a-0952a2c73aeb` (specified base plus the four-file Lever A patch;
the full command outputs are in the task report). The implementation pools a frozen render-pass
object, rebinds pass/encoder slots, excludes map-live passes from reuse, overwrites private data
on reuse, and only frees a newly allocated wrapper during binding-install rollback.

- Source regression: the base source lacks `acquireRenderPassWrapper`/`makeSlotHandler` (expected
  red, exit 1); `pnpm --filter @threenative/runtime-native exec vitest run
  tests/android-js-engine-native-profiling.test.mjs` is green (11/11). The contract/trace follow-up
  is green (29 passed, 2 skipped).
- Native build: `cmake -DTN_ANDROID_JS_PROFILE=ON .` configured the Linux V8/wgpu build; the
  configured Ninja at `.runtime/tools-venv/bin/ninja mystral` completed the `Linking CXX executable
  mystral` step. The resulting binary contains `,"threadCpuNs":`.
- Bayview desktop meter: valid runs 2–4 are under
  `artifacts/prd-222/lever-a/818e97b3-lever-a-0952a2c73aeb/`. After deduplication by
  `(frame,bindingNs,calls,threadCpuNs)`, requiring at least three markers and over 100 indexed
  draws, and retaining frames 226–899, median `threadCpuNs - presentNs` is 23.054, 21.055, and
  21.878 ms. The result overlaps the 21.1–22.5 ms baseline, so it does not establish the 0.5 ms
  improvement needed to trigger the Pixel 8 paired protocol.
- All three valid runs reached 900 presents, emitted no native exception/start failure, and have
  non-blank 1280×720 screenshots. The only `error` text is the non-fatal XKB keymap warning.
  `/tmp/bayview-batched-frame.png` was the only pre-change candidate and is all-black (mean 0),
  so an identical baseline comparison is unavailable. `baseline-after-lever-a.png` is now named
  beside the valid run artifacts for the next lever. Repeated valid frames are visually non-blank
  but not byte-identical (AE: run 2↔3 15,945,000; run 2↔4 875,792), so no exact-pixel claim is made.
- Repository gate: `pnpm typecheck && pnpm lint && pnpm test` ran. Typecheck completed; lint had
  431 existing non-fatal warnings; the full test suite then failed outside Lever A (the
  `.claude/worktrees/prd-222-resume/` agent-mirror census, a 5-second temp-dir-guard timeout, and
  a PRD-201 scaffold parent-hash mismatch; 2,200 passed / 3 failed). The focused runtime-native
  suite is green: 73 files, 532 passed, 34 skipped.

### Lever B: same treatment for the per-frame wrapper zoo

`beginRenderPass` is the biggest but not the only per-frame wrapper factory. Grep
`suspendFrameTracking()` call sites: command encoders (`createCommandEncoder`), compute passes,
and the per-frame canvas texture/view wrappers are rebuilt each frame the same way. Apply the
identical pool-and-rebind pattern. Expected: the remaining `newFunction`/`newObject` churn and a
further slice of the IC misses.

### Lever C: kill the generic property path on the C++ side

In `v8_engine.cpp`:

- `setProperty` → replace the `Reflect.set` JS-builtin call (`setPropertyWithReflect`) with
  `Object::CreateDataProperty` (keep the interned-key cache). `Reflect.set` exists for proxy
  semantics the bridge does not need on its own freshly created objects.
- `getProperty` → for bridge-internal reads use `v8::Private` slots or internal fields instead
  of name-keyed `Object::Get` (which walks `LookupIterator` with no IC).
- Drop the redundant `Isolate::Scope`/`Context::Scope` re-entry in the ~49 host-side methods —
  the render thread is always already inside the isolate; enter once per frame at the seam.

~4.6% + 3.2% of the thread per the profile. Mechanical, desktop-verifiable.

### Lever D: stop wrapping every crossed value in a `v8::Persistent`

`nativeCallback` allocates one Persistent per argument per crossing (`GlobalHandles::Create` +
`NodeSpace::Release` = 3.2% + scudo share). Arguments that do not outlive the call can be plain
`v8::Local`s inside the callback's own `HandleScope`. This requires the `Engine` interface to
distinguish "borrowed for this call" from "kept" — `freezeHandle` already marks the kept ones,
so the change is to make borrowed the default representation.

### Lever E (structural): fixed shapes via `ObjectTemplate` + internal fields

One `v8::ObjectTemplate` per WebGPU class (GPUBuffer, GPUTexture, GPUBindGroup, …) with an
internal field for the native handle, instantiated per object. Every instance of a class then
shares one map forever; Three.js's ICs stay monomorphic; `setPrivateData`/`getPrivateData`
become `SetAlignedPointerInInternalField` (no hash lookup, no private-symbol property).
This is the lever that reaches the full 3.9 ms of IC slow-path time plus the remaining shape
churn (`MigrateToMap`). Probe with GPUBuffer alone first.

## Order of operations and the bar

Run A → B → C → D, measuring desktop `work` after each; take a device pair whenever the
cumulative desktop win exceeds ~2 ms. E is the big rock — start it once A–D are banked, since
its wrapper factories replace the ones A/B touch.

The bar (PRD-222): **30 fps floor, 58 fps target on the Pixel 8**, judged only by the device
protocol on a cool, discharging phone. The vblank ladder is 20 → 30 → 60: leaving the 20-cell
needs ~5–7 ms off the render phase, which is within what A+C+D+E address (12.8 ms of V8
machinery + 4.3 ms allocator churn on the table).

## Standing traps (all bitten before)

- Never trust a binary you didn't watch link; name artifacts by source revision.
- Window 1 lies; markers emit under two logcat tags — dedupe by frame id.
- The physics SIGSEGV (F5) still kills most launches — use the crash-tolerant runner, accept
  only ≥4-window survivors.
- `pnpm typecheck && pnpm lint && pnpm test` before calling any step done; the census runs in
  the same commit as any runtime-native change.
