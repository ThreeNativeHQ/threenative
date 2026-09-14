# Midway tooling foundations — first slice

Source plan: [Midway session mining, September 14](../midway-session-mining-2026-09-14.md).
Base: `develop` at `7f7627ae839b94283f0e6b5477e9fac3420a6855`.

**Status: draft; source implementation and local checks, not release qualification.**
This change covers the report's proposed first slice (#1, #3 and #4). It does not claim
the other seven proposals, a Midway performance improvement, or native/GPU proof.

## 1. Discover the operation an example actually calls

The browser wildcard re-export gave Chromium-argument metadata to pointer reconciliation.
The grouped scenario re-export gave loader/tick metadata to an error constructor. These
exports now have operation-specific summaries, situations, constraints and importable examples.
No existing public symbol is removed. Tick accessors read durations; they do not advance a game.

The source-metadata test checks the example's import and actual call/new expression, rather
than accepting a non-empty comment. A separate integration test builds the real manifest and
queries the existing MCP search for the three reported situations. Public-entry example tests
exercise the browser helpers, scenario loader, tick accessors and validation errors.

**Generated outputs still need synchronization in a dependency-complete checkout.** Do not
hand-patch either manifest mirror or consider installed-package discovery fixed before this:

```sh
pnpm capabilities:sync
pnpm exec vitest run scripts/__tests__/capability-operation-metadata.spec.ts scripts/__tests__/capability-operation-search.spec.ts packages/playtest/__tests__/capability-examples.spec.ts
```

Review all generated changes, including `packages/core/capabilities.json`,
`packages/create-threenative/capabilities.json`, and generated capability documentation.
Discovery must use the manifest shipped by the engine version the consumer actually installs;
a copied manifest in a game is not a substitute for that identity.

## 3. Custom captures borrow a session, not a new launcher

`withBrowserCapture(config, callback, signal?)` is exported from
`@threenative/playtest/runner`. It composes the existing capture lock, display provider,
managed-server helpers, bridge handshake/setup, startup gate, adapter provenance, blank-frame
guard and bounded browser teardown. It does not replace the scenario runner.

It owns only the server/browser/display/lease it acquires. A supplied URL with no managed-server
command is borrowed; no unrelated server is stopped. Linux uses the existing private-display
policy unless the operator explicitly chooses the host display. Capture callbacks run headed;
this does not mean commandeering the visible Linux desktop.

The callback starts after the bridge and engine startup gate. Its `screenshot(label)` validates
the image before writing it; a failed recapture also removes the same label's stale PNG.
`capture.json` records adapter provenance, and `capture-session.json` records display strategy,
startup/setup evidence and `timingEvidence: "not-qualified"`. Neither file is a scenario verdict.
A screenshot, particularly one made under a virtual display, is not an FPS measurement.

Only web scenarios are accepted. Boot-failure scenarios, an explicitly bypassed startup gate,
missing startup capability, unknown renderer provenance and unapproved software adapters fail
closed. Scenario setup is handled by the existing handshake; scenario steps and assertions are
**not executed**. Use `runStandalonePlaytest` when their verdict is required.

Example game-owned capture script:

```ts
import { parseStandalonePlaytestArgs, withBrowserCapture } from "@threenative/playtest/runner";

const config = parseStandalonePlaytestArgs(process.argv.slice(2));
const controller = new AbortController();
const interrupt = () => controller.abort(new Error("Capture interrupted"));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  await withBrowserCapture(config, async (session) => {
    await session.screenshot("ready");
    // Read game-specific observations here; do not reimplement browser/display ownership.
  }, controller.signal);
} catch (error) {
  console.error(error);
  process.exitCode = error instanceof Error && error.name === "CaptureLockTimeoutError" ? 75 : 1;
} finally {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
}
```

Run from the game project with a scenario that advertises the game's startup capability:

```sh
CAPTURE_LOCK=1 pnpm exec tsx tools/capture.ts --scenario playtests/smoke.playtest.json --server-command 'pnpm exec vite --host 127.0.0.1 --port $PORT --strictPort' --port 0 --timeout 120000 --artifacts artifacts/custom-capture
```

Lock contention retains the existing lock timeout and exit-75 convention, not a failed game
assertion. Cancellation is checked between resource acquisitions; a queued acquisition retains
its existing bounded queue wait rather than abandoning a future lease without its release
handle. Page operations and the callback respond to the supplied signal. The callback budget
is `config.timeoutMs`; boot and bridge work receive the existing startup allowance. The library
does not install process-wide signal/exit handlers, so a CLI should wire signals as above.

Before qualification, replace at least two actual Midway capture scripts with this primitive
and compare their outputs. Those external game scripts were not available in this checkout;
no migration or live-browser success is claimed here.

