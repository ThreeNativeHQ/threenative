---
prd_contract: v1
---

# PRD-pmndrs-labs — Opt-in CPU microbenchmarks with pmndrs/labs

**Status:** PARTIAL — Phases 1–2 and P3-B landed and verified; P3-A and acceptance criteria pending.
**Priority:** P2 — Add focused CPU regression evidence without adding a mandatory timing gate.
**Complexity:** 4 (MEDIUM); risk override: none.
**Owner:** ThreeNative maintainers
**Depends on:** None; existing hardware/frame performance tooling remains authoritative.
**Progress:** 83%
**Date:** 2026-10-06

Phases 1–2 are implemented. Phase 1 installed the pinned `@pmndrs/labs@0.9.0` artifact only through the explicit isolated setup path and dispatched `--cpu-setup`/`--cpu` from the existing CLI. Phase 2 added the two real workload families and their correctness controls. Phase 3's bounded lifecycle (P3-B) is implemented and verified; comparison (P3-A) and the acceptance criteria remain open. No measured speedup or comparison report exists yet.

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

The proof commands below describe tests/flows implemented in this PRD. Phase 1 establishes the launch/config contract; the two workload files added in Phase 2 run real selected-checkout modules and are proven by the focused tests and a real capture. Phase 3 follows the combined candidate. Do not overlap measurement processes on the same machine to claim a time saving.

### Phase 1 — An isolated tool reachable through the existing CLI

**Status:** DONE
**Files:** EDIT `scripts/engine-load-test/cli.ts`, `pnpm-workspace.yaml`, `tsconfig.json`, `.gitignore`; NEW `scripts/performance-regression/cpu.ts`, `scripts/performance-regression/labs/labs.config.ts`, generated private tool manifest and scoped lock; EXTEND/NEW focused script tests.
**Implementation:** Qualify the pinned artifact, implement explicit setup/version checks, isolated installation and early CLI dispatch. Keep the root dependency graph and normal workspace paths unchanged.

- [x] P1-A [local; actor: agent]: Labs installs only through the explicit isolated setup path with its qualified exact version. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-tooling.spec.ts` — Evidence: 16/16 passed. `TN_CPU_BENCH_NODE=<node22> pnpm bench:engines --cpu-setup` installed `@pmndrs/labs@0.9.0` into `scripts/performance-regression/labs` from the catalog pin, with `node-linker=hoisted` and the scoped `pnpm-lock.yaml`; the root package graph, workspace globs and root lock are unchanged.
- [x] P1-B [local; actor: agent]: The real `bench:engines` CPU entry point launches the installed worker and records its result, or returns a specific actionable failure. proof: `TN_CPU_BENCH_INTEGRATION=1 pnpm exec vitest run scripts/__tests__/cpu-bench-cli.spec.ts` — Evidence: 5/5 passed. The real entry point launched the installed worker through a smoke workload and recorded `provenance.json` plus the raw Labs result; an empty workload directory returned the actionable `TN_CPU_BENCH_RUN_FAILED`.

**Checkpoint:** Self-review pending; obtain one substantive reviewer when available, otherwise label self-review. Do not count a reviewer result as an implementation box.

### Phase 2 — Real, correctness-qualified CPU workloads

**Status:** DONE
**Files:** NEW `scripts/performance-regression/labs/benches/loop.bench.ts`, `scripts/performance-regression/labs/benches/state.bench.ts`, shared pure fixtures `scripts/performance-regression/labs/workloads/selected-source.ts`, `loop-workload.ts`, `state-workload.ts`; EXTEND `scripts/__tests__/cpu-bench-workloads.spec.ts`; EDIT `scripts/performance-regression/cpu.ts` (child environment allowlist, `--ignore-scripts`). Core implementation files are measurement subjects, not modification targets. No `labs.config.ts` change was needed: it already limits discovery to `benches/**/*.bench.ts` and already exposes the block/sample/source knobs the workloads read.
**Implementation:** The pure fixtures import the selected checkout's real `packages/core/src/loop.ts` and `state.ts` through `TN_CPU_BENCH_SOURCE` (never the runner's copy) and hold setup, registration and every assertion outside the timed closure. The Labs adapters only register them. Each family groups its three sizes into one group.

- [x] P2-A [local; actor: agent]: The loop family executes the selected checkout's real fixed-step/dispatch behavior with the expected observable callback results. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-workloads.spec.ts -t loop` — Evidence: 2/2 passed. The positive case runs `FixedStepLoop.stepFrame` over 120 exact 1/64 s steps at 0/32/256 registered callbacks and checks update/tick counts, dispatch count, order-independent checksum and fixed `dt`; the red case runs a stub checkout that never dispatches `onAfterPhysics` and its `verify()` throws. Real capture `TN_CPU_BENCH_NODE=<node22> pnpm bench:engines --cpu --source <checkout> --name p2-workloads` recorded `loop.bench.ts` dispatch 0/32/256 at 8 blocks (224/232/224 samples, avg 72,929/167,388/462,265 ns, no errors).
- [x] P2-B [local; actor: agent]: The state family measures the selected checkout's real coalesced-write/publication behavior with correct final values and notifications. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-workloads.spec.ts -t state` — Evidence: 2/2 passed. The positive case runs 32 `set()` writes plus one `flush()` at 0/1/32 subscribers and checks the immediate pre-flush read, the coalesced pre-flush publication, the post-flush value, the notification count and the stable immediate-snapshot identity; the red case runs a stub checkout that never publishes and its `verify()` throws. The same real capture recorded `state.bench.ts` 0/1/32 subscribers at 8 blocks (352/408/400 samples, avg 2,641/2,230/2,663 ns, no errors).

