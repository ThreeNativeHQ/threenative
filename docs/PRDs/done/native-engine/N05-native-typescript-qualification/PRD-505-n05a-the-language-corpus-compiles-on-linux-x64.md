# PRD-505 — The language corpus compiles on Linux x64 (N05a)

**Status:** IN PROGRESS — the compiler is now Perry (decision 11 in NATIVE-ENGINE-DECISION.md, 2026-10-05); every box proven with tslang is reopened and re-proves with Perry. Early spike for gate T; blocks nothing else (owner decision 2)
**Complexity:** 4 — a third-party LLVM-based compiler, pinned and cached, plus a fixture corpus; no engine code yet
**Owner:** João
**Work package:** N05 — [native-engine batch](../../../native-engine/README.md) · [N05 index](../../../native-engine/N05-native-typescript-qualification/README.md)
**Depends on:** [PRD-500 — API catalog, binding ABI and version protocol](../PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md)

## Context

§1 and §8.4 named ASDAlexander77/TypeScriptCompiler as the first candidate; since 2026-10-05 the
compiler is Perry (decision 11 in `docs/architecture/NATIVE-ENGINE-DECISION.md`), for compiling
game-authored TypeScript and generated binding stubs to native code — not the engine's
implementation language. Nothing in this repository compiles TypeScript ahead of time today: the
native host transpiles with SWC (`MYSTRAL_USE_SWC` in `packages/runtime-native/CMakeLists.txt`) and
executes in QuickJS or V8. §17 requires the compiler to be a cached, checksum-pinned SDK artifact,
never an LLVM rebuild per game. This PRD qualifies the language subset only; the `three` module
adapter and callback lifetime are [PRD-506](PRD-506-n05b-three-imports-bind-natively-and-callbacks-are-reclaimed.md).

## Solution

1. **Pin, don't vendor a moving target.** proposed: `tools/native-typescript/compiler.lock.json`
   records the upstream commit, the prebuilt toolchain archive per host and its SHA-256. A provision
   script downloads and verifies it into a cache outside the repo; a checksum mismatch fails closed.
2. **The corpus is the contract (§8.4).** proposed: `tools/native-typescript/corpus/`, one small
   program per feature, each with an expected stdout file: classes, inheritance, getters/setters,
   constructors taking object options, enums and unions, ordinary imports including the import
   cycles the fixtures use, typed arrays, closures, exceptions (throw/catch across functions),
   async loading behaviour the first game needs. Native callbacks and native resource lifetime
   live in PRD-506 because they need the ABI.
3. **Memory mode (§8.4, R15).** Use the compiler's correctness-oriented default (Boehm GC). The
   non-freeing mode is rejected for anything long-running; reference counting is rejected while its
   cycle limitation stands. A corpus case allocates in a loop for N iterations and asserts bounded
   RSS, so a non-freeing build fails the suite.
4. **Fork policy.** Start on the pinned upstream commit. A fork (proposed:
   `tools/native-typescript/patches/`) is allowed only for a reduced failing corpus case; each patch
   carries the minimized reproduction, a semantic test, a native target test, and is written to be
   sent upstream. No LLVM fork, no language extensions for unrelated npm packages.
5. **Every case runs twice.** Reference run: the same file under Node (`tsx`) produces the expected
   stdout. Native run: compiled executable produces byte-identical stdout and exit code. A
   divergence is a named failure, never a re-blessed expectation.

## Out of scope

- `three` / `three/webgpu` / `three/tsl` import resolution, native callbacks, wrapper rooting — [PRD-506](PRD-506-n05b-three-imports-bind-natively-and-callbacks-are-reclaimed.md).
- Android arm64 — [PRD-507](../../../native-engine/N05-native-typescript-qualification/PRD-507-n05c-the-same-corpus-runs-on-android-arm64.md).
- Shipping a game artifact — [PRD-530 (N17)](../../../native-engine/PRD-530-n17-strict-native-typescript-game-packaging.md).

## Execution Phases

