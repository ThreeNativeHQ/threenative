# PRD-579 — Perry earns its place on a Midway-shaped workload

**Status:** NOT STARTED
**Priority:** P2 — Perry is a gated option (decision 11) and game code runs on V8 and browser JS today; no workload shaped like a real game has judged it yet (Phases 1–3 open).
**Complexity:** 3 (LOW) — 1–5 tooling files (+1), a compiler patch crosses the pinned toolchain boundary (+2); risk override: none
**Owner:** João
**Depends on:** [PRD-573](./PRD-573-the-performance-bar-is-a-scorecard-on-named-scenes.md) for the scorecard rules
**Estimate:** Phase 1 ≈ 6 h (most of it a Perry build from source); Phase 2 ≈ 8–12 h; Phase 3 ≈ 2 h. No quick win: Midway does not link under Perry, so no box shows a Midway gain in four hours.

## Context

Layer: toolchain and benchmark (`tools/native-typescript/` and `scripts/engine-load-test/`, on
`origin/feat/native-engine`). No engine or game code changes here.

Decision 11 in `docs/architecture/NATIVE-ENGINE-DECISION.md` makes Perry the game-code compiler, with
a stopping rule: "If Perry needs broad compiler or runtime redesign to pass the gameplay and HUD
corpus, its integration stops expanding and the same C ABI is tried with another compiler."
Decision 12 keeps browser JS for game code on the web and measures Perry-in-Wasm (option A) only
through PRD-533's three-arm benchmark.

Where Perry stands (read 2026-10-09):

- **Midway does not link under Perry.** PRD-530 Phase 4 (on `origin/feat/native-engine`) lists the
  web-only imports that block it. The part that links (`src/sim`, 12.7k lines) prints what tsx
  prints in 28 of 32 valid check scripts, 13 to 16 times slower.
- **Five performance cliffs** on object-property patterns that game state uses, 80 to 300 times
  slower than V8, with reproducers in `tools/native-typescript/repros/`. The owner decision of
  2026-10-08 (PRD-530) forbids a game-code workaround and a strict-build lint for them.
- **An upstream fix exists for the absent-key cliff** (Perry PR #11594). The epic brief reports it
  is in no release yet, gives about 9x on that cliff, and leaves Perry 20 to 40 times slower than
  tsx on the check scripts. These numbers are from the brief and unverified here.
- **On the synthetic bench, Perry ties.** PRD-533 (on `origin/feat/native-engine`) measured 64k
  objects on hardware WebGPU: Wasm-JS 43.55 ms and Wasm-Perry 45.22 ms p50.
- The toolchain pin is `tools/native-typescript/compiler.lock.json` (Perry `v0.5.1520`). Local
  compiler changes go through `tools/native-typescript/patches.json`, which is empty: each entry
  names a diff and the corpus cases that fail without it, and `run-corpus.mjs --native
  --without-patches` fails unless the red set equals those cases.

Not in scope: Perry facade gaps and the same-stdout regression check (PRD-530 Phase 4), the
synthetic three-arm qualification (PRD-533), and the JS-to-Wasm call count (PRD-553).

## Solution

1. **Take the upstream fix through the existing patch rule (Phase 1).** The absent-key fix enters
   `patches.json` with `repros/absent-property-read.ts` as its corpus case, or the pin moves to a
   Perry release that carries it. João picks one (see `## Blocked on`).
2. **A workload shaped like Midway (Phase 2).** `bench:engines` gains a workload with the patterns
   Midway's frame uses: optional state fields read through `??`, object spread of small state
   objects, many `Object3D` writes per frame, and animation through the engine's `PropertyBinding`.
   It runs on the web arms (`current`, `wasm-js`, `wasm-perry`) and the native arms (`native-v8`,
   `native-aot`).
3. **Apply the stopping rule with numbers (Phase 3).** The proposed reading: Perry keeps expanding
   only if, in the same run, `wasm-perry` is no slower than `wasm-js` and `native-aot` is no slower
   than `native-v8` on the Midway-shaped workload. Otherwise the decision record says integration
   stops expanding, as decision 11 requires. A strict build does not fall back to V8 silently.

## Execution Phases

#### Phase 1: The absent-key fix is in the pinned toolchain
**Status:** NOT STARTED
**Files:** `tools/native-typescript/patches.json` and `patches/`, or `tools/native-typescript/compiler.lock.json`
- [ ] With the fix, the corpus passes, and without it exactly `absent-property-read` fails. proof: `node tools/native-typescript/run-corpus.mjs --native` (all pass) and `node tools/native-typescript/run-corpus.mjs --native --without-patches` (red set equals the one case)
- [ ] Each of the five repros is timed under the patched Perry and tsx in one session, and the ratios are recorded here with the load average. proof: `tsx <repro>` and `perry compile <repro> -o <exe> --strict-eval --strict-dynamic-import --strict-unimplemented` then `<exe>`, for each file in `tools/native-typescript/repros/`
- [ ] The Midway check-script slowdown under the patched Perry is recorded against tsx. proof: `node tools/native-typescript/compile-game.mjs <midway-open-pacific> --checks <midway-open-pacific>/scripts --package @threenative/core=packages/core/src/flight.ts` (the `slowdown` column, median over the `same` scripts)

#### Phase 2: A Midway-shaped workload runs on every arm
**Status:** NOT STARTED
**Files:** `scripts/engine-load-test/workloads.ts`, `scripts/__tests__/engine-load-test-workloads.spec.ts`
- [ ] The workload parses, runs, and renders the same frame on every arm. proof: red-green case in `pnpm exec vitest run scripts/__tests__/engine-load-test-workloads.spec.ts`, then `pnpm bench:engines -- --target web --arms current,wasm-js,wasm-perry --workloads midway-shaped` with zero pixel mismatch between arms
- [ ] Native arms run the workload in one invocation, and the frame CPU p50 ratios are recorded with the load average. proof: `pnpm bench:engines -- --arms native-v8,native-aot --workloads midway-shaped`

#### Phase 3: The stopping rule is applied
**Status:** NOT STARTED
**Files:** `docs/verification/runtime-perf-state.md`, `docs/architecture/NATIVE-ENGINE-DECISION.md` (decision 11 note)
- [ ] The decision is recorded under `## Decisions` and beside decision 11, from the Phase 2 ratios. proof: the two Phase 2 `bench:engines` reports

## Blocked on

- Patch or pin: carry the upstream fix as a local patch now, or wait for a Perry release that carries it. João decides.
- The numeric reading of the stopping rule in Solution 3 is a proposal. João confirms or changes it before Phase 3.
- Building Perry from source needs LLVM 22 on the build machine (from the epic brief, unverified here).
- Whether `bench:engines --target web` accepts `--workloads` is unverified. If it does not, Phase 2 adds that flag first.
