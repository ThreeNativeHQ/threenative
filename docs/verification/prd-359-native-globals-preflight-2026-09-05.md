# PRD-359 native globals preflight — 2026-09-05

`@threenative/core/net` is still unshipped (`PROTOCOL.md:1-5,24-70`); its API explicitly types
`AbortSignal` (`:32-40,88-93`) and its transport contract needs the text/stream/time/URL surfaces
below. Native bootstrap installs fetch/shims,
streams, and URL in `runtime.cpp:623-645,2282-2293,2385-2389`; the manifest records them in
`shim-manifest.json:5-6,15,18-21,24,28,37`.

- **AbortController/AbortSignal:** Installed by the guarded fallback (`fetch-polyfill.js:49-125`);
  browser/native surface is portable for cancellation signaling. `fetch-shim.test.mjs:28-91`
  covers installation and listener behavior. No native-target `net.connect` cancellation proof.
- **UTF-8:** Encoder/decoder are installed (`fetch-polyfill.js:2-40`), but fallback `TextDecoder`
  ignores options and returns malformed bytes instead of throwing (`:4-20`); `TextDecoderStream`
  also ignores options (`streams-polyfill.js:381-395`). This fails PRD invalid UTF-8 handshake
  semantics (`PROTOCOL.md:122-130`) on fallback engines. Tests only round-trip (`fetch-shim.test.mjs:41-53`).
- **Streams:** Reader cancellation exists (`streams-polyfill.js:49-50,108-116`), but desiredSize
  is fixed and no queue/backpressure strategy is implemented (`:18-23,79-84,205-252`). Basic
  read/pipe tests pass (`streams-shim.test.mjs:23-184`); cancellation/backpressure are unproved.
- **performance.now:** Installed by `runtime.cpp:1877-1892`; it overwrites engine start-relative
  clocks with `high_resolution_clock` epoch time, so monotonicity is unproved. No net clock test.
- **URL:** Fallback parser is installed (`url-worker-polyfill.js:71-155`) and C++ independently
  parses explicit `https://host:port` (`webtransport.cpp:696-715`). Normal/relative parsing tests
  exist (`url-worker-shim.test.mjs:37-93`); full net URL validation is unproved.

Current callers are `packages/core/src/assets.ts:263-267`, `packages/playtest/src/protocol.ts:513-514`,
`packages/playtest/src/runner/server.ts:68-79,229-234`, and `packages/core/src/loop.ts:62-63`;
there is no `core/net` export or caller yet.

This is a source inventory, not native transport acceptance. The coordinator inspected the actual TextDecoder fallback, ReadableStream desiredSize and runtime setupPerformance implementations and confirmed the gaps. Existing shim tests do not establish the missing pressure/fatal-decoding/clock guarantees. Required repairs are bounded in EXECUTION.md as 2b-streams, 4c-utf8 and 7clock. AbortSignal is present; no duplicate cancellation shim is warranted.
