# G5 — profiling

**Milestones:** M15, M16
**State:** IN PROGRESS. Physical Android attribution and engine pricing remain open.

No optimization fast path is accepted before a profile records the bottleneck. Evidence
must name the target, hardware, scene, build, sample duration and before/after measurement.
Simulator and emulator measurements may prove plumbing but must not stand in for physical
driver or phone-performance evidence.

## PRD-068 measurement path

The Android JavaScript-engine spike now has a default-off, fail-closed measurement path:

- `RuntimeConfig.vsync` selects FIFO or a supported uncapped present mode and preserves it on
  resize. An uncapped request refuses to fall back silently to FIFO.
- `TN_ANDROID_JS_NATIVE` records `Engine::getName()`, the six hot render-command counts and
  their time, plus submit/poll and present time for every submit.
- `examples/native-smoke` can bake a named mesh count, visibility rung, shared/distinct
  materials, and the 2,358-object pure-JavaScript matrix workload into one hashed bundle.
- `measure-android-js-engine.mjs` rejects missing or duplicate markers, subject drift, mixed
  engine identities, emulators, and any physical serial other than the named Pixel 8.

On 2026-08-10, `emulator-5554` proved only that this plumbing executes. After correcting the
measurement window to cover exactly 60 frame intervals, a 100-mesh, 0%-visible development run
recorded exactly 120 submits, 15 counted calls/frame, 0.0104 ms/frame in the six timed bindings,
and 11.01 ms/frame uncapped. The busy-loop control moved the binding figure to 0.1445 ms/frame,
about 14x. The same bundle with FIFO present reported 16.68 ms/frame. Kernel `VmHWM` recorded
171,924 kB peak RSS; actual `llvm-strip --strip-all` output was 20,099,904 bytes with 12,607,756
`.text` bytes. The final footprint pass also includes stripped `libSDL3.so`, producing a
22,338,816-byte total across packaged x86_64 shared libraries. A separate five-launch
development run reached the exact first-frame marker at a
1,023.6 ms p95. These are x86_64 emulator numbers under `packages/runtime-native/.runtime/`;
they are not PRD findings and satisfy no physical-hardware acceptance criterion.

The call-counter blind control is now a real JavaScript-side change: `--extra-draw-control`
adds one visible shared-geometry mesh. The emulator's main render submit changed from two to
three `drawIndexed` calls while its second submit was unchanged. The owning proof run was
interrupted by a concurrent PRD-066 package install on the shared emulator, so this remains a
development observation and the physical control is **UNVERIFIED**.

Candidate comparisons now fail closed unless both reports are acceptance-eligible Pixel 8 runs,
both exact packaged runtime hashes resolve to `-O2` CMake outputs, each has five cold starts, the
candidate has a clean-build time, the bundle SHA is identical, the stripped runtime SHA is
different, and the candidate reports the requested `Engine::getName()`. Every report owns a
separate sibling logcat file and content-addressed APK. Comparison reopens the control APK and
recomputes its complete native footprint and packaged JavaScript hash, so later builds cannot
silently replace either half of its evidence. The archived path is created before verification
and is the exact APK installed; evidence-eligible runs reject `--skip-install`.

Still owed on Pixel 8 serial `37251FDJH0037Z`: the full visibility ladders for both subjects,
Chrome-on-device pure-JavaScript comparison, varied-material crossing result, candidate-engine
measurements, every remaining negative control, and the decision record.

### Phase 2B cheapest-disqualifier audit

No candidate is eliminated before measurement:

| Branch | Audit status | Pinned dependency fact | Still unmeasured |
| --- | --- | --- | --- |
| JavaScriptCore | **SURVIVES.** The arm64 build enables the baseline JIT, with DFG and FTL disabled. | `jsc-android@294992.0.0`; its [tagged build script](https://github.com/react-native-community/jsc-android-buildscripts/blob/v294992.0.0/scripts/compile/jsc.sh#L43-L84) is the configuration evidence. | Adapter refactor, runtime JIT activation, size, build time and device performance. |
| Hermes | **SURVIVES.** JSI can retain caller storage as a no-copy external ArrayBuffer. | Hermes `v0.13.0`; [the implementation passes `MutableBuffer::data()` to the external data block](https://github.com/facebook/hermes/blob/v0.13.0/API/hermes/hermes.cpp#L2060-L2077). | Adapter, lifetime negative control, size, build time and device performance. |
| V8 | **CONDITIONAL.** A pinnable JIT artifact exists, but it contains V8 10.0 rather than the desktop pin and is not drop-in compatible. | [`v8-android-jit-nointl@11.1000.4`](https://registry.npmjs.org/v8-android-jit-nointl/-/v8-android-jit-nointl-11.1000.4.tgz), SHA-256 `46870658adfe0f6eaa4819226af37a25663bd54599304dd7d7c91ed1089dae9e`; arm64 `libv8android.so` is 15,507,808 bytes. | V8 10 adapter compatibility, snapshot staging, NDK/page compatibility, packaged size, build time and device performance. |

This table is dependency research, not engine pricing. Every performance and packaged-runtime
cell remains **UNMEASURED**, so it supports no recommendation.
