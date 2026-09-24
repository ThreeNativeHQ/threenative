# PRD-447 — The distributable ships only what the player runs

**Status:** IN PROGRESS
**Complexity:** 4 (MEDIUM); risk override: none. About 9 implementation files, and the change crosses the release/prebuilt boundary.
**Owner:** Claude (session 2026-09-24)
**Depends on:** None. Coordinates with PRD-399, which qualifies dev distributables on an x86_64 emulator.

## Context

Study: `docs/spikes/distributable-size-2026-09-24.md`. Everything below was measured on the PRD-399
consumer sandbox game (the newest APK and web dist, 2026-09-22) and the local `tn-linux` trees.

| Distributable | Today | Dominated by |
| --- | --- | --- |
| Android release APK | 105 MB | native libraries for two ABIs: 101 MB (x86_64 alone is 53 MB) |
| Desktop Linux runtime (`mystral`) | 126 MB | 52 MB of debug and symbol sections; `strip` gives 74 MB |
| Native `assets/scripts/main.js` | 5.0 MB raw / 985 KB deflated | `minify: false` at `packages/runtime-native/scripts/bundle.mjs:372` |
| Web `dist/` | 6.9 MB | 3.6 MB main chunk, including 2.1 MB of base64 Rapier WASM; Basis transcoder shipped twice; Draco in three variants |

Files inspected:

- `packages/runtime-native/android/app/build.gradle.kts:100-113`: ABI list defaults to `arm64-v8a,x86_64`; splits are opt-in.
- `packages/runtime-native/scripts/package-android.mjs:776-799, 843-895`: copies every supplied asset; `debug|release` modes.
- `package-desktop.mjs`, `desktop-distribution.mjs`, `native-build.mjs`: no strip step, although the tree builds `CMAKE_BUILD_TYPE=Release`.
- `packages/runtime-native/CMakeLists.txt:81, 1145`: SWC is ON for desktop only, used by `src/js/module_system.cpp:587` and `src/cli/bundler.cpp:192`.
- The Linux link line has no `--gc-sections`; Android already has it.

Android stripping already happens: AGP's `stripReleaseDebugSymbols` gives 16.8 MB in the APK against the 34.7 MB unstripped `.so`.

## Solution

Four kinds of cut, none of which changes what a game can do:

1. **Native payload:** release Android builds ship arm64 only; the desktop runtime is stripped and linked with section GC; SWC leaves the packaged desktop runtime if nothing there loads `.ts`.
2. **JS payload:** minify the native bundle; ship one copy of each web decoder; load Rapier's WASM as a file when that measurably lowers transfer bytes.
3. **Content hygiene:** packagers copy only files the build's asset manifest names, and report the rest.
4. **Transfer:** the web build emits brotli and gzip sidecars.

Consumer flow: `threenative build` (web, or `--target android|desktop`) → packager → distributable → the same playtest that qualifies it today, plus a size observation.

Risks:

- **Dev-lane breakage.** The x86_64 emulator lane (PRD-366, PRD-399) needs x86_64. Debug builds and explicit `-PthreenativeAbis` keep both ABIs; only release defaults change.
- **Minification breaks name-dependent code** (`constructor.name`, function names in registries). Proved by the playtest on both native targets before the default changes.
- **Prebuilt cohort shape** (`PREBUILT_ASSET_NAMES` has three consumers, including the proof lock). Stripping must not rename or add a prebuilt asset. The SWC cut must not either, or it moves out of scope.

Out of scope, with reasons:

- QuickJS, rejected by the owner on 2026-09-24: too slow against V8.
- An ICU-free V8 rebuild (estimated −10 MB per ABI; needs a multi-hour Chromium build and drops `Intl`). Follow-up PRD.
- quiche opt-out: WebTransport is a shipped API, and one prebuilt runtime serves every game.
- Gating the playtest bridge: agents prove release builds through it.
- Compressing Android native libraries: trades installed size, and Play already compresses in transit.

## Acceptance criteria

