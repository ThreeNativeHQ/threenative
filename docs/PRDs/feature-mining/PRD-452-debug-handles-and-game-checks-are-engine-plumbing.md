# PRD-452 — A game's debug handles and headless checks are engine plumbing

**Status:** PROPOSED
**Complexity:** 5 (MEDIUM): 1–5 implementation files, +2 for a new module (`@threenative/playtest/node`), +2 for the crossing to the sandbox game
**Owner:** unassigned
**Depends on:** None. Split out of PRD-451's mining for the size cap.

## Context

This was mined read-only from `../sandbox` on 2026-09-25, at engine `bbc49c781`. Every game that
leaves "one runnable check", as the ponytail rule requires, pays the same boilerplate three times.

1. **Debug flags and handles.** Five games wrote about 20 hand-guarded toggles and handles through
   URL query, `globalThis` or `localStorage`, each guarded by hand for native: midway
   `render/world.ts:141,165`; wildwood `scenes/Valley.ts:244,277,406,505,554,767,946`; fps
   `render/sky.ts:70`, `lighting.ts:53`, `scenes/Play.ts:273`, `entities/Enemy.ts:1193`; lumen
   `render/lighting.ts:34`, `postprocessing.ts:24`, `scenes/Play.ts:241`; soul-cave `scenes/Cave.ts:226`.
   Core has only the dev-only `__THREENATIVE__` snapshot (`packages/core/src/game.ts:272`).
2. **Capture scripts cannot reach the scene.** Midway has about 30 `tools/capture-*.mjs`. Twenty-five
   of them `import()` `/src/game.ts` from a page script to set `window.midway` (e.g.
   `tools/capture-hulls.mjs:45-80`). There are more in wildwood (13), fps (4) and fox-game (3).
   `withBrowserCapture` (`packages/playtest/src/runner/captureSession.ts:62`) exists, but only two
   probes use it, and it offers no sanctioned scene handle. That missing handle is why the re-import
   hack exists.
3. **Headless checks.** Midway's 39 `scripts/check-*.mjs` each repeat about 15 lines that bundle a
   TS module to a data URL. The same game also has an FNV state digest (`sim/seeded-battle.ts:174-186`)
   and a percentile timer (`sim/perf.ts:22-33`). Crate-vault (`scenes/Play.ts:44-55`) and warden
   (`scenes/Play.ts:313-330`) have their own digests. The replay driver replays input but never
   hashes state.

## Solution

- **`debugFlag(name)` and `exposeDebug(name, value)`** go in core. `debugFlag` reads `?name` on web
  and `TN_DEBUG_<NAME>` on native. `exposeDebug` publishes the value under
  `__THREENATIVE__.debug[name]` in dev builds only, so a production build exposes nothing.
- **`session.debug(name)` on `withBrowserCapture`** reads that handle, and it throws when the handle
  is not published, never returning `undefined`.
- **`@threenative/playtest/node`** provides `stateDigest(states)` (a stable hash of plain data, which
  throws on functions or cycles) and `timeSteps(step, n)` (returns `{ p50, p95, max }`). How TS gets
  loaded is decided by measurement in Phase 2. Pricing the incumbent (`tsx` as the template's check
  runner) against an `importSource` helper comes first, and only the smaller of the two ships,
  because playtest carries no bundler today (`pngjs` is its only dependency).

## Acceptance Criteria

The phase boxes below are the criteria.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Debug flag and handle | Midway `render/world.ts` toggles; `withBrowserCapture` page scripts | The `window.midway` re-import in the migrated tools is deleted | P1, P3 |
| Node check helpers | Midway `scripts/check-*.mjs` and `sim/seeded-battle.ts` | The game's digest and percentile code are deleted | P2, P3 |

## Execution Phases

#### Phase 1: one flag, one handle, both targets
**Status:** NOT STARTED
**Files:** `packages/core/src/debug.ts` (new), `packages/core/src/index.ts`, `packages/playtest/src/runner/captureSession.ts`, specs
- [ ] `debugFlag` reads the URL on web and the env on native; `exposeDebug` publishes nothing in a production build; `session.debug` throws on a missing handle. proof: `pnpm exec vitest run packages/core/__tests__/debug.spec.ts packages/playtest/__tests__/captureSession*.spec.ts`
- [ ] Native reads the flag. proof: desktop example playtest run with `TN_DEBUG_<NAME>=1 … --target desktop`, asserting the flagged state (web-only is unfinished)

#### Phase 2: a game's check is two imports
**Status:** NOT STARTED
**Files:** `packages/playtest/src/node/index.ts` (new), `packages/playtest/package.json` (`./node` export), spec
- [ ] Loader decided by measurement: lines per check script under `tsx` versus under `importSource`, with the result recorded under `## Decisions`. proof: the two counts on Midway's `check-audio.mjs`
- [ ] `stateDigest` is stable across key order and throws on functions and cycles; `timeSteps` returns ordered percentiles. proof: `pnpm exec vitest run packages/playtest/__tests__/node*.spec.ts`

#### Phase 3: Midway uses them
**Status:** NOT STARTED
**Files (in `../sandbox/midway-open-pacific`, its own PR, local tarballs from a private staging dir):** 3 capture tools, 3 check scripts, `sim/seeded-battle.ts`, `sim/perf.ts`, `render/world.ts`
- [ ] Three capture tools reach the scene through `session.debug`, and three check scripts use the node helpers. Each migrated file runs green, and the net diff is negative. proof: each migrated tool and script exits 0; `pnpm verify` green; `git diff --numstat` recorded
- [ ] Determinism still proves: `check-*` seeded-battle digest is identical across two runs and differs when the seed changes. proof: the migrated check, both runs recorded
