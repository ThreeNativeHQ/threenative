# PRD-497 — Architecture decision, scope and compatibility inventory (N00)

**Status:** PROPOSED
**Complexity:** 3 — docs and one inventory script; no runtime code, but it reverses standing product rules
**Owner:** João
**Work package:** N00 — [native-engine batch](README.md)
**Depends on:** None

## Context

The batch changes what the native package is. `packages/runtime-native/AGENTS.md` says it is "a host, not a renderer", keeps upstream `WebGPURenderer` primary, and rules out a custom C++ renderer and a native GLTF replacement (§3, R1). `docs/architecture/CHARTER.md` outranks AGENTS.md, so the reversal needs a recorded decision before any engine code lands (§3).

The compatibility target is the workspace-pinned `three: 0.185.1` in `pnpm-workspace.yaml`, with the patch `packages/core/patches/three@0.185.1.patch` (§2.2). §2.1 defines "JS-free", strict artifacts and the optional scripting profile; §11.3 requires every module under `packages/core/src` (108 entries today) to be classified before porting starts.

## Solution

1. **Decision record** (proposed: `docs/architecture/NATIVE-ENGINE-DECISION.md`). It names the reversed rules, quotes the charter rule it amends in plain words, and lists the two completion gates E and T (§1). `packages/runtime-native/AGENTS.md` and `docs/architecture/NATIVE-RUNTIME.md` change only to point at it. They keep describing the shipped host until a native engine ships (primary docs follow the executables).
2. **Definitions** in the same record: native engine, strict native artifact, optional JS scripting profile, WebView-UI labelling (§2.1), and the non-goals (§2.3). The configuration dimensions are engine implementation × game runtime × UI, and contradictory combinations are rejected (§13).
3. **Pinned reference**: three@0.185.1 plus the ThreeNative patch is the behavioural oracle. Upgrading it is a deliberate batch, never drift (§18).
4. **Legacy rollback**: the current JS-owned engine stays a separately selected backend. A strict artifact never falls back to it automatically (§1).
5. **Module classification** (proposed: `docs/architecture/native-engine-inventory.json`, produced by `scripts/native-engine-inventory.ts`). Each `packages/core/src` module, and each module reachable from it, gets one class: `native-engine`, `binding-glue`, `build-tool`, `game-specific` or `unsupported`. Each entry also names the owning work-package key (§11.3). The script fails closed on an unclassified module.

## Out of scope

- The reference outputs and baselines: [PRD-498](PRD-498-n01-baseline-and-differential-fixture-runner.md).
- The API catalog that turns the inventory into bindings: [PRD-500](PRD-500-n03-api-catalog-binding-abi-and-version-protocol.md).

## Execution Phases

#### Phase 1: The decision is recorded
**Status:** NOT STARTED
**Files:** proposed `docs/architecture/NATIVE-ENGINE-DECISION.md`; `packages/runtime-native/AGENTS.md` (pointer only)
- [ ] The decision record names gates E and T, the strict/native/scripting definitions, three@0.185.1 + patch as the pinned reference, and legacy rollback with no automatic fallback. proof: `pnpm check:docs && pnpm exec vitest run scripts/__tests__/primary-docs.spec.ts`
- [ ] AGENTS.md mirrors regenerate cleanly after the pointer edit. proof: `pnpm sync:agents --check`

#### Phase 2: Every core module is classified
**Status:** NOT STARTED
**Files:** proposed `scripts/native-engine-inventory.ts`, `scripts/__tests__/native-engine-inventory.spec.ts`, `docs/architecture/native-engine-inventory.json`
- [ ] The inventory script walks `packages/core/src` and its reachable imports, and fails on any module without a class and owner. proof: red-green `pnpm exec vitest run scripts/__tests__/native-engine-inventory.spec.ts`
- [ ] The committed inventory classifies every current module with zero `unclassified` entries. proof: `pnpm tsx scripts/native-engine-inventory.ts --check`
- [ ] Every module classed `native-engine` names an N-key that exists in the batch index. proof: `pnpm tsx scripts/native-engine-inventory.ts --check`

## Blocked on

- Owner approval of the charter amendment. João signs the decision record before Phase 1 is ticked.

## Decisions

- C++20 for the engine, Dawn/wgpu-native retained, no upstream Three.js bundle inside the native engine, TypeScriptCompiler as the first AOT candidate (§1, §4). Fixed by the proposal.
