# Networking

**Direction:** WebTransport on browser and native, reusing the owned quiche bridge.
One TypeScript client implementation; an authoritative dedicated server; real datagram
and reliable-stream evidence on browser, Windows, macOS, Linux and physical Android
before closure. iOS implementation remains in scope; iOS artifacts and verification
may be deferred without blocking `done/`, per owner direction on 2026-09-05.
Deferred iOS results remain explicitly unverified, never passed.

| PRD | Status | Outcome |
| --- | --- | --- |
| [PRD-359 — portable multiplayer transport](./PRD-359-portable-multiplayer-transport.md) | IN PROGRESS — Task 0 policy checks passed; Task 1a fixture underway | Players on browser, Windows, macOS, Linux, Android and iOS share a server using the same game source |

The existing native implementation is incomplete evidence, not a release-ready transport.
The PRD records the exploration, alternatives, bounded implementation slices and release matrix.
Renet2 remains an alternative if the interoperability spike invalidates this direction.
Task 0 policy checks passed; native baseline contracts passed locally. Transport interoperability and platform acceptance remain unverified.

Follow [EXECUTION.md](./EXECUTION.md); Task 1a is underway.
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