- [ ] AC-1 [local; actor: agent]: `threenative build --target android` in release mode produces an APK/AAB whose `lib/` holds only `arm64-v8a`; debug mode and `-PthreenativeAbis=arm64-v8a,x86_64` still produce both. Consumer game release APK ≤ 55 MB (from 105 MB); it passes `pnpm native:verify:android:artifact` and its existing playtest on an arm64 target. — Evidence: pending.
- [ ] AC-2 [local; actor: agent]: The packaged desktop runtime carries no `.debug_*`, `.symtab` or `.strtab` sections, and is ≤ 80 MB (from 126 MB); the starter's `test:native` still qualifies on Linux x64. — Evidence: pending.
- [ ] AC-3 [local; actor: agent]: The native `main.js` is minified: the consumer game's bundle is ≤ 2.2 MB (from 5.0 MB), and the consumer playtest passes on desktop and on the Android emulator. — Evidence: pending.
- [ ] AC-4 [local; actor: agent]: The Android, desktop and iOS packagers copy only files the build's asset manifest names; a fixture holding a stray `*.orig` file packages without it and the build prints its path. — Evidence: pending.
- [ ] AC-5 [local; actor: agent]: A template web build ships one Basis transcoder and one Draco decoder variant; a KTX2 texture and a Draco model still load in the existing template playtest. — Evidence: pending.
- [x] AC-6 [local; actor: agent]: The web build emits `.br` and `.gz` sidecars for every JS, WASM, CSS, HTML and JSON file over 1 KB; the record names main-chunk raw, gzip and brotli bytes. — Evidence: `action-rpg` scaffolded from local tarballs and built with `threenative build --target web`: 15 `.br` + 15 `.gz`, 0 JS/WASM/CSS/HTML/JSON files over 1 KB without a sidecar; `web main chunk assets/index-*.js: raw 3564059 B, gzip 1218667 B, brotli 934057 B`. `compression.spec.ts` red (module missing) → green, round-trips bytes and the entry report.
- [ ] AC-7 [local; actor: agent]: Rapier on web loads its WASM as a separate file **only if** brotli transfer bytes for the physics payload drop and a physics template playtest still passes. Otherwise the change is reverted and the measured reason recorded here. — Evidence: pending.
- [ ] AC-8 [local; actor: agent]: The Linux runtime links with `-ffunction-sections -fdata-sections -Wl,--gc-sections`, kept only if the stripped binary shrinks and the native contract tests stay green. The measured delta is recorded either way. — Evidence: pending.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Release ABI set | `threenative build --target android` release → `package-android.mjs` → Gradle `threenativeAbis` | Release default `arm64-v8a`; debug keeps both | AC-1 |
| Stripped desktop runtime | `threenative build --target desktop` → `package-desktop.mjs` / `desktop-distribution.mjs` | Unstripped copy replaced by a stripped copy | AC-2 |
| Minified native bundle | `bundle.mjs` (called by every native packager) | `minify: false` → minified | AC-3 |
| Manifest-only packaging | `package-android.mjs:776-799`, `package-desktop.mjs:322-338`, `package-ios.mjs:523-540` | Recursive copy → manifest-driven copy | AC-4 |
| Web decoders and sidecars | `threenative build` web → Vite → `buildWeb` | Duplicate decoder emit removed; compression step added | AC-5, AC-6 |

## Execution Phases

#### Phase 1: Native payload

**Status:** IN PROGRESS
**ACs:** AC-1, AC-2, AC-8

