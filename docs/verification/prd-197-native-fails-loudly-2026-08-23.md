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

## Resume repair 2 — live timer consume and sampler mutation (2026-08-24)

The second review handoff required the timer contract to exercise the production
scheduler-first path and its pending-state consume, and required the sampler mutation to
match the live three-argument `failResource` call.

### Red controls

Before the runtime timer fix, the new timer controls failed against the production source:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  1 failed | 1 passed (2)
Tests       2 failed | 15 passed (17)
exit 1
```

The failures were the missing pre-engine scheduler request and the missing production
pending-state consume. Removing the live sampler validation branch also went red:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/webgpu-bindings-contract.test.mjs --reporter=dot
Test Files  1 failed (1)
Tests       1 failed | 6 passed (7)
Error: a null sampler handle must fail at bind-group creation
exit 1
```

### Green controls

After the runtime and contract fixes, the focused native contract suite passed:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/webtransport/peer-verification-contract.test.mjs \
    tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  3 passed (3)
Tests       21 passed (21)
exit 0
```

The timer test now checks the actual `initializeJSAndBindings()` order and rejects a source
mutation that removes the pending-state consume. The native timer executable separately
proves timeout/interval delivery. The WebGPU contract retains null sampler, view, buffer, and
generic-resource coverage and its live three-argument mutation goes red.

### Native and repository gates

```text
$ pnpm native:build
[4/4] Linking CXX executable mystral
exit 0

$ cmake --build packages/runtime-native/build/tn-linux \
    --target threenative-bindings-creation-test threenative-timer-delivery-test --parallel 4
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-bindings-creation-test
native WebGPU creation bindings passed
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test
[Mystral] process.exit(42) called
native timer delivery contract passed
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

$ pnpm budgets
exit 0

$ PATH=/tmp/tn-repair-timeout-bin:$PATH pnpm test
Test Files  198 passed (198)
Tests       1883 passed (1883)
suite temporary directory count unchanged: 0
exit 0
```

The plain `pnpm test` command was attempted twice and stopped in the pre-suite playtest
orphan guard because reparented Chromium processes remained after its bounded cleanup timeout;
the cleanup shim above was outside the repository and was not committed. The complete suite
then passed with that process-group cleanup in place.

The required peer-verification source check remains:

```text
$ grep -n "verify_peer\|TODO" packages/runtime-native/src/webtransport/webtransport.cpp
808:    quiche_config_verify_peer(s->config, !allowInsecurePeerVerification);
```

The live WebTransport prerequisite remains explicitly blocked and fail-closed:

```text
$ TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 pnpm --dir packages/runtime-native exec vitest run \
    --config vitest.config.ts tests/webtransport/webtransport.test.ts --reporter=dot
Error: WebTransport live certificate fixture prerequisite failed: requires WebTransport echo-server source \
(/home/joao/projects/threenative/threenative-engine/.worktrees/prd-197-native-host-fails-loudly/packages/runtime-native/examples/webtransport/server)
Tests       11 skipped (11)
exit 1
```

No live certificate handshake is claimed. QuickJS native execution, Android, and iOS remain
unverified.

## Resume repair 3 — pending timer transition (2026-08-24)

The repair removes the unreachable engine-first fallback after the scheduler-first request. The
pending branch is now the single consume transition; skipping it leaves the timer globals absent.
The contract mutation models that state change, and the native executable schedules its timeout
and interval before its first `Runtime::pollEvents()` call. Its `evalScript()` failure path is the
negative control when the pending consume is skipped.

### Red controls

The corrected contract mutation was run against the pre-repair source. It changed the pending
branch to a no-op and asserted the resulting state was still pending; the current source went red
because the redundant fallback was still present:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/timer-contract.test.mjs --reporter=dot
exit 1
FAIL  tests/timer-contract.test.mjs > scheduler-first timer installation consumes its pending state exactly once
AssertionError: the scheduler-first transition must not fall through to a second installation path
Test Files  1 failed (1)
Tests       1 failed | 9 passed (10)
```

