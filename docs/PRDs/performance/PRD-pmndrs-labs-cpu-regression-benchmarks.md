---
prd_contract: v1
---

# PRD-pmndrs-labs — Opt-in CPU microbenchmarks with pmndrs/labs

**Status:** PARTIAL — Phase 1 landed and verified; Phases 2–3 pending.
**Priority:** P2 — Add focused CPU regression evidence without adding a mandatory timing gate.
**Complexity:** 4 (MEDIUM); risk override: none.
**Owner:** ThreeNative maintainers
**Depends on:** None; existing hardware/frame performance tooling remains authoritative.
**Progress:** 33%
**Date:** 2026-10-06

This is a planning-only PRD. Creating it does not install dependencies, implement the integration, establish a performance improvement, or authorize a merge. All implementation and acceptance evidence remains pending.

## Context

The user asked whether `pmndrs/labs` is worth integrating into ThreeNative and where it belongs. Recommendation: adopt a small, removable development-tool integration for Node/V8 CPU microbenchmarks. Do not integrate it into the game runtime, renderer, native host, templates, or published packages.

Assessment snapshots:

- ThreeNative `develop`: `a683fcff3b598acdd3fd47760b1be2dfd64f914e`.
- Labs `main`: `b65ac37531374061619a26223ef7a0a18b0352af`; inspected manifest version `0.9.0`. The corresponding registry artifact has not been qualified in this planning task.

ThreeNative already has the right consumer and a substantial performance system. Root `package.json` routes `pnpm bench:engines` to `scripts/engine-load-test/cli.ts`. That runner already calls `scripts/performance-regression/compare.ts`; the neighboring `run.ts` owns alternating baseline/candidate hardware runs, provenance and bounded execution. Keep those mechanisms and their existing frame/native verdicts intact.

The missing useful instrument is a focused, repeatable way to compare CPU work without launching a GPU scene. Labs supplies benchmark workers, warmup, block-based sampling, saved results, comparison reports, and correctness facilities. Its documentation explicitly limits portability to Node/V8. Node measurements can help select an optimization to investigate; they do not demonstrate browser performance, C++ boundary cost, GPU speed, native parity, or higher game FPS.

Two current implementations are suitable initial subjects:

| Subject | Current implementation | Why measure it |
| --- | --- | --- |
| Fixed-step and callback dispatch | `packages/core/src/loop.ts`: `FixedStepLoop.stepFrame`, `createAfterPhysicsPhase` | Separate simulation/dispatch overhead from renderer and device cost. |
| State writes and publication | `packages/core/src/state.ts`: `createGameStore`, `set`, `flush` | Compare coalesced writes and publication under repeatable subscriber workloads. |

Read the implementation, not old backlog assumptions: the inspected loop already retains its frame callback, and the store already reuses pending/current storage. The store's current default is frame-driven publication, not a fixed 100 ms interval. PRD-189 is related optimization history, not proof that its original findings remain present and not a prerequisite for this tool.

A concrete compatibility issue needs an explicit boundary: ThreeNative declares Node `>=20.19.0`; Labs declares Node `>=22.12.0`. Do not silently raise the framework requirement or install Labs as a mandatory root dependency.

## Solution

### Scope and alternatives

Use Labs as an instrument beneath the existing benchmark entry point. Leaving the current tooling unchanged avoids another dependency but lacks this focused worker-based CPU measurement path. Replacing the current performance framework with Labs is rejected: it would lose real-platform meaning and duplicate existing report, provenance, and hardware orchestration work. Forking Labs or rebuilding its statistics is also out of scope.

Deliver only two workload families, an isolated tool installation, and a reachable developer report. No new framework package, engine API, dashboard, workflow, automatic baseline promotion, or required CI timing threshold is part of this PRD.

### Consumer path and dependency isolation

Proposed commands below are new behavior, not commands already shipped:

