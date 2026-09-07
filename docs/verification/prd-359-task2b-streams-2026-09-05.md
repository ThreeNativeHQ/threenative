# PRD-359 Task 2b-streams — native queue strategies

Status: accepted after root correction, independent review and local gates.
Executed platforms: Linux V8/Dawn and Linux QuickJS/Dawn. Other platforms are
unverified by this row. Task 2b still owns finite transport buffers and JS queues.

## Scope and actual callers

The installed native Streams shim now measures readable/writable queue sizes
using the supplied strategy. Pulls wait for startup, serialize, and stop at
pressure; writes serialize and signal pressure through writer.ready. Erroring
preserves an active sink operation's result. Abort teardown and close settlement
wait for startup or the active operation. Duplicate close rejects without losing
the first close request. Size callbacks cannot cause a write after erroring.

Actual callers and loading path:

- `packages/runtime-native/src/runtime.cpp:2292` executes the embedded stream script.
- `packages/runtime-native/CMakeLists.txt:1272` includes streams in generated runtime scripts.
- `packages/runtime-native/src/runtime-scripts/webtransport-polyfill.js:53` constructs receive streams.
- The same file at line 57 constructs send streams; line 75 constructs datagram writers.

Engine MCP search for a stalled native reliable-message consumer returned
GPUReadback and ThreePlaytestPhysicsRecorder. Both details were read; they cover
GPU readback and physics observations. Reuse decision: repair the installed
native global, not add a game shim or second transport.

A high-water mark supplies cooperative pressure, not a hard queue limit. The
transport-level finite queue integration remains open through Task 2b.
[Streams erroring ordering](https://streams.spec.whatwg.org/#writable-stream-finish-erroring)
and independent Node observations guided the lifecycle correction. This is not
complete WHATWG conformance.

## Red evidence and review

The initial strategy regression observed initial desiredSize 1 instead of 3,
pressure 1 instead of 0, and no size callback calls. The initial stream run exited
1 (4 failed / 9 passed); `/tmp/prd359-streams-red.log` retains the output.

Root rejected the worker's initial green: its pending probe was unreliable and
an assertion had been changed to accept rejection of a successful in-flight
write. Root restored the correct expectation and added Node-reference probes.
The corrected regression run exited 1:

```text
Tests  4 failed | 12 passed (16)
in-flight result: Expected "resolved"; Received "sink failed"
ready after controller error: Expected "sink failed"; Received "resolved"
abort during start: Expected abortSettled false; Received true
abort during write: Expected first "resolved"; Received "stop"
```

Further root and independent-review regressions also went red before repair:

| Regression | Observed failure | Result before repair |
| --- | --- | --- |
| Size callback errors the stream after startup | Sink still called and write resolved | 1 failed / 16 passed, exit 1 |
| Close during erroring, pending start and write | Close rejected before active operation settled | 2 failed / 17 passed, exit 1 |
| Duplicate close during erroring | First close remained pending; second overwrote its record | 2 failed / 17 passed, exit 1 |

Logs: `/tmp/prd359-streams-root-reentrant-red.log`,
`/tmp/prd359-streams-root-close-red.log`,
`/tmp/prd359-streams-root-duplicate-close-red.log`.
The lifecycle regressions execute the same public-API probe against Node and the
installed shim and compare each to explicit expected values.

Fresh read-only reviewer `review_streams_root_fix` found the close-ordering and
duplicate-close defects, then independently confirmed their corrections match
Node for both pending-start and pending-write cases. No review finding remains
open in this bounded row. Finite native transport queues were outside this review.

The final pressure helper distinguishes rejected from fulfilled promises; the
native surface also awaits writer.ready before close. This prevents a rejection
from being counted as pressure recovery. Datagram status probes await each sink
write before replacing the next test stub, preserving the native status tested.

## Final verification

All commands below ran in `.worktrees/networking-359` and exited 0.

```sh
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/streams-shim.test.mjs
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/runtime-next-contract.test.mjs
cmake --build packages/runtime-native/build/tn-linux --target mystral threenative-webtransport-wire-test threenative-webtransport-surface-test -j4
cmake --build packages/runtime-native/build/tn-linux-quickjs --target threenative-webtransport-wire-test threenative-webtransport-surface-test -j4
ctest --test-dir packages/runtime-native/build/tn-linux -R 'threenative-webtransport-(wire|surface)-test' --output-on-failure
ctest --test-dir packages/runtime-native/build/tn-linux-quickjs -R 'threenative-webtransport-(wire|surface)-test' --output-on-failure
XDG_RUNTIME_DIR=/tmp/xdg-runtime-wt TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 sh scripts/xvfb.sh pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/webtransport/webtransport.test.ts
pnpm typecheck
pnpm lint
pnpm test
```

```text
Stream unit tests:          19 passed (19)
Bootstrap contract:         29 passed | 2 existing skipped (31)
Linux V8 native contracts:  2/2 passed
Linux QuickJS contracts:    2/2 passed
Linux V8 live Go fixture:   15 passed (15)
Full suite native package:  101 files passed; 730 passed | 38 existing skipped
TypeScript physics parity:  29 passed
Rust unit/parity:           14 passed + 2 passed
Full suite repository unit: 389 files passed | 2 skipped; 4265 passed | 7 skipped
Full pnpm test exit:        0
```

Final logs: `/tmp/prd359-streams-final-unit.log`,
`/tmp/prd359-streams-root-bootstrap-contract.log`,
`/tmp/prd359-streams-final-{v8,quickjs}-{build,ctest}.log`,
`/tmp/prd359-streams-final-surface-{v8,quickjs}-build.log`,
`/tmp/prd359-streams-final-live.log`,
`/tmp/prd359-streams-root-typecheck-final.log`,
`/tmp/prd359-streams-final-lint.log`, `/tmp/prd359-streams-final-suite.log`.

The final test-only pressure assertion tightening was rerun in the focused unit
suite and both rebuilt native contracts after the full suite; runtime source
was unchanged. Stream source SHA-256:
`8a2bd99c31ea86748daed52db3d32cc813d12de7d1a4c9c1f1dc914bacbd16d3`.

Full-gate prerequisites were repaired without source changes: missing V8 and
QuickJS crash/GPU test executables were built, and typecheck was rerun after a
concurrent build had temporarily removed physics declarations. GPU contracts
ran on NVIDIA GeForce RTX 2080 / Vulkan. No missing executable was skipped.

The existing bootstrap source-hash contract failed before refresh. The row now
owns its fifth file, runtime-next-contract.test.mjs, and updates literal hashes
for streams and the previously reviewed Task 2a WebTransport source. Behavioral
assertions remain independent of those hashes. Biome formatting is disabled for
native JS/MJS by repository configuration; lint passed with complexity warnings.

Trusted positive TLS, all non-Linux platforms, complete transport bounds,
application protocol/authentication, cold installed MCP discovery, CI networking
qualification and PR/merge delivery remain later PRD work.