## 4. A repeated-flight CPU fixture before optimizing allocations

The test-only fixture uses 32 synthetic aircraft, seed `20260914`, fixed `1 / 60`-second steps,
120 warmup ticks and 600 measured ticks. Its airframe values and population are test inputs,
not a new engine preset or Midway's battle configuration. It calls the existing `FlightModel`
and `createRandom`; neither implementation is changed.

```sh
pnpm exec tsx scripts/check-flight-cost.ts > artifacts-flight-cost.json
```

One sample is elapsed CPU time for **one whole population step**, not one aircraft and not a
rendered frame. Setup, warmup, sample-buffer allocation, sorting, hashing and state inspection
are outside that measured interval. The report includes all samples, mean/p50/p95/max, setup
and warmup times, workload, runtime identity, source hashes and a final-state hash.

No universal machine-dependent budget is shipped. Supply bounds derived from a comparable
baseline when a budget check is needed:

```sh
pnpm exec tsx scripts/check-flight-cost.ts --max-mean-ms 1 --max-p95-ms 2
```

Those numbers illustrate syntax, not an accepted performance target. Exit 0 without bounds
means measurement completed; the report says `measurement-only` and has no passing verdict.
With bounds, exit 1 means budget failure. Invalid arguments, workload, clocks or sample series
exit 2. The deterministic negative control proves that an identically shaped workload whose
step costs four clock units instead of one trips the bound while producing the same final state.
It does not claim a hardware performance threshold.

For before/after work, keep the fixture/workload, runtime and measurement mode identical.
Check final-state equality when behavior should be unchanged, and retain the source hashes to
identify which implementation produced each result. Warmup reduces first-use effects; it does
not prove that all JIT or scheduler effects have disappeared.

### Bounded allocation sampling and frame attribution

Use the existing runtime tools rather than adding another profiler:

```sh
mkdir -p artifacts/cpu-cost
pnpm exec node --heap-prof --heap-prof-interval=65536 --heap-prof-dir=artifacts/cpu-cost --import=tsx scripts/check-flight-cost.ts > artifacts/cpu-cost/sampled-run.json
pnpm exec threenative-playtest trace --url http://127.0.0.1:5173 --seconds 20 --settle 4 --out artifacts/cpu-cost/scene-trace.json
```

The Node sample is bounded by the fixed fixture and process exit. It is a sampled heap profile,
not an exact allocation census. It includes module loading and setup: inspect FlightModel call
stacks rather than attributing the whole process profile to steady-state stepping. Sampling changes
overhead; do not compare sampled timings
with an unsampled baseline. For the browser trace, preserve the reproduced game's actual input
journey; the trace command's default held input is `KeyW`, and `--no-input` changes the workload.

A large p95/mean ratio is an investigation signal, **not proof that GC caused a pause**. Use
allocation evidence and the existing trace to attribute the slow work before changing hot-path
objects. This fixture does not measure GPU work, native replay, a complete battle, or FPS.

## Verification record and remaining gates

Executed locally with Node `v22.16.0` and TypeScript `5.8.3`:

- [x] Source metadata regressions failed against the old exports and passed after the change.
- [x] 41 authored assertions passed: 12 metadata, 15 timing/budget, 1 real FlightModel determinism,
  and 13 capture lifecycle contracts. The available fallback transpiled TypeScript, mapped Vitest
  test registration to Node's test runner, and routed capture I/O imports to the same test fixture.
  This is **not** a claim that the repository's Vitest command or a real browser was run.
- [x] The real 32-aircraft/600-sample fixture executed using byte-verified pinned engine sources.
  A deliberately tiny real CLI budget exited 1, a permissive budget exited 0, and invalid flags
  exited 2. The deterministic final-state SHA-256 was
  `9ef8a2e23420b714c679efa13a4a00a1f535b1831d676a96e58eef14cead12b7`.
- [x] A bounded Node heap profile was generated by running the compiled CPU CLI with
  `--heap-prof --heap-prof-interval=65536`; no allocation-cause conclusion is claimed.
- [x] Standalone strict/noUncheckedIndexedAccess checking of the timing helper, real FlightModel
  fixture and CPU CLI passed with the available TypeScript compiler.
- [ ] Install the pinned workspace dependencies and regenerate/commit capability outputs.
- [ ] Run canonical Vitest, package builds, repository typecheck and Biome with the pinned tools.
- [ ] Run real browser/private-display, cancellation/orphan and contention checks.
- [ ] Migrate and validate two Midway capture callers and repeat the matched game workload.

The sandbox could read and write GitHub through the connected API, but could not clone the
repository or install its dependencies. Keep the PR draft until the unchecked gates are resolved.
