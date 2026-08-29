# Batch — make `packages/runtime-native` maintainable without breaking it, 2026-08-28

**Status:** PROPOSED — seven PRDs filed, none started. Filed from
[the runtime-native refactor analysis](../../reports/runtime-native-refactor-analysis-2026-08-28.md)
(measured at `7b729e2d`) and from the first C++ coverage measurement this repository has ever
taken, [native-coverage-scouting-2026-08-28](../../verification/native-coverage-scouting-2026-08-28.md).

**The owner's constraint, and the batch's whole shape: harden it first, so we catch the regression
if we do some shit.** This is a core module. Nothing here moves product code until something exists
that would notice if a move broke it.

## Why the batch is ordered the way it is

The analysis ranked the debt by impact ÷ effort and the obvious first move — split the 7,768-line
`bindings.cpp` — came out **sixth**. The reason is measurable: the package has zero coverage
instrumentation, zero sanitizer options and zero CTest registrations, and **27 of its 73 vitest
files assert on C++ source text** rather than behaviour. That suite reds when a symbol is renamed
and stays green when behaviour breaks — precisely inverted for a refactor. Its measured coverage is
**39.19%** overall and **32.14%** for `bindings.cpp` itself.

So PRD-229 builds the instruments, PRD-230 does the move behind them, and everything else follows.

## Scope and ownership

| PRD | Outcome | Complexity | Depends on |
| --- | --- | --- | --- |
| [229](./PRD-229-the-native-host-is-provable-before-it-is-moved.md) | Coverage is measured and gated, one command runs every native test, ASan/UBSan lane exists, the C++ lint hole closes, source-text assertions become behaviour tests, coverage and perf floors become gates. **Moves no product code.** | 7 → HIGH | none |
| [230](./PRD-230-the-webgpu-bindings-move-one-surface-at-a-time.md) | The 87 `tnWebgpuHandlerNN` get real names; `BindingsState` splits into cohesive sub-structs; `bindings.cpp` splits one surface per commit; re-measure | 7 → HIGH | 229, all six phases |
| [231](./PRD-231-the-backend-dialect-stops-leaking-into-the-binding-code.md) | 339 dialect `#if`s leave the binding logic for `webgpu_compat.h`; all three dialects build and are named | 6 → MEDIUM | 230 |
| [232](./PRD-232-profiling-is-a-component-not-a-smear.md) | `TN_ANDROID_JS_PROFILE`'s 64 sites and the frame-phase counters become one `FrameProfiler`, with byte-identical output | 5 → MEDIUM | 230 phase 2; **coordinate with [227](../PRD-227-the-frame-crosses-once.md) and [228](../done/PRD-228-the-pixel-budget-is-the-engines.md)** |
| [233](./PRD-233-runtime-cpp-stops-being-the-place-everything-goes.md) | `runtime.cpp`'s thirteen `setup*` shims move into files named after what they shim; `shim-manifest.json` is the control | 5 → MEDIUM | 229 only |
| [234](../done/PRD-234-the-scripts-tier-has-one-device-library.md) | Rejected and reverted: the shared device layer added 404 census lines, firing its kill switch | 4 → MEDIUM | none |
| [235](./PRD-235-the-build-directory-matrix-is-one-documented-thing.md) | The nine build directories get one enforced manifest; an unbuildable target stops looking like an unrun one | 3 → LOW | 229 phases 1–2 |

## Order

1. **229 first, and alone.** Every other PRD's verification names an instrument it builds. Its
   Phase 1 already has a blocker found by measurement rather than by planning: the render-pass
   class-table contract passes under gcc/Release and reports three failures under the instrumented
   clang/Debug build, cause unattributed. Settle that before anything else.
2. **234 in parallel, any time.** It touches no C++ and depends on nothing here.
3. **233 in parallel once 229 is green.** Different files from 230, and it has an existing enforced
   control (`shim-manifest.json`) that the WebGPU side lacks.
4. **230 next**, as single commits on days the perf lane is paused — that file took 60 commits in
   90 days.
5. **231 and 232 after 230.** 232 waits on PRD-227/228 rather than the reverse: they own those
   meters and are live.
6. **235 last of the structural work**, once CTest registration and the coverage configuration have
   decided what a build directory is for.

## Two blocked PRDs this batch would unblock

[PRD-177](../BLOCKED/requires-asan-libuv-source-build/PRD-177-native-restart-shutdown-lifetime.md)
and
[PRD-184](../BLOCKED/requires-asan-libuv-source-build/PRD-184-native-shutdown-ownership-transfer.md)
are parked under `requires-asan-libuv-source-build` because their negative control cannot fire:
proving the libuv close-then-clear fixes needs an allocator-error instrument that can see a
write-after-free, and exit codes cannot. **PRD-229 Phase 3 is that instrument.**

They stay in `BLOCKED/` until it exists — filing convention, and honesty: the blocker is real
today. When 229 Phase 3 lands, attempt them, record what actually happened, and `git mv` them into
this batch if they become workable. Do not move them on the strength of a plan.

## Deliberately not in this batch

- **A generated binding layer, IR or codegen for the 87 handlers.** Tempting at 7,768 lines and
  closed with evidence by the charter.
- **A DRY pass.** Exact 6-line clone rate across `src/` is 2%. There is nothing there.
- **Any performance-motivated restructuring.** No algorithmic hotspot was found; the frame cost is
  a scheduling problem owned by PRD-227/228, not a structure problem.
- **A whole-tree reformat.** It would bury every review in this batch.
- **Widening the coverage denominator by enabling raytracing, video, GLTF, the debug server or
  native physics in the default lane.** Those subsystems are *not compiled* in `tn-linux` — 8,367
  lines that are unmeasured rather than uncovered. Measuring them is its own decision.

## The rule this batch is judged by

Every phase in every PRD here names a mutation that makes its gate go red, and pastes the failure.
A refactor batch whose tests never failed has proved that the code still compiles, and nothing else.