```sh
# Explicit setup, using a compatible Node executable and the scoped frozen lock.
pnpm bench:engines --cpu-setup

# Capture CPU evidence for a checkout; existing non-CPU flags keep their meaning.
pnpm bench:engines --cpu --source /absolute/path/to/checkout --name candidate

# Compare two explicit saved CPU runs; never select an implicit latest result.
pnpm bench:engines --cpu-compare --baseline /path/to/base-run --candidate /path/to/candidate-run
```

Extend the existing CLI with early, mutually exclusive CPU dispatch. Unknown/missing values, conflicting hardware flags, invalid source paths, and unsupported Node versions fail before running a workload. Preserve all existing hardware branches. Use an argument array with `spawn`/`execFile`, never a shell command assembled from user paths.

Keep the tool under `scripts/performance-regression/labs/`, outside the root workspace globs (`packages/*`, `examples/*`). Add the exact Labs version to the root catalog as the version authority; a generated private tool manifest and its scoped lockfile materialize that pin for an isolated installation. A focused contract check rejects drift between the catalog and generated manifest. Do not add Labs to root dependency lists or widen the workspace globs. The isolated install must ignore the parent workspace; setup is explicit and requires Node 22.12 or newer. Normal benchmark invocation never downloads dependencies. Normal framework installation, tests, and build must not resolve or execute Labs. Root-discovered tests cover wrapper and fixture contracts without importing Labs. Real-worker integration cases require the explicit `TN_CPU_BENCH_INTEGRATION=1` mode and a qualified installation; outside that mode they are reported unrun, never counted as integration evidence. Keep shared workload fixtures free of Labs imports and let the benchmark adapters consume them.

Qualify the exact registry artifact before accepting the pin: verify version, engine requirement, executable, public exports, license, lock integrity, and the worker/config/report behavior used below. The inspected source identifies the executable as `labs`, not `bench`. Stop and report a mismatch; do not silently substitute an unpinned Git branch or another version. Preserve the upstream ISC notice wherever redistribution requires it.

The wrapper runs the installed executable with a controlled working directory containing `labs.config.ts`. Upstream currently discovers config there or in `benches/`; do not assume an undocumented `--config` option. Configuration limits discovery to the two owned workload files. Use a run-local results directory, avoiding the developer's unrelated Labs baseline/cache state.

### Workload contracts

**Loop/dispatch family.** Import the actual selected checkout's `loop.ts`, not a copied implementation. Exercise `FixedStepLoop.stepFrame` with bounded simulation callbacks, deterministic timestamp increments, and explicit request-frame/clock seams. Exercise callback dispatch at 0, 32, and 256 registered callbacks, with a bounded checksum proving the expected callbacks executed. Outside timing, check update counts, callback ordering, and registration/removal semantics against the real implementation. Renderer callbacks are deliberate CPU fixtures; report their scope as dispatch, never as a rendered frame or scene benchmark.

**State family.** Import the selected checkout's `state.ts`, including its actual resolved `zustand/vanilla` dependency. Measure 32 coalesced writes followed by one explicit `flush`, with 0, 1, and 32 subscribers. Preserve deterministic final values, immediate reads, and observable publication counts. Do not start an interval, reuse a permanently growing workload, or include constructor/setup costs in a steady-state measurement. Publication legitimately allocates snapshots; this benchmark must not assert zero allocation from timing or net heap change.

Each benchmark uses fresh bounded state at the appropriate setup boundary, consumes a result so the work remains observable, and releases subscriptions/callbacks after the run. Correctness assertions happen outside timed intervals and are exercised by focused tests. Record workload definitions, input sizes, and checksums in the report. A callback or flush bypass must invalidate correctness rather than produce a flattering timing result.

### Reports, identity, and comparison

Write artifacts under `artifacts/engine-load-test/cpu/<unique-run-id>/`: original Labs saved results, its human-readable report, and a small ThreeNative provenance manifest. Keep large results untracked. The manifest includes the measurement domain `node-cpu`, source commit and dirty status, absolute resolved source-module identities and content hashes, resolved dependency/lock hashes, tool version, Node/V8 versions, platform/architecture/CPU identity, workload/configuration hashes, start/end times, and correctness outcomes. Resolve dependency provenance from the measured checkout, not the wrapper's dependency tree.

