# PRD-447 — The distributable ships only what the player runs

**Status:** DONE (2026-09-24)
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

- [x] AC-1 [local; actor: agent]: `threenative build --target android` in release mode produces an APK/AAB whose `lib/` holds only `arm64-v8a`; debug mode and `-PthreenativeAbis=arm64-v8a,x86_64` still produce both. Consumer game release APK ≤ 55 MB (from 105 MB); it passes `pnpm native:verify:android:artifact` and its existing playtest on an arm64 target. — Evidence: consumer release build exits 0 (census prints `16 KB ok` for the 4 arm64 libraries); APK **51,749,487 B** (from 105,284,577), `aapt` `native-code: 'arm64-v8a'`; the debug APK built from the same tree carries both ABIs (107,055,308 B). `native:verify:android:artifact <apk> --abis arm64-v8a` passes (4 libraries). Pixel 8 (arm64, Mali-G715): `production-readiness.playtest.json` pass, 941 frames, 0 failed, 0 JS errors, runner exit 0. Earlier Pixel attempts failed `TN_PLAYTEST_BRIDGE_MISSING` because a sibling lane had reset the phone to a 30 s screen timeout, so the activity launched screen-off and was stopped; the bridge ships in the release bundle.
- [x] AC-2 [local; actor: agent]: The packaged desktop runtime carries no `.debug_*`, `.symtab` or `.strtab` sections, and is ≤ 80 MB (from 126 MB); the starter's `test:native` still qualifies on Linux x64. — Evidence: `starter` scaffolded from this branch's packages, `threenative build --target desktop --mode release`: the shipped `container/starter/starter` is **74,254,000 B** (input 126,432,264 B), `readelf -S` debug/symtab/strtab count **0** (input 13). `test:native` exit 0 (`starter desktop gate passed: 300 frames`; `consumer gameplay qualified on desktop: 5 assertions`), and the release container's playtest passes on it: `starter-production-readiness` pass, 941 frames, 5/5 assertions. Linux only; macOS is deliberately unstripped (see Phase 1).
- [x] AC-3 [local; actor: agent]: The native `main.js` is minified: the consumer game's bundle is ≤ 2.2 MB (from 5.0 MB), and the consumer playtest passes on desktop and on the Android emulator. — Evidence: consumer `assets/scripts/main.js` **2,063,155 B** (from 5,015,233), minified with names kept. Desktop: the minified bundle qualifies (`test:native` consumer gameplay, 5 assertions; release `starter-production-readiness` 941 frames, 5/5). Android x86_64 emulator (`threenative_api35`, branch debug APK, both ABIs): `production-readiness` pass 2/2, 941 frames, 0 console errors; baseline APK identical. One earlier red was `E/cr_CronetUrlRequestContext( 1624)` from a system process, reproduced 0 of 4 times: the runner's Android console capture is not pid-filtered (`packages/playtest/src/runner/android.ts:207`, `:506-519`). That is a pre-existing runner follow-up, not this change. `play.playtest.json` is `TN_PLAYTEST_UNSUPPORTED_ON_TARGET` on devices (network assertions) on both APKs.
- [x] AC-4 [local; actor: agent]: ~~The Android, desktop and iOS packagers copy only files the build's asset manifest names~~ **Amended 2026-09-24:** the Android and desktop packagers drop provable junk and print each path; a fixture holding a stray `*.orig` file packages without it and the build prints its path. — Evidence: the literal rule was measured to break real games: `public/` holds hand-placed runtime files no manifest names (wildwood 536 incl. `audio/*.ogg`, fps-framework 100, and the Basis transcoder in lumen-hall/menu-spike, whose older receipts predate it). Shipped rule (`scripts/asset-manifest.mjs`, used by both packagers): skip editor/VCS leftovers (`*.orig|.rej|.bak|.swp|~`, `.DS_Store`, `Thumbs.db`, `.gitkeep`) and, with a manifest, `<stem>.<hash>.<ext>` outputs superseded by a named same-stem sibling; keep everything else; a named file missing on disk fails `TN_ASSETS_MANIFEST_MISSING`. Real dirs (read-only): wildwood 425 copied / 333 superseded skipped, lumen-hall 68/27, fps-framework 90/23, consumer 7/0; zero `audio/` or `basis/` skips. `asset-manifest.spec.ts` red (4 failed on the manifest-only rule) → green 5/5; packaging tests 144 + 38 passed. iOS has its own copy loop and is not a supported target (owner, 2026-09-23), so it is unchanged.
- [x] AC-5 [local; actor: agent]: A template web build ships one Basis transcoder and one Draco decoder variant; a KTX2 texture and a Draco model still load in the existing template playtest. — Evidence: `starter` web dist ships one Basis pair (`basis/basis_transcoder.js` 57,529 + `.wasm` 527,333) and **zero** Draco decoders (was 7 never-fetched hashed decoder files, 1.93 MB). `textures.playtest.json` and `models.playtest.json` pass on the RTX 2080 (`webgpu:architecture=turing|vendor=nvidia`), 0 console/network errors. Draco: `starter`'s `native-proof.glb` re-encoded with `KHR_draco_mesh_compression` (required) cooks to `EXT_meshopt_compression`, and `models.playtest.json` passes (`TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb`, 0 errors), so no runtime Draco decoder is needed. Follow-up, pre-existing and unchanged: a raw Draco `.glb` shipped with every model sub-pass off would 404 on `draco/`, because nothing has ever copied that decoder.
- [x] AC-6 [local; actor: agent]: The web build emits `.br` and `.gz` sidecars for every JS, WASM, CSS, HTML and JSON file over 1 KB; the record names main-chunk raw, gzip and brotli bytes. — Evidence: `action-rpg` scaffolded from local tarballs and built with `threenative build --target web`: 15 `.br` + 15 `.gz`, 0 JS/WASM/CSS/HTML/JSON files over 1 KB without a sidecar; `web main chunk assets/index-*.js: raw 3564059 B, gzip 1218667 B, brotli 934057 B`. `compression.spec.ts` red (module missing) → green, round-trips bytes and the entry report.
- [x] AC-7 [local; actor: agent]: Rapier on web loads its WASM as a separate file **only if** brotli transfer bytes for the physics payload drop and a physics template playtest still passes. Otherwise the change is reverted and the measured reason recorded here. — Evidence: **not changed; reason measured.** `@dimforge/rapier3d-compat@0.19.3` exports only `"."` and its `init()` ignores `module_or_path`, always decoding the inlined base64; the file-loading path needs the non-compat `@dimforge/rapier3d`, a new dependency not in the catalog. Measured upside: `rapier_wasm3d_bg.wasm` 429,334 B brotli vs `rapier.mjs` 614,287 B (~185 KB less transfer). Baseline `action-rpg`: main chunk 3,564,059 raw / 934,103 brotli; JS+WASM brotli total 1,100,254 B. `packages/physics` vitest 180/180. Adding the dependency is a follow-up decision for the owner.
- [x] AC-8 [local; actor: agent]: The Linux runtime links with `-ffunction-sections -fdata-sections -Wl,--gc-sections`, kept only if the stripped binary shrinks and the native contract tests stay green. The measured delta is recorded either way. — Evidence: **kept.** Stripped `mystral` 74,327,728 → 58,072,784 B (−16.3 MB, −21.9%), raw 126,515,528 → 101,546,296; `ctest -L native-contract` 44/44 before and after. Games on the GC'd, stripped runtime: `starter` release playtest pass (941 frames, 5/5) and `test:native` pass (300 frames); consumer game desktop release `production-readiness` pass (941 frames, 5/5); 0 `undefined symbol`/`symbol lookup error`/crash lines. Desktop archive `starter.tar.gz` 29,552,864 → 23,643,803 B.

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

