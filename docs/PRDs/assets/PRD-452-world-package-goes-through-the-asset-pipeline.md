# PRD-452 — A world package goes through the asset pipeline

**Status:** NOT STARTED
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

- [ ] AC-1 [local; actor: agent]: a core spec compiles the `world-v1` fixture with `compileAssets` into a temp dir, serves the output through a stubbed `fetch`, and `WorldCells.load({ url: "world/world.json" })` goes resident with 0 failures. The red run on today's code fails on `world.json` — Evidence: pending.
- [ ] AC-2 [local; actor: agent]: the same spec with the manifest deleted (the delete-test) still loads from the uncompiled `assets/world/` — Evidence: pending.
- [ ] AC-3 [local; actor: agent]: a GLB with an embedded texture, compiled to KTX2, loads through `WorldCells` with no `assets` option inside a game — Evidence: pending.
- [ ] AC-4 [local; actor: agent]: `examples/abyss-framework` `world-flythrough` (webgpu recipe) passes against the compiled package with the same residency counts as PRD-448 AC-6 (6 evictions, 0 failures) — Evidence: pending.
- [ ] AC-5 [local; actor: agent]: Machinefall's package, compiled, is measured against the 6.4 GiB baseline (total bytes, uncooked bytes, compile wall time), and its `map-walk` playtest passes with 0 failed loads — Evidence: pending.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Compiled world package | `threenative build` → `compileAssets` over `assets/world/` → `assets.manifest.json` | Serving the export raw from `public/` | AC-1, AC-4, AC-5 |
| World loads via the game's loader | `WorldCells.load` → `ctx.assets.resolve` / `ctx.assets.model` | `defaultLoadModel` (renderer-less `createAssetLoader()`) and raw `fetch` of package files | AC-1, AC-3 |

## Execution Phases

#### Phase 1: `WorldCells` loads through the asset loader
**Status:** NOT STARTED
**ACs:** AC-1, AC-2, AC-3
**Files:**
- `packages/core/src/world-cells.ts`: logical paths, `assets.resolve`/`assets.model`, the game loader as default.
- `packages/core/src/world-heightmap.ts`: `loadWorldHeightmap` takes a resolved URL (or the loader).
- `packages/core/__tests__/world-cells.spec.ts`: compiled-fixture and delete-test cases.

**Implementation:**
- Find how a core system reaches the running game's `ctx.assets` (not a new global). If none exists, `assets` is an option and the doc example passes `ctx.assets`.
- Keep `loadModel` as the override; it stops being the only way to get KTX2.

**Verification:** `pnpm --filter @threenative/core exec vitest run __tests__/world-cells.spec.ts`. Red first on today's code.
- [ ] red: compiled fixture fails on `world.json` with today's `WorldCells`
- [ ] green: compiled fixture resident, 0 failures
- [ ] delete-test: no manifest still loads
- [ ] KTX2 GLB loads with no `assets` option

**Checkpoint:** pending

#### Phase 2: Example world moves to `assets/`
**Status:** NOT STARTED
**ACs:** AC-4
**Files:**
- `examples/abyss-framework/`: world package under `assets/world/`, `world-main.ts`/`world-native.ts` URLs.

**Verification:** the `world-flythrough.playtest.json` command from PRD-448 AC-6, `--browser-recipe webgpu`, adapter checked.
- [ ] web fly-through passes on compiled output: residency counts recorded
- [ ] desktop fly-through (`world-flythrough.desktop.playtest.json`) passes

**Checkpoint:** pending

#### Phase 3: Machinefall compiles its world
**Status:** NOT STARTED
**ACs:** AC-5
**Files (Machinefall repo):**
- `apps/client/package.json`: `world:export` writes `assets/world`.
- `apps/client/.gitignore`: `assets/world`.
- `apps/client/src/level/World.ts`: logical URL.

**Implementation:** re-export to disk (needs ~7 GB free on `/home`), run `threenative build`, measure.
- [ ] export on disk, not `/tmp`
- [ ] compiled bytes vs 6.4 GiB baseline, uncooked bytes, and compile time recorded here
- [ ] LOD1 images deduped by `sharedImages` (count of distinct images in `shared/images/` vs the asset count)
- [ ] `map-walk` passes, 0 failed loads

**Checkpoint:** pending
