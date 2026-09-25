# Distributable size: where the bytes are and how to cut them

Date: 2026-09-24. Read-only study; nothing in the engine was changed.

Measured on real outputs: the sandbox game `prd399/consumer` (newest APK and web dist, 2026-09-22),
the sandbox game `rigged-run` (QuickJS APK), and the local `packages/runtime-native/build/tn-linux*`
trees. Anything not measured is marked **unverified**.

## Where the bytes are today

| Distributable | Size | Dominated by |
| --- | --- | --- |
| Android APK (consumer) | **105 MB** | native libraries for 2 ABIs: 101 MB; game content under 1 MB |
| Desktop Linux binary (`mystral`, V8) | **126 MB** | debug info and symbols 52 MB; V8 about 34 MB |
| Web `dist/` (consumer) | **6.9 MB** | main chunk 3.6 MB, of which **2.1 MB is base64-inlined Rapier WASM** |

APK breakdown (consumer.apk, raw bytes; native libraries are stored uncompressed):

| Entry | arm64-v8a | x86_64 |
| --- | --- | --- |
| `libv8android.so` | 29.9 MB | 31.1 MB |
| `libmystral-runtime.so` | 16.8 MB | 18.5 MB |
| `libSDL3.so` | 2.1 MB | 2.3 MB |
| `libc++_shared.so` | 1.3 MB | 1.2 MB |
| `assets/scripts/main.js` | 5.0 MB raw / 0.99 MB deflated | |
| `classes.dex` | 2.7 MB raw / 0.89 MB deflated | |

Desktop binary composition (symbol bytes from `nm -S`; the QuickJS build has no V8):

| Component | Bytes | Removable? |
| --- | --- | --- |
| V8 | 20.8 MB of symbols; 34.6 MB stripped delta vs QuickJS | partly: ICU via an i18n-free build |
| tint (WGSL compiler) | 5.3 MB | no, Dawn needs it |
| SPIR-V tools | 4.4 MB | no, Dawn's Vulkan path needs it |
| swc (TypeScript compiler) | 3.8 MB | yes for release: shipped games load pre-bundled JS |
| Dawn | 2.2 MB | no |
| Skia | 2.0 MB | if Canvas2D is unused |
| Rapier | 1.6 MB | if physics is unused |
| SDL | 1.3 MB | no |
| quiche + BoringSSL | 1.0 MB | yes unless WebTransport is used |
| Rust regex | 0.9 MB | probably, pulled in with swc (**unverified**) |

The Android `libmystral-runtime.so` links wgpu/naga (2.8 MB), Skia (1.3 MB) and Rapier (1.2 MB),
and **not** swc or quiche (measured on the local, stale `build/tn-android` tree).

## Android levers, ranked

1. **Ship arm64 only: −53 MB (105 → ~52 MB). Free.** Both ABIs are the default
   (`packages/runtime-native/android/app/build.gradle.kts:100-102`). x86_64 only serves emulators.
   Keep it reachable for the emulator lane via `-PthreenativeAbis`, or use the existing
   `threenativeAbiSplits` / an AAB release. No performance cost.
2. **Trim V8 instead of replacing it: likely up to −10 MB per ABI (unverified).** The Android
   `libv8android.so` has a 13.9 MB `.text` and a 10.1 MB `.rodata`, and the `.rodata` carries
   embedded ICU data (`icudt72l`, plus `Intl::CompareStrings` and ICU object caches). A build with
   `v8_enable_i18n_support=false` drops ICU at the cost of `Intl` and locale-aware
   `toLocaleString`, which games rarely need. Blocker: the Android V8 payload has no reproducible
   build recipe, so this needs a V8 rebuild first. Keep WebAssembly (2.6 MB of desktop V8
   symbols): Recast navigation ships as WASM.
3. **Minify the native `main.js`: 5.0 → 1.95 MB raw, 985 → 548 KB in the APK.**
   `packages/runtime-native/scripts/bundle.mjs:372` hard-codes `minify: false` with no stated
   reason. Likely faster to parse as well. Risk: code that depends on `constructor.name` or
   function names; needs one playtest before it becomes the default.
4. **Package only manifest-referenced assets.** The packager copies every supplied file
   (`packages/runtime-native/scripts/package-android.mjs:776-799`; desktop and iOS packagers do the
   same). An older fps-framework APK carried 19 MB of `.orig` backups plus several different-hash
   copies of one model. The engine does not create those files, but ships them without a warning.
5. **Compress native libraries, sideload APKs only.** They are stored for 16 KB page alignment.
   gzip takes V8 30 → 10.5 MB and the runtime 16.8 → 6.4 MB. Play already compresses in transit,
   so this only matters for direct-download APKs, and it costs installed size. Situational.

Low value: R8 on `classes.dex` (1.1 MB compressed; `isMinifyEnabled=false` today).

## Desktop levers, ranked

1. **Strip: 126 → 74 MB. Free.** The tree is `CMAKE_BUILD_TYPE=Release` yet carries debug info;
   `package-desktop.mjs`, `desktop-distribution.mjs` and `native-build.mjs` contain no strip step.
   Whether the published prebuilt is stripped is **unverified**.
2. **The same ICU-free V8 build** applies to desktop; savings **unverified**.
3. **Drop swc from release runtimes: about 3.8 MB** (plus about 0.9 MB of Rust regex if it only
   comes with swc). Needs a CMake option (`packages/runtime-native/CMakeLists.txt:1143-1182`).