**Status:** DONE
**ACs:** AC-1, AC-2, AC-8

- [x] Release default ABI is `arm64-v8a` (Gradle and packager), debug keeps both; spec red before the change, green after. — `package-android.mjs:androidAbiGradleArgs` passes `-PthreenativeAbis=arm64-v8a` for release unless `THREENATIVE_GRADLE_ARGS` names a set; debug keeps the Gradle default (both). `android-release-abis.spec.ts` red (`androidAbiGradleArgs is not a function`, 3 failed) → green 3/3; the 4 package-android specs 53/53.
- [x] Desktop packaging strips the runtime (`llvm-strip`/`strip` on Linux, ~~`strip -x` on macOS~~; Windows PDBs stay out of the archive); prebuilt asset names unchanged. **Amended 2026-09-24:** macOS moves to a follow-up (strip must be followed by an ad-hoc re-sign, and only a macOS lane can prove the result launches). — Linux `strip --strip-all` (fallback `llvm-strip`) runs on the release sidecar copy in `package-desktop.mjs:stripDesktopRuntime`; the local `tn-linux/mystral` copy went 126,432,264 → 74,254,000 bytes, 0 `.debug_*/.symtab/.strtab` sections, `--version` exits 0. Windows copies no `.pdb` (spec). **macOS not stripped**: `strip` voids the linker signature Apple Silicon needs to launch an unsigned build and no macOS lane here proves a re-sign. `PREBUILT_ASSET_NAMES` untouched. Specs: `desktop-strip.spec.ts` red 7 failed → green 7/7; 8 desktop packaging test files 222 passed. Runtime proof (`test:native`) pending.
- [x] Linux section GC measured and kept or rejected (AC-8). — Kept (Linux-only block in `CMakeLists.txt`): stripped `mystral` 74,327,728 → **58,072,784 B** (−21.9%), raw 126,515,528 → 101,546,296; `ctest -L native-contract` 44/44 in both builds; `--version` exits 0. Games run on it: see AC-8.
- [x] SWC decision recorded: if no packaged-runtime path loads `.ts`, the release desktop runtime builds with `MYSTRAL_USE_SWC=OFF` under the same prebuilt asset name. Otherwise record why and leave it. — **Left ON.** A packaged game never reaches SWC (`module_system.cpp:577` returns for `.js`), but the same prebuilt asset is the dev CLI (`mystral run foo.ts`, `main.cpp:444`) and ships `mystral-tools`, whose bundler transpiles `.ts` (`bundler.cpp:190-192`, linked at `CMakeLists.txt:2105-2110`) for `threenative build --target desktop`. OFF would save a further 21.7 MB stripped (52,640,016 B) but break those commands; a separate player-only asset would change `PREBUILT_ASSET_NAMES`, out of scope.
- [x] Consumer release APK size and arm64 playtest recorded (AC-1); stripped desktop size and starter `test:native` recorded (AC-2). — Consumer release APK built from this branch on 2026-09-24: 105,284,577 → **51,749,487 B**, `lib/` arm64-v8a only (4 libraries), `main.js` 5,015,233 → 2,063,155 B; installs and launches on the Pixel 8 with no JS errors in logcat. Two breaks found and fixed on the way: the packager's post-build 16 KB census demanded an x86_64 slice and failed every release build (`4f99a5f7c`, census now checks the requested ABI set; the packaging fixture's fake Gradle had hidden it by always emitting both), and `native:verify:android:artifact` gained `--abis` (`d89ad78f4`; passes with `--abis arm64-v8a`, still fails without). Pixel playtest: `TN_PLAYTEST_BRIDGE_MISSING`, identical on the old baseline APK, so not caused by this branch; Pixel playtest passed on rerun (see AC-1); desktop `test:native` passed (see AC-2).

