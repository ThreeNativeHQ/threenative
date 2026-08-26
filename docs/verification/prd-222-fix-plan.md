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

### Lever A (historical, rejected and removed): reuse the GPURenderPassEncoder wrapper

**Historical rationale:** three.js began render passes every frame, and each `beginRenderPass`
built a fresh JS object and ~15 fresh `v8::Function`s. The hypothesis was that every renderer call
site therefore saw a new receiver map and a new callee every frame → megamorphic ICs → the
3.9 ms/frame of stub-cache + dictionary time, plus the `newFunction` cost itself
(~0.15–0.44 ms/frame desktop, more on device).

**Historical design tested:**

- `bindings_state.h` temporarily carried `struct RenderPassWrapper { js::JSValueHandle object;
  shared_ptr<WGPURenderPassEncoder> pass; shared_ptr<WGPUCommandEncoder> encoder; }` plus
  `std::vector<std::unique_ptr<RenderPassWrapper>> renderPassWrappers;` on `BindingsState`.
- `bindings.cpp`:
  - `makeSlotHandler` / `makeSlotPairHandler` bound handlers to the wrapper's *slots*
    (`shared_ptr` dereference at call time) instead of capturing the pass by value, so a pooled
    wrapper's methods followed whichever pass was currently bound.
  - `acquireRenderPassWrapper(state)` handed out a pooled wrapper only when its previous pass was
    no longer a value in `encoderRenderPassMap`; otherwise it grew the pool. Concurrent passes did
    not share a wrapper.
  - In `beginRenderPass`, a fresh wrapper received `newObject()` + `freezeHandle` and all binding
    tables once; reuse only rebound the pass/encoder slots and overwrote private data. Rollback
    called `discardRenderPassWrapper()` only for a fresh wrapper.
- The historical red/green test asserted that `RenderPassWrapper`, `acquireRenderPassWrapper`, and
  `makeSlotHandler` existed and that captured render-pass handlers were absent. Those pooling-only
  assertions were removed with the rejected implementation.

**Historical validation plan completed before removal:**

1. The desktop probe ran 3× 900-frame samples and checked screenshots and exceptions.
2. The implementation covered private-data overwrite and fresh-only batched-pass installation.
3. The desktop work did not move ≥0.5 ms, so the device arm was not triggered.
4. The CMake/Gradle profile flags remained default-OFF.

### Lever A execution record (2026-08-26)

#### Kill-switch ruling (2026-08-26)

Rejected and removed. The three valid desktop medians for the reusable render-pass-wrapper pool
were 23.054, 21.055, and 21.878 ms for `threadCpuNs - presentNs`; they overlap the recorded
21.1–22.5 ms baseline and establish no improvement. The pool, slot-bound handlers, fresh-only
installer path, lifecycle harness, and reuse-specific tests cost substantially more framework and
test code than plain captured render-pass bindings, so the abstraction fails the kill switch.
`threadCpuNs` profiling and the independently pre-existing batched-pass marker/fixture corrections
remain. The named screenshot was captured from the pooled source revision; it is historical
pool-era visual evidence, not a post-removal or current-HEAD baseline for future levers.

Source: `818e97b3-lever-a-0952a2c73aeb` (specified base plus the four-file Lever A patch;
the full command outputs are in the task report). At that historical source, the implementation
pooled a frozen render-pass object, rebound pass/encoder slots, excluded map-live passes from reuse,
overwrote private data on reuse, and only freed a newly allocated wrapper during rollback.

- Historical source regression: the base source lacked
  `acquireRenderPassWrapper`/`makeSlotHandler` (expected red, exit 1); the focused profiling test
  passed 11/11 against the pooled revision, and the contract/trace follow-up passed 29 tests with
  2 skipped.
- Historical native build: `cmake -DTN_ANDROID_JS_PROFILE=ON .` configured the Linux V8/wgpu
  build; the configured Ninja at `.runtime/tools-venv/bin/ninja mystral` completed the `Linking CXX
  executable mystral` step. The resulting binary contains `,"threadCpuNs":`.
