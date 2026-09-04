---
prd_contract: v1
---

# PRD-118 — The Android JavaScript engine: why the phone is three times slower, and what replacing QuickJS costs

**Status: ACCEPTED, 2026-08-16 — the charged retake ran and the numbers did not move.** The run is
recorded in [`docs/verification/prd-118-charged-retake-2026-08-16.md`](../../verification/prd-118-charged-retake-2026-08-16.md):
Pixel 8 at **72%** battery, `Thermal Status: 0`, no `--allow-low-battery`, and the installed APK
proved by hash and by symbol table to be the V8 one.

| Pixel 8, 16 384 cubes, collapsed scene | frame p50 | JS per frame |
|---|---|---|
| QuickJS | 119.19 ms | 115.64 ms |
| **V8, charged retake** | **8.32 ms** | 5.25 ms (not retaken) |
| Godot 4.7.1 Android | 39.27 ms | — |

Script time fell **22x**. The acceptance criterion — *L3 @16 384 under 39.27 ms* — is met with room
to spare, subject to Caveat 1 below.

**Caveat 1 stands, and the retake did not disturb it.** The host presents `fifo vsync=true` and the
device runs 120 Hz, so 8.33 ms is the frame interval and ThreeNative sits on it at every rung across
a 4x load range. The defensible claim is **its work fits inside one 120 Hz frame** while Godot needs
39.27 ms, which is above Godot's own 60 Hz floor and therefore real cost. The arms ran at different
refresh rates; the scorer would refuse that pairing outright, and the conclusion survives anyway
because even at 60 Hz ThreeNative would read 16.67 ms.

**Caveat 2 is closed, and the battery turned out not to be the variable.** The provisional run sat
at 21–25%. At 72% the same rung reads 8.32 ms against 8.33 ms — which proves little by itself, since
that arm is pinned to vsync. **The QuickJS arm is the one that carries information**: at 20 ms it was
nowhere near the frame interval and free to move, and it read 20.03 ms charged against 20.02 ms
provisional. On this device the 50% bar changed nothing measurable. That is a result about the bar,
not a licence to drop it — see PRD-127 §9, whose first kill switch this fires.

**What is still not claimed.** Android-on-this-device, not mobile-ready; one phone is not mobile. The
Android default remains QuickJS and `-PthreenativeJsEngine=v8` is what changes it. Whether to pay the
+25.6 MB arm64 payload to make V8 the default is the owner's call, exactly as §6 says.

**Original status: SCOPING, 2026-08-15.** The measurements below ran; the fix has not. Every number
carries its source. The one thing already proved is that the Android runtime **configures and
builds from source on this machine**, which is what decides whether any of this is possible.

**Complexity: 8 → HIGH mode.** A cross-compiled third-party JavaScript engine, a new dependency
with no vendor-supplied Android artifact in the current source, and a documented architecture
decision to reopen. No new public API, no framework surface, no gameplay.

**Blast radius.** `packages/runtime-native/CMakeLists.txt`, `CMakePresets.json`,
`scripts/download-deps.mjs`, `scripts/package-android.mjs`, and whichever engine backend file the
choice lands on. Nothing in `packages/core`, no template, no example. If a framework fix is implied
by a result here, it is a different PRD.

**Depends on and does not overlap:**

- **PRD-117** produced the measurement this document acts on and owns the load-test instrument.
  This PRD changes the runtime; it does not touch the benchmark.
- **PRD-066** measured the same phone at 4.5 fps debug versus 24.8 fps `-O2`. Its lesson — that the
  build configuration, not the engine, was the story — is exactly the shape of this finding.
- **PRD-069/PRD-072** own cost attribution. This PRD does not re-attribute; §1 states what was
  measured and stops.

---

## 1. The finding

Same source, same three draw calls, same 196 611 triangles, same collapsed scene:

| L3 @ 16 384 cubes | frame p95 | JS engine |
|---|---|---|
| Chromium on this desktop | **11.45 ms** | V8 |
| Pixel 8, own runtime | **119.19 ms** | QuickJS |