4. **Make quiche opt-in: about 1.0 MB.** `MYSTRAL_USE_QUICHE` defaults ON
   (`packages/runtime-native/CMakeLists.txt:1288`); only WebTransport uses it.
5. **Link hygiene:** the Linux link line lacks `--gc-sections`; C++ ThinLTO untested; the
   ui-overlay Rust crate has no release profile. Savings **unverified**.

## Web levers, ranked

1. **Stop shipping physics to games that do not use it.** All 10 templates call `rapier()`, so
   every scaffolded game pays about 2.1 MB raw / 845 KB gzipped.
2. **Precompress.** No `.br`/`.gz` sidecars are emitted. The 3.6 MB main chunk is 1.23 MB with
   `gzip -9` and **0.94 MB with brotli -q 11**. Hosts that do not compress on the fly (static zips,
   some CDNs) serve the raw file.
3. **Load Rapier's WASM as a file, not base64.** `@dimforge/rapier3d-compat@0.19.3` inlines a
   1.57 MB WASM as 2.09 MB of base64 and blocks streaming compilation. Switching to the non-compat
   package saves 0.5 MB raw; savings under brotli are **unverified** and likely smaller.
4. **Deduplicate decoders in zipped builds.** The Basis transcoder ships twice (2 × 527 KB,
   `dist/basis/` and `dist/assets/`) and Draco in three variants (about 1.2 MB). A browser fetches
   one of each, so this only shrinks itch-style zip downloads.
5. **Gate the playtest bridge.** It is present in 15 of 17 existing dists; Abyss carries a 959 KB
   playtest chunk. Whether it loads lazily is **unverified**. Agents prove builds through it, so
   gate it behind a flag rather than deleting it.

Already fine: sourcemaps are off, no font files ship, the inspector and `DebugOverlay` are
eliminated in production (zero hits across 17 dists), and `three` is tree-shaken.

## Assets

The pipeline already compresses by default: KTX2 ETC1S textures at quality 150 with a 2048 px
maximum edge (`packages/assets/src/passes/model-textures.ts:82-83`), and mesh quantization at
16/8/12 bits for position/normal/UV plus simplification
(`packages/assets/src/passes/model.ts:208-212`). The remaining wins are game-side: a lower
`maxSize` for mobile, and no opted-out `.none.jpg` images. Per-GPU-family texture variants were
not investigated (the asset scout timed out).

## Stacked best case: Android, consumer game

105 MB → **~52 MB** (arm64 only) → **~51.5 MB** (minified `main.js`) → **~42 MB** if an
ICU-free V8 saves the estimated 10 MB (unverified).

## Rejected: QuickJS

A QuickJS build is much smaller (rigged-run's single-ABI APK is 29.5 MB; the stripped desktop binary
drops from 74 to 40 MB), but its interpreter-only performance is far behind V8. Rejected by the
owner on 2026-09-24: not worth the size.

## Free wins to file as one PRD

1. Default Android ABI to arm64-v8a; keep x86_64 for the emulator lane.
2. Strip desktop release binaries in packaging.
3. Minify the native `main.js`, proved by a playtest.
4. Package only files the asset manifest references; warn on the rest.
5. Emit brotli and gzip sidecars from the web build.

## Achieved (PRD-447, 2026-09-24)

Measured on the same consumer game and local trees after the PRD-447 changes.

| Distributable | Before | After | Change |
| --- | --- | --- | --- |
| Android release APK | 105,284,577 B | 51,749,487 B | arm64-v8a only in release; debug keeps x86_64 |
| Native `assets/scripts/main.js` | 5,015,233 B | 2,063,155 B | esbuild minify, `keepNames`, licence comments kept |
| Desktop Linux runtime (packaged) | 126,432,264 B | 74,254,000 B | stripped release copy |
| Desktop Linux runtime + section GC | 74,327,728 B stripped | 58,072,784 B stripped | `--gc-sections`, Linux only |
| Web decoder copies in `dist/assets` | 7 files, 1.93 MB | 0 | never fetched; one Basis pair remains in `basis/` |
| Web main chunk transfer (`action-rpg`) | 3,564,059 B raw | 934,103 B brotli / 1,218,661 B gzip | `.br`/`.gz` sidecars |

Not taken, with the measurement: Rapier WASM as a file would save about 185 KB brotli
(`rapier_wasm3d_bg.wasm` 429,334 B against `rapier.mjs` 614,287 B) but needs the non-compat
`@dimforge/rapier3d`, a new dependency. SWC-off would save another 21.7 MB stripped on Linux, but
the prebuilt runtime is also the `mystral run foo.ts` CLI and ships `mystral-tools`, which
transpiles TypeScript. Manifest-only packaging was measured to drop hand-placed runtime files, so
the packagers skip only editor leftovers and superseded digest outputs (333 files in one game).

## Reproduce

```sh
# APK composition
unzip -lv <game>/dist-native/<game>.apk | sort -k1 -nr | head -25
# stripped desktop size
strip -o /tmp/mystral.stripped packages/runtime-native/build/tn-linux/mystral && ls -la /tmp/mystral.stripped
# component attribution
nm -C -S --size-sort packages/runtime-native/build/tn-linux-quickjs/mystral | less
# native main.js minify delta
unzip -p <game>.apk assets/scripts/main.js > main.js
node_modules/.pnpm/esbuild@*/node_modules/esbuild/bin/esbuild main.js --minify --target=es2022 --outfile=main.min.js
```
