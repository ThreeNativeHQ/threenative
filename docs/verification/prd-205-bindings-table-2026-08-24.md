# PRD-205 — WebGPU bindings-table closure

Date: 2026-08-24
Lane: `linchpin/prd-205-closure`
Repair target: `83daa9cd2f34a129a2430ea96a5ce95018340335`

Status: focused repair, native V8/QuickJS controls, desktop native gate, and repository gates
verified on Linux. Android, iOS, browser-reference, and pixel-conformance lanes are unverified.

## Repairs

1. `installBindingTable` now performs a no-getter descriptor preflight for every destination. It
   rejects non-objects, accessors anywhere in the prototype chain, and non-writable data before
   the first write. Snapshots distinguish missing/inherited data from own data. Rollback restores
   own data with its original value and deletes only bindings that were not own, preserving
   inherited lookup. A successful write must expose an own data descriptor containing the newly
   created function; an inherited lookup or silent proxy setter cannot claim success.
2. `Engine` gained `JSPropertyInfo`/`getPropertyInfo`. V8, QuickJS, and JSC implement descriptor
   inspection without invoking accessors. V8, QuickJS, and JSC now return operation failure and
   latch exceptions for exceptional `setProperty`, `hasProperty`, and `deleteProperty` results;
   ordinary false results remain ordinary false results.
3. Dynamic element and Canvas 2D handles are recorded in `BindingsState::protectedHandles` and
   released in reverse order exactly once by `destroyBindingsState` before engine destruction.
   V8/QuickJS protection lookup is per-engine, not a process-global set.

## Red/green evidence

Negative controls were added before the production repair. The original V8 executable was red:

    cmake --build --preset tn-linux --target threenative-webgpu-bindings-reentrancy-test --parallel
    ./build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    build: exit 0
    executable: exit 1
    property binding proof failed: inherited-data rollback state
    V8: inherited data became an own property after rollback

The repaired V8 control is green:

    cmake --build --preset tn-linux --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 0; native WebGPU bindings reentrancy passed

The equivalent QuickJS control is green in the explicitly configured alternate build:

    cmake -S . -B build/tn-linux-quickjs -DCMAKE_BUILD_TYPE=Release \
      -DMYSTRAL_USE_V8=OFF -DMYSTRAL_USE_QUICKJS=ON -DMYSTRAL_USE_JSC=OFF \
      -DMYSTRAL_USE_DAWN=ON -DMYSTRAL_USE_WGPU=OFF -DTN_ENABLE_NATIVE_PHYSICS=OFF
    cmake --build build/tn-linux-quickjs \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test
    configure: exit 0
    build and executable: exit 0; native WebGPU bindings reentrancy passed

The control covers inherited data rollback, silent setters, own/inherited accessors, non-writable
and non-object destinations, revoked-proxy exceptions for set/has/delete, dynamic handle ownership,
and destroying one runtime before using the second runtime.

## Focused and native verification

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs
    exit 0; Test Files 2 passed; Tests 20 passed

    pnpm --filter @threenative/runtime-native test
    exit 0; Test Files 57 passed; Tests 391 passed | 33 skipped; physics parity 28 JS tests and
    2 Rust tests passed; publint passed

    pnpm native:build
    exit 0; V8/Dawn native executable linked

    SDL_AUDIODRIVER=dummy pnpm native:verify:desktop
    exit 0; audio Promise proof passed; desktop core passed 300 frames at 1280x720; physics
    actuation, playtest (14 assertions), and query proofs passed

JSC was not runtime-tested on this Linux host. Its Objective-C++ source passed this syntax-only
check using temporary compatibility stubs for unavailable Apple/Foundation umbrella headers:

    clang++ -fsyntax-only -x objective-c++ -std=c++17 -D__APPLE__ -DMYSTRAL_JS_JSC \
      -I/tmp/tn-prd205-jsc-stub -I/usr/include/webkitgtk-4.1 \
      -Ipackages/runtime-native/include packages/runtime-native/src/js/jsc_engine.mm
    exit 0

## Trace provenance

The committed fixtures remain untouched. They are byte-identical:

    cmp -s packages/runtime-native/tests/fixtures/webgpu-bindings-call-trace-pre.json \
      packages/runtime-native/tests/fixtures/webgpu-bindings-call-trace-post.json
    exit 0
    pre/post counts: 75 calls, 65 results, 10 errors; deepEqual: true