**10.4×.** Against Godot's Android export on the same device and the same scene, ThreeNative is
**3× slower** (119.19 ms against 39.27 ms).

Three independent measurements say the cause is the interpreter and not the renderer:

1. **~95% of the mobile frame is script.** At 16 384, the game-side step was 101.62 ms of a
   106.32 ms frame in the hand-instanced mode, and 115.64 ms of 119.19 ms in the collapsed one.
2. **The GPU is idle.** The identical 16 384-cube scene with nothing animating renders in
   **8.25 ms** at 3 draw calls. The Mali-G715 has the headroom; nothing is waiting on it.
3. **Per-object cost tracks the language, not the work.** Godot does equivalent per-object work
   *and* renders in 39.27 ms — roughly 2.4 µs per object in GDScript against about 7 µs in QuickJS.

Two rounds of JavaScript micro-optimisation in `packages/core/src/collapse.ts` took the 4 096 rung
from 28.68 ms to 22.49 ms — real, and not nearly enough. **A 3× gap is not reachable from the
JavaScript side.**

`packages/runtime-native/CMakeLists.txt` selects V8 on desktop, JSC on iOS, and QuickJS on Android,
with the comment "simplest to integrate, no special runtime deps". Android is the only platform
ThreeNative ships on an interpreter without a JIT, and it is the only platform where it loses.

---

## 2. What is already proved

**Updated 2026-08-15 after four build blockers were found and cleared.** The Android runtime now
**builds from source, arm64, with zero errors** — `libmystral-runtime.so`, 30.8 MB, `ELF 64-bit LSB
shared object, ARM aarch64, for Android 21, built by NDK r27b`, carrying QuickJS symbols and no V8
symbols. Four defects stood in the way, each hiding the next:

| # | Defect | Symptom |
|---|---|---|
| 1 | SDL3 reads `ANDROID_NDK`, not `CMAKE_ANDROID_NDK` | generate step hunts for `/sources/android/cpufeatures/cpu-features.c` |
| 2 | The `tn-android` preset set `ANDROID_ABI`, which CMake's built-in Android support ignores | built 32-bit ARM; surfaced only as a link error against the arm64 Rust physics lib. **The preset could never have produced a working arm64 binary.** Fixed by adding `CMAKE_ANDROID_ARCH_ABI` |
| 3 | No position-independent code | SDL3's static lib cannot link into a shared object; fixed with `CMAKE_POSITION_INDEPENDENT_CODE` |
| 4 | `elseif(UNIX)` links `-lpthread` and `-ldl` | Android matches `UNIX`, but bionic folds both into libc, so the linker finds neither |

**The engine choice was hard-forced, not defaulted.** The platform block set
`MYSTRAL_USE_QUICKJS ON` unconditionally, so an explicit `-DMYSTRAL_USE_V8=ON` was accepted on the
command line, silently ignored, and reported back as `JS Engine: V8=OFF ... QuickJS=ON`. It now
honours an explicit choice and still defaults to QuickJS when none is given.

**The V8 backend compiles for Android.** With V8 selected, every source file builds — including
`src/js/v8_engine.cpp` — and the build fails at link with exactly one cause:

```
ld.lld: error: third_party/v8/libv8_monolith.a(abort-mode.o) is incompatible with aarch64linux
```

That is the **x86_64 desktop V8** being linked into an arm64 target. (§3.1's first question is
answered in §2.2, and the answer is not the one first recorded here.)

## 2.1 What was proved earlier

- **The Android runtime builds from source here.** `cmake --preset tn-android` configures cleanly
  with `ANDROID_NDK` and `CMAKE_ANDROID_NDK` both pointed at NDK 27.1.12297006. SDL3 needs
  `ANDROID_NDK` specifically — with only `CMAKE_ANDROID_NDK` set it looks for
  `/sources/android/cpufeatures/cpu-features.c` and the generate step fails.
- **A `tn-android` preset already exists** and already carries the engine switches
  (`MYSTRAL_USE_V8`, `MYSTRAL_USE_JSC`, `MYSTRAL_USE_QUICKJS`). Selecting a different engine is a
  cache variable, not new build plumbing.
