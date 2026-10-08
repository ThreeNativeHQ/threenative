# PRD-507 — The same corpus runs on Android arm64 (N05c)

**Status:** DONE 2026-10-07 — the Perry corpus runs on a physical arm64 Pixel 8, standalone and packaged in an activity
**Complexity:** 4 — cross-compilation, NDK linking and packaging for a third-party compiler runtime
**Owner:** João
**Work package:** N05 — [native-engine batch](../../../native-engine/README.md) · [N05 index](README.md)
**Depends on:** [PRD-505](PRD-505-n05a-the-language-corpus-compiles-on-linux-x64.md); the `three-fixture` and callback cases from [PRD-506](PRD-506-n05b-three-imports-bind-natively-and-callbacks-are-reclaimed.md) join once they exist

## Context

§8.4 requires the corpus on Linux x64 **and** Android arm64 early: an LLVM target triple does not
establish a working runtime, linker, standard library, ABI or packaging path. §18 lists "device
path differs from desktop" as a stop risk. The repository already builds the native host for
Android through the NDK and Gradle (`packages/runtime-native/android/`, build tree
`packages/runtime-native/build/tn-android`) and packages 16 KB-aligned libraries
(`pnpm native:verify:android:artifact`). The compiler's GC runtime (Boehm, PRD-505 decision) must
link into that same shape.

## Solution

1. Cross-compile each corpus case for `aarch64-linux-android` with the pinned toolchain plus the
   repository's pinned NDK; link the compiler's runtime and GC statically into one `.so` per case.
2. Run each case two ways: as a standalone executable pushed with `adb` (fast loop), and loaded by
   a minimal Android activity from the existing host's packaging path (the real shape).
3. 16 KB page alignment is checked on every produced library with the existing verifier.
4. Same expected stdout files as Linux x64 — no Android-specific expectations.

## Out of scope

- Strict game APK packaging and artifact manifests — [PRD-530 (N17)](../../../native-engine/PRD-530-n17-strict-native-typescript-game-packaging.md).
- Device performance claims — [PRD-533 (N20)](../../../native-engine/PRD-533-n20-platform-qualification-performance-default-promotion.md).

## Execution Phases

#### Phase 1: Cross-compile and link
**Status:** DONE
**Files:** `tools/native-typescript/{android.mjs,build-cross-runtime.mjs,provision.mjs,three-bridge.mjs,compiler.lock.json,targets/android-arm64.json}`
- [x] Every corpus case links for `aarch64-linux-android` with the pinned NDK and GC runtime. proof: `node tools/native-typescript/run-corpus.mjs --native --target aarch64-linux-android --build-only` — 2026-10-07: 19 of 19 cases ok (18 link to `lib<case>.so`, `unsupported-export` is refused at compile time as its `.expected` requires), Perry v0.5.1520 `--target android`, NDK 28.2.13676358, `tn_engine_*` built for arm64 (`-DTN_ENGINE_CORE_ONLY=ON` into `packages/runtime-native/build/android-core-arm64-v8a`). The blocker recorded on 2026-10-06 is closed by building Perry's runtime from the compiler's own source, see Decisions 1.
- [x] Every produced library passes 16 KB alignment. proof: `node packages/runtime-native/scripts/check-android-16kb-alignment.mjs artifacts/native-typescript/android` — 2026-10-07: "Android 16 KB check passed ... (18 ELF files)". Red control: an NDK 28 link of a trivial library with `-Wl,-z,max-page-size=4096` fails the same check ("LOAD alignments 0x1000 ... expected every segment >= 0x4000"). The packaged APK passes as well (`... app-debug.apk --abis arm64-v8a`: 2 native libraries).

#### Phase 2: Run on a device
**Status:** DONE
**Files:** `tools/native-typescript/{run-corpus.mjs,device.mjs,packaged.mjs,android/tn_so_runner.c,android/tn_pthread_keys.c,android/corpus-player/}`
- [x] Every case's stdout and exit code on an arm64 Android device match the Linux reference. proof: `node tools/native-typescript/run-corpus.mjs --native --target aarch64-linux-android --adb <serial>` — 2026-10-07 on a physical Pixel 8 (arm64-v8a, Android 17, not an emulator): 19 of 19 cases ok, alloc-loop peak RSS 43.2 MB (limit 512 MB). Decision 6 explains the device. Red controls, all observed: without `tn_so_runner`'s heap-tagging opt-out 12 of 19 pass and the seven stdlib-linked cases print empty output; without `tn_pthread_keys.o` a library aborts with "out of TLS keys" (exit 134).
- [x] The `three-fixture` case runs inside an Android app, loaded by an activity, not only as a pushed executable. proof: `node tools/native-typescript/run-corpus.mjs --native --target aarch64-linux-android --adb <serial> --case three-fixture --packaged` — 2026-10-07 on the same Pixel 8: 1 of 1 ok. What ran is a new minimal app, `android/corpus-player`, not the engine host's activity (Decision 7): built with the host's Gradle 8.13 distribution, AGP 8.11.1, SDK 36 and NDK 28.2, carrying `lib/arm64-v8a/libthree-fixture.so` as its only native library, installed with `adb install`, and run by `CorpusActivity` in the app process. Red control: with `android:allowNativeHeapPointerTagging="true"` the same run produces no output.

