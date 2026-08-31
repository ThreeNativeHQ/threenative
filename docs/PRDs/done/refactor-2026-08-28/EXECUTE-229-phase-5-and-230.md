---
prd_contract: v1
---

# EXECUTE — the runtime-native refactor batch, in order

**Covers every PRD in this folder, with executable phases for each — not pointers to them.**

| § | PRD | Start |
| --- | --- | --- |
| 3 | 229 Phase 5 — source-text assertions become behaviour tests | **now**, critical path |
| 4 | 233 — `runtime.cpp` stops being the place everything goes | **now**, in parallel |
| 5 | 235 — the build directory matrix is one documented thing | **now**, in parallel |
| 6 | 230 — the WebGPU bindings move, one surface at a time | after §3.3 exits 0 |
| 7 | 231 — the backend dialect stops leaking into the binding code | after §6 |
| 8 | 232 — profiling is a component, not a smear | after §6.2 **and** PRD-227/228 |
| 11.1 | 234 | never — executed, rejected, reverted |
| 11.2 | 177, 184 (outside the batch) | attemptable; §11.2 names what to red-green first |

Three lanes can start today: §3, §4 and §5 touch different files and different gates. Everything
else is genuinely ordered — §10 says what happens if you ignore that.

Every number here was measured on 2026-08-29, not taken from the PRDs' filing day. Read
[PRD-229](./PRD-229-the-native-host-is-provable-before-it-is-moved.md) and the PRD for whichever
section you are executing; this file is the how, they are the why.

**A runbook, not a proposal.** Every command here has been run on 2026-08-29 unless the step says
otherwise. Follow it top to bottom; each step names what makes it fail.

Read [PRD-229](./PRD-229-the-native-host-is-provable-before-it-is-moved.md) and
[PRD-230](./PRD-230-the-webgpu-bindings-move-one-surface-at-a-time.md) first — this file executes
them, it does not restate their reasoning.

## 0. Where the work actually stands

| | |
| --- | --- |
| PRD-229 phases 1–4, 6 | **Landed** 2026-08-28 under commits that never cited the PRD. Reconciled into its evidence section on 2026-08-29. |
| PRD-229 phase 5 | **Executed.** The PRD-230 source-text gate reports 0 files. |
| PRD-230 | **Implementation complete.** Phases 1–4 are executed; only the inherited ASan-clean row remains open. |
| `src/webgpu/bindings.cpp` | 7,870 lines before the PRD-230 moves (+102 since filing). |

**Phase 5 is not busywork, and this is the measurement that proves it.** The assertion that
`frame-op-stream.test.mjs` made against `bindings.cpp` was:

```js
const replay = nativeSource.slice(
  nativeSource.indexOf("bool replayPackedFrameOpStream("),
  nativeSource.indexOf("static js::JSValueHandle", nativeSource.indexOf("bool replayPackedFrameOpStream(")),
);
expect(replay).not.toMatch(/\b[A-Za-z][A-Za-z0-9_]*\.contains\(/u);
```

Move that definition to another file — which is exactly what PRD-230 does — and `indexOf` returns
`-1`, the slice is **0 characters**, and `not.toMatch` passes on the empty string. Observed:

```text
moved 21971 chars into src/webgpu/frame_op_replay_split.cpp
  old assertion sliced 0 chars and passed = true
```

These tests do not merely red on a safe change. **They go green while the thing they protect
disappears.** Splitting `bindings.cpp` behind 27 of them is refactoring blind.

## 1. Preconditions — run these, do not assume them

```sh
# third_party/ must be present or nothing native compiles (706 MB)
test -d packages/runtime-native/third_party || pnpm native:build

pnpm --filter @threenative/runtime-native native:coverage   # expect exit 0
pnpm budgets                                                # expect exit 0
```

If `native:coverage` reports a generator conflict it now names the fix itself; the raw CMake
"does not match the generator used previously" dump is gone. Removing that directory is safe —
it is derived output — but it cannot be rebuilt without `third_party/`.

### Known reds you are inheriting, neither caused by this work

Measured 2026-08-29. Do not spend a morning re-attributing them, and do not let either hide a red
you introduce.

| Red | State |
| --- | --- |
| `packages/playtest/__tests__/generated-shooter-input.spec.ts` — `expect(report.pass).toBe(true)` | Pre-existing, unrelated to the refactor. The root suite is otherwise **2,497 passed / 1 failed**. A `console.info("PROBE-FAILED-ASSERTION:")` probe sits above the assertion; it is another lane's debugging aid, not the cause. |
| `threenative-webgpu-bindings-reentrancy-test` under `tn-linux-asan` | Real shutdown-lifetime defect, found by the sanitizer lane. Passes in `tn-linux`, SIGSEGVs under ASan. See §7.2. |
| `threenative-bindings-creation-test` under `tn-linux-asan` after Phase 5 | Dawn sampler/queue leak. PRD-230 Phase 1 proved it against the committed pre-rename source by rebuilding after mechanically reversing all 87 renames; the same sampler allocation leaked. |

