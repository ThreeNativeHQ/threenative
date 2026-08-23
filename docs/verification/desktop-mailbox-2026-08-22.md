# Desktop mailbox silence — reproduction and diagnosis

Date: 2026-08-22
Lane: `lane-desktop` (PRD-167)
Status: **CLOSED — repaired by `25b5a194`, criterion 3 proved ten-for-ten**

## Summary

The desktop playtest flake filed as PRD-167 reproduces on today's tree. With the frame pump
observed, every observed instance of the silence is the **native host process dying** — not an
idle-but-alive application. The named cause is a re-entrant V8 property store inside the host's
DOM-event dispatch seam:

- `packages/runtime-native/src/runtime.cpp:4569-4571` (and `4586-4587`):
  `RuntimeImpl::dispatchConstructedEvent` calls `jsEngine_->setProperty(event, "target"/"currentTarget"/"eventPhase", ...)`
  from inside a JS-invoked native callback (`window.dispatchEvent`, bound at
  `packages/runtime-native/src/runtime.cpp:3990-3992`; same pattern at `3658` canvas, `3803` document).
- `packages/runtime-native/src/js/v8_engine.cpp:738`: `V8Engine::setProperty` re-enters V8
  (`v8::Object::Set`) while JS is already executing on the stack; V8 dies in
  `v8::internal::UpdateDescriptorForValue`.

The trigger sequence is the PRD-162 scenario itself: `input.keyDown KeyP` is answered, the game's
`setTimeout(0)` replay callback runs `createReplayDriver(...)`, whose first action is
`target.dispatchEvent(new Event("blur"))` on `globalThis`
(`packages/core/src/replay.ts:176`) — a JS→native→V8 re-entry that intermittently segfaults the
host. Once the process is gone, nothing reads the request file, the runner waits out its
5-second operation timeout, and the mailbox has "gone silent".

## Correction to the origin record

[phase-2-2026-08-20.md](phase-2-2026-08-20.md) inferred "the application was alive" in failing
runs from `[PRD162] replay-consumed ...` being present in the captured console. That line proves
only that the replay executed before death; liveness was never checked (`isAlive()` runs only on
the success path). Today's failures die *before* logging `replay-consumed`. Both generations are
consistent with one defect whose crash point moved with the rebuilt host binary.

## Reproduction

Environment note: `examples/prd162-replay/node_modules` resolves `@threenative/*` from installed
tarballs under `node_modules/.pnpm/`; those copies were stale published builds without PRD-162's
`portable` recording support (first baseline run failed `TN_REPLAY_INVALID: unknown key
'portable'`). All batches below ran after repacking current workspace builds into those store
copies. Note also that the example's desktop bundle takes `@threenative/playtest` code from
**core's bundled dist** (`packages/core/dist/playtest.js` inlines it), so app-side changes require
rebuilding core before they reach the game.

Baseline (no instrumentation), four consecutive CLI runs of
`examples/prd162-replay/playtests/replay-desktop.playtest.json --target desktop`:
4× exit 1, all reaching assertions with `resource.state.stateHash` **pass**
(`1884960806`) but failing console-diagnostics policy on a host-emitted
`[Window] Brand icon unavailable...` error line — host-binary drift vs Aug 20, unrelated to the
mailbox. No timeout in this batch.

Instrumented batches (app-side poll/receive/respond/heartbeat logs; standalone driver mirroring
the CLI operation sequence): 1/6 + 1/6 + 1/8 timeouts, always

```text
Device mailbox operation '5' exceeded 5000ms.
```

with op ids `1=describe 2=ready 3=sample 4=input.keyDown 5=advance(2)`.

Failing-run trace (run e7), complete mailbox activity after `respond id=4`:

```text
[PRD167] receive id=4 method=input.keyDown raf-polls=13 t=1787434216440
[PRD167] respond id=4 ok=true raf-polls=13 t=1787434216440
error | [Mystral] Caught signal SIGSEGV, exiting gracefully
```

No further poll fires; request 5 is never received; heartbeats stop with the process.
Passing runs answer all ten operations within ~400 ms of app time.

## Named cause — gdb evidence

Running the same driver with the host under `gdb -batch` (crash rate made it a ~1-in-8 event):

```text
Thread 1 "prd162-replay" received signal SIGSEGV, Segmentation fault.
 #0 v8::internal::(anonymous namespace)::UpdateDescriptorForValue(...)
 #1 v8::internal::LookupIterator::PrepareForDataProperty(...)
 #2 v8::internal::Object::SetDataProperty(...)
 ...
 #7 v8::Object::Set(...)
 #8 mystral::js::V8Engine::setProperty(...)                     [js/v8_engine.cpp]
 #9 mystral::RuntimeImpl::dispatchConstructedEvent(...)         [runtime.cpp]
 #10 mystral::RuntimeImpl::setupDOMEvents() lambda              [runtime.cpp dispatchEvent binding]
 #11 mystral::js::V8Engine::nativeCallback(...)                [invoked from executing JS]
 #12 Builtins_CallApiCallbackGeneric
```

A JS→native callback that re-enters V8 through `v8::Object::Set` mid-execution crashes inside
V8's map-transition machinery. Instrumentation is exonerated: the identical timeout+SIGSEGV
reproduced on a bundle built before any probe existed (run d1).

## Criteria status (PRD-167)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Cause named at `file:line`, frame pump observed | **Met** — see above; polls/heartbeats observed stopping exactly at process death |
| 2 | Mailbox reports a named diagnostic instead of going silent | **Met** — red/green below, proved end-to-end through the CLI |
| 3 | Ten consecutive clean desktop runs | **Met** — ten-for-ten after `25b5a194` and a regenerated fixture (below) |
| 4 | Full `pnpm typecheck && lint && pnpm test` | Coordinator wave; scoped gates green (below) |