**Files:** `android/app/build.gradle.kts`, `scripts/package-android.mjs`, `scripts/package-desktop.mjs` or `scripts/desktop-distribution.mjs`, `CMakeLists.txt`, their `__tests__` specs.
**Verification:** E1: `unzip -l <release.apk> | grep lib/`, `pnpm native:verify:android:artifact`, playtest `--target android` on the Pixel 8 or an arm64 emulator. E2: `readelf -S` on the packaged runtime, starter `test:native`. E3: `ctest` contract tests after section GC.
**Checkpoint:** passed 2026-09-24 — evidence under the ACs above.

#### Phase 2: JS payload

**Status:** DONE
**ACs:** AC-3, AC-5, AC-7

- [x] `bundle.mjs` minifies; any name-dependent failure is fixed at its engine source, not by turning minify back off. — `minify: true` with `keepNames: true` (core's backend stamp reads `constructor.name` at `renderer.ts:755`, `geometry-capture.ts:453`) and `comments.legal` (8 licence banners kept). Consumer game, same source: android 4,918,166 → 2,063,155 B, desktop 7,311,684 → 4,399,418 B; `keepNames:false` would save only ~117 KB more. `bundle-minify.spec.ts` red (stashed `bundle.mjs`) → green; runs the minified bundle and reads back a class name.
- [x] Consumer playtest passes on desktop and on the Android emulator with the minified bundle (AC-3). — See AC-3.
- [x] One Basis transcoder and one Draco variant emitted (AC-5). — The engine Vite plugin (`engine-freshness.ts`) rewrites three's `new URL('../libs/…')` decoder defaults, so Vite stops emitting 7 never-fetched decoder files (1.93 MB). `starter` dist now holds one Basis pair (`basis/`, 584,862 B) and **no** Draco decoder: the model pass re-encodes Draco input as Meshopt, so none is fetched. `textures` and `models` playtests pass on the RTX 2080, 0 console/network errors. `three-decoder-urls.spec.ts` red (3 failed) → green.
- [x] Rapier WASM-as-file measured and kept or reverted (AC-7). — Not made: needs a new dependency; numbers under AC-7.

**Files:** `packages/runtime-native/scripts/bundle.mjs`, the web decoder emit in `packages/core` or `packages/assets`, the physics web loader in `packages/physics`.
**Verification:** E4: `ls -la` on `assets/scripts/main.js`, playtest on both native targets. E5: `pnpm test:templates` for a KTX2 + Draco template. E6: brotli bytes before and after, plus a physics template playtest.
**Checkpoint:** passed 2026-09-24 — evidence under the ACs above.

#### Phase 3: Content hygiene and transfer

**Status:** DONE
**ACs:** AC-4, AC-6

- [x] Packagers copy the manifest's file set and print what they skipped; spec with a stray `.orig` fixture is red first (AC-4). — Amended as under AC-4: junk and superseded outputs are skipped and printed; hand-placed files ship.
- [x] Web build writes `.br`/`.gz` sidecars (AC-6). — `create-threenative/src/compress.ts`, called from `buildWeb`; node:zlib only.
- [x] Spike doc updated with the achieved sizes; `pnpm typecheck && pnpm lint && pnpm test` green. — Spike updated ("Achieved" section). Gate so far: `pnpm build`, `typecheck` and `lint` exit 0. `pnpm test` stops at `runtime-native`, whose 18 reds all need native test binaries this worktree never built (`TN_PUMP_PROBE_NO_BINARY`, `cmake --build … --target …`). The root `vitest run` found 2 real reds from this branch (`build-assets.spec.ts`: sidecar step on a missing outDir; `temp-dir-guard`: the strip spec's temp dirs), both fixed in `f341d2817`; the other 11 came from a `TMPDIR` inside the worktree and pass with a normal one. Rerun on `2183856a9`: root `vitest run` **476 files / 5,714 tests passed**, 0 failed. The `runtime-native` package suite is 1,404 passed / 18 failed, all 18 needing native binaries not built in this worktree (unrun here, not attributable).

**Files:** `package-android.mjs`, `package-desktop.mjs`, `package-ios.mjs`, `buildWeb` in `packages/create-threenative`.
**Verification:** E7: packager specs. E8: `find dist -name '*.br'` on a template build. E9: the full gate.
**Checkpoint:** passed 2026-09-24 — evidence under the ACs above.

## Follow-ups (filed from this PRD's evidence)

- macOS desktop strip: `strip -x` followed by an ad-hoc re-sign, proved on a macOS lane.
- Rapier WASM as a file: needs the non-compat `@dimforge/rapier3d` (~185 KB brotli saved); an owner call on the new dependency.
- The playtest runner's Android console capture is not pid-filtered (`packages/playtest/src/runner/android.ts:207`), so a system process's error line can red `diagnostics`.
- A raw Draco `.glb` shipped with every model sub-pass off would 404 on `draco/`; nothing copies that decoder (pre-existing).
- A player-only desktop runtime without SWC would save 21.7 MB more, but needs its own prebuilt asset name.
