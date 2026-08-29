---
prd_contract: v1
---

# EXECUTE — the runtime-native refactor batch, in order

Covers all seven PRDs. §3 and §4 are the critical path (PRD-229 Phase 5, then PRD-230); §7 carries
the rest of the batch, which is gated behind them or runs beside them.

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

## 4. PRD-230 — only after §3.3 returns nothing

Read PRD-230 for the full design. The execution constraints that matter:

1. **Baseline perf before the first move**, per PRD-229 Phase 6: desktop `render.p50` and the
   `TN_HOST_GAP` sub-phases, recorded with the exact command into
   `docs/verification/runtime-perf-state.md`. Budget: `render.p50` may not rise more than 2%, no
   sub-phase share may move more than 2 points. **Exceeding it reverts the phase — it does not get
   explained.** Desktop fps is not a verdict; the Xvfb present throttle pins it.
2. **One surface per commit.** `bindings.cpp` took 60 commits in 90 days from the perf lane; land
   these on days that lane is paused, or you will spend the batch in conflicts.
3. **Name the 87 `tnWebgpuHandlerNN` after what they bind** before moving them. An agent grepping
   `GPUQueue.writeBuffer` finds nothing today; that is the whole point of the PRD.
4. After each commit: `pnpm --filter @threenative/runtime-native native:coverage` and check the
   per-subsystem floor for `src/webgpu/` (33.82%) has not dropped. `pnpm budgets` owns it.

## 5. Gates — all of these, every commit

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter @threenative/runtime-native native:coverage
pnpm budgets
```

A red in `packages/runtime-native` aborts the root suite before ~2,463 root tests run, so never
read a green root suite as proof while that package is failing.

`pnpm test` does **not** currently reach zero failures, and waiting for it to will stall you
forever. The bar for this work is: **2,497 passed, and the only failure is the inherited one named
in §1.** Anything else is yours. Check it explicitly rather than reading the exit code:

```sh
pnpm test 2>&1 | tail -5      # expect: Tests  1 failed | 2497 passed (2498)
```

The one inherited failure is `generated-shooter-input.spec.ts` with
`TN_CAPTURE_BLANK: bright pixel ratio 0.04470 is below 0.05` — the shooter template's visual
capture, a render/threshold question owned by the templates lane and untouched by this batch. It
has drifted (0.01987 on 2026-08-27, 0.04470 on 2026-08-29) and sits just under the floor, so treat
a *different* ratio as movement in that lane rather than as something you broke.

## 6. What fails this work

- A converted test that passes control (b) but not (a). It is the old assertion in new syntax.
- Claiming a phase green without pasting the control output.
- Splitting `bindings.cpp` while any Tier 1 file still reads it as text.
- Letting `render.p50` rise past 2% and writing a justification instead of reverting.
- Building a shared abstraction because the conversions look repetitive. **PRD-234 died exactly
  there**: 690 library lines to carry 60 lines of duplication, every caller keeping its own helper
  and gaining an adapter. See
  [the kill-switch record](../../verification/native-scripts-adb-kill-switch-2026-08-28.md).

## 7. The rest of the batch

The batch [README](./README.md) fixes the order and the reasons; this is the execution view. Only
PRD-233 and PRD-235 can start before PRD-230 — everything else waits.

| PRD | Runs when | What it needs from this file |
| --- | --- | --- |
| [233](./PRD-233-runtime-cpp-stops-being-the-place-everything-goes.md) — `runtime.cpp`'s thirteen `setup*` shims move to files named after what they shim | **In parallel, now.** Depends on PRD-229 only, and touches different files from 230. | Its Tier 3 conversions (§3.1). It already has an enforced control the WebGPU side lacks: `shim-manifest.json`. |
| [235](./PRD-235-the-build-directory-matrix-is-one-documented-thing.md) — the nine build directories get one enforced manifest | **In parallel, now.** Depends on PRD-229 phases 1–2, both landed. | Nothing. Lowest complexity in the batch (3 → LOW) and it retires a real trap — see §7.1. |
| [230](./PRD-230-the-webgpu-bindings-move-one-surface-at-a-time.md) — `bindings.cpp` splits, the 87 `tnWebgpuHandlerNN` get real names | After §3.3 exits 0. | Everything in §3 and §4. |
| [231](./PRD-231-the-backend-dialect-stops-leaking-into-the-binding-code.md) — 339 dialect `#if`s leave the binding logic for `webgpu_compat.h` | After 230. | The split must land first or the `#if`s move twice. |
| [232](./PRD-232-profiling-is-a-component-not-a-smear.md) — `TN_ANDROID_JS_PROFILE`'s 64 sites become one `FrameProfiler` | After 230 phase 2, **and** after PRD-227/228. | Those two own the meters it touches and are live. Coordinate before starting; do not assume they wait for you. |
| [234](../done/PRD-234-the-scripts-tier-has-one-device-library.md) — one device library for the scripts tier | **Never.** Executed, measured, rejected, reverted. | Read §6's last bullet before proposing anything shaped like it. |

### 7.1 PRD-235 is worth doing early, and this session proved why

Its thesis is that an unbuildable target should not look like an unrun one. Two directory traps
cost real time on 2026-08-29 and are exactly what its manifest would have named:

- `build/tn-linux-coverage` was configured by Ninja while the coverage lane wants `Unix Makefiles`,
  and CMake's error named no fix. §1 now handles it, but the manifest is the general answer.
- `third_party/` was absent, so nothing native compiled and `pnpm budgets` read as a stale digest
  rather than as a missing toolchain. `pnpm native:build` restores it (706 MB).

### 7.2 Two PRDs outside the batch that this work unblocks

[PRD-177](../BLOCKED/requires-asan-libuv-source-build/PRD-177-native-restart-shutdown-lifetime.md)
and
[PRD-184](../BLOCKED/requires-asan-libuv-source-build/PRD-184-native-shutdown-ownership-transfer.md)
were parked because ASan could not see inside the prebuilt `libuv.a`. **That blocker was removed on
2026-08-29**: the sanitizer configuration now builds libuv 1.51.0 from source
(`build/tn-linux-asan/libuv-src/libuv.a`).

They are **attemptable, not proven**. Nobody has run their negative controls. Attempt, record what
happened, and `git mv` them into this batch only on the strength of a result — never on a plan.

A third blocker was removed on the way: **the lane could not report what it caught.** The desktop
crash-handler policy installed a SIGSEGV handler that `_exit(1)`s, so ASan's own handler never ran
and the lane's entire output was `[Mystral] Caught signal SIGSEGV, exiting gracefully`.
`CrashHandlerPolicy::LeaveToSanitizer` now stands the handler down under `__SANITIZE_ADDRESS__`.

With that fixed the lane immediately named the defect:

```text
SUMMARY: AddressSanitizer: SEGV in dawn::RefCounted::Release()
    #9  mystral::RuntimeImpl::~RuntimeImpl()  src/runtime.cpp:349
    #12 main  tests/webgpu_bindings_reentrancy_test.cpp:1806
```

A Dawn ref-counted object released during runtime teardown after its owner is gone — a
shutdown-ownership defect, which is PRD-184's subject. Full record and reproduction:
[asan-shutdown-segv-2026-08-29](../../verification/asan-shutdown-segv-2026-08-29.md).

**Red-green this before calling either PRD done, and give it its own fix commit** rather than
folding it into a refactor.
