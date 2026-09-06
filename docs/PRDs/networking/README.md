# Networking

**Direction:** WebTransport on browser and native, reusing the owned quiche bridge.
One TypeScript client implementation; an authoritative dedicated server; real datagram
and reliable-stream evidence on browser, Windows, macOS, Linux and physical Android
before closure. iOS implementation remains in scope; iOS artifacts and verification
may be deferred without blocking `done/`, per owner direction on 2026-09-05.
Deferred iOS results remain explicitly unverified, never passed.

| PRD | Status | Outcome |
| --- | --- | --- |
| [PRD-359 — portable multiplayer transport](./PRD-359-portable-multiplayer-transport.md) | IN PROGRESS — Tasks 0/1a/1a-close/2a/2b-streams/2b-send/2b-signal/2b/2b-proof/2c passed; process-local TLS trust next | Players on browser, Windows, macOS, Linux, Android and iOS share a server using the same game source |

The existing native implementation is incomplete evidence, not a release-ready transport.
The PRD records the exploration, alternatives, bounded implementation slices and release matrix.
Renet2 remains an alternative if the interoperability spike invalidates this direction.
The Go fixture passes the earlier Chromium byte echo proof and 23 native tests, including asynchronous DNS, IPv4/IPv6, real stalled-reader pressure and 100 reconnects in one native process; failed-handshake readiness is repaired. Trusted TLS qualification and the full platform matrix remain unverified.

Follow [EXECUTION.md](./EXECUTION.md); Task 2c DNS is next. Native stream strategy/lifecycle proof passed on Linux V8 and QuickJS. The Task 2a/2b queue-bound checkpoint is accepted after live pressure and reconnect proof.
The exact API, byte format and backend contract are in [PROTOCOL.md](./PROTOCOL.md).

**Selected architecture:** one protocol and conformance suite, thin language adapters.
**Reference backend:** Go using webtransport-go. Node.js and Rust adapters are deferred.
No shared native server core; no client installs Go dependencies.

**Required local proof:** [SANDBOX.md](./SANDBOX.md) specifies the small game at
`../sandbox/networking-proof`, using installed tarballs and real browser/browser plus
browser/native clients. Its passing evidence is required for done closure.

Playtest reuses resource/state and frame-performance assertions. The execution plan adds
a small multi-client proof coordinator, network metric collectors, and one portable
`waitForResource` step with a real deadline for asynchronous readiness/acknowledgements.