A tool working directory's Git commit is not necessarily the measured source commit. Collect source identity separately. Baseline and candidate must resolve to the requested checkouts and actual files. Reject accidental self-comparison; allow same-revision repeatability controls only through a separately named explicit control mode. A changed workload or incompatible environment is incomparable, not a regression or improvement. Labels supplied by the caller never stand in for inspected identity.

Delegate sampling and statistical comparison to the supported Labs CLI. The inspected package exports do not expose its internal comparison module: no deep imports, copied statistics, undocumented JSON flags, or ANSI-output scraping for a machine verdict. Validate saved-result structure and nonempty coverage against the pinned artifact; retain upstream JSON unchanged. Publish the comparison report with explicit baseline/candidate identities and the subprocess exit result, without converting exit zero into a ThreeNative performance PASS.

Neutral statistical output is not proof of equivalence. Preserve upstream instability/confound warnings. Per-benchmark tests do not automatically control false positives across a suite. Inner timing samples are not independent process replicates, and interleaving cases within one run does not establish interleaved measurements of two Git revisions. No new confidence claim or percentage FPS improvement is derived from these results.

Existing frame-based `IRunReport`, hardware lane manifests, thresholds, and comparison logic remain untouched. CPU artifacts must never populate a GPU/frame lane, manufacture `frameMs`, or satisfy native parity. A later optimization motivated by this tool still needs the relevant existing browser/native workload and correctness playtest before claiming end-to-end improvement.

### Bounded execution and failure handling

Use the upstream validated defaults unless a recorded config explicitly changes them. Set a proposed 300-second wall-clock budget for one default CPU capture, excluding explicit setup; this is a design limit, not a measured runtime claim. On timeout or cancellation, terminate the worker process tree and mark the run incomplete. Exceptions, assertion failures, zero discovered cases, missing files, nonfinite statistics, incompatible schemas, and missing provenance cannot produce valid evidence. Retain diagnostic artifacts separately from completed reports. Capture failures return nonzero; comparisons remain advisory and never change merge policy.

## Integration Ledger

| Capability | Reachable consumer/trigger | Replaces / disposition | Evidence |
| --- | --- | --- | --- |
| Isolated CPU capture | Root `bench:engines` script → `scripts/engine-load-test/cli.ts` CPU dispatch → proposed `scripts/performance-regression/cpu.ts` → installed Labs CLI and real core modules | Adds a distinct CPU instrument; no replacement of frame/hardware collectors | P1-B, P2-A, P2-B, AC-1 |
| Explicit CPU comparison | Same existing entry point with proposed `--cpu-compare` → identity validation → Labs CLI → discoverable report/artifacts | No implicit baseline, no new statistical implementation, no hardware verdict reuse | P3-A, P3-B, AC-1 |

Implementation must record final non-test dispatch locations alongside the owning proof. Merely importing a helper in tests is not evidence that `pnpm bench:engines` reaches it.

## Execution Phases

The proof commands below describe tests/flows to implement in this PRD. They have not run. Phase 1 establishes the launch/config contract; the two workload files in Phase 2 can then be authored independently. Phase 3 follows the combined candidate. Do not overlap measurement processes on the same machine to claim a time saving.

### Phase 1 — An isolated tool reachable through the existing CLI

**Status:** DONE
**Files:** EDIT `scripts/engine-load-test/cli.ts`, `pnpm-workspace.yaml`, `tsconfig.json`, `.gitignore`; NEW `scripts/performance-regression/cpu.ts`, `scripts/performance-regression/labs/labs.config.ts`, generated private tool manifest and scoped lock; EXTEND/NEW focused script tests.
**Implementation:** Qualify the pinned artifact, implement explicit setup/version checks, isolated installation and early CLI dispatch. Keep the root dependency graph and normal workspace paths unchanged.