`pnpm typecheck` and `pnpm lint` are exit 0. `native:coverage` and `pnpm budgets` are exit 0.

**A note on this checkout.** Other agents commit into this working tree while you are in it, and
they sweep whatever is uncommitted — including your files, under their commit message. `8ff06738`
is an instance: it carries this session's crash-handler change *and* an unrelated lane's debug
probe. Commit your own work early and often, and check `git log --oneline -1` before assuming your
edits are still uncommitted.

## 2. The pattern — already landed, copy it

The exemplar is `packages/runtime-native/tests/frame-op-stream.test.mjs`, converted on 2026-08-29.
The helper it uses is `test-support/native-definition.ts`:

```js
import { nativeDefinition } from "../../../test-support/native-definition.js";

const replay = nativeDefinition("replayPackedFrameOpStream");
expect(replay.text).not.toMatch(/\b[A-Za-z][A-Za-z0-9_]*\.contains\(/u);
```

`nativeDefinition(symbol)` walks every `.cpp/.cc/.mm/.h/.hpp` under
`packages/runtime-native/src`, finds the **definition** (a body, not a declaration), returns it
brace-matched, and **fails closed**: zero matches throw, two matches throw. It takes no path, so
moving the file changes nothing.

### The two controls, and why both are mandatory

PRD-229 Phase 5's table is explicit: *"A test that fails (a) is a text assertion wearing a
costume."*

| Control | Method | Required result | Observed on the exemplar |
| --- | --- | --- | --- |
| (a) the definition moves | cut the function out of `bindings.cpp` into a new file | **stays green** | `Tests 8 passed (8)` |
| (b) the behaviour breaks | inject `someMap.contains(42)` into the body | **reds** | `× keeps native replay compatible with the runtime's C++17 toolchains` |

Run both on every file you convert. A conversion with only (b) is not a conversion.

## 3. Phase 5 — the work, one test file per commit

### 3.1 Regenerate the inventory (it moves; do not trust this snapshot)

```sh
cd packages/runtime-native/tests && python3 - <<'PY'
import re, glob
for f in sorted(glob.glob('*.mjs')+glob.glob('*.ts')):
    t=open(f).read()
    if 'readFileSync' not in t: continue
    hits=[f"{s}x{t.count(s)}" for s in ('bindings.cpp','runtime.cpp','bindings_state.h','registration_table.cpp') if s in t]
    if hits: print(f"{f:<48} {', '.join(hits)}")
PY
```

Snapshot 2026-08-29 — **27 files** across both subjects, of which **15 block PRD-230** (Tier 1 +
Tier 2; the §3.3 gate counts exactly these). `frame-op-stream.test.mjs` is already converted and is
the worked example. Convert in this order; it is dependency order for PRD-230, not alphabetical.

**Tier 1 — the `bindings.cpp` heavyweights. PRD-230 cannot start until these are done.**

| File | References |
| --- | --- |
| `runtime-next-contract.test.mjs` | `bindings.cpp`x9, `runtime.cpp`x11 |
| `webgpu-bindings-contract.test.mjs` | `bindings.cpp`x8, `registration_table.cpp`x1 |
| `lifecycle-pause.test.mjs` | `bindings.cpp`x2, `runtime.cpp`x5 |
| `webgpu-bindings-trace.test.mjs` | `bindings.cpp`x1, `registration_table.cpp`x1 |
| `android-js-engine-native-profiling.test.mjs` | `bindings.cpp`x1, `runtime.cpp`x1, `bindings_state.h`x1 |

**Tier 2 — single `bindings.cpp` assertions, mechanical once Tier 1 sets the shape.**

`js-engine-fast-path`, `resize-attachment-invariant`, `screenshot-format`, `srgb-presentation`,
`webgpu-async-observation`, `wgpu-null-handle`, `wait-latency`, `raytracing-contract`,
`canvas-event-listener`, `audio-decode-promise`.

**Tier 3 — `runtime.cpp` only. PRD-230 does not need these; [PRD-233](./PRD-233-runtime-cpp-stops-being-the-place-everything-goes.md) does.**

`crash-handler-policy`, `timer-contract`, `embedded-js`, `scheduler-yield`,
`dom-event-constructors`, `input-multitouch`, `mobile-assets`, `android-webp-provisioning`,
`production-profile`, `ui-layer-host-contract`.

**Not a Phase 5 target:** `native-coverage.test.mjs`. Its `bindings.cpp`/`runtime.cpp` mentions are
fixture data for the coverage summarizer, not assertions about the C++. Leave it.

