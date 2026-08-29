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
| PRD-229 phase 5 | **The only open phase.** 27 test files still read C++ source as text. |
| PRD-230 | Blocked on phase 5, and on nothing else. |
| `src/webgpu/bindings.cpp` | 7,870 lines, still growing (+102 since filing). |

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

### 6.2 Phase 2 — `BindingsState` becomes cohesive sub-structs

One commit. Group the 109 fields into `ResourceRegistries`, `PresentationState`, `FrameProfiling`,
`ScreenshotCapture`, `Canvas2DComposite`; device and engine handles stay top-level. Access becomes
`state->registries.textureRegistry` and the compiler finds every site. The
`#if TN_ANDROID_JS_PROFILE` members move inside `FrameProfiling` so the struct's conditional shape
stops leaking to the top level.

**No field is added, removed, renamed in meaning, or given a different default.** Placement
changes; identity does not.

**The perf A/B is mandatory here, not optional** — struct layout is cache behaviour.

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
| `native:test:asan` | `83% tests passed, 1 tests failed out of 6` — the failure is the shutdown SEGV in §11.2. A **second** failure is yours. |

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
  [the kill-switch record](../../verification/native-scripts-adb-kill-switch-2026-08-28.md).

---

## 11. The rest of the folder

### 11.1 [PRD-234](../done/PRD-234-the-scripts-tier-has-one-device-library.md) — do not revive it

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
[asan-shutdown-segv-2026-08-29](../../verification/asan-shutdown-segv-2026-08-29.md).

Neither PRD is proven; nobody has run their negative controls. Red-green this defect first, in its
own fix commit, then attempt them and `git mv` them into this batch **on the strength of a result,
never a plan**.