## Decisions

1. **Perry's Android runtime is built from the compiler's source, 2026-10-07.** v0.5.1520's Linux compiler is stamped `src:85ccd72f8e53...`, a hash of the tag's contract sources taken from a tree with no `.git` (not a commit), and its Android runtime `git:381045a8735f`; Perry refuses the pair. `tools/native-typescript/build-cross-runtime.mjs` clones the tag, checks the commit against `compiler.lock.json`, exports it without `.git`, and cargo-builds the runtime, stdlib and UI archives with the nightly in the tag's `rust-toolchain.toml` and the pinned NDK. The runtime takes the `src:` stamp, which equals the compiler's (also reproduced independently from the sources with Perry's algorithm). `compiler.lock.json` pins that stamp under `crossBuilds`, `provisionCross` serves only a tree whose runtime carries it, and Perry's own check still runs at every link. A build made on another machine installs with `--install <dir>`. The lock states that the stamp is the only trust anchor: the archives are not pinned by checksum because a Rust build is not reproducible bit for bit, and the build runs `cargo build --locked` on a date-pinned toolchain. Drop `crossBuilds` when the pin moves to a release whose archives match.
2. **Heap pointer tagging is off for the run, 2026-10-07.** Android 11+ tags malloc pointers in the top byte (0xb4...). Perry range-checks addresses as 48-bit values, so a stdlib-linked program reads its arena objects as shapeless: the first object after `js_object_alloc_with_shape` arrived as `0xb400007d63364a30` under lldb, stores past slot two were dropped, and `console.log` printed empty strings. This is not a build defect: the shipped archives behave the same (stamp-patched copy tested). The loader calls `mallopt(M_BIONIC_SET_HEAP_TAGGING_LEVEL, NONE)`, the packaged app sets `allowNativeHeapPointerTagging="false"`. PRD-530 must carry the manifest attribute into the strict game APK.
3. **Virtual pthread keys link into every library, 2026-10-07.** Android's std keeps each `thread_local!` in a pthread key and Perry's runtime declares several hundred, so a library aborts at bionic's 128. Upstream fixed it after the release (PerryTS/perry#10244, train v0.5.1565, no tag yet) by changing the runtime sources, which would change the stamp the compiler checks. `android/tn_pthread_keys.c` instead defines the four key calls with a per-thread table behind one real key, and reaches the link through `PERRY_EXTRA_LINK_ARGS`, so the compiler and runtime stay as shipped. Drop it when the pin moves to a release with the fix.
4. **`unsupported-export` imports `CatmullRomCurve3`, 2026-10-07.** It imported `Raycaster`, which PRD-531 slice 3 implemented, so its compile-error expectation failed on every target. The case needs a name the catalog still refuses.
5. **Not done here.** An x86_64 Android build of the same runtime (no consumer), and the strict APK shape (PRD-530).
6. **A physical Pixel 8 instead of the arm64 emulator, 2026-10-07.** The box named an emulator. The build host is x86_64 and cannot run an arm64 emulator, and the "Blocked on" line asked for the physical device, which also proves more (a real Mali driver, 4 KB pages, heap tagging). No emulator result is claimed.
7. **`corpus-player` instead of the host's activity, 2026-10-07.** The box asked for the host's packaged activity. The engine host's `engine-player` needs SDL3 and wgpu payloads and loads no TypeScript library, so a library has nothing to plug into. The corpus-player is the smallest app that loads one Perry library: same Gradle, AGP, SDK, NDK and ABI as the host's project. It proves the library loads and runs in an app process with packaged alignment, not that the engine's own activity can host it.

## Security and compatibility

An app that runs a Perry v0.5.1520 library must opt out of native heap pointer tagging (`android:allowNativeHeapPointerTagging="false"`), because Perry treats pointers as 48-bit values. That gives up the pointer-tag memory-safety checks Android 11 and later apply to the app's heap, so a strict game APK (PRD-530) carries the attribute only for as long as the pin does, and the tradeoff belongs in its release notes. The same applies to hardware memory tagging (MTE), which uses the same top byte.

## Upstream issue (draft, not posted)

> **Android arm64: pointers from bionic's tagged malloc break address classification (stdlib-linked programs print empty strings)**
>
> v0.5.1520, `--target android`, Pixel 8 (Android 17), runtime and stdlib built from the tag. From Android 11 bionic returns malloc pointers with a tag in the top byte (`0xb4…`). Any program that links perry-stdlib (a native library, `new Headers()`) reads its arena objects as shapeless: under lldb the first object after `js_object_alloc_with_shape` arrives as `0xb400007d63364a30`, `object_live_slot_count` returns 0, `js_object_set_field` drops every store past slot two ("OOB write ... field_count=2"), and `console.log` prints empty strings. A runtime-only program is unaffected. Calling `mallopt(M_BIONIC_SET_HEAP_TAGGING_LEVEL, M_HEAP_TAGGING_LEVEL_NONE)` before loading fixes it, as does `android:allowNativeHeapPointerTagging="false"` in an app. Suggested fix: strip the tag where addresses are classified, or document the manifest requirement. Related: #10219 / #10244 (pthread key exhaustion), which a second program hits first.