### 3.2 Per file, per commit

1. Read each text assertion and write down **what property it was really protecting** — a refusal
   gate, an ordering, an install-once, a toolchain constraint. If you cannot name the property, the
   assertion is cargo; delete it and say so in the commit.
2. Convert:
   - property is about **a definition's contents** (toolchain constraints, forbidden constructs) →
     `nativeDefinition(symbol)`.
   - property is about **observable behaviour** → drive the ctest executable and assert its output.
     `ctest --test-dir build/tn-linux --show-only=json-v1` lists what you can drive.
   - property is about **build configuration** (a CMake option, a standard level) → assert against
     `CMakeLists.txt`, and say in a comment why that is the right subject.
3. **Delete the text assertion in the same commit.** Never leave both.
4. Run both controls. Paste both into the commit body — red and green, per PRD-229's rule that a
   gate you did not run is not claimed.
5. `npx vitest run tests/<file>` green, then move on.

Commit message shape:

```text
test(runtime-native): convert <file> off source-text assertions (PRD-229 phase 5)

Property protected: <what it really was>.
Control (a) definition moved -> green: <pasted>
Control (b) behaviour broken -> red:   <pasted>
```

### 3.3 Phase 5 exit criterion

Not "the files were converted". PRD-229's wording: *every property Phases 7–9 could break is
asserted by a test that survives a rename and fails on a behaviour change.*

The progress gate below **exits 0 only when no file is left**, and it ignores comment lines — a
converted file legitimately still names `bindings.cpp` in the comment explaining what it used to
do, and a plain `grep` counts that as unconverted forever. Save it as `phase5.py` and run it from
`packages/runtime-native/tests`:

```python
import re, glob, sys
SUBJECTS = ('bindings.cpp', 'bindings_state.h', 'registration_table.cpp')
IGNORE = {'native-coverage.test.mjs'}   # fixture data for the coverage summarizer, not assertions
remaining = []
for f in sorted(glob.glob('*.mjs') + glob.glob('*.ts')):
    if f in IGNORE:
        continue
    code = ''.join(l for l in open(f)
                   if not l.lstrip().startswith('//') and not l.lstrip().startswith('*'))
    if 'readFileSync' not in code:
        continue
    hits = [s for s in SUBJECTS if s in code]
    if hits:
        remaining.append((f, hits))
for f, hits in remaining:
    print(f"{f:<46} {', '.join(hits)}")
print(f"\n{len(remaining)} files still read a PRD-230 subject as source text")
sys.exit(1 if remaining else 0)
```

Baseline observed 2026-08-29 after the exemplar landed: **15 files, exit 1**. Those 15 are exactly
Tier 1 + Tier 2 below. When it prints `0 files` and exits 0, Phase 5 is done for PRD-230's purposes
and §4 may start. Tier 3 is not counted by this gate — it gates PRD-233, not PRD-230.

Then update PRD-229's evidence section with the per-file control table and flip its status to
EXECUTED.
---

## 4. [PRD-233](./PRD-233-runtime-cpp-stops-being-the-place-everything-goes.md) — `runtime.cpp` stops being the place everything goes

**Start now, in parallel with §3.** Depends only on PRD-229, touches no WebGPU file, and has the
control the WebGPU side lacks: `shim-manifest.json` must come out byte-identical.

Measured 2026-08-29: `src/runtime.cpp` is **3,654 lines** with **27 `setup*` call sites**.

One surface per commit, least entangled first. For each: create `src/runtime/<surface>.cpp`
exposing one installer that takes the engine and runtime state, move the functions **verbatim**,
call it from `Runtime::initialize`, add it to `target_sources`, convert that surface's Tier 3 test
from §3.1, and delete the text assertion in the same commit.

| # | File | Why here | Existing executable test |
| --- | --- | --- | --- |
| 1 | `performance.cpp`, `process.cpp`, `url.cpp` | small, self-contained — do these first to settle the installer shape | — |
| 2 | `storage.cpp` | already has an executable test at 86.54% coverage | `local_storage_test.cpp` |
| 3 | `fetch.cpp` | ~276 lines | `fetch-shim`, `fetch-local-asset` |
| 4 | `timers.cpp` | three installers, on the hot path | `timer_delivery_test.cpp` |
| 5 | `dom_events.cpp` | ~630 lines, most entangled with lifecycle — last | — |

**Per commit, all of these:**

```sh
pnpm budgets            # shim-manifest.json byte-identical: the primary control
ctest --test-dir packages/runtime-native/build/tn-linux --output-on-failure
pnpm --filter @threenative/runtime-native native:test:asan   # see §9 on its inherited red
pnpm --filter @threenative/runtime-native native:coverage    # floors hold; runtime.cpp lines fall
```

