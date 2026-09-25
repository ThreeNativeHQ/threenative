# PRD-451 — Games stop rewriting what the engine ships

**Status:** IN PROGRESS — phases 1–2 done, phase 3 in its sandbox PR
**Complexity:** 4 (MEDIUM): 6–10 implementation files, +2 for the crossing to the sandbox game, which installs from a tarball
**Owner:** unassigned
**Depends on:** None. Related: PRD-354/355 (reinvention gate), PRD-325 (seams not repeated here)

## Context

This was mined read-only from `../sandbox` on 2026-09-25, at engine `bbc49c781`. Midway Pacific
(27k LOC) plus 18 other games were mined. All paths are relative to `../sandbox/`.

**1. Midway hand-wrote seven things the engine ships, because search can't find them.**

| Game code | Already shipped |
| --- | --- |
| midway `render/world.ts:61-89` visible-only matrix walk. It is **dead code**: the engine sets `matrixWorldAutoUpdate = false`, so it never registers. | `MatrixWorldPass` |
| midway `render/world.ts:1154-1189` `freezeStatic` (12 sites) | `markStatic` |
| mulberry32 in midway `sim/math.ts:143`, `render/rear-station.ts:68` and crate-vault `scenes/Play.ts:33` | `createRandom` |
| `keys.has` axes and raw pointer lock in midway `scenes/Midway.ts:455-492`, lumen `first-person.ts:88` and fps `scenes/Play.ts:974` | `InputMap`, `captureMouse`, **neither in `capabilities.json`** |
| midway `render/airframe-lod.ts` `focalPx` | `lodPixelScale`, **not in the manifest** |
| midway `ui/frame-meter.ts` and fps `perf.ts` | `FrameBudget` p50/p95/p99 |
| raw `mergeGeometries` in 6 games | `mergeParts` |

**2. Three mechanisms that five or more games wrote by hand:**

- **Merge a static subtree by material.** Six games wrote it: midway `render/assets.ts:120-183`,
  plus four more copies in `rear-station`, `cockpit-detail` and `devastator`; caravel
  `render/props.ts:355`; fps `render/facade.ts:197`; lumen `render/cathedral.ts:188`; warden
  `render/crateShape.ts:37`; crate-vault `render/crateGeometry.ts:53`. `mergeParts` does the hard
  part, but every caller writes the grouping.
- **Texture setup after load.** Five games set colour space, wrap, repeat and anisotropy by hand:
  midway `render/cockpit-detail.ts:55`, lumen `render/surfaces.ts:527`, wildwood
  `scenes/Valley.ts:1075`, soul-cave `scenes/Cave.ts:96` and fps `render/sky.ts:57`. Colour space is
  a correctness trap. `texture(path)` (`packages/core/src/assets.ts:76`) takes no options.
- **Debug flags and handles.** Five games wrote about 20 URL, global or localStorage toggles, each
  guarded by hand for native (midway, wildwood, fps, lumen, soul-cave). Midway's ~25 capture scripts
  re-`import()` `/src/game.ts` just to reach the scene.

## Solution

1. **Search first.** Add recall rows that quote the games' own words. Where a row fails, add
   `@situation` tags to the shipped symbol. This needs no new API.
2. **Three small core APIs**, each optional and additive:
   - `mergeByMaterial(root, { label, skip? })`: groups meshes by material, calls `mergeParts` for
     each group and returns the meshes. Materials pass through, so it owns none of the look.
   - `texture(path, { data?, wrap?, repeat?, anisotropy? })`: `texture(path)` is unchanged.
   - `debugFlag(name)` reads `?name` on web and `TN_DEBUG_NAME` on native. `exposeDebug(name, v)`
     publishes the value under `__THREENATIVE__.debug` in dev builds only, so a page script reads
     `window.__THREENATIVE__.debug.x` directly.
3. **Midway deletes its copies** and plays the same.

Kill switch: `pnpm tsx scripts/count-loc.ts` must score each API below the copies it replaces.

## Execution Phases

#### Phase 1: a search in the games' words finds what they rewrote
**Status:** DONE
**Files:** `scripts/fixtures/capability-recall/corpus.json`; `@situation` tags on whichever symbols fail, starting with `packages/core/src/input.ts`
- [x] One recall row for each of the seven misses above, observed red first. proof: `pnpm caps:recall` — 8 `prd451.*` rows (the seven plus `mergeParts`); red first, 7 of 8 missed and `InputMap`, `captureMouse`, `lodPixelScale` were absent from `capabilities.json` (only their types were exported, so the manifest builder never saw them).
- [x] Every row resolves, with no reject hits. proof: `pnpm build && pnpm caps:recall` exit 0 — recallAtK 0.897 (61/68), all 8 new rows recalled with no reject hits; the 7 misses and 16 reject hits are the 60 baseline rows' own, unchanged. Fixes: `@situation` lines on `MatrixWorldPass`, `markStatic` (now its own doc block, since the family's shared summary collapsed to `invalidateStatic`), `createRandom`, `FrameBudget`; value exports of `InputMap`, `captureMouse` (lifted out of `InputMap.captureMouse()`, which delegates) and `lodPixelScale`. Rows cite `sandbox:<game>#<file>`, provenance only.