- [x] P1-A [local; actor: agent]: Labs installs only through the explicit isolated setup path with its qualified exact version. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-tooling.spec.ts` — Evidence: 16/16 passed. `TN_CPU_BENCH_NODE=<node22> pnpm bench:engines --cpu-setup` installed `@pmndrs/labs@0.9.0` into `scripts/performance-regression/labs` from the catalog pin, with `node-linker=hoisted` and the scoped `pnpm-lock.yaml`; the root package graph, workspace globs and root lock are unchanged.
- [x] P1-B [local; actor: agent]: The real `bench:engines` CPU entry point launches the installed worker and records its result, or returns a specific actionable failure. proof: `TN_CPU_BENCH_INTEGRATION=1 pnpm exec vitest run scripts/__tests__/cpu-bench-cli.spec.ts` — Evidence: 5/5 passed. The real entry point launched the installed worker through a smoke workload and recorded `provenance.json` plus the raw Labs result; an empty workload directory returned the actionable `TN_CPU_BENCH_RUN_FAILED`.

**Checkpoint:** Self-review pending; obtain one substantive reviewer when available, otherwise label self-review. Do not count a reviewer result as an implementation box.

### Phase 2 — Real, correctness-qualified CPU workloads

**Status:** NOT STARTED
**Files:** NEW `scripts/performance-regression/labs/benches/loop.bench.ts`, `scripts/performance-regression/labs/benches/state.bench.ts`, shared pure workload fixtures; EXTEND focused workload tests and configuration. Core implementation files are measurement subjects, not modification targets.
**Implementation:** Implement the bounded workload contracts above using actual selected-checkout modules. Keep setup/assertions outside timing; verify observable results and cleanup. Group the three dispatch sizes and three subscriber sizes into only two workload families.

- [ ] P2-A [local; actor: agent]: The loop family executes the selected checkout's real fixed-step/dispatch behavior with the expected observable callback results. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-workloads.spec.ts -t loop` — Evidence: pending.
- [ ] P2-B [local; actor: agent]: The state family measures the selected checkout's real coalesced-write/publication behavior with correct final values and notifications. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-workloads.spec.ts -t state` — Evidence: pending.

**Checkpoint:** Pending. Existing core correctness tests remain authoritative for behavior beyond the benchmark fixture; do not pretend these CPU workloads prove full game behavior.

### Phase 3 — Honest comparison and bounded report consumption

**Status:** NOT STARTED
**Files:** EXTEND `scripts/performance-regression/cpu.ts` and focused CLI/tooling tests; NEW `scripts/performance-regression/cpu-report.ts`; EDIT the relevant existing benchmark usage documentation after the commands ship.
**Implementation:** Preserve raw results, write/validate provenance, delegate explicit comparisons, and return discoverable artifact paths. Implement timeouts, child cleanup, and incomplete/incomparable outcomes. Do not edit a workflow or the hardware report schema.

- [ ] P3-A [local; actor: agent]: Comparison rejects incompatible, missing, stale, or accidentally identical source evidence rather than presenting it as an optimization result. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-cli.spec.ts -t comparison` — Evidence: pending.
- [ ] P3-B [local; actor: agent]: A timed-out or cancelled capture leaves no active benchmark worker and no completed-result claim. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-cli.spec.ts -t lifecycle` — Evidence: pending.

**Checkpoint:** Pending. Inspect the combined diff and actual CLI artifacts; report reviewer availability honestly. Focused controls must exercise the real caller where silent bypass or stale-artifact reuse is plausible.

## Acceptance Criteria