`render.p50` within 2% — timers and the frame callback are hot-path.

**Negative control, once per commit, pasted:** delete one installer call from `initialize` →
`pnpm budgets` must fail *naming the missing globals*. If it passes, the manifest is not actually
guarding the move and the commit is not proven.

---

## 5. [PRD-235](./PRD-235-the-build-directory-matrix-is-one-documented-thing.md) — the build directory matrix is one documented thing

**Start now, in parallel.** Depends on PRD-229 phases 1–2, both landed. Lowest complexity in the
batch (3 → LOW) and the highest ratio of pain removed to work done — **this session lost time to
both traps it retires** (§11.1). Measured 2026-08-29: **12 build directories** under
`packages/runtime-native/build/`.

**Phase 1 — the matrix exists and is enforced.** New `build-matrix.json`, new
`scripts/check-build-matrix.ts`, called from `scripts/check-budgets.ts`, new
`tests/build-matrix.test.mjs`.

| Test | Assertion | Negative control (observe red, paste it) |
| --- | --- | --- |
| `should fail when a test target belongs to no configuration` | named failure | add an `add_executable` with no matrix row → red |
| `should fail when a configuration names a preset that does not exist` | named failure | rename a preset in `CMakePresets.json` → red |

Revert check: remove the call from `check-budgets.ts` → the spec asserting `pnpm budgets` runs it
reds.

**Extend the matrix with the generator.** Each row should carry its CMake generator, because the
coverage lane uses `Unix Makefiles` while every preset uses `Ninja` — the mismatch that cost this
session a rebuild. §1's guard is the point fix; the matrix is the general one.

**Phase 2 — wrappers read the matrix.** A few vitest wrappers per commit, plus
`tests/runtime-test-utils.ts`. A wrapper resolves its executable through the matrix and reports
**blocked with the reason** when that configuration was never built — never a silent skip, never a
bare "not found".

**Phase 3 — retire what is dead.** For each of the 12 directories name the PRD or lane that still
needs it; drop the unreferenced from the documented matrix. The directories themselves are
untracked, so this is a documentation delete, not an `rm`.

---

## 6. [PRD-230](./PRD-230-the-webgpu-bindings-move-one-surface-at-a-time.md) — the WebGPU bindings move, one surface at a time

**Only after §3.3 exits 0.** Measured 2026-08-29: `bindings.cpp` is **7,870 lines**, **87**
`tnWebgpuHandlerNN`, **109** `BindingsState` fields.

Land these on days the perf lane is paused — that file took 60 commits in 90 days, and 6 touched it
in the week before this runbook was written.

### 6.0 Before the first move: the perf baseline

PRD-229 Phase 6 requires it and PRD-230 cannot be judged without it. Record desktop `render.p50`
and every `TN_HOST_GAP` sub-phase (`drain`, `replay`, `present`, `gpuDrain`, `poll`, `other`) at
the current HEAD into `docs/verification/runtime-perf-state.md`, with the exact command and machine
state. **Desktop fps is not a verdict** — the Xvfb present throttle pins it; `render.p50` is.

Budget for every later phase: `render.p50` may not rise more than **2%**, and no `TN_HOST_GAP`
sub-phase may move its share by more than **2 points**. A phase that exceeds it is **reverted, not
explained**.

### 6.1 Phase 1 — the 87 handlers get their names back

One commit, `bindings.cpp` only. Each `tnWebgpuHandlerNN` takes the name of the surface and method
its `bindingTable({…})` registration row already declares — `handleGpuQueueWriteBuffer`,
`handleHtmlCanvasElementGetContext`. The mapping is derivable from that row; you are not inventing
names, you are reading them.

**The verification is the phase.** Paste this into the record:

```sh
git diff -w --word-diff       # identifier changes ONLY - no statement added, removed or reordered
```

`readability-identifier-naming` (PRD-229 Phase 4, and it is in `WarningsAsErrors`) holds the
convention. Then: every §3 behaviour test green, `ctest` green, ASan lane green, and **coverage
unchanged within noise** — a rename cannot change coverage, so a drop means something else moved.

Executed 2026-08-29: the identifier-only negative control red and final gate green; shipping
compilation and 27/27 enabled CTests passed; coverage held at total 35.70%, `src/webgpu/` 40.66%,
and `src/runtime.cpp` 39.97%; steady `render.p50` held at 1.3 / 1.2 ms. Full parity recorded web
72/0/1 and desktop 69/2/2. Mechanically reversing the 87 renames and rebuilding reproduced the
same two desktop failures (`25-camera-parented-overlay`, `61-offscreen-screenshot`), proving they
were inherited. Android recorded 0/0/73 because no device lane was available. The ASan lane kept
its two separately attributed inherited reds from the current-run bar in §1.2.