- **`package-android.mjs` does not use that build.** It downloads a prebuilt
  `libmystral-runtime.so` from a release (`ANDROID_PREBUILT_ASSETS`). Any engine change has to
  reach the packaging path too, or the APK will keep shipping the old QuickJS runtime and every
  measurement will show no change.

### 2.2 The arm64 V8, and how it was obtained

`download-deps.mjs` has no Android URL for V8, so the artifact was fetched by hand. Reproducible
until it is automated:

```sh
curl -L -o v8-android-jit.zip \
  https://github.com/Kudo/v8-android-buildscripts/releases/download/v11.110.1/v8-android-jit.zip
unzip v8-android-jit.zip           # yields dist.tar
tar xf dist.tar                    # yields dist/packages/v8-android-jit/{include,org}
unzip dist/packages/v8-android-jit/org/chromium/v8-android/11.110.0/v8-android-11.110.0.aar -d aar
# headers: dist/packages/v8-android-jit/include
# library: aar/jni/arm64-v8a/libv8android.so   (29.9 MB)
```

They land in `packages/runtime-native/third_party/v8-android/{include,lib}`, beside the desktop
`third_party/v8` rather than replacing it, so a host build and a device build coexist in one
checkout. CMake prefers the Android directory when `ANDROID` is set.

**The version gap is real and does matter — corrected 2026-08-15.** The Android artifact is
**V8 11.0.226**; the desktop archive is **13.1**.

An earlier revision of this document claimed the backend compiled against 11.0 with zero errors.
**That was wrong.** The syntax-only check passed because the entire file sits behind
`#if defined(MYSTRAL_JS_V8)`, which that invocation never defined — it compiled an empty
translation unit and reported success. The tell was there and was misread: the object was
**864 bytes with no symbols**.

With the guard actually set, `v8_engine.cpp` fails on V8 11 at three sites:

```
v8_engine.cpp:173:26: error: no matching constructor for initialization of 'v8::ScriptOrigin'
v8_engine.cpp:225:26: ...
v8_engine.cpp:269:26: ...
```

`ScriptOrigin` dropped its leading `Isolate*` parameter after V8 11, so code written for 13.1 does
not compile against 11.0. Option A is therefore a dependency addition **plus a small backend port**
— three call sites on current evidence, not a rewrite, but not zero either. Any fix must stay
version-guarded so the desktop 13.1 build keeps compiling.

Note this is the **JIT** build (`v8-android-jit.zip`). A JIT-less V8 would reproduce the problem
this PRD exists to solve.

### 2.3 Eleven blockers cleared; the twelfth is where it stands

The build path now goes end to end: **the APK contains `libv8android.so`, `libc++_shared.so` and
`assets/v8/snapshot_blob.bin`, and installs.** It does not yet run — `createV8Engine()` returns
null and the runtime reports "Failed to create JavaScript engine". Note C++ `std::cout` does not
reach logcat, so the absence of `[V8]` lines is not evidence of where it stopped.

| # | Blocker | Fix | File |
|---|---|---|---|
| 1 | SDL3 reads `ANDROID_NDK`, not `CMAKE_ANDROID_NDK` | pass both | invocation |
| 2 | preset set `ANDROID_ABI`, which CMake's Android support ignores — **it could never build arm64** | `CMAKE_ANDROID_ARCH_ABI` | `CMakePresets.json` |
| 3 | static libs not position-independent | `CMAKE_POSITION_INDEPENDENT_CODE` | `CMakePresets.json` |
| 4 | `elseif(UNIX)` links `-lpthread`/`-ldl`; bionic has neither | Android branch first | `CMakeLists.txt` |
| 5 | engine hard-forced to QuickJS, ignoring `-DMYSTRAL_USE_V8=ON` | honour explicit choice, default unchanged | `CMakeLists.txt` |
| 6 | no arm64 V8 | `third_party/v8-android` | §2.2 |
| 7 | single V8 path for two ABIs | per-ABI selection | `CMakeLists.txt` |
| 8 | `libc++_shared.so` missing — V8 links the shared STL | `ANDROID_STL` follows the engine | `build.gradle.kts` |
| 9 | gradle hardcoded `MYSTRAL_USE_QUICKJS=ON` | `-PthreenativeJsEngine=v8`, QuickJS default | `build.gradle.kts` |
| 10 | external startup snapshot never loaded | asset + `SetSnapshotDataBlob` | `v8_engine.cpp`, `android_main.cpp`, gradle |
| 11 | **guard mismatch**: `v8_engine.cpp` is behind `MYSTRAL_JS_V8`, new code used `MYSTRAL_USE_V8` | align on `MYSTRAL_JS_V8` | `android_main.cpp` |