- [ ] AC-1 [local; actor: agent]: A developer can capture both workload families from two explicit source checkouts through `pnpm bench:engines`, compare the runs, and open a report identifying the actual measured sources and CPU-only scope. proof: `TN_CPU_BENCH_INTEGRATION=1 pnpm exec vitest run scripts/__tests__/cpu-bench-cli.spec.ts -t end-to-end` with the qualified installed Labs executable and real core modules — Evidence: pending.
- [ ] AC-2 [local; actor: agent]: A normal supported framework install/build/test path does not install, import, or execute Labs; ordinary hardware benchmark dispatch retains its pre-change behavior. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-tooling.spec.ts scripts/__tests__/cpu-bench-cli.spec.ts -t compatibility` including a Node 20.19 compatibility environment — Evidence: pending.

These are eight required boxes total, including six phase outcomes. Tests may share a fixture, but each box asserts its named property. Existing source/workspace gates still apply to implementation changes; the focused examples above do not waive required typecheck, lint, tests, or documentation checks.

## Blocked on

No external owner, device, deployment, or release action is required by this planning scope. Package qualification and execution evidence are implementation work still to do, not satisfied prerequisites. A compatible Node 20.19 environment is required for AC-2; check available local/CI environments before treating it as unreachable. No physical-device or GPU performance claim is an acceptance criterion here.

## Decisions

2026-10-06 — Proposed by this assessment in response to the user's integration request: adopt Labs selectively as optional CPU tooling; retain existing ThreeNative performance authority. Choose P2 because this adds developer evidence rather than fixing a confirmed release blocker. Do not fork Labs, add a required timing gate, expand to input/culling/physics suites, or claim a speedup in this PRD. Such expansion requires a measured need and separate scope.

## Verification status

Phase 1 landed: the pinned `@pmndrs/labs@0.9.0` artifact is installed only through the explicit isolated setup path, the existing CLI dispatches `--cpu-setup`/`--cpu` before hardware parsing, and the installed worker was launched end to end against a smoke workload. Phases 2–3 and both acceptance criteria remain open; no workload family, comparison report, or measured speedup exists yet. Document validation is reported in the PR body; it does not advance implementation progress.

## Sources inspected

- [ThreeNative root commands and Node floor](https://github.com/ThreeNativeHQ/threenative/blob/a683fcff3b598acdd3fd47760b1be2dfd64f914e/package.json)
- [ThreeNative workspace globs and version catalog](https://github.com/ThreeNativeHQ/threenative/blob/a683fcff3b598acdd3fd47760b1be2dfd64f914e/pnpm-workspace.yaml)
- [Existing benchmark entry point](https://github.com/ThreeNativeHQ/threenative/blob/a683fcff3b598acdd3fd47760b1be2dfd64f914e/scripts/engine-load-test/cli.ts)
- [Existing paired hardware collector](https://github.com/ThreeNativeHQ/threenative/blob/a683fcff3b598acdd3fd47760b1be2dfd64f914e/scripts/performance-regression/run.ts)
- [Current loop and callback implementation](https://github.com/ThreeNativeHQ/threenative/blob/a683fcff3b598acdd3fd47760b1be2dfd64f914e/packages/core/src/loop.ts)
- [Current state publication implementation](https://github.com/ThreeNativeHQ/threenative/blob/a683fcff3b598acdd3fd47760b1be2dfd64f914e/packages/core/src/state.ts)
- [Labs manifest, executable, exports, Node floor and license declaration](https://github.com/pmndrs/labs/blob/b65ac37531374061619a26223ef7a0a18b0352af/package.json)
- [Labs public API](https://github.com/pmndrs/labs/blob/b65ac37531374061619a26223ef7a0a18b0352af/src/index.ts)
- [Labs worker/config/CLI launch path](https://github.com/pmndrs/labs/blob/b65ac37531374061619a26223ef7a0a18b0352af/src/cli/runner.ts)
- [Labs comparison command](https://github.com/pmndrs/labs/blob/b65ac37531374061619a26223ef7a0a18b0352af/src/cli/commands/compare.ts)
- [Labs documented methodology and statistical limitations](https://github.com/pmndrs/labs/blob/b65ac37531374061619a26223ef7a0a18b0352af/README.md)