### 6.2 Phase 2 — `BindingsState` becomes cohesive sub-structs

One commit. Group the 109 fields into `ResourceRegistries`, `PresentationState`, `FrameProfiling`,
`ScreenshotCapture`, `Canvas2DComposite`; device and engine handles stay top-level. Access becomes
`state->registries.textureRegistry` and the compiler finds every site. The
`#if TN_ANDROID_JS_PROFILE` members move inside `FrameProfiling` so the struct's conditional shape
stops leaking to the top level.

**No field is added, removed, renamed in meaning, or given a different default.** Placement
changes; identity does not.

**The perf A/B is mandatory here, not optional** — struct layout is cache behaviour.

Executed 2026-08-29: the compile control red on every unmigrated flat path, then the shipping host
and all native tests built after the nested-path migration. CTest passed 27/27 enabled targets;
runtime-native held its inherited two-test red; ASan held its inherited 4/6 bar. Coverage rose to
35.76% total and 40.68% WebGPU while runtime.cpp held 39.97%. Mandatory performance passed at
steady `render.p50` 1.2 / 1.2 ms with a largest host-phase share shift of 0.078 points. A fresh
`TN_ANDROID_JS_PROFILE=ON` build passed with both Dawn and wgpu-native, and the regenerated
109,232-line census passed budgets. Full parity matched Phase 1 exactly: web 72/0/1, desktop
69/2/2 with the same two inherited failures, and Android 0/0/73 with no device lane available.

### 6.3 Phase 3 — the split, one commit per surface

Most independent first, most churned last:

| # | New translation unit | Note |
| --- | --- | --- |
| 1 | `bindings_canvas2d_composite.cpp` | ~325 lines, most self-contained — proves the pattern |
| 2 | `bindings_screenshot.cpp` | |
| 3 | `bindings_presentation.cpp` | surface acquire, sRGB bridge, present |
| 4 | `bindings_resources.cpp` | buffer/texture/view/sampler creation and registries |
| 5 | `bindings_pipelines.cpp` | shader modules, pipelines, bind groups |
| 6 | `bindings_commands.cpp` | encoder, render and compute passes |
| 7 | `bindings_frame_stream.cpp` | packed replay — `replayPackedFrameOpStream` lives here, and §2's exemplar already follows it |
| 8 | `bindings.cpp` | what remains: install tables, device/adapter, state lifecycle |

Per commit: the new TU, `bindings.cpp`, `CMakeLists.txt` (`target_sources`), the record.

Functions move **verbatim**. If a body must change to compile, the only permitted changes are a
shared header declaration or a namespace qualification — **never logic**. Review the diff as
move-only with `git diff -M --stat`; moves must dominate.

**Record the payoff per commit:** single-TU compile time, starting from the measured **16 s**. If
it is not falling, the split is not buying what the PRD claims and that belongs in the record.

Surface 1 executed 2026-08-29: the 327-line Canvas2D compositor body moved byte-for-byte into
`bindings_canvas2d_composite.cpp`. The CMake omission control red-linked at `endDawnFrame`; after
registration, shipping compilation, 27/27 enabled CTests, the inherited runtime-native and ASan
bars, and unchanged coverage all passed. The isolated TU rebuild plus archive/link measured 22.32 s
against the 17.09 s baseline, so no compile-time payoff is claimed yet. Idle steady performance
passed at `render.p50` 1.0 / 1.0 ms with a maximum required host-phase share shift of 0.217 points;
an earlier 1.5 / 1.5 ms noisy sample was rejected and is retained in the performance record. Full
parity matched Phases 1–2 exactly, and the regenerated 109,263-line census passed budgets.

Surface 2 executed 2026-08-29: screenshot accessors and the capture body moved verbatim into
`bindings_screenshot.cpp`; the only linkage change was a private shared declaration for the former
static capture function. The CMake omission control red-linked at every existing consumer, then
shipping compilation, focused screenshot tests 9/9, 27/27 enabled CTests, inherited runtime-native
and ASan bars, and increased coverage passed. The isolated TU rebuild plus archive/link fell to
5.04 s; performance passed at `render.p50` 1.0 / 1.0 ms and a maximum required host-phase share
shift of 0.264 points. Full parity matched the existing bar, and the regenerated 109,300-line
census passed budgets.

Surface 3 executed 2026-08-29: surface acquire, resize, sRGB bridge, presentation pacing and present
reporting moved verbatim into `bindings_presentation.cpp`; only cross-TU linkage and private
declarations changed. The CMake omission control red-linked at the existing callers, then shipping
compilation, focused presentation tests 47/47 and 27/27 enabled CTests passed. Runtime-native and
ASan retained their inherited bars, and coverage held the Phase 2 floors. The isolated TU rebuild
plus archive/link measured 6.05 s; performance passed at `render.p50` 1.0 / 1.0 ms and a maximum
required host-phase share shift of 0.296 points. Full parity matched the existing bar, and the
regenerated 109,370-line census passed budgets and the kill switch.