- Historical Bayview desktop meter: valid runs 2–4 are under
  `artifacts/prd-222/lever-a/818e97b3-lever-a-0952a2c73aeb/`. After deduplication by
  `(frame,bindingNs,calls,threadCpuNs)`, requiring at least three markers and over 100 indexed
  draws, and retaining frames 226–899, median `threadCpuNs - presentNs` was 23.054, 21.055, and
  21.878 ms. The result overlapped the 21.1–22.5 ms baseline, so it did not establish the 0.5 ms
  improvement needed to trigger the Pixel 8 paired protocol.
- All three historical valid runs reached 900 presents, emitted no native exception/start failure,
  and had non-blank 1280×720 screenshots. The only `error` text was the non-fatal XKB keymap warning.
  `/tmp/bayview-batched-frame.png` was the only pre-change candidate and is all-black (mean 0),
  so an identical baseline comparison was unavailable. `baseline-after-lever-a.png` was captured
  from the pooled source and remains named beside those artifacts only as historical visual
  evidence; it is not a post-removal or current-HEAD baseline. Repeated valid frames were visually
  non-blank but not byte-identical (AE: run 2↔3 15,945,000; run 2↔4 875,792), so no exact-pixel
  claim was made.
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

#### Fox/shadow workload checkpoint (diagnostic only)

A freshly rebuilt Bayview shadows-on/off pair removed 1,408 bridge calls and 9.103 ms of
render-thread work, while measured binding work fell by only 1.662 ms. This is diagnostic-only
evidence: it locates most of the removed work in the surrounding JavaScript/V8/host machinery and
does not license disabling shadows, changing the game's look, or making an FPS claim.

#### Lever C execution record (2026-08-26)

Source `2fdb675c22b350a7ddd227238af2e6a851df28b0` replaces bridge-owned `Reflect.set`
writes with `Object::CreateDataProperty` while retaining interned keys and keeping the global path
separate. One conditional V8 entry scope now enters the isolate/context only when needed and always
retains a handle scope. Proven C++-only shader entry-point and texture metadata moved from ordinary
JavaScript properties into common binding state/native registries; JS-required compatibility fields
were preserved. Lever A pooling remains absent.

- The executable V8 contract reads, overwrites, enumerates, and deletes an own writable,
  enumerable, configurable data property, with an inherited-setter negative control. It also proves
  nested native callbacks preserve return values, caught exceptions, reentrancy, and zero
  outstanding handles. The old `Reflect.set` path failed the own-property control before the fix.
- The fresh no-pool base `9840fc88` medians were 21.1050905, 22.9768555, and 23.1198635 ms;
  their three-run median was **22.9768555 ms/frame**. Lever C medians were 22.666427,
  22.710709, and 22.223790 ms; their three-run median was **22.666427 ms/frame**. The measured
  cumulative improvement was **0.3104285 ms/frame**.
- Both arms used the original Bayview bundle with SHA-256
  `12d7edb2112ab1bcb8872c089968131decaafbe79dd216eec66e2ab876b9ac20`. Each run deduped
  `(frame,bindingNs,calls,threadCpuNs)`, retained 899 eligible frames with at least three markers and
  over 100 indexed draws, and measured the median of frames 226–899 (674 frames) using
  `threadCpuNs - presentNs`.
- All six runs reached 900 presents, produced non-blank 1280×720 screenshots, and had zero
  exception/start-failure matches after excluding the known non-fatal XKB warning. Evidence is in
  `artifacts/prd-222/lever-c/baseline-no-pool-9840fc88/` and
  `artifacts/prd-222/lever-c/2fdb675c-lever-c/`.
- The 0.3104285 ms desktop improvement did not meet the approximately 2 ms Pixel 8 trigger, so no
  device pair ran and no FPS claim is made. Focused checks passed 42 tests with 2 skipped plus the
  native executable contract. The root typecheck and lint completed (431 existing warnings); the
  package suite stopped at one unrelated pre-existing over-broad source-slice assertion in
  `webgpu-bindings-contract.test.mjs` (533 passed, 34 skipped, 1 failed).

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