#### Phase 2: three one-call APIs
**Status:** DONE
**Files:** `packages/core/src/{merge-parts,assets,debug,index}.ts`, `packages/runtime-native/src/runtime.cpp`, matching `__tests__/*.spec.ts`
**Verification:** `pnpm --filter @threenative/core build`, `pnpm typecheck`, `pnpm lint` all exit 0; `pnpm exec vitest run packages/core` 1552/1552
- [x] `mergeByMaterial`: 3 materials × N meshes → 3 meshes, transforms baked, `skip` honoured, and a rejected group throws naming the label. proof: `pnpm exec vitest run packages/core/__tests__/merge-parts.spec.ts` — 22/22; a group where only some meshes carry uv throws naming the label rather than losing its mapping. `merge-parts.ts` joins the constraints allowlist (it reads a material's identity and the game's own instance) with a `no new Material|Color`, `no .material.x` assertion beside the exemption.
- [x] `texture` options apply, and `texture(path)` behaves exactly as before. proof: `packages/core/__tests__/assets.spec.ts` — 48/48, including the shared cached instance left untouched and sRGB whenever options omit `data` (the loader default is linear).
- [x] `debugFlag` reads the URL, and `exposeDebug` publishes nothing in a production build. proof: `pnpm exec vitest run packages/core/__tests__/debug.spec.ts` — 7/7. The production branch cannot be reached from inside vitest (its `import.meta.env` is always the bundler's), so it is proven by a separate node process loading `dist/index.js`: `debugFlag("freeCam")` reads `TN_DEBUG_FREE_CAM` and `exposeDebug` publishes nothing — the same plain ESM the native bundle is.
- [x] `debugFlag` reads `TN_DEBUG_*` on native. proof: `examples/native-smoke/playtests/debug-flag.playtest.json --target desktop` on a freshly built `build/tn-linux/mystral` (V8, Vulkan) — RED exit 1 without the variable (`resource.GameState.debugProbe` false), GREEN exit 0 with `TN_DEBUG_PROBE=1` (true). The build caught a real compile error in the forward loop, fixed in the same commit. Run on the clean-console bundle variant (`THREENATIVE_UI_FRAME_GATE=enabled`): the default bundle's deliberate empty-audio proof logs one error line that reds every desktop scenario, the untouched `geometry-capture-desktop` control included. Not wired into CI, which names desktop scenarios individually.
- **count-loc** (code lines, comments and blanks excluded, counted by hand): `mergeByMaterial` 37 (interface 4 + const 1 + function 32) against midway `render/assets.ts:119-157` `consolidate` 35 — **over one copy, under two**; `devastator.ts` and `rear-station.ts` hold two more group-by-material loops. `texture` options 16 against midway `render/cockpit-detail.ts:41-70` 21 in one file, plus lumen, wildwood, soul-cave and fps. `debug.ts` 36 against roughly 20 hand-guarded toggles in 5 games — over one 4-line copy, under the second. The kill switch scores every repetition, so all three hold across the games they replace; none holds against a single copy by itself, except texture options.

#### Phase 3: Midway deletes its copies
**Status:** NOT STARTED
**Files (`../sandbox/midway-open-pacific`, its own PR; core packed to a private staging dir, never `.packages`):** `render/{assets,rear-station,cockpit-detail,devastator,world}.ts`, `sim/math.ts`, `scenes/Midway.ts`, 3 `tools/capture-*.mjs`
- [ ] The rows in section 1, the merge copies, the private texture loader and the `game.ts` re-import are replaced, and the net diff is negative. proof: `pnpm typecheck && pnpm test` (4 playtests) green; `git diff --numstat` recorded
- [ ] Same picture, no more submissions. proof: `node tools/compare-frames.mjs` (3 frozen views) and `node tools/capture-deck-perf.mjs` against `docs/perf/deck-baseline-20260922.json`; fresh-subagent judge

## Not in this PRD

Each item waits for a second game or for a PRD of its own:

- **Static shadow-caster proxy:** Midway only (351 → 5 shadow submissions, and the `ShadowNode`
  `0xFFFFFFFE` mask trap).
- **Audio:** per-sound cooldowns (3 games), the voice-line queue, and the travel-time delay.
- **Node check helpers:** state digest and step timer. Midway has 39 `check-*` scripts; crate-vault
  and warden have digests.
- **Placement and native canvas:** `normaliseToMetres` anchoring (4 games); the native canvas shim
  gaps.
- **Single-game math and UI helpers:** aim math, one-shot UI events, world→screen in the UI realm,
  `SpatialGrid2D`, `RippleField` GPU nodes, the clone build budget, and the runtime LOD rung.