Surface 4 executed 2026-08-29: buffer, texture, texture-view and sampler creation, mapping,
accounting and registry bodies moved verbatim into `bindings_resources.cpp`; the captured-handler
templates moved verbatim into a private shared header. The CMake omission control red-linked only
at moved symbols, then shipping compilation, focused resource tests 55/55 and 27/27 enabled CTests
passed. Runtime-native and ASan retained their inherited bars, and coverage rose to 35.84% total
and 40.89% WebGPU. The isolated TU rebuild plus archive/link measured 5.83 s; performance passed at
`render.p50` 1.0 / 1.0 ms and a maximum required host-phase share shift of 0.265 points. Full parity
matched the existing bar, and the regenerated 109,445-line census passed budgets and the kill
switch.

Surface 5 executed 2026-08-29: shader modules, pipeline layouts, bind-group layouts, bind groups,
compute/render pipelines and pipeline registries moved verbatim into `bindings_pipelines.cpp`;
only six handler linkage qualifiers and private declarations changed. The CMake omission control
red-linked only at moved symbols, then shipping compilation, focused pipeline tests 47/47 and
27/27 enabled CTests passed. Runtime-native and ASan retained their inherited bars, and coverage
remained above the pre-move bar. The isolated TU rebuild plus archive/link measured 8.13 s;
performance passed at `render.p50` 1.0 / 1.0 ms and a maximum required host-phase share shift of
0.267 points. Full parity matched the existing bar, and the regenerated census recorded 109,497
lines; budgets and the kill switch passed.

Surface 6 executed 2026-08-29: render-bundle, query-set, command-encoder, render-pass and
compute-pass bodies moved verbatim into `bindings_commands.cpp`; only three handler linkage
qualifiers and private declarations changed. The CMake omission control red-linked only at moved
entry points, then shipping compilation, focused command tests 57/57 and 27/27 enabled CTests
passed. Runtime-native and ASan retained their inherited bars, and coverage held at 35.75% total
and 40.67% WebGPU. The 1,681-line TU rebuild plus archive/link measured 19.29 s, 12.9% slower than
the 17.09 s monolith baseline, so this surface claims no compile-time payoff. Performance passed at
`render.p50` 0.7 / 0.9 ms and a maximum required host-phase share shift of 1.106 points. Full
parity matched the existing bar, and the regenerated census recorded 109,553 lines; budgets and
the kill switch passed.

Surface 7 executed 2026-08-29: `PackedFrameReader` and the 374-line
`replayPackedFrameOpStream` body moved verbatim into `bindings_frame_stream.cpp`; only the upload
staging helper's linkage and a private declaration changed. The CMake omission control red-linked
only at the moved replay symbol, then shipping compilation, focused frame-stream tests 21/21 and
27/27 enabled CTests passed. Runtime-native and ASan retained their inherited bars, and coverage
held at 35.75% total and 40.67% WebGPU. The TU rebuild plus archive/link measured 8.04 s, 53.0%
faster than the 17.09 s monolith baseline. A 1.3 / 1.3 ms sample under an unrelated ~850%-CPU
SwiftShader workload was rejected; after it exited, performance passed at `render.p50` 1.2 / 1.2
ms and a maximum required host-phase share shift of 1.099 points. Full parity matched the existing
bar, and the regenerated census recorded 109,605 lines; budgets and the kill switch passed.

Surface 8 and Phase 4 executed 2026-08-29: the retained `bindings.cpp` owns state/upload lifecycle,
profiling, compatibility installers, queue/device/adapter handlers, binding tables and frame
boundaries. It is 2,937 lines, down 62.7% from 7,870, and its isolated rebuild measured 9.50 s,
44.4% below the 17.09 s baseline. Final coverage was 35.75% total, 40.67% WebGPU and 39.97%
`runtime.cpp`; final steady `render.p50` was 1.2 / 1.2 ms with a maximum required host-share shift
of 1.099 points. Parity and test bars were unchanged, and the Phase-5 source-text gate remained at
zero files. `adb devices -l` listed only `emulator-5554`, so the physical Pixel 8 lane remains open:
**no device result claimed**. The ASan-clean acceptance row also remains open on its two proven
inherited failures; no new sanitizer failure appeared.

