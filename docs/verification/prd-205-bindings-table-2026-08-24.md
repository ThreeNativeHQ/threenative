# PRD-205 — WebGPU bindings-table closure

Date: 2026-08-24
Lane: `linchpin/prd-205-closure`
Base: `d1663477bed0736020b67320b072846daf211ef3`
Status: focused, native, and repository gates verified on Linux; pixel conformance is unverified because the browser reference captures are absent

## Repairs

1. `installBindingTable` now validates every destination as a non-null object before the first
   write, snapshots every affected property, checks every `setProperty` result, and rolls back in
   reverse order. Existing properties are restored and new properties are deleted. Failure returns
   `false` with the engine exception set. The smallest cross-engine API is `hasProperty` plus
   `deleteProperty`, implemented by V8, QuickJS, and JSC; the engines now report failed writes.
2. The dynamic canvas `getContext` binding uses a named factory that captures the native canvas ID.
   It never reads the mutable row destination to identify the canvas. The created element is
   protected for the callback lifetime. The native control creates two canvases, mutates one public
   ID and internal ID to the other, and proves their contexts remain independently owned.
3. The call-trace fixture now executes `Document.createElement`, successful dynamic
   `HTMLCanvasElement.getContext`, and successful `HTMLElement.addEventListener`. It also retains
   mutation controls that remove the dynamic path or a required table row. The live trace has 75
   calls, 65 result entries, and 10 caught errors; the pre/post fixture files are byte-identical.
4. The accounting below separates the table/API subtotal from integration plumbing. The wrapper
   factories contain three real rows: two `GPUTexture` rows (`createView`, `destroy`) and one
   pipeline row (`getBindGroupLayout`) shared by the render/compute pipeline surfaces.

## Red/green evidence

The focused contract/trace command was red after the negative controls were added and before the
repair:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs
    Test Files  2 failed (2)
    Tests       3 failed | 15 passed (18)

After the repair:

    Test Files  2 passed (2)
    Tests       20 passed (20)

The live trace comparison command passed:

    pre/post bytes identical: true
    live trace matches pre fixture: true
    calls=75 results=65 errors=10

The successful dynamic creation, context, and event-listener calls are counted as result entries;
missing-method errors are not used as coverage.

## LOC accounting

The PRD abstraction subtotal is the table API and implementation only:

    356 packages/runtime-native/include/mystral/js/engine.h
    193 packages/runtime-native/src/webgpu/registration_table.cpp
     42 packages/runtime-native/include/mystral/webgpu/registration_table.h
    591 subtotal

Integration/runtime plumbing is reported separately rather than folded into that subtotal:

    1304 packages/runtime-native/src/js/v8_engine.cpp
     914 packages/runtime-native/src/js/quickjs_engine.cpp
     676 packages/runtime-native/src/js/jsc_engine.mm
    5898 packages/runtime-native/src/webgpu/bindings.cpp
     158 packages/runtime-native/src/webgpu/wrapper_factories.cpp
     166 packages/runtime-native/src/webgpu/bindings_state.h
     25 packages/runtime-native/include/mystral/webgpu/wrapper_factories.h
    9141 integration/runtime subtotal
    9732 complete touched accounting set

These are current-tree `wc -l` counts for the complete production set touched or required to
account for this repair. No net-negative claim is made against an unrelated or stale PRD baseline.

## Native proof

    pnpm native:build: exit 0; ninja: no work to do
    cmake --build --preset tn-linux --target threenative-webgpu-bindings-reentrancy-test --parallel \
      && ./build/tn-linux/threenative-webgpu-bindings-reentrancy-test: exit 0
    native WebGPU bindings reentrancy passed

The V8 reentrancy executable ran on an NVIDIA GeForce RTX 2080 through Vulkan. The equivalent
QuickJS target also exited 0 and printed `native WebGPU bindings reentrancy passed`. JSC passed the
Objective-C++ syntax-only compile; no JSC runtime result is claimed.

The packaged desktop gate passed with the host's dummy audio driver:

    SDL_AUDIODRIVER=dummy pnpm native:verify:desktop: exit 0
    Verified native-smoke.js (6752705 bytes), one file with no imports
    desktop audio decodeAudioData Promise proof passed on V8
    desktop core gate passed: 300 frames, 1280x720
    desktop physics actuation bindings proof passed
    desktop physics playtest proof passed: 14 assertions
    desktop physics query proof passed

## Repository gates

    pnpm typecheck: exit 0; Scope 16 of 17 workspace projects
    pnpm lint: exit 0; Checked 1113 files; 381 warnings, no errors
    pnpm test: exit 0; 197 files passed, 1 skipped; 1880 tests passed, 3 skipped
    pnpm --filter @threenative/runtime-native test: exit 0; 57 files passed; 391 passed, 33 skipped
    pnpm budgets: exit 0; 18376/15000 framework LOC review trigger, no hard failure
    pnpm quality: exit 0; 70 findings (11 new, 9 grew, 50 inherited, 0 waived)
    git diff --check: exit 0

The budgets run reported native census drift but no hard failure. Lint and quality findings are
outside this scoped repair.

## Current-source conformance and host limits

The current repair tree was run with:

    sh ../../scripts/xvfb.sh node conformance/run-conformance.mjs \
      --target desktop --out /tmp/tn-prd205-desktop-xvfb

The native executions completed with exit code 0 for 67 of 68 registry rows and wrote screenshots.
The report summary was `pass:0 fail:0 blocked:68 planned:0 validated:0`: all 67 executable rows were
blocked from comparison because the current browser reference captures are missing, and
`90-multitouch-input` is additionally host-blocked. Exact first comparison blocker:

    Missing browser reference capture: packages/runtime-native/artifacts/conformance/web/01-basic-cube.png

Therefore no browser or pixel-conformance pass is claimed. A direct run without Xvfb also stopped
before execution with `SDL_Init failed: x11 not available`; the Xvfb run is the usable native
execution evidence. The Xvfb compatibility wrapper returned exit 2 during cleanup after the report;
the native processes themselves exited 0.

Android was checked with the SDK path required on this host:

    /home/joao/Android/Sdk/platform-tools/adb version
    Android Debug Bridge version 1.0.41
    Version 37.0.0-14910828
    Installed as /home/joao/Android/Sdk/platform-tools/adb

    /home/joao/Android/Sdk/platform-tools/adb devices -l
    192.168.1.192:5555 device product:shiba model:Pixel_8 device:shiba transport_id:4
    emulator-5554 device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1

The Android tool is available and two devices are attached. Android runtime conformance was not
executed in this repair, so no Android result is claimed. iOS was not executed and has no result
claim.
