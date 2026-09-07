# PRD-359 Task 2b-signal — writable abort signal — 2026-09-05

This bounded prerequisite exposes the standard
`WritableStreamDefaultController.signal` in the installed native Streams shim.
It lets the later WebTransport sink cancel a capacity wait while retaining the
standard writer ordering: signal abort synchronously, then wait for the active
sink operation and settle `abort()`/`closed` in the normal lifecycle.

## Scope and files

| File | State |
| --- | --- |
| `packages/runtime-native/src/runtime-scripts/streams-polyfill.js` | modified |
| `packages/runtime-native/tests/streams-shim.test.mjs` | modified |
| `packages/runtime-native/tests/runtime-next-contract.test.mjs` | hash literal refreshed |
| `packages/runtime-native/tests/webtransport_surface_test.cpp` | modified |
| `packages/runtime-native/docs/G1-desktop-host.md` | updated |

The only additional file is this evidence record. No fetch shim, WebTransport
polyfill, native transport source, execution plan, manifest or unrelated test
was changed. The existing `AbortController` installed by `fetch-polyfill.js`
is reused; no new global is introduced.

## Reference behavior

The WHATWG algorithm first resolves a terminal closed/errored stream, signals
the controller abort signal, re-reads state because signaling runs author code,
then returns an existing pending abort request or creates one. The implementation
follows that order from [WritableStreamAbort](https://streams.spec.whatwg.org/#writable-stream-abort).

The read-only Node reference is `/tmp/prd359-signal-node-reference.log`.
It recorded a stable signal object, synchronous signal delivery, reason identity,
held-write signal rejection, abort/closed settlement, and terminal repeat abort
resolution. Node 20.19.6's reentrant `controller.error()` probe threw an internal
assertion and is not used as a passing result. The real Chromium 151.0.7922.34
reference is recorded in `artifacts/networking-359/task2b-integration-decisions.md`
: with a held start, a signal
listener calling `controller.error(listenerError)` produced
`abort='listener-error'`, `closed='listener-error'`,
`signal.reason='requested'`, `events=['signal']`, and no `sink.abort` call. A
separate browser probe (`/tmp/prd359-signal-root-browser-erroring.log`)
confirmed that erroring still fires the signal, while a truly settled errored
stream resolves a later abort without signaling. Node 20 differs on the former
case and is not the reference for it. The nested-abort browser probe is
`/tmp/prd359-signal-root-browser-nested.log`; the shim preserves its same-promise,
outer-reason and inner-sink-abort behavior.

## Red — tests before implementation

The new tests were added before the source change and exercised the existing
surface, so the failures were behavioral rather than a missing-symbol build
failure.

### Shim behavior

Command:

```sh
pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
  tests/streams-shim.test.mjs
```

`/tmp/prd359-signal-red-shim.log`, exit 1:

```text
Test Files  1 failed (1)
Tests  4 failed | 19 passed (23)
```

One of those four failures was an incorrect Node-reference expectation in the
new terminal test, not an implementation regression; it was corrected to await
full error settlement. Only the other three are behavioral red evidence. The
corrected no-signal mutation below independently reproduces three failures.

The old shim had no controller signal, did not synchronously notify a held
write, did not re-read state after a signal listener, and returned a rejected
cached abort promise on a later terminal repeat.

### Native surface

The surface target compiled successfully with the new asynchronous assertion.
Before the source repair, `/tmp/prd359-signal-red-native-surface.log` exited 1
and reported:

```text
[log] stream surface: ... signal-sync=false signal-write=resolved
      signal-abort=resolved signal-closed=reason signal-events=abort
webtransport surface contract failed with exit 1
```

The hash contract also went red after changing the shipped script, as required:
`/tmp/prd359-signal-hash-red.log` reported the old literal versus the computed
`7a5665317d6649275a6fd26e26789e5fc3014b427c051d7692cd2b26e76b08f3`.

## Green — focused proof

After the source repair, the shim and bootstrap contracts passed:

```text
`/tmp/prd359-signal-green-shim.log`
Test Files  1 passed (1)
Tests  23 passed (23)

`/tmp/prd359-signal-green-contract.log`
Test Files  1 passed (1)
Tests  29 passed | 2 skipped (31)
```

The native V8 targets rebuilt successfully:

```sh
cmake --build packages/runtime-native/build/tn-linux \
  --target threenative-webtransport-surface-test \
  threenative-webtransport-wire-test -j4
ctest --test-dir packages/runtime-native/build/tn-linux \
  -R 'webtransport-(wire|surface)' --output-on-failure
```

Build output is `/tmp/prd359-signal-green-native-build.log`, and CTest output
is `/tmp/prd359-signal-green-ctest.log`:

```text
1/2 Test #1: threenative-webtransport-wire-test ......   Passed
2/2 Test #2: threenative-webtransport-surface-test ...   Passed
100% tests passed out of 2
```

The direct surface run `/tmp/prd359-signal-green-native-surface.log` exited 0
after the real V8 host evaluated the held-write lifecycle probe and printed
`native webtransport surface contract passed`.

## Required mutation

Suppressing the single `AbortController.abort(reason)` delivery call in the
repaired source produced `/tmp/prd359-signal-negative-no-signal.log`, exit 1:

```text
Test Files  1 failed (1)
Tests  3 failed | 20 passed (23)
```

The failures covered signal state/reason, held-write settlement before cleanup,
and the reentrant controller-error outcome. The exact source line was restored
to the same reviewed bytes used by the native build and live run.

## Explicit native live check

After the final V8 build, the reusable runner
`python3 artifacts/networking-359/native-64k-proof.py` started its owned Go
fixture on `127.0.0.1:0`, generated exactly 65,536 bytes, wrote and closed a
bidirectional stream, and compared every echoed byte plus FIN. It exited 0:

```text
[log] PASS: native byte-identical 65536-byte echo with FIN
```

Full output is `/tmp/prd359-signal-live-64k.log`. The runner uses the explicit
development insecure TLS override and therefore does not qualify trusted TLS.

The required existing Go/native live suite also ran after the final signal build:

```sh
XDG_RUNTIME_DIR=/tmp/xdg-runtime-wt TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 \
  sh scripts/xvfb.sh env TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 \
  pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts \
  tests/webtransport/webtransport.test.ts
```

It exited 0 with `Test Files 1 passed (1)` and `Tests 15 passed (15)`;
full output is `/tmp/prd359-signal-live-suite.log`. No full repository suite or
non-Linux platform run is claimed by this bounded row; receive backpressure,
native capacity retry and the remainder of Task 2b stay with the parent
integration work.

## Coordinator and independent verification

QuickJS rebuilt the wire and surface targets successfully (exit 0, 11/11 build
steps), then CTest passed 2/2 (exit 0). The source hash before and after the build
was the reviewed `7a5665317d6649275a6fd26e26789e5fc3014b427c051d7692cd2b26e76b08f3`.
Logs: `/tmp/prd359-signal-root-quickjs-build.log`,
`/tmp/prd359-signal-root-quickjs-ctest.log`.

The coordinator also executed the nested-abort probe against the actual embedded
shim, asserting the browser outcome: same promise, both abort calls resolve,
closed rejects inner reason, signal retains outer reason, one signal followed by
one sink abort. Exit 0, `/tmp/prd359-signal-root-shim-nested.log`.

Independent read-only review found no blocking defect in the source or regression
coverage. The reviewer did not execute native tests; the native results above are
separate executed evidence. Full repository gate results are recorded below.

## Full-gate timestamp interruption

`pnpm typecheck` and `pnpm lint` exited 0; lint reported 603 warnings and no
fixes. Logs: `/tmp/prd359-signal-root-typecheck.log`,
`/tmp/prd359-signal-root-lint.log`. The first `pnpm test` exited 1 in the
QuickJS hardware timestamp contract; 100 native test files and 733 tests passed,
one timestamp test failed, and 38 tests were skipped. Exact diagnostic:

```text
compute pass reported no elapsed time: 1788655435497930752 then 1788655435497930752
```

Full log: `/tmp/prd359-signal-root-test.log`. Doctor exited 0 and found local
Node, Playwright, Chromium and Xvfb; it reported no local Xcode toolchain. This
is not iOS qualification. The timestamp replay passed both engine tests without
a code change. Both timestamp native targets were then rebuilt (V8 8/8 steps,
QuickJS 1/1, both exit 0), and the focused replay again passed 2/2, exit 0.
Logs: `/tmp/prd359-signal-root-timestamp-replay.log`,
`/tmp/prd359-signal-root-timestamp-v8-build.log`,
`/tmp/prd359-signal-root-timestamp-quickjs-build.log`,
`/tmp/prd359-signal-root-timestamp-rebuilt-replay.log`.

The timestamp cause remains unproven; no threshold or source was weakened. The
full test gate was rerun against the fresh prerequisites and passed, exit 0
(`/tmp/prd359-signal-root-test-replay.log`):

```text
packages/runtime-native test: Test Files 101 passed (101)
packages/runtime-native test: Tests 734 passed | 38 skipped (772)
Test Files 389 passed | 2 skipped (391)
Tests 4265 passed | 7 skipped (4272)
```

Together with the passing typecheck, lint, focused native and live proofs, this
accepts Task 2b-signal. The intermittent timestamp failure remains recorded above;
its cause was not fixed or proven by the replay. Full networking remains open.