The pre and post files were introduced together by `dd17da35` and the history does not contain a
separately captured pre-refactor executable for this repair. Therefore the equality is a checked-in
fixture consistency result, not independent pre-versus-post executable provenance. The pre fixture
was not rewritten during this repair, and no live trace re-capture is claimed here.

## Repository gates

    pnpm typecheck
    exit 0; Scope 16 of 17 workspace projects

    pnpm lint
    exit 0; Biome checked 1113 files; 381 warnings, no errors

    pnpm test
    exit 0; 197 files passed, 1 skipped; 1880 tests passed, 3 skipped

    pnpm budgets
    exit 0; 18376/15000 framework LOC review trigger, 85293/100000 native runtime LOC,
    no hard failure; census drift reported

    pnpm quality
    exit 0; 70 findings (11 new, 9 grew, 50 inherited, 0 waived)

    pnpm sync:agents
    exit 0; 16 mirrors synced, 0 written

    git diff --check
    exit 0; no whitespace errors

The first combined parallel gate batch produced a generated-declaration race in `typecheck` and
an orphan-browser guard collision in `test`; serial reruns above passed. No source change was made
for those harness races.

## Lane limits

- Android: unverified; no Android runtime/conformance execution was run for this repair.
- iOS: unverified; no iOS runtime execution was run for this repair.
- Browser/pixel conformance: unverified; browser reference captures are absent, and no pixel
  comparison is claimed.

Current touched-source line counts from `wc -l` are 630 for the table/API subtotal, 9434 for the
runtime integration subtotal, and 416 for the native reentrancy proof. No net-negative claim is
made against an unrelated or stale PRD baseline.

## Independent follow-up repair

Baseline: `89714a5ec4ab661c019f71fe35a9ef357481090c`

A fresh review found three remaining lifecycle/transaction gaps. The follow-up closes them without
changing the checked-in trace fixtures:

1. Binding-table writes retain every expected installed descriptor, then verify the complete table
   only after all writes. Verification runs forward and reverse because proxy descriptor/prototype
   traps are observable. Every post-preflight failure rolls back every snapshotted row, then verifies
   the complete original snapshot; an unstable or mismatched final state remains a reported failure.
2. QuickJS now owns `lastException_` through one replace helper and one clear helper. Replacement
   releases the previous owned value, teardown clears the final value before context release, and
   the helpers do not free `JS_UNDEFINED` or `JS_NULL`.
3. JSC records the callback-map keys created by each engine and erases only those keys before that
   engine releases its context. Existing exception protection and cached `Reflect.set` behavior are
   retained.

### Follow-up red/green evidence

The focused source contracts were added before production changes. The baseline was red in exactly
the three new contracts:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs
    exit 1; Test Files 1 failed, 1 passed; Tests 3 failed, 23 passed
    failures: whole-table write/rollback verification; QuickJS exception ownership;
    JSC per-engine callback ownership

The executable two-row control was also red on the baseline. Its second proxy row returned success
after deleting the first row that had already passed the old immediate check:

    cmake --build --preset tn-linux \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    build: exit 0
    executable: exit 1
    whole-table binding proof failed: a later row deleted an earlier verified row without failing

The repaired source contracts and trace contract are green:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs
    exit 0; Test Files 2 passed; Tests 26 passed

The native control now also covers rollback-order corruption, consecutive unconsumed QuickJS
exceptions, QuickJS teardown with an outstanding exception, engine recreation, and a surviving
engine callback after two other engines are destroyed. Both configured Linux engines passed on the
NVIDIA GeForce RTX 2080 Vulkan adapter:

    cmake --build --preset tn-linux \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 0; native WebGPU bindings reentrancy passed

    cmake --build build/tn-linux-quickjs \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test
    exit 0; native WebGPU bindings reentrancy passed

JSC remains unavailable as a runtime on this Linux host. Its updated Objective-C++ source passed
the existing syntax-only compatibility-stub check:

    clang++ -fsyntax-only -x objective-c++ -std=c++17 -D__APPLE__ -DMYSTRAL_JS_JSC \
      -I/tmp/tn-prd205-jsc-stub -I/usr/include/webkitgtk-4.1 \
      -Ipackages/runtime-native/include packages/runtime-native/src/js/jsc_engine.mm
    exit 0

