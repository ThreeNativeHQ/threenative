# Android JavaScript engine spike — 2026-08-10

**State:** IN PROGRESS. Measurement plumbing and candidate viability gates are complete;
physical Pixel 8 attribution, engine pricing and the recommendation are still open.

This record executes PRD-068. Emulator observations prove only the harness. Performance claims
require physical Pixel 8 serial `37251FDJH0037Z`; it was not attached during this update.

## Candidate viability gates

No branch was eliminated by its cheapest pre-build gate. This does not price or recommend one.

| Branch | Verdict | Reproducible evidence | Still UNMEASURED |
| --- | --- | --- | --- |
| JavaScriptCore | **SURVIVES.** The published arm64 build enables baseline JIT and disables C-loop, DFG and FTL. | [`jsc-android@294992.0.0`](https://registry.npmjs.org/jsc-android/-/jsc-android-294992.0.0.tgz), tarball SHA-256 `2571ee361cd3700d86cc31686431b89cafac0540aa3fb320eb3015be1aa05dd2`; [tagged flags](https://github.com/react-native-community/jsc-android-buildscripts/blob/v294992.0.0/scripts/compile/jsc.sh#L41-L83). The AAR contains stripped arm64 `libjsc.so`, 19,896,032 bytes, SHA-256 `1dacd0e27510e744900ed3613d2145f5c6044eed3aa63319cd65b9d0c3f1ee59`. | Runtime JIT activation, adapter, packaged delta, build time, cold start, RSS and frame time. |
| Hermes | **SURVIVES.** JSI provides a no-copy external ArrayBuffer adequate for a Float32 view. | Hermes `v0.13.0`, commit `4b3bf912cc0f705b51b71ce1a5b8bd79b93a451b`; [external data block](https://github.com/facebook/hermes/blob/4b3bf912cc0f705b51b71ce1a5b8bd79b93a451b/API/hermes/hermes.cpp#L2060-L2075) and [typed-array view](https://github.com/facebook/hermes/blob/4b3bf912cc0f705b51b71ce1a5b8bd79b93a451b/lib/VM/JSLib/TypedArray.cpp#L118-L171). | Adapter and lifetime control, artifact, packaged delta, build time, cold start, RSS and frame time. |
| V8 | **SURVIVES CONDITIONALLY.** A pinnable JIT artifact exists, but it is stale V8 10 and not drop-in compatible. | [`v8-android-jit-nointl@11.1000.4`](https://registry.npmjs.org/v8-android-jit-nointl/-/v8-android-jit-nointl-11.1000.4.tgz), tarball SHA-256 `46870658adfe0f6eaa4819226af37a25663bd54599304dd7d7c91ed1089dae9e`. It contains V8 10.0.139.9 arm64 `libv8android.so`, 15,507,808 bytes, SHA-256 `531d63e04628a9bd5a8e9984e826424e77a755e1fa5c535dabaceb29ec097cd4`, plus a 46,454-byte external snapshot. | V8 10 adapter changes, snapshot staging, NDK/page compatibility, packaged delta, build time, cold start, RSS and frame time. |

Hermes' retained `MutableBuffer` wrapper must own or outlive its backing allocation; it does not
make a borrowed GPU or physics pointer safe after unmap/free. Float32 offsets must be four-byte
aligned and native/JavaScript concurrent mutation must be synchronized.

The V8 artifact was built with NDK r23c, depends on `libc++_shared.so`, and supplies a shared
library where the repository expects V8 13's static monolith. Five `ScriptOrigin` calls in the
existing adapter need the older V8 10 leading-`Isolate*` signature. No maintained V8 13 Android
artifact matching the desktop pin was found.

Because V8 and JSC arrive as separate shared libraries, the measurement report sums the stripped
bytes and `.text` of every packaged `.so` for the target ABI as `nativeFootprint`. Reporting only
`libmystral-runtime.so` would hide the candidate engine itself and is rejected as incomplete.
Each report preserves a content-addressed APK; candidate comparison reopens the control APK,
rehashes it, recomputes the footprint, checks aggregate arithmetic and requires the selected
shared engine library. It also extracts and hashes `assets/scripts/main.js` from both APKs, so a
mutable metadata file or edited report cannot defeat the same-bundle rule.
The APK is archived before verification and that immutable path is the one installed and
launched. Acceptance and comparison runs reject `--skip-install`.

## Local verification

The public tarballs were downloaded directly, SHA-256 hashed, unpacked, and inspected with
`tar`, `unzip`, `readelf` and `stat`. Tagged build/API sources were read at their immutable tags
or commits. The focused measurement contracts pass 18/18, and the exact APK, merged native
library and active CMake output share one SHA-256 in the local x86_64 development build. The
footprint helper inspected that APK directly: stripped `libSDL3.so` was 2,238,912 bytes and
stripped `libmystral-runtime.so` was 20,099,904 bytes, for 22,338,816 packaged native bytes after
stripping. This is an x86_64 harness result, not the arm64 acceptance figure.

## Physical evidence still required

The Pixel run must add the uncapped QuickJS ladders, Chrome/native pure-JavaScript ratio,
varied-material crossing check, call-counter control, complete native-time split and five-start
cold-start data. Only then may surviving engines be priced or the falsifiers resolved. Until
those reports exist, every branch remains **UNMEASURED** and this record makes no recommendation.
