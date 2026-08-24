# PRD-197 — native host fails loudly at creation

Run 2026-08-23 in lane `lane-197`. The changes are engine-layer changes under
`packages/runtime-native/`; no game code was used to mask the defects.

## Resolved file set

- `packages/runtime-native/CMakeLists.txt`
- `packages/runtime-native/src/cli/main.cpp`
- `packages/runtime-native/src/js/jsc_engine.mm`
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

## Repair round 2 — remaining blocking findings

This round addressed the JSC timer stub, the over-broad TLS environment parser, and the
non-failing live-fixture prerequisite.

The red controls were added before the source fixes. Against the lane at the start of this
round, they failed on the JSC stub and the missing exact-parser/mode-log contract:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/webtransport/peer-verification-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  2 failed (2)
Tests       3 failed | 7 passed (10)
FAIL  tests/timer-contract.test.mjs > JSC does not install a non-scheduling timer stub
FAIL  tests/webtransport/peer-verification-contract.test.mjs > WebTransport verifies TLS peers by default and documents the dev override
```

The corrected source and controls are green:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/webtransport/peer-verification-contract.test.mjs \
    tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  3 passed (3)
Tests       16 passed (16)
exit 0
```

JSC no longer installs `setTimeout` or `clearTimeout`; the runtime scheduler remains the only
timer owner, so an engine-only JSC context cannot return a timer ID for work it will never deliver.
The TLS override now enables insecure verification only for the exact value
`MYSTRAL_WEBTRANSPORT_INSECURE=1`; the runtime logs either `insecure-override` or `verify-peer` and
prints the parsed environment value. The CLI help documents that all other values preserve peer
verification.

The live certificate fixture was checked in fail-closed mode. It could not execute because the
fixture source is absent; the prerequisite returned a failure with the exact required path rather
than allowing the 11 live tests to appear as successful skips:

```text
$ TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 pnpm --dir packages/runtime-native exec vitest run \
    --config vitest.config.ts tests/webtransport/webtransport.test.ts --reporter=dot
FAIL  tests/webtransport/webtransport.test.ts > WebTransport API
Error: WebTransport live certificate fixture prerequisite failed: requires WebTransport echo-server source \
(/home/joao/projects/threenative/threenative-engine/.worktrees/prd-197-native-host-fails-loudly/packages/runtime-native/examples/webtransport/server)
Test Files  1 failed (1)
Tests       11 skipped (11)
exit 1
```

This is `BLOCKED` live-fixture evidence, not a certificate-connectivity PASS. The next evidence
action is to provide that exact echo-server fixture (and its Rust toolchain), then rerun the same
command with `TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1`.

## Acceptance criteria

| Criterion | Implementation and mutation | Observed proof |
|---|---|---|
| Invalid WebTransport certificates fail by default and require an explicit override. | `quiche_config_verify_peer` receives `!allowInsecurePeerVerification`; only exact `MYSTRAL_WEBTRANSPORT_INSECURE=1` enables the development override, the parsed mode is logged, and CLI help documents other values as secure. | The focused contract suite passed 16 tests and rejects truthy-alias and missing-mode-log mutations. The live prerequisite was run with `TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1` and is `BLOCKED` on the absent fixture path above. No live certificate connection is claimed. |
| Null sampler and bind-group creation fails at creation. | Both native handle returns are checked immediately. Malformed descriptors are also rejected at the binding boundary so Dawn's non-null error handles cannot escape as wrappers; automatically created bind-group views are released on both failure and success. | Removing either check or the failure-path view release is rejected by `webgpu-bindings-contract.test.mjs`. Display-free proof: `./packages/runtime-native/build/tn-linux/threenative-bindings-creation-test` printed `native WebGPU creation bindings passed` and exited `0`. |
| Timer delivery survives installation order and pending work. | Engine-level timer stubs were removed from V8, QuickJS, and JSC; `Runtime::setupTimers()` owns the real libuv/chrono timers after engine creation, and shutdown waits for timer close callbacks. The executable requires `process.exit(42)` from the completed callback and fails closed on timeout. | Restoring an engine stub or the old timeout check is rejected by `timer-contract.test.mjs`; the disabled-delivery executable mutation returned `1` without the success line. Display-free proof: `./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test` logged `process.exit(42)`, printed `native timer delivery contract passed`, and exited `0`. |

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
808:    quiche_config_verify_peer(s->config, !allowInsecurePeerVerification);
```

## Repository gates

- `pnpm build`: passed after the fresh-install setup.
- `pnpm typecheck`: passed.
- `pnpm lint`: exited `0`; it reported 291 pre-existing warnings and no failure.
- Focused PRD tests and native proofs: passed as recorded above.
- Earlier `pnpm test` evidence in this record exited `1` at an unrelated runtime-native conformance dry-run test. The final rerun below passed.

## Resume repair — null resources and timer installation order

The review defects were reproduced before the source fix by adding the two new contracts and
running the focused suite:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  2 failed (2)
Tests       3 failed | 13 passed (16)
exit 1
```

The failing controls were the restored warning path for a null sampler, the valid-layout/null-
resource path, and the silent scheduler-first timer return. After restoring the source fix:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/webtransport/peer-verification-contract.test.mjs \
    tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  3 passed (3)
Tests       20 passed (20)
exit 0
```

The binding contract mutation restores the sampler warning and goes red; the timer contract
mutation restores `if (!jsEngine_) return;` and goes red. Both contracts also check their
positive behavior: null/undefined, buffer, sampler, texture-view, and generic resources name
the resource, binding, and reason before bind-group creation submits; engine-first and
scheduler-first installation produce the same timeout/interval delivery sequence.

The repaired native sources compiled and the display-free proofs passed:

```text
$ cmake --build packages/runtime-native/build/tn-linux \
    --target threenative-bindings-creation-test threenative-timer-delivery-test --parallel 4
[1/4] Building CXX object CMakeFiles/mystral-runtime.dir/src/webgpu/bindings.cpp.o
[2/4] Linking CXX static library libmystral-runtime.a
[3/4] Linking CXX executable threenative-bindings-creation-test
[4/4] Linking CXX executable threenative-timer-delivery-test
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-bindings-creation-test
native WebGPU creation bindings passed
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test
[Mystral] process.exit(42) called
native timer delivery contract passed
exit 0
```

Final repository reruns for this repair:

```text
$ pnpm native:build
exit 0

$ SDL_AUDIODRIVER=dummy pnpm --filter @threenative/runtime-native native:verify:desktop
desktop audio decodeAudioData Promise proof passed on V8
desktop core gate passed: 300 frames, 1280x720
desktop physics actuation bindings proof passed
desktop physics playtest proof passed: 14 assertions
desktop physics query proof passed
exit 0

$ pnpm typecheck
exit 0

$ pnpm lint
exit 0
291 pre-existing warnings; no failure

$ pnpm test
Test Files  198 passed (198)
Tests       1883 passed (1883)
exit 0
```

The live WebTransport fixture remains explicitly fail-closed at the absent
`packages/runtime-native/examples/webtransport/server` path above. No live certificate
handshake is claimed. QuickJS native execution, Android, and iOS remain unverified.
