# PRD-359 networking exploration — 2026-09-05

Planning evidence for [PRD-359](../PRDs/networking/PRD-359-portable-multiplayer-transport.md).
No production code changed. No live platform gate executed.

## Executed

The root invocation `pnpm exec vitest run packages/runtime-native/tests/webtransport/peer-verification-contract.test.mjs`
exited 1 with `No test files found`. Root include patterns cover `__tests__/*.spec.ts`,
not the native package's `tests/*.test.mjs`. This was a collection/configuration failure,
not a failing networking implementation test.

From `packages/runtime-native`, executed:

```sh
pnpm exec vitest run --config vitest.config.ts tests/webtransport/peer-verification-contract.test.mjs
```

```text
Test Files  1 passed (1)
     Tests  4 passed (4)
Duration  128ms (transform 12ms, setup 0ms, import 21ms, tests 9ms, environment 0ms)
```

Exit 0. This suite checks source contracts; it does not validate a TLS handshake.

A Node VM probe loaded the actual native polyfill with stubbed native bridge functions:

```js
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const context = vm.createContext({
  ReadableStream, WritableStream, Uint8Array, ArrayBuffer, console,
  __wtConnect: () => 1, __wtSendDatagram: () => -1,
});
vm.runInContext(readFileSync(
  'packages/runtime-native/src/runtime-scripts/webtransport-polyfill.js', 'utf8'
), context);
const wt = vm.runInContext("new WebTransport('https://example.invalid')", context);
await wt.datagrams.writable.getWriter().write(new Uint8Array([1]));
console.log('PROBE: native datagram send returned -1; JS write still resolved');
console.log('PROBE: maxDatagramSize before any handshake =', wt.datagrams.maxDatagramSize);
```

```text
PROBE: native datagram send returned -1; JS write still resolved
PROBE: maxDatagramSize before any handshake = 1200
```

Exit 0. This reproduces ignored native status and constant capacity reporting; it is
not a red/green implementation test and does not assert that unreliable writes must
always deliver. The PRD requires tests distinguishing legitimate drops from invalid
operations and requiring observable bounded admission.

## Inspected, not executed

The PRD lists the native bridge, poll-loop caller, CMake/downloader, missing fixture,
missing referenced documentation, capability guidance and exports inspected during planning.
No browser, native host, physical phone, simulator, server, packet impairment, TLS peer,
load test, full typecheck/lint/test suite or release qualification was run.
The four source-contract tests cannot establish any platform's networking readiness.


## Execution handoff review

The owner selected a shared protocol/conformance suite with thin language adapters and
left the backend choice to the planner. The handoff chooses Go/webtransport-go as the
reference backend; Node/Rust adapters are deferred. The owner also made iOS qualification
non-blocking and required a local game at `../sandbox/networking-proof`.

A read-only prd-creator checkpoint reviewer found four issues: authentication dependency
order, conflicting player ID types, unspecified room validation and missing measurement
producers. All were corrected. Its second review confirmed those corrections and found
one signed-clock-offset rejection error; that sentence now allows signed clock offsets
while requiring finite values and nonnegative RTT/uncertainty.

The planning check verified local Markdown links, balanced fenced blocks, and ordering
of auth/issuer tasks before game configuration and metrics before qualification. Whitespace
checks emitted no diagnostics. These are document checks, not runtime implementation gates.
The sandbox requirement is specified in SANDBOX.md; no sandbox game was built during planning.