- [x] Release default ABI is `arm64-v8a` (Gradle and packager), debug keeps both; spec red before the change, green after. — `package-android.mjs:androidAbiGradleArgs` passes `-PthreenativeAbis=arm64-v8a` for release unless `THREENATIVE_GRADLE_ARGS` names a set; debug keeps the Gradle default (both). `android-release-abis.spec.ts` red (`androidAbiGradleArgs is not a function`, 3 failed) → green 3/3; the 4 package-android specs 53/53.
- [ ] Desktop packaging strips the runtime (`llvm-strip`/`strip` on Linux, `strip -x` on macOS; Windows PDBs stay out of the archive); prebuilt asset names unchanged. — Partial: Linux `strip --strip-all` (fallback `llvm-strip`) runs on the release sidecar copy in `package-desktop.mjs:stripDesktopRuntime`; the local `tn-linux/mystral` copy went 126,432,264 → 74,254,000 bytes, 0 `.debug_*/.symtab/.strtab` sections, `--version` exits 0. Windows copies no `.pdb` (spec). **macOS not stripped**: `strip` voids the linker signature Apple Silicon needs to launch an unsigned build and no macOS lane here proves a re-sign. `PREBUILT_ASSET_NAMES` untouched. Specs: `desktop-strip.spec.ts` red 7 failed → green 7/7; 8 desktop packaging test files 222 passed. Runtime proof (`test:native`) pending.
- [ ] Linux section GC measured and kept or rejected (AC-8).
- [ ] SWC decision recorded: if no packaged-runtime path loads `.ts`, the release desktop runtime builds with `MYSTRAL_USE_SWC=OFF` under the same prebuilt asset name. Otherwise record why and leave it.
- [ ] Consumer release APK size and arm64 playtest recorded (AC-1); stripped desktop size and starter `test:native` recorded (AC-2).

**Files:** `android/app/build.gradle.kts`, `scripts/package-android.mjs`, `scripts/package-desktop.mjs` or `scripts/desktop-distribution.mjs`, `CMakeLists.txt`, their `__tests__` specs.
**Verification:** E1: `unzip -l <release.apk> | grep lib/`, `pnpm native:verify:android:artifact`, playtest `--target android` on the Pixel 8 or an arm64 emulator. E2: `readelf -S` on the packaged runtime, starter `test:native`. E3: `ctest` contract tests after section GC.
**Checkpoint:** pending

#### Phase 2: JS payload

**Status:** IN PROGRESS
**ACs:** AC-3, AC-5, AC-7

- [x] `bundle.mjs` minifies; any name-dependent failure is fixed at its engine source, not by turning minify back off. — `minify: true` with `keepNames: true` (core's backend stamp reads `constructor.name` at `renderer.ts:755`, `geometry-capture.ts:453`) and `comments.legal` (8 licence banners kept). Consumer game, same source: android 4,918,166 → 2,063,155 B, desktop 7,311,684 → 4,399,418 B; `keepNames:false` would save only ~117 KB more. `bundle-minify.spec.ts` red (stashed `bundle.mjs`) → green; runs the minified bundle and reads back a class name.
- [ ] Consumer playtest passes on desktop and on the Android emulator with the minified bundle (AC-3).
- [ ] One Basis transcoder and one Draco variant emitted (AC-5).
- [ ] Rapier WASM-as-file measured and kept or reverted (AC-7).

**Files:** `packages/runtime-native/scripts/bundle.mjs`, the web decoder emit in `packages/core` or `packages/assets`, the physics web loader in `packages/physics`.
**Verification:** E4: `ls -la` on `assets/scripts/main.js`, playtest on both native targets. E5: `pnpm test:templates` for a KTX2 + Draco template. E6: brotli bytes before and after, plus a physics template playtest.
**Checkpoint:** pending

#### Phase 3: Content hygiene and transfer

**Status:** IN PROGRESS
**ACs:** AC-4, AC-6

- [ ] Packagers copy the manifest's file set and print what they skipped; spec with a stray `.orig` fixture is red first (AC-4).
- [x] Web build writes `.br`/`.gz` sidecars (AC-6). — `create-threenative/src/compress.ts`, called from `buildWeb`; node:zlib only.
- [ ] Spike doc updated with the achieved sizes; `pnpm typecheck && pnpm lint && pnpm test` green.

**Files:** `package-android.mjs`, `package-desktop.mjs`, `package-ios.mjs`, `buildWeb` in `packages/create-threenative`.
**Verification:** E7: packager specs. E8: `find dist -name '*.br'` on a template build. E9: the full gate.
**Checkpoint:** pending
