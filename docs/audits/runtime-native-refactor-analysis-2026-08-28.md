# runtime-native: is another refactor worth it?

**Short answer: yes, but not the one you are picturing.** Splitting `bindings.cpp` is item #5 on
this list, not item #1 — and it is blocked behind two cheaper changes. The measurements below are
from this tree at `573d8f2e` (2026-08-28), working tree dirty with the timestamp-query WIP.

---

## What I measured

| Metric | Value | How |
| --- | ---: | --- |
| C++ in `src/` + `include/` | 45,318 lines | `find … \| wc -l` |
| Package total counted by the census | 103,500 lines | `docs/verification/native-runtime-census-2026-08-16.md` |
| Native LOC review trigger | 50,000 | same doc — **currently 2.07× over** |
| `src/webgpu/` | 10,448 lines | per-dir count |
| `src/webgpu/bindings.cpp` | 7,768 lines | `wc -l` |
| Functions > 150 lines, whole package | 27 | AST-ish brace scan |
| Functions > 300 lines | 6 | same |
| Exact 6-line clones across `src/` | **2%** of lines | window-hash clone scan |
| `#if/#ifdef/#else` directives in `bindings.cpp` | 217 | `grep -c` |
| … in `context.cpp` | 122 | `grep -c` |
| `BindingsState` members | ~100 fields in one struct | `bindings_state.h:175-315` |
| Opaquely-named handlers | 87 × `tnWebgpuHandlerNN` | `grep -oE` |
| C++ test executables | 25 (30 `add_executable`) | `CMakeLists.txt` |
| `add_test` / CTest registrations | **0** | `grep -c add_test` |
| Sanitizer or coverage build options | **0** | `grep -n sanitize\|coverage CMakeLists.txt` |
| Vitest files that read C++ **source text** | 27 of 73 | `grep -l 'src/…\.cpp'` |
| Times `bindings.cpp` is named inside tests | 35 | same |
| `bindings.cpp` incremental compile | **16 s** (one TU) | `ninja` single-object rebuild |
| `runtime.cpp` incremental compile | 9 s | same |
| A normal small TU (`checked_handle.cpp`) | 1 s | same |
| Commits touching `bindings.cpp` in 90 days | 60 | `git log --name-only` |
| Build directories under `build/` | 9 | `ls build` |

### Things that are *not* wrong (do not spend effort here)

- **DRY is fine.** Only 2% of `src/` lines sit in a repeated 6-line window, and the top offenders
  (`context.cpp` adapter/device request blocks) are backend-dialect twins, not copy-paste rot.
- **Arity validation is centralised and correct.** 0 of 87 handlers index `args[N]` without a
  guard — `BindingRegistration::minimumArity` does it at the table. That is good design; keep it.
- **No algorithmic hotspot found.** The complexity scanner's only `src/` hits are nested loops in
  `cli/main.cpp` (33) and `debug/debug_server.cpp` (20) — cold paths, argument parsing and a debug
  socket. The hot path is already instrumented (`TN_HOST_GAP`, `TN_ANDROID_JS_PROFILE`). A
  performance-motivated refactor has no evidence behind it.
- **YAGNI is mostly respected.** `ablation.h` is 55 lines, default-off, asserted absent from
  shipped presets. That is a measurement instrument, not dead weight.

So the case for refactoring is **maintainability, testability and agent-legibility** — not speed,
not duplication.

---

## The finding that changes the plan

**27 of 73 vitest files assert against C++ *source text and file paths*.** `bindings.cpp` is named
35 times, `runtime.cpp` 33 times. `tests/raytracing-contract.test.mjs` locates
`static js::JSValueHandle js_traceRays(` by string index and asserts a refusal appears before a
backend call — it executes no native code at all.

Two consequences:

1. **Those tests are not proofs.** They pass on a file that never compiled. That is the exact
   failure mode the root AGENTS.md fail-closed rule exists to prevent, one layer up.
2. **They are the refactor tax.** Moving a function out of `bindings.cpp` reds tests that have
   nothing to say about behaviour. Any split that starts in the C++ will spend most of its budget
   repairing greps.

**So: convert the highest-value source-text assertions into executable ones *before* moving any
C++.** That work is useful even if the split never happens.

---

## Ranked recommendations (impact ÷ effort)

### Do now — under a day each

**1. Fix the red census gate. (5 minutes, unblocks every commit here)**
`pnpm census` currently fails: `__tests__/` (your new `host-gap-gpu-drain.spec.ts`) has no census
row. Add the row with owner/proof/alternative/verdict, re-run.

**2. Rename the 87 `tnWebgpuHandlerNN` functions. (2–3 hours, mechanical, zero behaviour change)**
They came out of the PRD-222/224 lambda→static-function extraction and the numbering is an
artifact of that tool, not a design. `tnWebgpuHandler01` is `HTMLElement.appendChild`;
`tnWebgpuHandler35` is 389 lines of something you have to read to identify. Every registration
site already names the surface and method — the rename is derivable from the `bindingTable({…})`
row three lines below the reference. Impact is highest for the framework's actual primary
consumer: an agent grepping for `GPUQueue.writeBuffer` finds nothing today.
*Verify:* `cmake --build build/tn-linux` + the 25 contract executables; the diff must be
name-only.

**3. Close the C++ lint hole. (half a day)**
`pnpm quality` already reports it: `packages/runtime-native/src:1 lint-coverage-hole value=ignored
threshold=linted`. 45k lines of C++ with no clang-format and no clang-tidy, in a repo where Biome
owns formatting everywhere else. Add `.clang-format` + a `clang-tidy` config scoped to the
lifetime/bugprone checks that matter here (`bugprone-use-after-move`, `cppcoreguidelines-*-member-init`,
`performance-*`), baseline the existing findings, fail on new ones.