Post-merge reconciliation executed 2026-08-29 after `main` merged at `7f84b1a4`: root tests passed
255 files / 2,549 tests, the rebuilt shipping host passed 30/30 enabled CTests, coverage measured
38.50% total / 40.67% WebGPU / 42.01% `runtime.cpp`, and ASan retained exactly its inherited 4/6
bar. Parity was unchanged at web 72/0/1, desktop 69/2/2 and Android 0/0/73; the regenerated census
was already current at 111,050 lines. The idle desktop meter passed at steady `render.p50` 1.0 /
1.2 ms with a maximum required host-share shift of 1.231 points. Typecheck passed across all 17
applicable workspace projects, and lint exited zero with no errors. The physical Pixel 8 was
reachable over Wi-Fi ADB, but the attached USB transport left it charging, so that reconciliation
did not claim the device row.

The physical-device row closed later on 2026-08-29 after USB was unplugged. The current V8 APK
(`com.threenative.game`, SHA-256
`3a743288c670c0598d754554da0969f20d124ca44959a4122ddcfd3ffcc35271`) passed the 300-frame
first proof on the Pixel 8 with a nonblank 1080x2400 screenshot. Seven kept 300-frame windows then
held **59.77–59.99 fps**, `render.p50` **4.8–5.3 ms**, and zero hitches. Pre/post doctors reported
thermal status `NONE`, 36.7 -> 38.5 °C skin, and discharging. The Android build first red-compiled
because `bindings_frame_stream.cpp` and `bindings_resources.cpp` called `wgpuDevicePoll` without
the wgpu-native extension declaration; the red contract and conditional includes landed at
`4ac7b273`, after which Android and desktop rebuilt and 30/30 enabled CTests passed. The pinned V8
artifact's separate 16 KB alignment guard remains upstream-blocked; the measured Pixel has a 4 KB
page size, so that does not invalidate this device run and is not claimed fixed.

Final gates ran at `e4b9a076`: `pnpm test` passed 255 files / 2,549 tests with one file and three
tests skipped; `pnpm typecheck` passed all 17 applicable workspace projects; and `pnpm lint` exited
zero with no errors and 452 existing warnings. Documentation links, primary-doc tests, budgets,
coverage floors, 30/30 enabled CTests, and the regenerated 111,083-line census passed. ASan stayed
exactly 4/6 on its two documented inherited Dawn failures: no new sanitizer failure appeared, and
the clean-ASan acceptance row remains open rather than being misreported green.

### 6.4 Phase 4 — re-measure and say what did not run

Coverage per subsystem after vs before. `render.p50` and `TN_HOST_GAP` shares, same command, same
machine. Single-TU compile times. `pnpm census` (generated, never retyped).

**The device row:** only a Pixel 8 run can speak to fps. If no device run happens, this PRD records
**"no device result claimed"** and stays open on that row — it does not close on desktop evidence.

---

## 7. [PRD-231](./PRD-231-the-backend-dialect-stops-leaking-into-the-binding-code.md) — the backend dialect stops leaking into the binding code

**After §6.** Moving the `#if`s before the split means moving them twice. Measured 2026-08-29:
**231** preprocessor directives in `bindings.cpp`, **140** in `context.cpp`.

**Phase 1 — the dialects build, and a gate counts the directives.** New
`scripts/check-native-dialects.ts` called from `check-budgets.ts`, new
`docs/verification/native-dialect-baseline-2026-08-28.md`. Record which build directory covers
which dialect today — `build/tn-linux` = Dawn, `build/tn-linux-wgpu` and `build/tn-android` = wgpu
— **and which dialect has no lane at all**, named rather than implied. The gate records the current
per-file directive count and fails when it rises.

| Test | Assertion | Negative control |
| --- | --- | --- |
| `check-native-dialects.spec.ts` → `should fail when a file gains preprocessor directives` | count > baseline fails | add one `#if` to a fixture → red |
| `native-dialect-lane.test.mjs` → `should name every dialect with no build lane` | unlaned dialects listed | remove the naming branch → red |

**Phase 2 — `context.cpp` stops branching.** The double-signature `onWgpuLog` becomes one function
taking a compat string type; adapter/device request, surface creation and present call compat
helpers in `include/mystral/webgpu_compat.h`. All three dialects compile; behaviour tests, `ctest`
and ASan stay green; `render.p50` within 2%; **the directive count drops and the gate's baseline is
lowered in the same commit** — a ratchet, like the coverage floors.

**Phase 3 — the per-surface files stop branching.** One `bindings_*.cpp` per commit, same
verification set each time.

---

## 8. [PRD-232](./PRD-232-profiling-is-a-component-not-a-smear.md) — profiling is a component, not a smear

**After §6 Phase 2, and after PRD-227/228.** Those two own the meters this touches and are **live**
— coordinate with them before starting; do not assume they wait for you. Measured 2026-08-29:
`TN_ANDROID_JS_PROFILE` appears in `bindings.cpp` (48), `v8_engine.cpp` (15), `bindings_state.h`
(3), `runtime.cpp` (2), `main.cpp` (1).