## Root cause, corrected by the repair

This record first read the crash as a re-entry hazard in `setProperty`. Lane-native's
`25b5a194` corrected the mechanism: **use-after-free**. `setupDOMEvents` captured the document
and window v8 handles by value into the `dispatchEvent` lambdas without `protect()`; their
backing persistents lived in `frameHandles_`, which `clearFrameHandles()` frees at end of frame —
so from frame two on, every dispatch constructed events from freed memory. Whether that surfaced
as an intermittent SIGSEGV inside `UpdateDescriptorForValue` or as silent `event.target`
corruption depended on heap reuse. The fix protects both handles the way the existing mechanism
listener already protected canvas, with a deterministic C++ mutation proof in
`tests/dom_dispatch_lifetime_test.cpp`. The gdb stack above is unchanged as evidence; only its
interpretation changes.

## Criterion 3 — ten for ten after the repair

Two findings had to be handled first:

1. The brand-icon host line was moved to stdout (`abaae6d5` wave), so icon-less runs no longer
   exit 1 under console-error classification. That removes the noise behind this record's earlier
   "6× exit 1" distribution.
2. Regenerating the fixture was required: core's `CORE_VERSION` now comes from
   `packages/core/src/version.ts` (generated from package.json, `"0.2.0"`), while
   `examples/prd162-replay/src/browser-recording.ts` still embedded `"core": "0.1.0"` from its
   original capture. Fail-closed validation rejected it on every run with
   `TN_REPLAY_RUNTIME_MISMATCH` — ten runs, ten identical assertion failures, zero crashes,
   before the refresh. The recording was regenerated against the current build with
   `capture-browser-recording.mjs`; seed, step, inputs and ticks are unchanged, so the asserted
   `stateHash = 1884960806` is untouched; only the embedded agent/core header and sha256 moved.

Ten consecutive CLI runs of `replay-desktop.playtest.json --target desktop` against the rebuilt
host and bundle, back to back with nothing else running:

```text
ten1  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten2  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten3  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten4  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten5  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten6  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten7  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten8  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten9  EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
ten10 EXIT=0 pass:true replay-consumed ... stateHash=1884960806 codes=[]
```

Every run reached `[PRD162] replay-consumed source=browser fingerprint=... stateHash=1884960806`;
no run emitted a timeout, stall, or host-exit diagnostic. Logs: `/tmp/prd167/ten*.log`.

## Criterion 2 — red/green

Red (`pnpm vitest run packages/playtest/__tests__/mailbox-silence.spec.ts` against HEAD):

```text
 Tests  4 failed | 1 passed (5)
 FAIL ... > a stopped frame pump is reported as a named stall diagnostic while timers still run
 AssertionError: expected [] to have a length of 1 but got +0
 FAIL ... deviceTimeoutDiagnostic is not a function
```

Green (same command after the fix):

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

What ships:

- App side (`packages/playtest/src/three/device.ts`): a timer-driven watchdog on the native
  mailbox poll emits `TN_PLAYTEST_MAILBOX_POLL_STALLED` when requestAnimationFrame has not
  serviced the poll for 2000 ms while timers still fire — the PRD §2 hypothesis made observable.
- Runner side (`packages/playtest/src/runner/deviceTransport.ts`,
  `packages/playtest/src/runner/androidRunner.ts`): when an operation times out, the runner now
  probes `driver.isAlive()`. Dead host → `TN_PLAYTEST_HOST_EXITED` carrying the last console
  lines (a SIGSEGV can no longer hide behind a generic timeout); live host → the existing
  `TN_PLAYTEST_OPERATION_TIMEOUT`.
- New codes registered in `packages/playtest/src/diagnostics.ts`.

## Scoped gates

```sh
cd packages/playtest && pnpm run typecheck   # exit 0
pnpm exec biome check <five edited files>    # warnings only; all remaining are pre-existing
                                             # patterns of this package (biome excludes it)
pnpm vitest run packages/playtest/__tests__/mailbox-silence.spec.ts \
  packages/playtest/__tests__/device-transport.spec.ts \
  packages/playtest/__tests__/desktop-playtest.spec.ts \
  packages/playtest/__tests__/device-playtest.spec.ts
# Test Files 4 passed, Tests 35 passed
```

## Criterion 2 end-to-end — the named diagnostic in a real CLI run

After rebuilding the chain (playtest dist → core dist → example bundle), the first two CLI runs
that hit the flake now report:

```text
"code": "TN_PLAYTEST_HOST_EXITED",
"message": "Device mailbox operation '5' exceeded 5000ms.; the host process has exited — last host
output: [Mystral] Starting main loop... | ... | [Mystral] Caught signal SIGSEGV, exiting gracefully"
```

Final distribution, eight consecutive CLI runs with the fix shipped
(`/tmp/prd167/final*.log`): 6× exit 1 — full protocol, `replay-consumed ... stateHash=1884960806`
every time, failing only the pre-existing host brand-icon console-diagnostics noise — and 2×
exit 2 `TN_PLAYTEST_HOST_EXITED`. No passing run emitted a stall or host-exit diagnostic; the
watchdog has no false positives on healthy runs.

## Repair attribution

The native repair is `25b5a194` (lane-native, Assignment 1): protect the document/window handles
captured by `setupDOMEvents`'s dispatch lambdas, plus `tests/dom_dispatch_lifetime_test.cpp` as
the deterministic mutation proof. The diagnostic shipped under criterion 2 stays: a future
silence must still name itself, whether the host dies (`TN_PLAYTEST_HOST_EXITED`), stalls its
frame pump (`TN_PLAYTEST_MAILBOX_POLL_STALLED`), or merely stops answering
(`TN_PLAYTEST_OPERATION_TIMEOUT`).
