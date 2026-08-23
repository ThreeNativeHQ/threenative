# Desktop mailbox SIGSEGV — native repair and proof

Date: 2026-08-22
Lane: `lane-native` (PRD-167 criterion 3; repairs [desktop-mailbox-2026-08-22.md](desktop-mailbox-2026-08-22.md)'s named cause)
Status: **REPAIRED — deterministic C++ red/green/mutation + ten consecutive clean desktop runs**

## Root cause — corrected from the origin record

The origin record named "a re-entrant V8 property store" in `dispatchConstructedEvent`. Re-entry
itself is not the defect — calling `v8::Object::Set` from inside a `FunctionCallback` is what every
DOM binding does. The defect is **use-after-free of frame-handle persistents captured by value**:

- `packages/runtime-native/src/js/v8_engine.cpp:347-355` (`getGlobal`) and `:432-440`
  (`newObject`) register their fresh `v8::Persistent*` in `frameHandles_`.
- `packages/runtime-native/src/js/v8_engine.cpp:874-889`: `clearFrameHandles()` deletes every
  persistent in that set unless it is protected.
- `packages/runtime-native/src/runtime.cpp:930`: every frame ends with `clearFrameHandles()`.
- `setupDOMEvents()` captured three such handles by value into lambdas that must outlive the
  creating frame — the `dispatchEvent` bindings at `runtime.cpp:3659` (canvas), `:3804` (document)
  and `:3991` (window). Canvas is kept alive by `canvasElement_` + `protect()`
  (`runtime.cpp:3758-3759`); **document and window were never protected**, so their backing
  persistents were freed at the end of the first frame.
- From frame 2 onward, `dispatchConstructedEvent` (`runtime.cpp:4569-4571`) passed the dangling
  handle to `setProperty`; `valPersistent->Get(isolate_)` read freed memory and the garbage or
  recycled value flowed into `v8::Object::Set` → SIGSEGV inside
  `v8::internal::UpdateDescriptorForValue`, matching the gdb stack in the origin record.

Intermittency explained: whether the freed slot still reads as the (usually still-alive) global
proxy, as an unrelated value, or as garbage depends on heap reuse and GC timing between frames.
When it reads as an unrelated value the dispatch silently corrupts `event.target` instead of
crashing — same defect, quieter symptom.

## Red — reproduction on today's tree

Uninstrumented CLI runs against the pre-fix host binary, 2026-08-22. Nine runs exited 1 on the
brand-icon stderr noise alone; run 10 hit the crash:

```text
run1 exit=1 ... run9 exit=1
run10 exit=2
```

```text
"code": "TN_PLAYTEST_HOST_EXITED",
"message": "Device mailbox operation '5' exceeded 5000ms.; the host process has exited — last host
output: [Mystral] Starting main loop... | ... | [Mystral] Caught signal SIGSEGV, exiting gracefully"
```

## Deterministic red/green/mutation — direct C++ test

New `tests/dom_dispatch_lifetime_test.cpp` (registered in `CMakeLists.txt` beside
`threenative-audio-graph-test`): create a noSdl runtime, register window/document listeners,
cross one `pollEvents()` boundary (which ends in `clearFrameHandles()`), then dispatch and assert
`event.target`/`event.currentTarget` identity for both targets. Identity checks run inside the
script; failure logs its name and exits via `process.exit(1)`.

Red (fix reverted / pre-fix source):

```text
$ ./build/tn-linux/threenative-dom-dispatch-lifetime-test ; echo exit=$?
[error] [dom-dispatch-lifetime] event.target is not window; event.currentTarget is not window;
event.target is not document; event.currentTarget is not document
[Mystral] process.exit(1) called
FAILED: identity checks after the frame boundary, exit 1
exit=1
```

Green (fix applied):

```text
$ ./build/tn-linux/threenative-dom-dispatch-lifetime-test ; echo exit=$?
[dom-dispatch-lifetime] window and document dispatch survived clearFrameHandles
exit=0
```

Mutation proof — reverting exactly the two named lines (`jsEngine_->protect(document)`,
`jsEngine_->protect(window)`) reproduces the red verbatim (exit=1, all four identity checks);
restoring them returns green (exit=0).

## The repair

`packages/runtime-native/src/runtime.cpp`, two lines plus comments:

- document handle: `jsEngine_->protect(document)` at creation (`:3772`).
- window handle: `jsEngine_->protect(window)` at creation (`:3966`).

Both reuse the existing protection mechanism exactly as listener callbacks already do
(`runtime.cpp:3641`, `:3976`). No second mechanism invented.

Second, required by criterion 3's definition of pass: `platform/window.cpp:52` printed an
informational degradation ("Brand icon unavailable … using compositor default") to **stderr**,
which the playtest runner classifies as a console error (`runner/desktop.ts:167`), failing every
icon-less desktop run regardless of the segfault. Absent-icon degradation moved to stdout; real
icon failures (undecodable staged asset, SDL_SetWindowIcon failure) stay on stderr. The message
still reports — it no longer reports as an error.

## Criterion 3 gate — ten consecutive clean desktop runs

Command, ten times:

```sh
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
  --project examples/prd162-replay \
  --scenario playtests/replay-desktop.playtest.json \
  --target desktop \
  --executable dist-native/prd162-replay \
  --timeout 30000
```

Result, all ten logs under `/tmp/prd167-lane-native/gate/`:

```text
gate run1 exit=0
gate run2 exit=0
gate run3 exit=0
gate run4 exit=0
gate run5 exit=0
gate run6 exit=0
gate run7 exit=0
gate run8 exit=0
gate run9 exit=0
gate run10 exit=0
```

Every run: `"pass": true`, `[PRD162] replay-consumed … stateHash=1884960806` (expected hash),
zero `SIGSEGV`/`HOST_EXITED`/console-error markers, zero `"type": "error"` console entries. The
brand-icon line still appears — as a log, not an error. No passing run emitted a stall or
host-exit diagnostic.

## Scoped gates

```text
cmake --build build/tn-linux --target threenative-dom-dispatch-lifetime-test   # green
./build/tn-linux/threenative-dom-dispatch-lifetime-test                        # exit 0
pnpm census                                                                    # re-tied in commit
```

Full `pnpm typecheck && lint && test` remains the coordinator wave (PRD-167 criterion 4).
