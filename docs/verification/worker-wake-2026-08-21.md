# Worker idle wake — P2-1 verification, 2026-08-21

PRD: `docs/PRDs/technical-debt-p2-2026-08-21/PRD-P2-1-native-worker-wake.md`
Target executed: **desktop Linux (V8)**. Android and iOS were **not** executed for this change
(no device lane was chased, per task constraints); both are named unverified targets.

## What actually runs

Two facts discovered while setting up the measurement lane, both pre-existing:

1. **The worker subsystem is not linked into the host binary.**
   `src/workers/worker_thread.cpp` and `src/workers/worker_registry.cpp` appear in no CMake
   source list (`MYSTRAL_SOURCES`, `CMakeLists.txt:1105` onward); the `Worker` global the
   installed runtime exposes is a main-thread polyfill (`src/runtime.cpp:2663`). The PRD's
   "production path" is therefore production *of the class*, exercised here through a
   dedicated harness rather than the packed game loop.
2. **This prebuilt V8 requires process-global init ordering.** `v8_engine.cpp:63`
   (`initializeV8`) guards `g_initialized` with a plain bool (unguarded race), and this
   monolith reserves its code tables during the *first* isolate creation: if that first
   creation happens off the main thread, every later isolate creation segfaults
   (`WasmCodePointerTable::AllocateUninitializedEntry`). The real host never hits either
   condition because it boots its main engine on the main thread before any worker starts;
   the harness mirrors that ordering.

## Measurement harness

Compiled in `/tmp/tn-worker-wake/` (untracked) from the repo's real
`src/workers/worker_thread.cpp` + `worker_registry.cpp` using the exact defines/includes of
the desktop Release build (`build/tn-linux/compile_commands.json`) and the same link inputs as
the `mystral` target (`libmystral-runtime.a`, `libv8_monolith.a`, …). Engine reported by the
binary itself: `[JS] Creating V8 engine (platform default)` / `[V8] Version: 13.1.201.22`.

Instrumentation added to `WorkerThread` for both baseline and after builds:
`loopEvals_` (times the main loop evaluated `__processMessages()`), `idleWaits_` /
`idleWakes_` (blocking-wait entries/exits), exposed via `waitStats()` — test-only, never
exposed to JavaScript.

## Baseline vs after (500 ms idle window, echo round-trip, then terminate)

| Metric | Baseline (1 ms poll) | After (predicate wait) |
| --- | --- | --- |
| Idle JS evaluations per worker per 500 ms | 459–471 (~940/s ≈ 1 kHz) | **0–2** (boot + ping wake only) |
| Blocking waits entered / wakes per posted message | 0 / n/a (polling) | 1–2 / exactly 1 per message |
| First-message latency (single arm) | 445–968 µs | 148–893 µs across 5 runs (296–388 µs typical) |
| First-message latency (4-worker arm, per worker) | 147–865 µs | 89–893 µs, all echoes correct |
| Terminate→join, single | 1 ms | 0–1 ms |
| Terminate→join, all 4 workers | ≤ 3 ms total | 0 ms total |
| Message correctness (`echo_ok`) | 1/1, 4/4 | 1/1, 4/4 across all runs |
| Process CPU, 2 s idle window (bash `time`, single worker) | user 32 ms + sys 10 ms (~2.1%) | user 9 ms + sys 10 ms (~0.95%) |

Raw lines (after-fix, representative run):

```
WAKE_RESULT arm=single workers=1 worker=0 idle_ms=500 loop_evals_in_window=2 idle_waits=2 idle_wakes=1 latency_us=296 join_ms=0 echo_ok=1 still_running=0
WAKE_RESULT arm=multi workers=4 worker=0 idle_ms=500 loop_evals_in_window=1 idle_waits=1 idle_wakes=1 latency_us=228 join_ms=0 echo_ok=1 still_running=0
WAKE_RESULT arm=multi workers=4 worker=1 idle_ms=500 loop_evals_in_window=1 idle_waits=1 idle_wakes=1 latency_us=149 join_ms=0 echo_ok=1 still_running=0
WAKE_RESULT arm=multi workers=4 worker=2 idle_ms=500 loop_evals_in_window=1 idle_waits=1 idle_wakes=1 latency_us=295 join_ms=0 echo_ok=1 still_running=0
WAKE_RESULT arm=multi workers=4 worker=3 idle_ms=500 loop_evals_in_window=2 idle_waits=2 idle_wakes=1 latency_us=214 join_ms=0 echo_ok=1 still_running=0
MULTI_JOIN_ALL_MS=0
```

Baseline raw lines (first clean capture):

