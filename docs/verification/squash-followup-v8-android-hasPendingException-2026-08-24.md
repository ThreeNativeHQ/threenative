# Squash follow-up — `HasPendingException` broke the Android V8 build (2026-08-24, ~23:20)

**Who ran this:** a Claude monitoring session (not Linchpin, not the PRD-219 lane worker).
**What it is:** Step-0 tree repair. Commit `0d6417f9` (the PRD-197/205/207 squash, 22:18)
added an exception-latch probe to `packages/runtime-native/src/js/v8_engine.cpp` that calls
`v8::Isolate::HasPendingException()` — present in the desktop prebuilt (V8 13.1,
`third_party/v8/include/v8-isolate.h:984`) and absent from the Android prebuilt (V8 11.0).
Every Android APK build on `main` failed from 22:18 until this fix. The JS gates in step 0
(typecheck / lint / test) cannot see a C++ break; Lane B (PRD-219) was the first lane to
attempt an APK build and hit it.

## Red (paste)

Lane B's `:app:buildCMakeDebug`, NDK clang against `third_party/v8-android` headers:

```
v8_engine.cpp:1454:23: error: no member named 'HasPendingException' in 'v8::Isolate'
```

## Fix

Version-guard the probe with the file's existing idiom (`V8_MAJOR_VERSION >= 13`; the file
already uses `>= 12` / `< 12` guards in seven places). On V8 < 13 the latch clears on the
host-side record alone: `nativeCallbackDepth_ == 0 && exceptionFromNativeCallback_ &&
hasException()`. The isolate probe only guarded the rare finally-block-with-pending-exception
call, and clearing early errs toward un-rejecting valid installs — the failure mode the latch
exists to fix.

## Green (pasted summary of what executed)

Both incremental CMake builds recompiled `v8_engine.cpp.o` fresh (object mtimes 23:22) and
linked:

```
cmake --build packages/runtime-native/build/tn-linux   # V8 13.1, x64 → [393/393], mystral linked
cmake --build packages/runtime-native/build/tn-android # V8 11.0, NDK  → [395/395], libmystral-runtime.so linked
```

Not claimed: an end-to-end Android run on device or emulator. The first lane to rebuild its
APK after syncing this commit owns that observation.
