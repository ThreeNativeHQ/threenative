# PRD-205 — WebGPU bindings-table closure

Date: 2026-08-24
Lane: linchpin/prd-205-closure
Status: verified on Linux desktop; mobile execution unverified

## Repairs

1. registration_table.cpp:37 now dispatches each row through its row-owned destination
   resolver. bindingTable(owner, rows) installs the resolver, while the shared dispatcher
   rejects a missing, null, or undefined destination before calling setProperty. Mixed-surface
   rows clear their resolver during table construction and therefore fail closed. The installer
   no longer accepts a separate owner, so a surface cannot silently use another table's owner.
   Adjacent registrations for the same owner are consolidated into one table.
2. wrapper_factories.cpp:25 routes texture createView/destroy and render/compute pipeline
   getBindGroupLayout through the same table dispatcher. The file has no direct newFunction
   WebGPU registration path left.
3. webgpu-bindings-contract.test.mjs:289 inventories exact (surface, name) pairs. The
   regression mutation deleting GPUComputePassEncoder.setPipeline fails the census, proving that
   the compute-pass family is not counted by method name alone. The final census is 86/86 pairs and
   43/43 error strings.
4. bindings.cpp was consolidated instead of relaxing the size criterion. The final mandated
   subtotal is net-negative against the actual pre-lane baseline.

## Red/green evidence

The focused contract/trace command was run before the repair and produced the required red
baseline:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs
    Test Files  2 failed (2)
    Tests       5 failed | 12 passed (17)

The five red assertions covered row-owned destinations, migrated surface/name pairs, the shared
wrapper-factory path, render-pass trace coverage, and the supplementary census. The LOC red
observation was:

    prior lane bindings.cpp: 6275
    new-header accounting:    287
    prior subtotal:          6562
    pre-lane baseline:       6510
    net:                       +52

After the four repairs and the trace extension, the focused command was green:

    Test Files  2 passed (2)
    Tests       17 passed (17)

The exact trace regression was also red before extension (trace must include
render-pass.setPipeline) and green after regeneration:

    pre/post trace matches: 62 calls, 52 results, 10 errors

## LOC accounting

The baseline command and final command were measured directly; the criterion remains the
bindings.cpp plus new-header subtotal:

    git show efa71954:packages/runtime-native/src/webgpu/bindings.cpp | wc -l
    6510

    wc -l packages/runtime-native/src/webgpu/bindings.cpp \
      packages/runtime-native/include/mystral/webgpu/bindings.h \
      packages/runtime-native/include/mystral/webgpu/registration_table.h \
      packages/runtime-native/include/mystral/webgpu/wrapper_factories.h \
      packages/runtime-native/src/webgpu/bindings_state.h
      6216 packages/runtime-native/src/webgpu/bindings.cpp
        56 packages/runtime-native/include/mystral/webgpu/bindings.h
        40 packages/runtime-native/include/mystral/webgpu/registration_table.h
        25 packages/runtime-native/include/mystral/webgpu/wrapper_factories.h
       166 packages/runtime-native/src/webgpu/bindings_state.h
      6503 total

Arithmetic: 6216 + 56 + 40 + 25 + 166 = 6503; 6503 - 6510 = -7 lines.

The repository LOC command also passed:

    pnpm tsx scripts/count-loc.ts: exit 0
    suggested framework normalised baseline: 432 (current baseline 441)
    platformer template LOC: 1891

## Trace fixtures

webgpu-bindings-call-trace.js now covers every migrated family, including DOM, canvas, GPU,
adapter/features, device, queue, buffer, texture, command encoder, render pass, compute pass,
render-bundle encoder, and global helpers. It preserves argument shape and records exactly one
result or error shape per call. The pre-repair executable was
/tmp/mystral-prd205-pre-repair; the final executable was
packages/runtime-native/build/tn-linux/mystral. The stored pre/post fixtures compare exactly.

## Native proof

    pnpm native:build: exit 0
    native WebGPU bindings reentrancy passed

The reentrancy executable ran on an NVIDIA GeForce RTX 2080 through Vulkan. The desktop gate was
also green with the host's required dummy audio driver:

    SDL_AUDIODRIVER=dummy pnpm native:verify:desktop: exit 0
    desktop audio decodeAudioData Promise proof passed on V8
    desktop core gate passed: 300 frames, 1280x720
    desktop physics actuation bindings proof passed
    desktop physics playtest proof passed: 14 assertions
    desktop physics query proof passed

## Browser/native conformance

The browser reference capture completed with:

    target: web
    pass: 68, fail: 0, blocked: 0

The named desktop comparison completed with:

    target: desktop
    pass: 67, fail: 0, blocked: 1
    report: packages/runtime-native/artifacts/conformance/prd205-desktop-final/report.json

The one blocked row is the registry-declared 90-multitouch-input host exclusion; the Xvfb host
has no evdev input backend. No Android or iOS execution is claimed: neither adb nor xcrun is
installed on this host.

## Repository gates

    pnpm typecheck && pnpm lint && pnpm test: exit 0
      typecheck: Scope 16 of 17 workspace projects
      lint: 380 warnings, no errors
      test: 198 files passed; 1883 tests passed

    runtime-native unit suite: 57 files passed; 388 tests passed; 33 skipped
    pnpm budgets: exit 0; 18376/15000 framework LOC review trigger, no hard failure
    pnpm quality: exit 0; 70 findings (11 new, 9 grew, 50 inherited)
    git diff --check: exit 0