#### Phase 1: Pinned, cached compiler
**Status:** IN PROGRESS — done with tslang 2026-10-04; re-prove with Perry
**Files:** `tools/native-typescript/compiler.lock.json`, `tools/native-typescript/provision.mjs`
- [x] The provision script fetches the pinned toolchain, verifies its SHA-256, and a second run is a cache hit with no download. proof: `node tools/native-typescript/provision.mjs --check` — 2026-10-06, re-proven with Perry (decision 11): Perry v0.5.1520 (`compiler.lock.json`): from an empty cache the first run downloads, verifies the sha256 and extracts; the second is a cache hit; `--check` exits 0. tslang history: first run downloads ubuntu-26.04 (sha256 pinned), second prints `cache hit`, `--check` exits 0. Pinned v0.0-pre-alpha87, commit 0a0906e0d9fb271264fd49c2dd9a5a32ca05463e.
- [x] A tampered archive is refused with a named checksum error. proof: `pnpm exec vitest run tools/native-typescript/__tests__/provision.spec.ts` — 2026-10-06, re-proven with Perry (decision 11): `provision.spec.ts` green against the Perry lock (tamper, corrupt and re-extract paths). tslang history: 2 passed; tampered bytes refused with `TN_NATIVE_TS_CHECKSUM` naming expected vs actual, cache-hit path makes no download.

#### Phase 2: The corpus, reference and native
**Status:** IN PROGRESS — done with tslang 2026-10-04; re-prove with Perry
**Files:** `tools/native-typescript/corpus/*.ts`, `tools/native-typescript/run-corpus.mjs`
**Findings (2026-10-04, v0.0-pre-alpha87):** the corpus passes as written, but it avoids shapes this compiler rejects, and gate T must count them: `new Int32Array(n)` (only the array-literal form compiles), `.toString()` on an `i32` or an enum member, and `import` resolution from `node_modules` (the compiler resolves source paths only, so multi-file cases compile per module with `--emit=obj` and link with `--obj=`). Each is a compiler limit, not a dropped case.
- [x] Every corpus case produces its expected stdout under Node. proof: `node tools/native-typescript/run-corpus.mjs --reference` — all 11 cases PASS (classes, inheritance, getters-setters, options-constructor, enums-unions, imports-cycle, typed-arrays, closures, exceptions, async-await, alloc-loop).
- [x] Every corpus case compiles to a Linux x64 executable whose stdout and exit code match the reference. proof: `node tools/native-typescript/run-corpus.mjs --native --target x86_64-linux-gnu` — 2026-10-06, re-proven with Perry (decision 11): 16 of 16 cases PASS with Perry on x86_64-linux-gnu, every stdout equal to the Node reference (strict dynamic-code controls on). Red control: the facade `Vector3.x` setter made a no-op, `three-fixture` fails on stdout. tslang history: exit 0, all 11 PASS, byte-for-byte stdout and matching exit codes. Multi-file imports compile per module (`--emit=obj`) and link with `--obj=`.
- [x] The allocation-loop case holds RSS bounded under the selected memory mode. proof: `node tools/native-typescript/run-corpus.mjs --native --case alloc-loop` — 2026-10-06, re-proven with Perry (decision 11): `alloc-loop` PASS, peak RSS 11.9 MB with Perry's collector (the facade no longer forces a full `gc()`, which raised RSS). tslang history: PASS, peak RSS 9.2 MB against the 512 MB limit under the default Boehm GC (`--mm=gc`).

#### Phase 3: Fork ledger, if needed
**Status:** NOT STARTED
**Files:** proposed `tools/native-typescript/patches/`, `tools/native-typescript/FORK.md`
- [x] Each local patch has a minimized case in the corpus that fails without it and passes with it. proof: `node tools/native-typescript/run-corpus.mjs --native --without-patches` reports exactly the patched cases red — 2026-10-06, re-proven with Perry (decision 11): `--without-patches` against the Perry pin: 0 local patches, "red set equals the declared set". tslang history: 2026-10-05: ThreeNative applies 0 local patches to the pinned toolchain, and `tools/native-typescript/patches.json` now declares that as an empty set; `run-corpus.mjs --native --without-patches` provisions the toolchain exactly as upstream ships it, runs the corpus (16 of 16 PASS) and exits 0 only when its red set equals the ledger's declared cases ("0 local patches", "red set equals the declared set"). A future patch must name its minimized cases there or this fails. Red control: a phantom patch declared for `classes` is refused ("declared but green (the patch proves nothing)"). `patches.spec.ts` (19 cases, fail-closed ledger) and the whole `tools/native-typescript` suite pass, 36 of 36.

## Blocked on

- Owner decision on whether a research fork may be published under the ThreeNative org, should Phase 3 need one — João.

## Decisions

- **Compiler stop rule (§8.4, §18).** If the agreed corpus needs broad compiler or runtime redesign, stop this integration before the engine rewrite expands. Do not replace TS authoring with C++ or declare V8 the finished answer; reassess the language profile or another AOT candidate explicitly. The C++ core remains reusable.
- **Static Hermes is excluded from the strict target (§8.4, R16).** Its native output participates in the Hermes runtime; it may only be evaluated for a separately labelled compatibility product.
- **No general-purpose compiler is written here (§1, §2.3).**
