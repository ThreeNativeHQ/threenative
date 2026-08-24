# PRD-197 — native host fails loudly at creation

Run 2026-08-23 in lane `lane-197`. The changes are engine-layer changes under
`packages/runtime-native/`; no game code was used to mask the defects.

## Resolved file set

- `packages/runtime-native/CMakeLists.txt`
- `packages/runtime-native/src/cli/main.cpp`
- `packages/runtime-native/src/js/quickjs_engine.cpp`
- `packages/runtime-native/src/js/v8_engine.cpp`
- `packages/runtime-native/src/runtime.cpp`
- `packages/runtime-native/src/webgpu/bindings.cpp`
- `packages/runtime-native/src/webtransport/webtransport.cpp`
- `packages/runtime-native/tests/runtime-test-utils.ts`
- `packages/runtime-native/tests/webtransport/webtransport.test.ts`
- `packages/runtime-native/tests/bindings_creation_test.cpp`
- `packages/runtime-native/tests/timer_delivery_test.cpp`
- `packages/runtime-native/tests/timer-contract.test.mjs`
- `packages/runtime-native/tests/webgpu-bindings-contract.test.mjs`
- `packages/runtime-native/tests/webtransport/peer-verification-contract.test.mjs`

## Red-green evidence

The first focused run was made before the source fixes:

```text
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
  tests/webtransport/peer-verification-contract.test.mjs \
  tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs
exit 1
Test Files: 3 failed
Tests: 7 failed
```

Those failures were the declared mutations: the unconditional `verify_peer(false)` path,
removed sampler/bind-group null checks, and restored engine-owned timer stubs. After the fixes:

```text
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
  tests/webtransport/peer-verification-contract.test.mjs \
  tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs \
  --reporter=dot
Test Files  3 passed (3)
Tests       8 passed (8)
```

The native timer executable initially exposed a second lifecycle defect: it printed
`native timer delivery contract passed` but exited `1` after `SIGSEGV` during shutdown. Keeping timer
contexts until libuv's close callback removed that crash; the same executable now exits `0` cleanly.

## Repair round 1 — reviewer defects

The review log identified two defects in the original timer and bind-group proofs. The timer
executable now requires the positive completion sentinel `42`; a deadline with the default exit
code `0` is a failure and cannot print the success line. Bind-group creation now releases every
automatically created texture view through one local ownership closure on both the native failure
path and the successful path. The contract suite mutates away that failure-path release and rejects
the candidate.

The exact old timer timeout false-positive was restored temporarily. The new contract assertion
went red:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/timer-contract.test.mjs --reporter=dot
Test Files  1 failed (1)
Tests  1 failed | 4 passed (5)
FAIL  tests/timer-contract.test.mjs > timer executable fails closed when the completion callback never arrives
AssertionError: Got unwanted exception. The input did not match the regular expression /constexpr int kCompletionExitCode = [1-9]\d*;/u.
```

The source mutation was restored. A timer-delivery-disabled executable mutation was then built and
run; it timed out, returned failure, and emitted no success line:

```text
$ cmake --build packages/runtime-native/build/tn-linux --target threenative-timer-delivery-test --parallel 4
[4/4] Linking CXX executable threenative-timer-delivery-test
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test
[Mystral] Evaluating script: timer_delivery_test.js (94 bytes)
[Mystral] Shutting down runtime...
native timer delivery contract timed out before completion
exit 1
```

After restoring the timer schedule, the final focused contract run was:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/webtransport/peer-verification-contract.test.mjs tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  3 passed (3)
Tests  12 passed (12)
exit 0
```

The restored sources were rebuilt and both required executables were run:

```text
$ cmake --build packages/runtime-native/build/tn-linux --target threenative-bindings-creation-test threenative-timer-delivery-test --parallel 4
[1/3] Building CXX object CMakeFiles/threenative-timer-delivery-test.dir/tests/timer_delivery_test.cpp.o
[2/3] Linking CXX executable threenative-timer-delivery-test
[3/3] Linking CXX executable threenative-bindings-creation-test
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-bindings-creation-test
native WebGPU creation bindings passed
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test
[Mystral] process.exit(42) called
native timer delivery contract passed
exit 0
```

## Acceptance criteria

| Criterion | Implementation and mutation | Observed proof |
|---|---|---|
| Invalid WebTransport certificates fail by default and require an explicit override. | `quiche_config_verify_peer` now receives `!allowInsecurePeerVerification`; only `MYSTRAL_WEBTRANSPORT_INSECURE=1` enables the development override, and the warning names the variable. | Contract mutation is red above. `webtransport.test.ts` contains default-reject and explicit-override cases. The live cases were not executed because the existing fixture path `packages/runtime-native/examples/webtransport/server` is absent; the file run reported `Test Files 1 passed`, `Tests 11 skipped`. |
| Null sampler and bind-group creation fails at creation. | Both native handle returns are checked immediately. Malformed descriptors are also rejected at the binding boundary so Dawn's non-null error handles cannot escape as wrappers; automatically created bind-group views are released on both failure and success. | Removing either check or the failure-path view release is rejected by `webgpu-bindings-contract.test.mjs`. Display-free proof: `./packages/runtime-native/build/tn-linux/threenative-bindings-creation-test` printed `native WebGPU creation bindings passed` and exited `0`. |
| Timer delivery survives installation order and pending work. | Engine-level timer stubs were removed from V8 and QuickJS; `Runtime::setupTimers()` owns the real libuv/chrono timers after engine creation, and shutdown waits for timer close callbacks. The executable requires `process.exit(42)` from the completed callback and fails closed on timeout. | Restoring either engine stub or the old timeout check is rejected by `timer-contract.test.mjs`; the disabled-delivery executable mutation returned `1` without the success line. Display-free proof: `./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test` logged `process.exit(42)`, printed `native timer delivery contract passed`, and exited `0`. |

## Native and desktop verification

Native dependencies were bootstrapped with `pnpm install --frozen-lockfile`. The V8/Dawn Linux
runtime was built with `pnpm native:build`; the two PRD executables were then built with:

```text
cmake --build packages/runtime-native/build/tn-linux \
  --target threenative-bindings-creation-test threenative-timer-delivery-test --parallel 4
exit 0
```

The desktop lane was run with `pnpm --filter @threenative/runtime-native native:verify:desktop` and
exited `0`. It ran the executable
`packages/runtime-native/build/tn-linux/mystral`, including:

```text
desktop audio decodeAudioData Promise proof passed on V8
desktop core gate passed: 300 frames, 1280x720
desktop physics actuation bindings proof passed
desktop physics playtest proof passed: 14 assertions
desktop physics query proof passed
```

The core gate wrote a nonblank screenshot at
`packages/runtime-native/artifacts/desktop-core-2026-08-24.png`.

Unverified targets: the live WebTransport endpoint (missing fixture), QuickJS native execution,
Android, and iOS. The source contract covers QuickJS, but no QuickJS executable was built or run.

## Required grep

```text
$ grep -n "verify_peer\|TODO" packages/runtime-native/src/webtransport/webtransport.cpp
803:    quiche_config_verify_peer(s->config, !allowInsecurePeerVerification);
```

## Repository gates

- `pnpm build`: passed after the fresh-install setup.
- `pnpm typecheck`: passed.
- `pnpm lint`: exited `0`; it reported 291 pre-existing warnings and no failure.
- Focused PRD tests and native proofs: passed as recorded above.
- `pnpm test`: exited `1` at the unrelated runtime-native conformance dry-run test. The isolated test reproduced a deterministic `Test timed out in 60000ms` after `63.52s`; its file had `40 passed`, `1 failed`. No PRD-197 source assertion failed.
