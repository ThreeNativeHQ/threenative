# Android 16 KB page alignment — what was fixed, and what is blocked upstream

**Ran 2026-08-24**, Pixel 8 (`shiba`, Android 17) and a starter scaffold built through
`threenative build --target android`.

## How it surfaced

Not from a failing gate. The device put a modal **"Android App Compatibility"** dialog over the
game on launch, naming `lib/arm64-v8a/libv8android.so` as not 16 KB aligned. It covers the whole
screen, so the first `adb shell screencap` of the session captured the dialog rather than the
frame — which is its own trap for any capture lane that does not check what is in the foreground.

Android 15 and later can run with 16 KB memory pages. A shared library whose LOAD segments are
aligned to the older 4 KB cannot be loaded on such a device at all; the warning on a 4 KB device is
the system saying so in advance.

## Measured, from a fresh APK

```
  OK   lib/arm64-v8a/libc++_shared.so        0x4000
  OK   lib/arm64-v8a/libmystral-runtime.so   0x4000   (was 0x1000)
  OK   lib/arm64-v8a/libSDL3.so              0x4000   (was 0x1000)
  4KB  lib/arm64-v8a/libv8android.so         0x1000
  OK   lib/x86_64/libc++_shared.so           0x4000
  OK   lib/x86_64/libmystral-runtime.so      0x4000   (was 0x1000)
  OK   lib/x86_64/libSDL3.so                 0x4000   (was 0x1000)
  4KB  lib/x86_64/libv8android.so            0x1000
```

Read with the NDK's `llvm-readelf -l`, first `LOAD` segment's alignment column.

- **`libmystral-runtime.so`** — `-Wl,-z,max-page-size=16384` on the Android `SHARED` target. NDK 27
  does not pass this by default; NDK 28 does.
- **`libSDL3.so`** — SDL 3.2.8 to **3.2.30**, the same minor line and the first release in it whose
  64-bit Android libraries carry 16 KB alignment. Its 32-bit libraries stay at 4 KB, correctly:
  16 KB pages are a 64-bit concern and those two ABIs are not shipped.

## Blocked: `libv8android.so`

It is a prebuilt from `Kudo/v8-android-buildscripts`, and that project's **newest release is
v11.1000.4 from 2023-08-20** — before the requirement existed. There is no version to bump to.
The options are to build V8 here, which is not a bump, or to find another maintained Android V8.
Until then the V8 default cannot be 16 KB-clean. `-PthreenativeJsEngine=quickjs` ships no V8.

## What the fix cost, and what it caught

The SDL version was written out by hand in **four** places. Moving it left three of them naming an
archive that no longer existed, one of which surfaced as a Gradle input-file error three layers
away from the pin it disagreed with. The packager now owns the constant; Gradle discovers both the
AAR and the SDL source tree by name; CMake already globbed.

The source tarball moves with the AAR because Android takes its native library from the AAR and its
SDL Java classes from the source tree's `android-project`, and a skew there is a Java layer calling
a runtime it was not built against.

**The clean-room Android test caught a real regression** in the first attempt: `package-android.mjs`
imported the constant from `download-deps.mjs`, which is deliberately not in the published package,
so a shipped install failed at require time. Ownership is inverted — the file that ships owns it.

Regression tests in `scripts/__tests__/android-16kb-alignment.spec.ts`: the link option must stay on
the Android `SHARED` target, the SDL pin must not go below 3.2.30, and no file outside the owner may
write an SDL3 version literal. Each is red on its own mutation.

## Re-verified after the bump

Desktop rebuilds SDL from source, so it moved too: `mystral` rebuilt against 3.2.30 and
`scripts/desktop-ui-overlay-proof.sh` is still **8/8**. `pnpm typecheck`, `pnpm lint` and
`pnpm test` (2078) green.