**Child environment safety:** A benchmark worker runs trusted local source, but that source is arbitrary Node execution, so `runCpuCapture` no longer spreads the wrapper's whole environment. `labsChildEnv` passes only runtime basics (`PATH`, `HOME`, temp/locale/`TERM`, platform runtime dirs) and the explicit `TN_CPU_BENCH_*` knobs; arbitrary tokens, credentials, `NODE_OPTIONS`/preload hooks and SSH-agent variables are dropped. `TN_CPU_BENCH_INTEGRATION=1 pnpm exec vitest run scripts/__tests__/cpu-bench-workloads.spec.ts -t "child environment"` — Evidence: 2/2 passed (5.77 s); the probe workload in the real child observed `null` for an injected sentinel, `NPM_TOKEN`, `SSH_AUTH_SOCK` and `NODE_OPTIONS`. This is not a sandbox claim: it limits ambient secrets, not what trusted benchmark code may do. The isolated install now also passes `--ignore-scripts`; `TN_CPU_BENCH_NODE=<node22> pnpm bench:engines --cpu-setup` still installed `@pmndrs/labs@0.9.0` with the frozen scoped lock and hoisted linker (exit 0). Scoped dependency audit (parent, read-only): the isolated `package.json`+`pnpm-lock.yaml` copied into a fresh outside-workspace temp dir gave `pnpm audit --json` exit 0, 37 dependencies, zero vulnerabilities, artifact `/tmp/tmp.Zm3z6R6zdu/audit.json`; static inspection of the installed `dist` found no telemetry/network calls or lifecycle hooks.
**Outstanding gap (resolved in P3-B, 2026-10-06):** the old `execFileAsync` timeout terminated only the direct child, leaving the Labs worker subtree. `runBoundedProcess` now kills the whole process group with TERM→KILL escalation; P3-B carries the proof.

**Checkpoint:** Self-review; no reviewer available. Existing core correctness tests remain authoritative for behavior beyond the benchmark fixture; these CPU workloads do not prove full game behavior.

### Phase 3 — Honest comparison and bounded report consumption

**Status:** PARTIAL — P3-B landed and verified; P3-A (comparison) open.
**Files:** EXTEND `scripts/performance-regression/cpu.ts` and focused CLI/tooling tests; NEW `scripts/performance-regression/cpu-report.ts`; EDIT the relevant existing benchmark usage documentation after the commands ship.
**Implementation:** Preserve raw results, write/validate provenance, delegate explicit comparisons, and return discoverable artifact paths. Implement timeouts, child cleanup, and incomplete/incomparable outcomes. Do not edit a workflow or the hardware report schema.

- [ ] P3-A [local; actor: agent]: Comparison rejects incompatible, missing, stale, or accidentally identical source evidence rather than presenting it as an optimization result. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-cli.spec.ts -t comparison` — Evidence: pending.
- [x] P3-B [local; actor: agent]: A timed-out or cancelled capture leaves no active benchmark worker and no completed-result claim. proof: `pnpm exec vitest run scripts/__tests__/cpu-bench-cli.spec.ts -t lifecycle` — Evidence: 4/4 passed. `runBoundedProcess` spawns the capture with `detached` POSIX process groups and enforces from `cpu.ts:runBoundedProcess` a timeout, a SIGINT/SIGTERM abort, capped (32 MiB) output, and a TERM→KILL escalation that reaps descendants even when the direct child exits first; the four tests use real Node child+grandchild processes, including a grandchild that ignores TERM. `TN_CPU_BENCH_INTEGRATION=1 pnpm exec vitest run scripts/__tests__/cpu-bench-cli.spec.ts scripts/__tests__/cpu-bench-tooling.spec.ts scripts/__tests__/cpu-bench-workloads.spec.ts --no-file-parallelism` — Evidence: 39/39 passed (33.65 s). The real-Labs cases time out (`TN_CPU_BENCH_TIMEOUT`, 4 s override) and receive a live `SIGTERM` (`TN_CPU_BENCH_CANCELLED`, 6 s); each leaves its run directory without `provenance.json`, so no completed-result claim is recorded. `TN_CPU_BENCH_TIMEOUT_MS` only narrows the 300 s budget and fails closed outside a positive integer ≤ `CPU_CAPTURE_BUDGET_MS`. Windows tree termination is not implemented or claimed.

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

Phases 1–2 landed. The pinned `@pmndrs/labs@0.9.0` artifact installs only through the explicit isolated setup path (now `--ignore-scripts`), the existing CLI dispatches `--cpu-setup`/`--cpu` before hardware parsing, and the installed worker was launched end to end. Phase 2 adds both real workload families against selected-checkout modules and captured six cases through `pnpm bench:engines --cpu` with no errors.

P3-B landed on 2026-10-06: `runBoundedProcess` owns the real-process-group lifecycle, the wrapper handles SIGINT/SIGTERM, and capture/setup argv now reject extras and duplicates. The previously noted direct-child-only timeout gap is closed. P3-A (comparison) and both acceptance criteria remain open; no comparison report or measured speedup exists yet.

Parent-lane Node 20.19.6 compatibility evidence only (AC-2 not ticked): the isolated profile is installed with the frozen scoped lock, and the four loop/state correctness tests pass — `pnpm exec vitest run scripts/__tests__/cpu-bench-workloads.spec.ts -t loop` 2/2 and `-t state` 2/2, plus the `runBoundedProcess` lifecycle tests 4/4 under the same Node. AC-2 still needs proof over the full ordinary install/build/test path, which is not run here.

Document validation is reported in the PR body; it does not advance implementation progress.

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
