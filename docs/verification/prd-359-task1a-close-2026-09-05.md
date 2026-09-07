# PRD-359 Task 1a-close — failed handshake promises — 2026-09-05

Engine layer: the native WebTransport polyfill left `ready` pending when the transport
sent `closed` before `ready` without a preceding `error`. The real Go fixture exposed
this as a 30-second timeout in the untrusted-certificate test; ten echo/lifecycle tests
already passed. No TLS verification setting was weakened.

## Caller and repair

`packages/runtime-native/src/webtransport/webtransport.cpp:1027` queues the transport
Closed event; `dispatchEvent` invokes the installed `__wtDispatch` on the main thread.
`packages/runtime-native/src/runtime-scripts/webtransport-polyfill.js:169` handles it.
The existing closed dispatcher now rejects both `ready` and `closed` before readiness,
using the earlier error or a WebTransportError for the close reason. Established-session
closure follows its existing branch.

The surface test substitutes only session creation (no socket), then drives the real
installed dispatcher with `closed` and asserts both promises reject as WebTransportError.
The test runs inside the compiled native runtime, not a copied JS implementation.
The existing live certificate test supplies independent real transport evidence.

## Red then green

Added the regression to `tests/webtransport_surface_test.cpp` first, rebuilt its native
target, then ran `ctest --test-dir packages/runtime-native/build/tn-linux -R
'^threenative-webtransport-surface-test$' --output-on-failure`. Exit 8:

```text
webtransport surface contract timed out before completion
0% tests passed, 1 tests failed out of 1
```

Changed the pre-ready closed branch and rebuilt `mystral` plus
`threenative-webtransport-surface-test` with `cmake --build ... -j 6`. Exit 0.
Same CTest command, exit 0:

```text
1/1 Test #2: threenative-webtransport-surface-test ... Passed 0.33 sec
100% tests passed out of 1
```

Mutation: restoring `if (st.lastError && !st.ready)` and removing `st.readyReject(err)`
restores the exact pre-repair branch that produced the red above. The regression's ready
promise remains pending without the repair.

## Live proof

```sh
XDG_RUNTIME_DIR=/tmp/xdg-runtime-wt TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 \
  sh scripts/xvfb.sh pnpm --dir packages/runtime-native exec vitest run \
  --config vitest.config.ts tests/webtransport/webtransport.test.ts
```

Exit 0 (captured directly, no output pipeline):

```text
Test Files  1 passed (1)
     Tests  11 passed (11)
  Duration  9.19s
```

This includes rejection of the development self-signed certificate with the insecure
override removed, plus explicit-development-mode connection, datagrams and streams.
It is not a trusted-certificate positive qualification run (Task 1b remains open).
Fresh native binary SHA256:
`2ef26e4713f60f6702b6a8db29e9654ca46a8dbc8b40195a8b2d5681b4612e6e`.
Go fixture uses webtransport-go v0.13.0 and quic-go v0.62.0; its Task 1a sources are
being finalized separately. Linux V8+Dawn executed; other platforms remain unverified.
Logs: `/tmp/networking-359-close-{red,green,live}.log` and corresponding build logs.
Fresh read-only reviewer `review_close` (Luna max) accepted dispatcher wiring, red/green dependency, promise settlement and unchanged established-session closure. Focused Biome check and JS syntax check exited 0. Full repository shipping gates remain required later.