### Follow-up gates and limits

    pnpm --filter @threenative/runtime-native test
    exit 0; Test Files 57 passed; Tests 397 passed, 33 skipped; physics parity 28 JS tests and
    2 Rust tests passed; publint passed

    pnpm typecheck
    exit 0; Scope 16 of 17 workspace projects

    pnpm lint
    exit 0; Biome checked 1113 files; 381 warnings, no errors

    pnpm test
    exit 0; Test Files 197 passed, 1 skipped; Tests 1880 passed, 3 skipped

    git diff --check
    exit 0; no whitespace errors

This follow-up did not execute JSC on Apple hardware, Android, iOS, browser-reference/pixel
conformance, or the full desktop 300-frame verification. It makes no new claim for those lanes.

## Fresh independent-review closure

Baseline: `881e15ba4ce10fc6b41777128f6f96802e180438`

The final independent review identified five fail-closed and engine-lifetime gaps:

1. `Engine::isBindingDestination` now admits only an unchanged ordinary object created by the
   owning engine. V8 uses an inaccessible private marker, QuickJS an
   unforgeable internal class ID with the ordinary prototype, and JSC an owner class with the
   ordinary prototype. Registration rejects globals, proxies, arrays, other exotic values, foreign
   handles, and altered prototypes before descriptor snapshots or writes. Production global
   helpers are completed on a protected ordinary host, then copied to `globalThis`. Cross-row setter
   and descriptor proxies prove that no trap runs and no earlier row is corrupted.
2. Every static and dynamic `installBindingTable` call in `bindings.cpp`, plus both shared wrapper
   factories, checks and propagates failure. Static production initialization returns false on the
   first failed table rather than accepting a partially installed surface.
3. Expected installed functions remain protected for the whole transaction and are released in
   reverse order on success and every rollback path. JSC native callbacks now live in callable
   private data with a finalizer and an owning global context; no process-global pointer-keyed
   callback map remains.
4. QuickJS `performance.now()` resolves its engine through `JS_GetContextOpaque(ctx)`. Destroying
   another engine no longer clears process-global state used by a surviving context.
5. `isSameValue` implements ECMAScript SameValue semantics: V8 uses `SameValue`, QuickJS uses
   `JS_IsSameValue`, and JSC handles `NaN` and signed zero before strict equality. A real ordinary
   object rollback proves `NaN` restores equal and `-0` restores distinct from `+0` without
   weakening complete rollback verification.

### Fresh-review red/green evidence

The focused controls were red before the production repair:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs
    exit 1; 8 contract tests failed
    missing: safe destination API/implementations, protected expected functions, JSC owned
    callbacks, SameValue/performance ownership, and checked static/dynamic table installs

    cmake --build --preset tn-linux \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 1; whole-table binding proof failed: proxy destination rejection did not identify the
    invariant

A final ordinary-only control then caught the exotic global-object exception before commit:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs --reporter=dot
    exit 1; 2 controls failed: the V8 global exception remained and ordinary-host global copies
    were absent

    cmake --build --preset tn-linux \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 1; atomic binding proof failed: global exotic destination did not fail

    cmake --build build/tn-linux-quickjs \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test
    exit 1; whole-table binding proof failed: proxy destination rejection did not identify the
    invariant

The repaired controls are green:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs --reporter=dot
    exit 0; Test Files 2 passed; Tests 30 passed

    cmake --build --preset tn-linux \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 0; NVIDIA GeForce RTX 2080, Vulkan; native WebGPU bindings reentrancy passed

    cmake --build build/tn-linux-quickjs \
      --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test
    exit 0; NVIDIA GeForce RTX 2080, Vulkan; native WebGPU bindings reentrancy passed

JSC is unavailable as an executable runtime on this Linux host. Its ownership, finalizer, and
SameValue source controls pass, and its Objective-C++ implementation passes the available syntax
lane:

    clang++ -fsyntax-only -x objective-c++ -std=c++17 -D__APPLE__ -DMYSTRAL_JS_JSC \
      -I/tmp/tn-prd205-jsc-stub -I/usr/include/webkitgtk-4.1 \
      -Ipackages/runtime-native/include packages/runtime-native/src/js/jsc_engine.mm
    exit 0