**Phase 1 — the meters get a test before they get a home.** Capture a real profile log from the
*current* build for a fixed scene and store it as a fixture; `tests/frame_profiler_test.cpp` drives
the emission path with known inputs and asserts the **byte-exact** line. The fixture is the
pre-refactor output, so any later phase that alters the format reds here. That is the whole point
of doing this before the move.

**Phase 2 — `FrameProfiler` takes ownership.** New `src/webgpu/frame_profiler.h/.cpp`. Counters,
phase timings and emission move verbatim. **Flag-off builds must contain no profiling code, and
that is verified by symbol absence, not by reading** — `nm` the binary. `render.p50` within 2%
measured with profiling both on *and* off.

**Phase 3 — the Android meter.** A Pixel 8 run comparing profile output before and after, or the
PRD records **"no device result claimed"** and stays open on that row.

---

## 9. Gates — all of these, every commit

```sh
pnpm typecheck && pnpm lint
pnpm test
pnpm --filter @threenative/runtime-native native:coverage
pnpm budgets
ctest --test-dir packages/runtime-native/build/tn-linux --output-on-failure
pnpm --filter @threenative/runtime-native native:test:asan
```

A red in `packages/runtime-native` aborts the root suite before ~2,463 root tests run, so never
read a green root suite as proof while that package is failing.

**Two gates do not currently reach zero failures. Waiting for them to will stall you forever.**
Judge by the named baseline instead:

| Gate | Bar |
| --- | --- |
| `pnpm test` | `Tests 1 failed | 2497 passed (2498)` — the one failure is the shooter capture named in §1. Anything else is yours. |
| `native:test:asan` | Current post-Phase-5 bar is `67% tests passed, 2 tests failed out of 6` — the shutdown SEGV in §11.2 plus the binding-creation Dawn leak named in §1. A **third** failure is yours. |

---

## 10. What fails this work

- A converted test that passes control (b) but not (a). It is the old assertion in new syntax.
- Claiming a phase green without pasting the control output.
- Splitting `bindings.cpp` while any Tier 1 file still reads it as text.
- Letting `render.p50` rise past 2% and writing a justification instead of reverting.
- Moving a `#if` before the surface it lives in has moved — you will move it twice.
- Landing PRD-232 without talking to the PRD-227/228 lanes first.
- Building a shared abstraction because the work looks repetitive. **PRD-234 died exactly there**:
  690 library lines to carry 60 lines of duplication, every caller keeping its own helper and
  gaining an adapter. See
  [the kill-switch record](../../../verification/native-scripts-adb-kill-switch-2026-08-28.md).

---

## 11. The rest of the folder

### 11.1 [PRD-234](../PRD-234-the-scripts-tier-has-one-device-library.md) — do not revive it

Executed, measured, rejected, reverted. `docs/PRDs/done/`. Read §10's last bullet before proposing
anything shaped like it.

Its two directory traps are also why §5 (PRD-235) is worth doing early — both cost this session
real time: `build/tn-linux-coverage` configured by Ninja while the coverage lane wants
`Unix Makefiles` and CMake named no fix; and `third_party/` absent, so a missing toolchain read as
a stale coverage digest.

### 11.2 PRD-177 and PRD-184 — attemptable, unproven

Parked under `BLOCKED/requires-asan-libuv-source-build` because ASan could not see inside the
prebuilt `libuv.a`. **All three prerequisites now exist**: the ASan lane (`1e530c4a`), libuv built
from source (2026-08-29), and — the one nobody had noticed was missing — a lane that can actually
report what it catches.

The crash handler used to `_exit(1)` on SIGSEGV before AddressSanitizer's handler ran, so the lane's
entire output was `[Mystral] Caught signal SIGSEGV, exiting gracefully`.
`CrashHandlerPolicy::LeaveToSanitizer` stands it down. The lane then immediately named:

```text
SUMMARY: AddressSanitizer: SEGV in dawn::RefCounted::Release()
    #9  mystral::RuntimeImpl::~RuntimeImpl()  src/runtime.cpp:349
    #12 main  tests/webgpu_bindings_reentrancy_test.cpp:1806
```

A Dawn ref-counted object released during teardown after its owner is gone — **a
shutdown-ownership defect, which is PRD-184's subject.** Full record:
[asan-shutdown-segv-2026-08-29](../../../verification/asan-shutdown-segv-2026-08-29.md).

Neither PRD is proven; nobody has run their negative controls. Red-green this defect first, in its
own fix commit, then attempt them and `git mv` them into this batch **on the strength of a result,
never a plan**.