Blocker 11 is worth remembering: the file compiled to an **864-byte object with no symbols** and the
linker blamed the *caller*. A guard that is merely spelled differently produces a missing-symbol
error pointing at the wrong file.

### 2.4 Where it actually stands: V8 runs, and aborts inside `V8::Initialize`

With blocker 12 fixed (`MYSTRAL_JS_V8` was defined only in the desktop branch, so the engine sources
compiled to nothing and the factory silently had no engine) and the `ScriptOrigin` port in place,
V8 now **loads and executes on the device**. It aborts:

```
libv8android.so  V8_Fatal(char const*, ...)
libv8android.so  v8::V8::Initialize(int)
libmystral-runtime.so  mystral::js::V8Engine::V8Engine()
```

**V8 named the cause itself** (blocker 13), and it is not the version pairing this document first
suspected:

```
# Fatal error in , line 0
Embedder-vs-V8 build configuration mismatch.
On embedder side pointer compression is DISABLED while on V8 side it's ENABLED.
```

The Android V8 is built **with pointer compression**; the desktop archive is not. Those change the
in-memory representation of every V8 handle, so the embedder must be compiled to match the library
it links — `V8_COMPRESS_POINTERS` and `V8_COMPRESS_POINTERS_IN_SHARED_CAGE`, defined only on the
Android branch. This is a per-library property, never a host preference.

Read the abort with `adb logcat -b crash` **before the buffer rotates** — the first tombstone here
lost it and cost a round of guessing. And instrument with `__android_log_print`: C++ `std::cout`
never reaches logcat, which is why an earlier absence of `[V8]` lines proved nothing.

If a further mismatch appears, the remaining untested pieces are the snapshot
(`SetSnapshotDataBlob` ordering against `InitializePlatform`) and the `icudtl.dat` the package ships
which this work never wired up.

**Default is unchanged.** Everything above is conditional: with no `-PthreenativeJsEngine` the
Android build is exactly the QuickJS one it was, and the desktop and iOS paths are untouched.

---

## 3. The options

| # | Approach | Expected | Principal risk |
|---|---|---|---|
| A | **V8 on Android** | closes most of the 10.4× | **now the only blocker**: `download-deps.mjs` has no Android URL, so `third_party/v8` holds the x86_64 archive. The known prebuilt (`Kudo/v8-android-buildscripts`, v11.1000.4) is a major version behind the desktop 13.1, so it may or may not satisfy the backend that just compiled |
| B | **JSC on Android** | JIT-class, same order as V8 | `MYSTRAL_USE_JSC` is implemented in `jsc_engine.mm` — Objective-C++, iOS-only. Android needs a port to the JSC C API plus an `android-jsc` shared library |
| C | **Bulk transform ABI** | removes the framework's ~50% share, never the game's | does not close the gap alone; the game's own update loop stays interpreted |
| D | **Accept and document** | nothing | ThreeNative's mobile story stays "3× slower than Godot on a flat scene of moving objects" |

**A and B are the only options that can close it.** C is worth doing on its own merits and is
already partly done, but on the measured split it caps out around half the framework's share —
roughly 25% of the frame — while the game's animation loop stays where it is.

### 3.1 What decides between A and B

Unmeasured, and each is a bounded experiment rather than an opinion:

1. Does the V8 backend in this repo compile against V8 11.x, or does it use 12/13-era API? That
   single question decides whether option A is a dependency addition or a backend rewrite.
