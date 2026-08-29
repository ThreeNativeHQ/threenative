---
prd_contract: v1
---

# EXECUTE — PRD-229 Phase 5, then PRD-230

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

Snapshot 2026-08-29 — **27 files**. Convert in this order; it is dependency order for PRD-230, not
alphabetical.

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
asserted by a test that survives a rename and fails on a behaviour change.* Concretely:

```sh
# must return nothing for bindings.cpp, bindings_state.h and registration_table.cpp
cd packages/runtime-native/tests && grep -l 'readFileSync' *.mjs *.ts \
  | xargs grep -l 'bindings\.cpp\|bindings_state\.h\|registration_table\.cpp' \
  | grep -v native-coverage.test.mjs
```

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

## 6. What fails this work

- A converted test that passes control (b) but not (a). It is the old assertion in new syntax.
- Claiming a phase green without pasting the control output.
- Splitting `bindings.cpp` while any Tier 1 file still reads it as text.
- Letting `render.p50` rise past 2% and writing a justification instead of reverting.
- Building a shared abstraction because the conversions look repetitive. **PRD-234 died exactly
  there**: 690 library lines to carry 60 lines of duplication, every caller keeping its own helper
  and gaining an adapter. See
  [the kill-switch record](../../verification/native-scripts-adb-kill-switch-2026-08-28.md).
