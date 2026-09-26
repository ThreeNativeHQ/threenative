# PRD-452 — A world package goes through the asset pipeline

**Status:** PARTIAL (Phases 1 and 2 landed and verified; the desktop run and Machinefall are open)
**Complexity:** 4 (LOW-MEDIUM); risk override: none. One core module (`world-cells.ts`), one spec, one example move, and a consumer change in Machinefall.
**Owner:** unassigned (drafted by Claude, 2026-09-25)
**Depends on:** PRD-448 (merged in #317). First consumer: Machinefall PRD-001 (jonit-dev/machinefall#2).

## Context

PRD-448 ships a Blender world export (`export_world.py`) and a runtime (`WorldCells`). The two meet only through `public/`, so a world package never passes through `@threenative/assets`:

- **Machinefall exports straight into `public/world`**, a symlink to `/tmp/machinefall-world`. It has no `assets/` source dir and no `assets` config block. Its 2 km package is 218 assets / 436 GLBs / **6.4 GiB**, every texture exactly as Blender wrote it: no KTX2, no size cap, no image dedupe. The LOD1 GLBs embed the same full-resolution images a second time. `/tmp` is tmpfs (RAM) and the export was already lost once.
- **`WorldCells` cannot read a compiled package.** Measured on 2026-09-25 by compiling the committed `world-v1` fixture from `assets/world/` with `compileAssets`: all 11 files come out content-addressed, including the non-model ones. The GLBs (`world/assets/pine.glb → world/assets/pine.615aeb7c.glb`) and `world.json`, `placements.bin` and `terrain/heightmap.u16` (all three kind `other`) are renamed too. The runtime breaks in three places:
  1. `WorldCells.load` raw-`fetch`es `world.json`, `placements.bin` and the heightmap by URL (`world-cells.ts` `load`, `world-heightmap.ts` `loadWorldHeightmap`). In a compiled build those names do not exist.
  2. Model URLs are built as `/world/assets/pine.glb`. The loader's manifest keys have no leading slash (`world/assets/pine.glb`), so `resolveCandidates` (`assets.ts:678`) throws "not listed in the asset manifest".
  3. The default model loader is `createAssetLoader()` with no renderer (`world-cells.ts` `defaultLoadModel`). A KTX2 texture throws `TN_ASSETS_KTX2_NO_RENDERER`. The game's own `ctx.assets` is built with the renderer (`game.ts:966`) but never reaches `WorldCells`.

The loader already does everything needed: `IAssetLoader.resolve(path)` maps a logical path to its served URL(s), with or without a manifest, and `model(path)` loads through the manifest with KTX2 wired. `WorldCells` just has to use it.

Out of scope: a new pass, a world-specific pipeline stage, and changing the package format. The pipeline's default `models.sharedImages` should dedupe the LOD1 images for free. Phase 3 checks that rather than assuming it.

## Solution

1. **`WorldCells` resolves every package path through an asset loader.** `url` becomes a logical path (`world/world.json`). `world.json`, `placements.bin` and the heightmap are fetched from `assets.resolve(path)`. Models load with `assets.model(logicalPath)`. Relative paths inside `world.json` are joined as logical paths with no leading slash.
2. **The game's loader is the default.** Inside a running game, `WorldCells` uses `ctx.assets` (renderer-aware, manifest-aware) with no argument. An explicit `assets` option overrides it. A loader that finds no manifest keeps today's verbatim and source-dir fallback, so an uncompiled `public/world` still works (the delete-test).
3. **The example proves it.** `examples/abyss-framework` moves its world package from `public/` to `assets/world/`, so the fly-through playtest runs against compiled, content-addressed output.
4. **Machinefall exports into `apps/client/assets/world/`**, on disk and gitignored, and `threenative build` compiles it. Report the before/after bytes and the compile time.

## Acceptance Criteria

- [x] AC-1 [local; actor: agent]: a core spec serves the `world-v1` fixture in its compiled, content-addressed layout through a stubbed `fetch` and `WorldCells.load({ url: "world/world.json" })` goes resident with 0 failures; the red run on the pre-change code fails on `world.json` — proof: `pnpm exec vitest run packages/core/__tests__/world-cells.spec.ts`, 14/14 green; red on the unchanged `world-cells.ts` (stashed) fails with `Error: World manifest request failed with status 404 for world/world.json.` The spec builds the layout in memory (each file served under a `sha256`-derived name, `assets.manifest.json` v1 mapping every logical path, authored names 404ing) instead of calling `compileAssets` into a temp dir: `@threenative/assets` is build-time tooling (`sharp`, gltf-transform, wasm encoders) and a core unit test may not inherit it. The names are the shape the compile step writes; the manifest keys are what the loader looks up.
- [x] AC-2 [local; actor: agent]: the same spec with the manifest gone (the delete-test) still loads the package from the compiled project's own `assets/` sources, nothing answering under the authored names — proof: `pnpm exec vitest run packages/core/__tests__/world-cells.spec.ts packages/core/__tests__/world-heightmap.spec.ts`, 20/20 green; the delete-test case `still loads the package from assets/ when the compiled output is gone` asserts the exact request log `["assets.manifest.json", "world/world.json", "assets/world/world.json", "world/placements.bin", "assets/world/placements.bin", "world/terrain/heightmap.u16", "assets/world/terrain/heightmap.u16"]` — 9 resident cells, 0 failures, each file asked for by its authored name first and then found under `assets/`, so the loader's second candidate is walked rather than dropped.
- [x] AC-3 [local; actor: agent]: a GLB with an embedded texture, compiled to KTX2, loads through `WorldCells` with `assets: ctx.assets` inside a game — proof: the example's `assets/world/assets/pine.glb` carries a 64x64 embedded texture; `pnpm --filter abyss-framework build` compiles it to `world/assets/pine.e8619385.glb` with `KHR_texture_basisu` in `extensionsRequired`, `image/ktx2` and `shared/images/99eff915884b390e.etc1s.ktx2` (manifest `embeddedTextures.formats: {"probe_bark_tex":"etc1s"}`, 14179 -> 1925 B, GPU 21845 -> 2731 B), and the `world-flythrough` playtest on the compiled build passes with `failures` 0 -> 0. Red control, the same build with `assets: ctx.assets` removed: `failures` 1 -> 4 and the run exits 1, which is the renderer-less default loader refusing the KTX2 image.
- [x] AC-4 [local; actor: agent]: `examples/abyss-framework` `world-flythrough` (webgpu recipe) passes against the compiled package with the same residency counts as PRD-448 AC-6 (6 evictions, 0 failures) — proof: `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/world-flythrough.playtest.json --url 'http://127.0.0.1:5181/?world' --server-command 'pnpm --filter abyss-framework preview --host 127.0.0.1 --port 5181 --strictPort' --browser-recipe webgpu --headed` after `pnpm --filter abyss-framework build` — `pass: true`, 440 frames, adapter NVIDIA turing (not SwiftShader; `texture-compression-bc` present), resident cells 3 -> 6 with a peak of 12, 7 residence changes, 6 evictions, 0 failures, 1 463 instances, 0 loads in flight at the end, 0 console and 0 network errors, frame p95 47.2 ms against the 93 ms budget. The counts match PRD-448 AC-6/AC-7 exactly.
- [ ] AC-5 [local; actor: agent]: Machinefall's package, compiled, is measured against the 6.4 GiB baseline (total bytes, uncooked bytes, compile wall time), and its `map-walk` playtest passes with 0 failed loads — proof: the four Phase 3 boxes below, each naming its own command.

## Decisions

- **2026-09-25 — the example owns its copy of the `world-v1` package under `assets/world/`.** It streamed the fixture through Vite's `?url` import of `packages/core/__tests__/fixtures/world-v1`, which is a package's test fixture reached across the package boundary and cannot pass through a compile step (one source dir per project). The copy is 192 KB and one asset diverges on purpose: `assets/pine.glb` carries a 64x64 embedded texture so the KTX2 path is exercised in a real run rather than only in a spec (AC-3). The core fixture is untouched.
- **2026-09-25 — no ambient path from a core system to the running game's `ctx.assets`.** `game.ts` builds the loader as a local inside `start()` and stores it only on the ctx object literal; core has no game/scene/loader registry to read it from. A global (a `globalThis` slot, a bus entry, a `WeakRef` on the renderer) was rejected — it outlives the game, leaks a loader across a `stop()`/`start()` cycle, and the two `Symbol.for` precedents in the tree are cross-bundle audio/render state, not an asset pipeline. So the loader is an option the game passes: `WorldCells.load({ assets: ctx.assets, … })`. The default is a fresh `createAssetLoader()` per load, which handles the manifest and the verbatim-then-`assets/` source fallback but has no renderer, so it cannot transcode KTX2.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Compiled world package | `threenative build` → `compileAssets` over `assets/world/` → `assets.manifest.json` | Serving the export raw from `public/` | AC-1, AC-4, AC-5 |
| World loads via the game's loader | `WorldCells.load` → `ctx.assets.resolve` / `ctx.assets.model` | `defaultLoadModel` (renderer-less `createAssetLoader()`) and raw `fetch` of package files | AC-1, AC-3, AC-4 |

## Execution Phases

#### Phase 1: `WorldCells` loads through the asset loader
**Status:** DONE (red, green, delete-test and the KTX2 case verified)
**ACs:** AC-1, AC-2, AC-3 done
**Files:**
- `packages/core/src/world-cells.ts`: logical paths, `assets.resolve`/`assets.model`, the loader as default.
- `packages/core/src/world-heightmap.ts`: unchanged — `loadWorldHeightmap` already takes a url and throws on a non-ok response, so it is handed each candidate in turn and its status ends up in the combined error.
- `packages/core/__tests__/world-cells.spec.ts`: compiled-layout and delete-test cases.

**Implementation:**
- No existing way to reach the running game's `ctx.assets` exists: `game.ts` builds the loader as a local in `start()` (`game.ts:974`), stores it only on the ctx object literal, and core has no ambient game/scene/loader registry (no `globalThis`, bus or `WeakRef`; the two `Symbol.for` precedents are cross-bundle audio/render state). So `assets` is an option and the default is a fresh `createAssetLoader()` per load — fresh rather than module-level, so one load's manifest read is never cached for the next (and a package is loaded once, so the extra manifest fetch is free).
- `loadModel` stays the override and keeps taking the authored url; without it the logical path goes to `assets.model`.

**Verification:** `pnpm exec vitest run packages/core/__tests__/world-cells.spec.ts packages/core/__tests__/world-heightmap.spec.ts` (20/20), `pnpm --filter @threenative/core exec tsc --noEmit` (0), `pnpm lint` (0), `pnpm exec vitest run packages/core` (1582/1582), `pnpm capabilities:check` (fresh), and `tsc --noEmit` in `examples/abyss-framework`, the only other `WorldCells.load` caller.
- [x] red: compiled fixture fails on `world.json` with today's `WorldCells`. proof: `pnpm exec vitest run packages/core/__tests__/world-cells.spec.ts` with `packages/core/src/world-cells.ts` stashed — `Error: World manifest request failed with status 404 for world/world.json.`, 2 failed / 12 passed.
- [x] green: compiled fixture resident, 0 failures. proof: same command with the change in place — 14/14, `stats().failures === 0`, 9 resident cells, the chunk attached and instanced batches built, every requested url matching `assets.manifest.json` or a content-hash name.
- [x] delete-test: no manifest still loads, from the project's `assets/` sources. proof: `pnpm exec vitest run packages/core/__tests__/world-cells.spec.ts packages/core/__tests__/world-heightmap.spec.ts`, case `still loads the package from assets/ when the compiled output is gone` — 9 resident cells, 0 failures, request log the four authored names each 404ing and the same three found under `assets/`; red on the pre-fix `world-cells.ts` (which took only candidate `[0]`) with `Error: World manifest request failed with status 404 for world/world.json.`, 1 failed / 19 passed.
- [x] KTX2 GLB loads through `WorldCells` with `assets: ctx.assets`. proof: AC-3 — `assets/world/assets/pine.glb` given a 64x64 embedded texture compiles to a GLB declaring `KHR_texture_basisu`, and the `world-flythrough` playtest on the compiled build reports `failures` 0 -> 0. Red control: the same build with the `assets` option removed reports `failures` 1 -> 4 and exits 1.

**Checkpoint:** package files and models resolve through the loader's manifest; the authored names still work without one. The `assets` default is per-load `createAssetLoader()` because no non-new path to `ctx.assets` exists; a game opts in with `{ assets: ctx.assets }`.

#### Phase 2: Example world moves to `assets/`
**Status:** DONE (the move, the compiling build, the web fly-through and the desktop fly-through are verified)
**ACs:** AC-4 done; AC-3 done here too (the KTX2 case rides the same run)
**Files:**
- `examples/abyss-framework/assets/world/`: the example's own copy of the `world-v1` package; `assets/pine.glb` carries a 64x64 embedded texture.
- `examples/abyss-framework/src/scenes/WorldProbe.ts`: logical `url: "world/world.json"` and `assets: ctx.assets`; the cross-package `?url` import of core's test fixture is gone.
- `examples/abyss-framework/vite.config.ts` + `package.json` + `.gitignore` + `biome.json`: the template's `assetsWatchPlugin`, `build: threenative build` (which compiles before Vite), the generated `public/` outputs ignored, and `playtest:world` pointed at build + preview.

**Implementation:** the package was never in `public/` as the PRD assumed — the scene imported `packages/core/__tests__/fixtures/world-v1/world.json?url`, which serves the fixture verbatim and cannot pass through a compile (one source dir per project). So the example owns a copy. The dev loop keeps working through the watcher every template already uses; the built lane is what the PRD asks for and what the scenario now runs.

**Verification:** the AC-4 command in the acceptance list, `--browser-recipe webgpu`, adapter checked in `artifacts/playtest/capture.json`.
- [x] web fly-through passes on compiled output: residency counts recorded. proof: `pnpm --filter abyss-framework build` then the AC-4 command — `pass: true`, 440 frames, adapter NVIDIA turing, resident 3 -> 6 (peak 12), 7 residence changes, 6 evictions, 0 failures, 0 loads in flight at the end, 1463 instances, 0 console/network errors, p95 47.2 ms of 93 ms. Manifest and compiled names: `world/world.json -> world/world.0d5bab07.json`, `world/placements.bin -> world/placements.2b739a45.bin`, `world/terrain/heightmap.u16 -> world/terrain/heightmap.a29283dd.u16`, all 11 files content-addressed.
- [x] desktop fly-through (`world-flythrough.desktop.playtest.json`) passes. proof: `pnpm native:build` (host `packages/runtime-native/build/tn-linux/mystral`), then the desktop-platform compile plus `bundle.mjs --project examples/abyss-framework --entry src/world-native.ts --target desktop` and `package-desktop.mjs --bundle … --assets examples/abyss-framework/public --runtime …`, then `node packages/playtest/dist/runner/cli.js examples/abyss-framework/playtests/world-flythrough.desktop.playtest.json --target desktop --executable /tmp/…/pkg --host-arg run --host-arg .threenative/game.js` — `pass: true`, `runtime: native`, 440 frames, adapter NVIDIA GeForce RTX 2080, resident 3 -> 6 (peak 12), 7 residence changes, 6 evictions, 0 failures, 0 loads in flight at the end, 1463 instances — the same counts as the web run and PRD-448 AC-7. `src/world-native.ts` lost its `/world.json` override: the desktop build compiles the package and stages the manifest beside the bundle, so the logical path resolves on the host. `threenative build --target desktop` in this example still stops at `TN_UI_ENTRY_MISSING` (its config leaves `ui.renderer` at the `web` default and the example has no `src/ui/main.tsx`), so the two scripts were run directly, as PRD-448 phase 4b did.

**Checkpoint:** the example's world package is compiled source, not a served fixture, and the web run proves the compiled names, the manifest and the KTX2 path in one flight.

#### Phase 3: Machinefall compiles its world
**Status:** NOT STARTED
**ACs:** AC-5
**Files (Machinefall repo):**
- `apps/client/package.json`: `world:export` writes `assets/world`.
- `apps/client/.gitignore`: `assets/world`.
- `apps/client/src/level/World.ts`: logical URL.

**Implementation:** re-export to disk (needs ~7 GB free on `/home`), run `threenative build`, measure.
- [ ] export on disk, not `/tmp`. proof: `apps/client/package.json` `world:export` writing `assets/world`, and the path listed in `apps/client/.gitignore` with a populated directory on `/home`.
- [ ] compiled bytes vs 6.4 GiB baseline, uncooked bytes, and compile time recorded here. proof: the `threenative build` run's `TN_ASSETS_BUDGET` lines and wall time, pasted into this file.
- [ ] LOD1 images deduped by `sharedImages` (count of distinct images in `shared/images/` vs the asset count). proof: `ls public/shared/images | wc -l` against the manifest's image count, with both numbers here.
- [ ] `map-walk` passes, 0 failed loads. proof: the `map-walk.playtest.json` run against the compiled client, with the `failed loads` component reported as 0.

**Checkpoint:** pending