```
WAKE_RESULT arm=single workers=1 worker=0 idle_ms=500 loop_evals_in_window=468 idle_waits=0 idle_wakes=0 latency_us=627 join_ms=1 echo_ok=1 still_running=0
WAKE_RESULT arm=multi workers=4 worker=0 idle_ms=500 loop_evals_in_window=470 idle_waits=0 idle_wakes=0 latency_us=812 join_ms=0 echo_ok=1 still_running=0
WAKE_RESULT arm=multi workers=4 worker=1 idle_ms=500 loop_evals_in_window=471 idle_waits=0 idle_wakes=0 latency_us=865 join_ms=0 echo_ok=1 still_running=0
WAKE_RESULT arm=multi workers=4 worker=2 idle_ms=500 loop_evals_in_window=470 idle_waits=0 idle_wakes=0 latency_us=147 join_ms=0 echo_ok=1 still_running=0
WAKE_RESULT arm=multi workers=4 worker=3 idle_ms=500 loop_evals_in_window=470 idle_waits=0 idle_wakes=0 latency_us=841 join_ms=0 echo_ok=1 still_running=0
MULTI_JOIN_ALL_MS=3
```

## Behaviour preservation checks (after fix)

```
CLOSE_PATH outputs_after_close=0 joined=1 join_ms=0
POST_AFTER_TERMINATE survived=1 queue_empty=1
```

`close()` exits the loop via `__processMessages()` returning false without reaching the wait;
a post after `terminate()` is dropped; every terminate joins. No lost wake is possible
between the empty-queue check and the wait: the check happens inside JS before the wait is
entered, and both `postMessage()` and `terminate()` push under `inMutex_` — the same mutex
released atomically when the waiter sleeps — before notifying `inCondition_`.

Pre-existing gap found on the way (identical at HEAD, so not caused or changed by P2-1):
a top-level `throw` in worker code reports "User code executed successfully" and delivers no
ERROR message — the engine-level `eval()` contract does not surface the exception
(`v8_engine.cpp`; outside this PRD's file list). In-message errors still reach `_onerror`
and the console override.

## Negative controls (both observed red)

Exact focused command (run from `packages/runtime-native/`; the vitest-4 include semantics
require the package cwd, the PRD's repo-root form resolves to the root config which does not
include this suite):

```sh
pnpm exec vitest run --config vitest.config.ts tests/worker-idle.test.mjs
```

**NC1 — restore the 1 ms polling loop** (mutation: re-added
`std::this_thread::sleep_for(std::chrono::milliseconds(1));` inside `threadMain`'s loop,
then reverted):

```
Error: RED observed: idle wake bound exceeded — threadMain restored a periodic idle sleep
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
exit=1
```

**NC2 — remove termination notification** (mutation: deleted
`inCondition_.notify_one();` from `terminate()`, then reverted):

```
Error: RED observed: worker join timeout — terminate() does not notify the idle wait before joining
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
exit=1
```

Both mutations were restored afterward; the focused suite is green again (source lane and,
with `TN_WORKER_WAKE_BIN=/tmp/tn-worker-wake/worker-wake-harness`, the runtime-measurement
lane).

## Gates

| Gate | Result |
| --- | --- |
| Focused worker suite (source + runtime arms) | PASS, exit 0 |
| `pnpm exec vitest run --config vitest.config.ts` (runtime-native, 49 files) | PASS — 329 passed, 30 skipped, exit 0 |
| `pnpm typecheck` (root) | FAIL — `packages/playtest/__tests__/scenario.spec.ts(623,17)` TS2353, a file under active edit by the concurrent P2-3/P2-5 lane; none of my files participate in any tsconfig project |
| `pnpm lint` (root) | FAIL — 5 errors, all in the concurrent lane's files: `packages/create-threenative/src/threenative.ts` (organizeImports, format) and `scripts/__tests__/primary-docs.spec.ts` (3× noExportsInTest); `packages/runtime-native/**` is excluded from biome by `biome.json` |
| `pnpm test` (root) | FAIL before any tests ran — capability-manifest step rejects the concurrent lane's new exports `evaluateRichPlaytestAssertions` / `resolveDiagnosticsPolicy` missing `@situation` tags |
| `pnpm native:build` | PASS, exit 0 (incremental — "ninja: no work to do"; note it does not compile `src/workers/`, so the harness build above is the actual compile proof for the changed C++) |

## Census

`pnpm census` run after the change, exit 0: native runtime LOC total **78,406 → 78,618**
(+212). Cell deltas: `src/` 38,836 → 38,857 (`worker_thread.cpp` predicate wait +
instrumentation), `include/` 3,816 → 3,836 (`worker_thread.h` WaitStats contract),
`tests/` 9,540 → 9,711 (new `tests/worker-idle.test.mjs` plus the census row in
`native-platform-workflow.test.mjs`). The census doc's diff is left **uncommitted** for the
coordinator to reconcile with the concurrent lane that also touches that file.