### Fresh-review gates and limits

    pnpm --filter @threenative/runtime-native test
    exit 0; Test Files 57 passed; Tests 401 passed, 33 skipped; physics parity 28 JS tests and
    2 Rust tests passed; publint passed

    pnpm typecheck
    exit 0; Scope 16 of 17 workspace projects

    pnpm lint
    exit 0; Biome checked 1113 files; 381 warnings, no errors

    pnpm test
    exit 0; Test Files 198 passed; Tests 1883 passed

    pnpm budgets
    exit 0; 18376/15000 framework LOC review trigger, 86954/100000 native runtime LOC,
    no hard failure; census drift reported

    pnpm quality
    exit 0; 70 findings (11 new, 9 grew, 50 inherited, 0 waived)

    pnpm sync:agents
    exit 0; 16 mirrors synced, 0 written

The first desktop attempt ran the stale production host because the focused CMake target had
relinked only the regression executable. It reported 284 presents for 300 frames. After explicitly
relinking the production host, the same gate passed:

    cmake --build --preset tn-linux --target mystral --parallel
    exit 0; linked mystral

    SDL_AUDIODRIVER=dummy pnpm native:verify:desktop
    exit 0; audio Promise proof passed; desktop core passed exactly 300 presents for 300 frames at
    1280x720; physics actuation, 14-assertion playtest, and query proofs passed

A later final-source gate run transiently reported 279 presents for 300 frames. The unchanged final
binary immediately emitted exact 60/120/180/240/300 present ticks and `TN_PRESENTS:300` in a direct
run; the unchanged full gate then passed with the result above. The transient miss was not
reproducible and no production change was made in response.

    git diff --check
    exit 0; no whitespace errors

Android, iOS, Apple JSC runtime execution, and browser-reference/pixel conformance remain
unverified. No result claims those lanes.

### Current closure repair: independent-review findings

This section records the follow-up repair on branch `linchpin/prd-205-closure`, based at
`13aad718`. The added controls were run before the implementation changes (red) and then rerun
after the changes (green).

The repair covers four failure classes:

- `installBindingTable` now fails closed when the active JS call already owns an exception; it no
  longer consumes that exception before a dynamic install.
- Failed dynamic texture, buffer, pipeline, encoder, pass, canvas, registry, metric, and protected
  handle paths roll back their native ownership and state once. `destroyBindingsState` also drains
  the registries instead of relying on process teardown.
- QuickJS callback data has a class finalizer, Engine-returned handles follow frame/protected
  ownership, and callback results transfer or duplicate exactly one reference as appropriate.
- Teardown queues an actual QuickJS Promise callback and checks that it cannot call destroyed
  binding state; the proxy rollback and cross-row adversarial assertions remain active.

The newly added native controls first failed as expected:

The native commands below are shown from the repository root.

    cmake --build packages/runtime-native/build/tn-linux \
      --target threenative-webgpu-bindings-reentrancy-test -j2
    ./packages/runtime-native/build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 1; dynamic install unwind lost the getter exception

    cmake --build packages/runtime-native/build/tn-linux-quickjs \
      --target threenative-webgpu-bindings-reentrancy-test -j2
    ./packages/runtime-native/build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test
    exit 1; dynamic install unwind lost the getter exception

After the exception-latch fix, the same controls still failed on the next invariant, proving the
resource/state assertions were independently exercising the missing cleanup:

    ./packages/runtime-native/build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 1; dynamic install unwind retained native state

    ./packages/runtime-native/build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test
    exit 1; dynamic install unwind retained native state

Final green controls:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs --reporter=dot
    exit 0; Test Files 2 passed; Tests 30 passed

    cmake --build packages/runtime-native/build/tn-linux \
      --target threenative-webgpu-bindings-reentrancy-test -j2
    exit 0
    ./packages/runtime-native/build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 0; NVIDIA GeForce RTX 2080, Vulkan; native WebGPU bindings reentrancy passed

    cmake --build packages/runtime-native/build/tn-linux-quickjs \
      --target threenative-webgpu-bindings-reentrancy-test -j2
    exit 0
    ./packages/runtime-native/build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test
    exit 0; NVIDIA GeForce RTX 2080, Vulkan; native WebGPU bindings reentrancy passed

The source audit still reports all 38 checked install callers:

    rg -n "installBindingTable\\(" packages/runtime-native/src/webgpu/bindings.cpp \
      packages/runtime-native/src/webgpu/wrapper_factories.cpp | wc -l
    38

During the final package gate, the pre-existing QuickJS source contract also caught the required
explicit protected-result duplication form:

    pnpm --filter @threenative/runtime-native test
    exit 1; tests/runtime-next-contract.test.mjs — native callback results must outlive their
    temporary C++ handles