**4. Add ASan/UBSan as a CMake option and one CI lane. (half a day, highest safety payoff)**
The domain risk in this package is exactly what sanitizers catch: raw `WGPU*` handles and
`js::JSValueHandle` lifetimes across a JS/GPU boundary. You already have
`handle_lifetime_test`, `shutdown_lifetime_test`, `dom_dispatch_lifetime_test` and
`webgpu_bindings_reentrancy_test` written — running the *existing* 25 executables under
`-fsanitize=address,undefined` costs one option and one lane. There is currently no sanitizer and
no coverage instrumentation anywhere in the package.

### Do next — 1–3 days each, in this order

**5. Split `BindingsState`. (1 day; this is the real blocker)**
One struct, ~100 members, mixing: device/queue/surface handles, swapchain state, sRGB presentation
bridge, screenshot capture, canvas-2D compositing, 8 resource registries with their id counters,
frame-op-stream replay bookkeeping, and 12 profiling counters. **This is why `bindings.cpp` cannot
be split** — every candidate module needs the whole struct. Group into cohesive sub-structs
(`ResourceRegistries`, `PresentationState`, `FrameProfiling`, `ScreenshotCapture`,
`Canvas2DComposite`) with `state->registries.textureRegistry` style access. Mechanical, compiler-
checked, no behaviour change. Note `bindings_state.h` changed 23 times in 90 days — it is already
being edited constantly, so the merge cost is real but the ongoing cost is worse.

**6. Split `bindings.cpp` along surface lines. (2–3 days, after #5)**
Not "into smaller files" — into the surfaces the binding tables already name: device/adapter,
buffer, texture/view/sampler, pipeline/shader, command-encoder + passes, queue, canvas-context +
presentation, frame-op-stream replay, canvas-2D composite. Concrete payoff: the 16 s single-TU
compile becomes ~8 files that build in parallel on your 24 cores; `bindings.cpp` is the most-churned
file in the package (60 commits/90 days), so the merge-conflict surface for the concurrent lanes
drops too. Do it *after* #2 (names) and #5 (state), or the diff is unreviewable.

**7. Extract the profiling concern. (1 day)**
`TN_ANDROID_JS_PROFILE` appears 64 times across `src/`, including `#if` blocks inside the
`BindingsState` struct itself, plus the six `framePhase*Ns` counters and `TN_HOST_GAP`. One
`FrameProfiler` type with no-op methods when compiled out removes most of the preprocessor noise
from the hot-path files and makes the meters testable on their own.

**8. Finish the backend-dialect adapter. (2 days)**
`webgpu_compat.h` (241 lines) already exists and is the right idea, but 217 preprocessor directives
still live in `bindings.cpp` and 122 in `context.cpp` — three dialects (Dawn, wgpu-modern,
wgpu-legacy) branch inline in the middle of logic, including a function whose signature is written
twice around an `#else`. Push the remaining differences behind the compat header so the binding
code reads as one implementation. This is also what makes #6's file boundaries stable.

### Later — real value, no urgency

**9. Register the C++ tests with CTest. (half a day)** 25 executables, 0 `add_test`,
`EXCLUDE_FROM_ALL`, each needing a hand-written vitest wrapper that shells out and a hand-written
`add_executable` block. That friction is why new native behaviour tends to get a source-text test
instead of an executable one (see the headline finding). `add_test` + a `ctest --output-on-failure`
lane makes writing the next executable test cheaper than writing a grep.

**10. Deduplicate the scripts tier. (1 day)** `scripts/` is 15,347 lines with no shared library
directory; 9 scripts each define their own adb wrapper, and `qualify-physical-mobile.mjs` (1,321)
and `measure-android-js-engine.mjs` (1,024) overlap heavily on device preflight. One
`scripts/lib/adb.mjs` + `scripts/lib/device.mjs` is the whole change.

**11. Split `runtime.cpp`'s DOM/fetch shims. (1 day)** 3,558 lines, `setupDOMEvents` alone is 630
and `setupFetch` 276. Same argument as #6 at a third the size. Lower priority only because it
churns half as often.

**12. Consolidate the 9 build directories.** `tn-linux`, `tn-linux-quickjs`, `tn-linux-dual`,
`tn-linux-wgpu`, `tn-linux-contracts-physics`, `tn-linux-contracts-video`, `prd223-*`… Each
contract lane grew its own. Which directory a given test executable links in is tribal knowledge
today, and the vitest wrappers hardcode it (`build/tn-linux`, `build/tn-linux-quickjs`). A
documented matrix of {engine × backend × contract set} → directory would do; collapsing them is
better but riskier.

### Do not do

- **A generated binding layer / IR / codegen for the 87 handlers.** Tempting at 7,768 lines, and
  explicitly closed with evidence by the charter (IR, scene format, bespoke vocabulary). It would
  also make the perf work — which is currently the package's active lane — much harder to reason
  about.
- **A DRY pass.** 2% clone rate. There is nothing there.
- **Any performance-motivated restructuring.** No evidence. The instruments say the cost is in
  `hostGap` (GPU-tail wait + replay), which is a scheduling problem, not a structure problem.

---

## Sequencing, given the live lanes

`bindings.cpp` took 60 commits in 90 days and `bindings_state.h` 23 — this is not a quiet file, and
your own memory notes concurrent agent lanes in this tree. Items 1–4 are additive and safe to land
any time. Items 5 and 6 are wide mechanical diffs that will conflict with anything in flight: land
them as single commits in one sitting, on a day the perf lane is paused, or they will rot.

**Total: about 1 week of focused work for items 1–7**, which is where nearly all the payoff sits.