The behavior-changing native mutation skipped the pending `setupTimers()` call. The target still
built, but the executable failed at the first script evaluation instead of reaching the completion
sentinel:

```text
$ cmake --build packages/runtime-native/build/tn-linux \
    --target threenative-timer-delivery-test --parallel 4
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test
[V8] timer_delivery_test.js:6: ReferenceError: setTimeout is not defined
could not schedule native timer contract
exit 1
```

### Green controls

After removing the fallback and preserving the pending consume:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
    tests/webtransport/peer-verification-contract.test.mjs \
    tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  3 passed (3)
Tests       21 passed (21)
exit 0

$ cmake --build packages/runtime-native/build/tn-linux \
    --target threenative-bindings-creation-test threenative-timer-delivery-test --parallel 4
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-bindings-creation-test
native WebGPU creation bindings passed
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test
[Mystral] process.exit(42) called
native timer delivery contract passed
exit 0
```

Native and repository gates also passed:

```text
$ pnpm native:build
[1/1] Linking CXX executable mystral
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

$ pnpm budgets
exit 0

$ pnpm test
Test Files  198 passed (198)
Tests       1883 passed (1883)
suite temporary directory count unchanged: 0
exit 0
```

The desktop V8/Dawn host is verified, including the nonblank screenshot at
`packages/runtime-native/artifacts/desktop-core-2026-08-24.png`. Live WebTransport remains
unverified because the echo-server fixture is absent; the live certificate handshake was not
claimed. QuickJS native execution, Android, and iOS remain unverified.

## Resume repair 4 — real engine-first timer proof (2026-08-24)

The blocking review defect was that the native timer executable only exercised the production
scheduler-first bootstrap. This repair adds the documented test-only
`RuntimeConfig::testEngineFirstTimers` seam. The default
`threenative-timer-delivery-test` leaves the seam false and proves scheduler-first installation;
the new `threenative-timer-engine-first-test` target compiles the same timeout/interval script
with `TN_TIMER_ENGINE_FIRST_TEST`, sets the seam true, and proves installation after the V8 engine
exists. Both executables require `process.exit(42)` before printing their completion sentinel.

### Red control

The behavior-changing mutation inserted `if (!timerInstallationPending_) return;` into
`Runtime::setupTimers()` before its installed-state check. The scheduler-first executable remains
green under that mutation, but the engine-first executable must fail before the completion
sentinel. Exact output:

```text
$ cmake --build packages/runtime-native/build/tn-linux --target threenative-timer-engine-first-test --parallel 4 && ./packages/runtime-native/build/tn-linux/threenative-timer-engine-first-test
[1/3] Building CXX object CMakeFiles/mystral-runtime.dir/src/runtime.cpp.o
[2/3] Linking CXX static library libmystral-runtime.a
[3/3] Linking CXX executable threenative-timer-engine-first-test
[Mystral] Initializing runtime...
[Mystral] Window: 1x1
[Mystral] Running in no-SDL mode (headless GPU)
[WebGPU] Initializing headless mode (no SDL)...
[WebGPU] Initializing...
[WebGPU] Instance created
[WebGPU] Adapter acquired successfully
[WebGPU] Headless adapter: NVIDIA GeForce RTX 2080
[WebGPU] Backend: Vulkan
[WebGPU] adapter feature probe 4: yes
[WebGPU] adapter feature probe 6: no
[WebGPU] adapter feature probe 7: no
[WebGPU] Device acquired successfully
[WebGPU] Headless mode initialized successfully
[WebGPU] Creating offscreen render target: 1x1
[WebGPU] Offscreen render target created
[JS] Creating V8 engine (platform default)
[V8] Creating engine...
[V8] Initializing V8 JavaScript engine...
[V8] V8 initialized successfully
[V8] Version: 13.1.201.22
[V8] Engine created successfully
[Mystral] Using JS engine: V8
[Mystral] Fetch API initialized (file://, http://, https://)
[Mystral] Web Streams API initialized (ReadableStream/WritableStream/TransformStream)
[Mystral] URL and Worker polyfills initialized
[DOM] Canvas element created with addEventListener, style, etc.
[log] [Mystral] WebP format support: YES
[Mystral] DOM event system initialized
[Mystral] localStorage initialized: /home/joao/.local/share/mystral/storage/prd-197-native-host-fails-loudly.json
[EventLoop] libuv 1.51.0 initialized
[AsyncHttp] Initialized with curl_multi + libuv
[AsyncFile] Initialized with libuv thread pool
[FileWatcher] Initialized with libuv fs_event
[Mystral] Runtime initialized
[Mystral] Evaluating script: timer_delivery_test.js (382 bytes)
[V8] timer_delivery_test.js:6: ReferenceError: setTimeout is not defined
[V8]   setTimeout(() => { timeoutCount += 1; }, 0);
could not schedule native timer contract
[Mystral] Shutting down runtime...
[AsyncHttp] Shutdown complete
[EventLoop] Shutdown complete
[V8] Destroying engine...
[WebGPU] Context destroyed
exit 1
```

No completion sentinel was printed. The mutation was then removed.

### Green controls

The focused timer/WebGPU/WebTransport contract suite passed, including the CMake target and
compile-definition assertion that the second executable selects the engine-first seam:

```text
$ pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/webtransport/peer-verification-contract.test.mjs tests/webgpu-bindings-contract.test.mjs tests/timer-contract.test.mjs --reporter=dot
Test Files  3 passed (3)
Tests       22 passed (22)
exit 0
```

Both real runtime executables then passed with the positive completion sentinel:

```text
$ cmake --build packages/runtime-native/build/tn-linux --target threenative-timer-delivery-test threenative-timer-engine-first-test --parallel 4
[1/4] Building CXX object CMakeFiles/mystral-runtime.dir/src/runtime.cpp.o
[2/4] Linking CXX static library libmystral-runtime.a
[3/4] Linking CXX executable threenative-timer-delivery-test
[4/4] Linking CXX executable threenative-timer-engine-first-test
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-timer-delivery-test
[Mystral] process.exit(42) called
native timer delivery contract passed
exit 0

$ ./packages/runtime-native/build/tn-linux/threenative-timer-engine-first-test
[Mystral] process.exit(42) called
native engine-first timer delivery contract passed
exit 0
```

### Native and package gates

```text
$ pnpm native:build
exit 0

$ SDL_AUDIODRIVER=dummy pnpm --filter @threenative/runtime-native native:verify:desktop
desktop audio decodeAudioData Promise proof passed on V8
desktop core gate passed: 300 frames, 1280x720, /home/joao/projects/threenative/threenative-engine/.worktrees/prd-197-native-host-fails-loudly/packages/runtime-native/artifacts/desktop-core-2026-08-24.png
desktop physics actuation bindings proof passed
desktop physics playtest proof passed: 14 assertions
desktop physics query proof passed: {"clearHitCount":0,"maskedHitCount":0,"pointCount":1,"pointMaskedHitCount":0,"pointMissCount":0,"rayDistance":2,"rayNormal":[0,1,0],"rayPosition":[0,0,1],"shapeCount":1,"shapeMaskedHitCount":0,"shapeMissCount":0}
exit 0

$ pnpm typecheck
exit 0

$ pnpm lint
exit 0
291 pre-existing warnings; no failure

$ pnpm budgets
exit 0
budgets ok: 8 framework packages, 8 example workspaces, 18376/15000 framework LOC, 82282/100000 native runtime LOC, 12 PRD files, largest template 2404 LOC, no compiled texture manifests found

$ pnpm test
Test Files  198 passed (198)
Tests       1883 passed (1883)
suite temporary directory count unchanged: 0
exit 0
```

The proof now exercises both installation orders against the actual `Runtime` and the same timer
script. The prior platform statements remain unchanged: the desktop V8/Dawn lane is verified;
live WebTransport remains unverified because the echo-server fixture is absent; QuickJS native
execution, Android, and iOS remain unverified.
