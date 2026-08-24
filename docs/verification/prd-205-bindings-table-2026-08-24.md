# PRD-205 — WebGPU bindings-table closure

Date: 2026-08-24
Lane: `linchpin/prd-205-closure`
Base: `a523efc17064aeca0bc341ae408926b532887036`
Status: verified on Linux desktop; Android and iOS execution unavailable on this host

## Repairs

1. `registration_table.cpp` now validates the whole table before writing any property. Each
   `BindingRegistration` carries its own `BindingDestination`; null, undefined, malformed, empty,
   and mixed-surface tables fail closed with no partial install. The native reentrancy executable
   checks distinct destinations, wrong-destination non-copying, mixed-surface rejection, and the
   invalid-row partial-install negative control.
2. `installWebGPUBindingTables` is declarative: the final source block is 315 lines, has zero
   inline `BindingsState` lambdas, and dispatches named handlers. The 93 rows are split across 91
   rows in `bindings.cpp` and 2 wrapper-factory rows; named capture factories retain native IDs or
   handles where the old inline closures did so.
3. The LOC proof counts every abstraction file: both registration/wrapper implementations and all
   five related headers/state files. The final subtotal is net-negative against the explicit PRD
   baseline.
4. The call-trace fixture covers DOM/HTMLElement, canvas, pipeline wrappers, render pass, compute
   pass, render bundle, and the remaining migrated families. A source mutation deleting a required
   row fails the focused test; the stored pre/post traces remain byte-identical.

## Red/green evidence

The focused contract/trace command was red before the repair:

    pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
      tests/webgpu-bindings-contract.test.mjs tests/webgpu-bindings-trace.test.mjs
    Test Files  2 failed (2)
    Tests       4 failed | 14 passed (18)

The failures covered row-owned destination handling, atomic mixed/invalid installation, the
installer's inline-handler structure, and the missing trace families. After the repairs:

    Test Files  2 passed (2)
    Tests       18 passed (18)

The live native trace also matched both stored fixtures:

    current trace matches pre/post byte-identical fixtures: 69 calls
    results=58, errors=11

Required trace families include `HTMLElement.appendChild`, `HTMLElement.addEventListener`,
`HTMLCanvasElement.getContext`, `HTMLCanvasElement.addEventListener`,
`GPURenderPipeline.getBindGroupLayout`, `GPUComputePipeline.getBindGroupLayout`, and every
render-pass, compute-pass, and render-bundle method group.

## LOC accounting

The explicit PRD baseline is:

    git show efa71954:packages/runtime-native/src/webgpu/bindings.cpp | wc -l
    6510

The complete implementation/header accounting set is:

    5885 packages/runtime-native/src/webgpu/bindings.cpp
     124 packages/runtime-native/src/webgpu/registration_table.cpp
     158 packages/runtime-native/src/webgpu/wrapper_factories.cpp
      56 packages/runtime-native/include/mystral/webgpu/bindings.h
      42 packages/runtime-native/include/mystral/webgpu/registration_table.h
      25 packages/runtime-native/include/mystral/webgpu/wrapper_factories.h
     166 packages/runtime-native/src/webgpu/bindings_state.h
    6456 total

Arithmetic: `5885 + 124 + 158 + 56 + 42 + 25 + 166 = 6456`; `6456 - 6510 = -54` lines.

The repository LOC command passed:

    pnpm tsx scripts/count-loc.ts: exit 0
    suggested framework normalised baseline: 432 (current baseline 441)
    platformer template LOC: 1891

## Native proof

    pnpm native:build: exit 0
    native WebGPU bindings reentrancy passed

The reentrancy executable ran two independently owned bindings states on an NVIDIA GeForce RTX 2080 through
Vulkan. The packaged desktop gate passed with the host's dummy audio driver:

    SDL_AUDIODRIVER=dummy pnpm native:verify:desktop: exit 0
    Verified native-smoke.js (6752705 bytes), one file with no imports
    desktop audio decodeAudioData Promise proof passed on V8
    desktop core gate passed: 300 frames, 1280x720
    desktop physics actuation bindings proof passed
    desktop physics playtest proof passed: 14 assertions
    desktop physics query proof passed

## Repository gates

    pnpm typecheck: exit 0; Scope 16 of 17 workspace projects
    pnpm lint: exit 0; 380 inherited warnings, no errors
    pnpm test: exit 0; 198 files passed; 1883 tests passed
    runtime-native unit suite: 57 files passed; 389 tests passed; 33 skipped
    pnpm budgets: exit 0; 18376/15000 framework LOC review trigger, no hard failure
    pnpm quality: exit 0; 70 findings (11 new, 9 grew, 50 inherited)
    git diff --check: exit 0

The budgets run also reported pre-existing native census drift; it did not fail the gate. The
quality and lint findings are outside the scoped runtime-native repair.

## Browser/native conformance and host limits

Existing PRD-205 evidence retained from the prior lane:

    target: web       pass: 68, fail: 0, blocked: 0
    target: desktop   pass: 67, fail: 0, blocked: 1

The desktop blocked row is the registry-declared 90-multitouch input host exclusion. Android and
iOS were not claimed: `adb` and `xcrun` are unavailable on this host.
