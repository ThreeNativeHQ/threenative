# PRD-221 phase 2 — the packaged application rejects any misaligned native dependency

Status: **COMPLETE — pending independent reviewer PASS.**

Candidate: branch `prd221/android-v8-16kb`, HEAD `99eac80ec7e969ec4aa9c90507d0d4df9ef63139`.
Host: linux-x64, Node v20.19.6, Vitest 4.1.10. Android SDK build-tools 36.0.0, NDK
28.2.13676358, JDK 17. Every command below was executed on this machine, 2026-09-11.

## Wiring on the branch

- `packages/runtime-native/scripts/check-android-16kb-alignment.mjs` — `readZipEntries` reads the
  archive's central and local headers to get each library's true data offset;
  `androidArtifactLibraryCensus` groups entries per ABI and refuses an empty or undeclared-ABI
  census; `assertAndroidArtifact16KbAlignment` checks the archive offset of every **stored**
  library and then every library's ELF LOAD segments; `verifyArchiveAlignmentWithZipalign`
  corroborates the offsets with the SDK's own `zipalign -c -P 16`.
- `packages/runtime-native/scripts/package-android.mjs:805` calls `alignAndroidArchive(output)`
  after Gradle and before the census, and `:809` runs `assertAndroidArtifact16KbAlignment(output)`
  on the artifact that ships. `alignAndroidArchive` fails closed when `zipalign`, `apksigner`, or
  the debug keystore is missing.

## Required test — green

```sh
packages/runtime-native $ ../../node_modules/.bin/vitest run --config vitest.config.ts \
  tests/android-packaging.integration.test.mjs
```

```
Test Files  1 passed (1)
Tests       13 passed (13)
```

Together with the phase-1 alignment suite: **48 passed**. The suite rejects a completed artifact
whose packaged library is misaligned and rejects an empty library census.

## Observed red, then green — on real packaged APKs, not fixtures

**Red.** A real APK this repository produced before the packager aligned the archive is still
rejected today by the same function. Pulled from the emulator, `com.threenative.bayview`
(base.apk sha256 `4764619f3ce1c518ec0af7b22140e36b6de445fab433abb97a39bc5b79939e75`,
250 542 402 bytes):

```
Android 16 KB alignment check failed for …/bayview.apk!lib/arm64-v8a/libSDL3.so:
uncompressed library stored at archive offset 0x11d000, which is not a multiple of 0x4000
```

That APK was built by an installed packager that predates `alignAndroidArchive`; it is
byte-identical to the first real build this phase recorded as refused. The unit control
`the packager aligns the finished APK to 16 KB before censusing it, and fails closed` also went
`1 failed | 12 passed` before the fix and `13 passed` after.

**Green.** The default starter was then rebuilt with this branch's packager against the recipe-6
V8 (`prd221-16kb-starter.apk`, sha256
`6acd46affa374b022a88a506c9e173178c58b1b4abd45b740983a16376f14aab`, 104 442 060 bytes). The
packager aligned it with `zipalign -P 16`, re-signed it with `apksigner`, and censused the result:

```
  16 KB ok: lib/arm64-v8a/libSDL3.so          (stored, offset 0x120000,  LOAD 0x4000, 0x4000, 0x4000)
  16 KB ok: lib/arm64-v8a/libc++_shared.so    (stored, offset 0x320000,  LOAD 0x4000, 0x4000, 0x4000, 0x4000)
  16 KB ok: lib/arm64-v8a/libmystral-runtime.so (stored, offset 0x454000, LOAD 0x4000, 0x4000, 0x4000)
  16 KB ok: lib/arm64-v8a/libv8android.so     (stored, offset 0x13bc000, LOAD 0x4000, 0x4000, 0x4000)
  16 KB ok: lib/x86_64/libSDL3.so             (stored, offset 0x3038000, LOAD 0x4000, 0x4000, 0x4000)
  16 KB ok: lib/x86_64/libc++_shared.so       (stored, offset 0x3264000, LOAD 0x4000, 0x4000, 0x4000, 0x4000)
  16 KB ok: lib/x86_64/libmystral-runtime.so  (stored, offset 0x3394000, LOAD 0x4000, 0x4000, 0x4000)
  16 KB ok: lib/x86_64/libv8android.so        (stored, offset 0x4484000, LOAD 0x4000, 0x4000, 0x4000)
ThreeNative Android APK: …/prd221-16kb-starter.apk — 8 native libraries 16 KB clean,
  archive offsets confirmed by /home/joao/Android/Sdk/build-tools/36.0.0/zipalign
```

An independent re-census of the installed APK (`adb pull` of the installed base.apk, sha256
`b0ba6c6a02275fba4988802c6f5817038937d83f58a8108293c400b81acc96e4`) also reports 8 libraries
16 KB clean with `zipalign` corroboration, so the artifact that shipped is the one inspected.

## User verification

The aligned starter installs (`adb install -r` → `Success`) and its libraries map on
`threenative_ps16k`; the run is recorded in the phase-3 record of the same date. No uninspected
library is credited: the census enumerates the archive rather than a build directory.

## Remaining

Independent reviewer decision: **PENDING**, not self-awarded.