The ownership helper was adjusted without changing the transfer path. The rerun is green:

    pnpm --filter @threenative/runtime-native test
    exit 0; Test Files 57 passed; Tests 401 passed, 33 skipped; physics parity 28 JS tests and
    2 Rust tests passed; publint passed

Repository gates after the repair are green:

    pnpm typecheck
    exit 0; Scope 16 of 17 workspace projects

    pnpm lint
    exit 0; Biome checked 1113 files; 381 warnings, no errors

    pnpm --filter @threenative/playtest test
    exit 0; no orphans; publint passed

    pnpm test
    exit 0; Test Files 197 passed, 1 skipped (198 total); Tests 1880 passed, 3 skipped (1883 total);
    temporary directory count unchanged

This repair was verified on Linux with the V8 and QuickJS native controls only. Android, iOS,
Apple JSC runtime execution, and browser-reference/pixel conformance remain unverified.

### Independent-review follow-up: five closure findings

This follow-up started from `131cd5a094d4f8e4cb4d041c93eb21241b9f44fb` and preserves the controls
above. It addresses the five findings from the independent review:

1. Compute-pass, render-pass, and command-encoder wrapper rollback now snapshots and restores the
   exact prior global pointers, per-encoder maps, surface-pass fields, and current encoder. The
   native regression keeps active passes on separate encoders, then forces a later wrapper install
   failure and compares the complete prior state.
2. `destroyBindingsState(BindingsState*& state)` nulls the caller's owner before cleanup, making a
   repeated call with the same owner variable safe. The header documents that retained raw aliases
   are invalid after the first call; the native control calls destruction twice.
3. Surface new-entry rollback now restores `frameCount` along with current texture, surface id,
   next texture id, and registry ownership.
4. `acquireSurfaceTexture` is exercised through controlled acquire/wrap/release callbacks with
   fake handles and no window, display, or GPU-backend claim. The control covers a created entry,
   an existing entry, and created-entry wrapper failure, including release and frame-count cleanup.
5. QuickJS callback tests return non-empty strings through both unprotected transfer and protected
   duplication paths. They run on both QuickJS runtime instances in the native binary when QuickJS
   is enabled.

Red before the production changes:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs --reporter=dot
    exit 1; the new wrapper-rollback, destroy-owner, and surface-frame-count contracts failed

    ./packages/runtime-native/build/tn-linux/threenative-webgpu-bindings-reentrancy-test
    exit 1; wrapper rollback proof failed: compute pass pointer or map state was not restored

    ./packages/runtime-native/build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test
    exit 1; wrapper rollback proof failed: compute pass pointer or map state was not restored

Green after the repair:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs --reporter=dot
    exit 0; Test Files 2 passed; Tests 34 passed

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/resize-attachment-invariant.test.mjs --reporter=dot
    exit 0; Test Files 1 passed; Tests 2 passed

    cmake --build packages/runtime-native/build/tn-linux \
      --target threenative-webgpu-bindings-reentrancy-test --parallel
    ./packages/runtime-native/build/tn-linux/threenative-webgpu-bindings-reentrancy-test \
      2>&1 | tail -n 4
    exit 0; native WebGPU bindings reentrancy passed; V8; NVIDIA GeForce RTX 2080; Vulkan

    cmake --build packages/runtime-native/build/tn-linux-quickjs \
      --target threenative-webgpu-bindings-reentrancy-test --parallel
    ./packages/runtime-native/build/tn-linux-quickjs/threenative-webgpu-bindings-reentrancy-test \
      2>&1 | tail -n 4
    exit 0; native WebGPU bindings reentrancy passed; QuickJS; NVIDIA GeForce RTX 2080; Vulkan

    pnpm --filter @threenative/runtime-native test
    exit 0; Test Files 57 passed; Tests 405 passed, 33 skipped; physics parity 28 JS tests and
    2 Rust tests passed; publint passed

    pnpm typecheck
    exit 0; Scope 16 of 17 workspace projects

    pnpm lint
    exit 0; Biome checked 1113 files; 381 warnings, no errors

    pnpm test
    exit 0; Test Files 197 passed, 1 skipped (198 total); Tests 1880 passed, 3 skipped (1883 total);
    temporary directory count unchanged

    git diff --check
    exit 0; no whitespace errors

Android, iOS, Apple JSC runtime execution, browser-reference, pixel-conformance, and full desktop
native verification were not run in this follow-up and remain unverified.