2. How much of `jsc_engine.mm` is Objective-C as opposed to the plain JSC C API? If it is mostly
   the C API, option B is a file rename and a link change.
3. Binary size. QuickJS is a few hundred kilobytes; V8 is tens of megabytes, and the APK is already
   218 MB.

---

## 4. Acceptance criteria

Consumer-scoped, and each only satisfiable by something that ran.

- [x] `pnpm bench:engines --arm tn-android` reports the L3 @ 16 384 rung at **under 39.27 ms**, the
      figure Godot's Android export produced on the same device on 2026-08-14 — measured with the
      device at **≥50% battery**, which PRD-117's provisional numbers were not.
      **8.32 ms p50 at 72% battery, 2026-08-16**, `Thermal Status: 0`, no `--allow-low-battery`
- [x] The APK under test contains the newly built runtime, proved by the packaging path, not by
      assumption — a run that silently shipped the prebuilt QuickJS `.so` is the failure this
      criterion exists to catch. **Three checks: the archive carries `libv8android.so` and
      `assets/v8/snapshot_blob.bin`; the runtime `.so` has 95 undefined `v8::` symbols and zero
      QuickJS entry points; the on-device `base.apk` sha256 equals the local archive's**
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm budgets` are green, and the default repo
      gate still requires no NDK
- [x] `examples/native-smoke` still asserts one import-free ESM file, and the desktop and iOS
      arms are unchanged — no C++, CMake or preset file was touched by the retake
- [x] The APK size change is recorded, whatever it is. **+25.6 MB of arm64 payload
      (75.8 → 101.4 MB uncompressed); +142.7 MB on the two-ABI benchmark archive**
- [x] `packages/runtime-native/AGENTS.md` is updated to state which engine each platform runs and
      why — the line "Android QuickJS+wgpu-native" becomes wrong the moment this lands.
      **It stays true as a statement of the default, and now says so explicitly, alongside the
      measured cost of the default and what selecting V8 requires**

Explicitly **not** an acceptance criterion: that ThreeNative beats Godot on every rung. Closing a
3× gap to parity at 16 384 is the goal; a result showing the engine swap buys less than expected is
a successful execution of this PRD and the most useful thing it could produce.

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | The engine swap lands but the APK still ships the prebuilt QuickJS runtime, and the benchmark reports no change | Assert the packaged `.so` is the one just built, before measuring |
| 2 | V8 11.x headers do not match the backend | Answer §3.1 question 1 first; it is a compile, not a guess |
| 3 | Binary size makes the APK unshippable | Recorded as a criterion; if it fails, option B or C is the answer |
| 4 | A JIT-less engine is required on some Android configuration | Keep QuickJS selectable; this is a preset variable, not a deletion |
| 5 | The measurement is taken at low battery again and reads as noise | ≥50% is in the criteria, and the PRD-117 numbers are marked provisional for exactly this reason |

**Failure mode this PRD is most likely to hit:** shipping a runtime nobody measured, because the
packaging path and the build path are separate and only one of them changed.

---

## 6. What this PRD does not decide

`packages/runtime-native/AGENTS.md` records "Android QuickJS+wgpu-native" as the platform's
architecture, and the CMake comment gives the reason: simplest to integrate, no special runtime
deps. That was a sound call when nothing had measured its cost. It now has a measured cost of 3×
against the engine ThreeNative is compared with. **Whether to pay the size and complexity to
reverse it is the owner's decision, not this document's** — the point of the PRD is that the
decision is now informed.

**Answered 2026-08-16: the owner took V8 as the Android default**
([PRD-130](./PRD-130-android-default-js-engine.md)). Flipped and proved the same day
in all three places the default is stated, both directions exercised on the Pixel 8 with the engine
read from logcat: [`prd-130-phase-6-2026-08-16.md`](../../verification/prd-130-phase-6-2026-08-16.md).
A fresh paired A/B on the same bundle put the top rung at 8.34 ms under V8 against 101.24 ms under
QuickJS — and the V8 side is the 120 Hz vsync interval, so that 12x is a lower bound.
`-PthreenativeJsEngine=quickjs` is the rollback.
