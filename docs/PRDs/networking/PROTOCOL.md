# PRD-359 protocol and API contract

**Implementation specification, version 1.** None of these new APIs are shipped yet.
This file is normative for the TypeScript client and Go reference adapter. Future
Node/Rust adapters must implement this contract and pass the same tests. Do not add
a shared native server core, code generator, replication system or transport fallback.

## Dependency boundary

| Consumer | Transport dependency | ThreeNative responsibility |
| --- | --- | --- |
| Browser game | Built-in `WebTransport` | Shared TypeScript messaging implementation |
| Native game | Existing quiche C API and host bridge | Portable WebTransport subset, packaging and native conformance |
| Go server | `github.com/quic-go/webtransport-go`, backed by quic-go | Small Go framing/session adapter and reference gameplay |
| Future Node server | Separately qualified Node WebTransport library | Thin adapter; deferred, no npm server package in this PRD |
| Future Rust server | Separately qualified Rust WebTransport library | Thin adapter; deferred, no Rust server core in this PRD |

Go is the sole reference backend required for closure. Reference server gameplay is Go.
Do not promise shared TypeScript server simulation. The client never downloads the server
language runtime. Pin Go dependencies in `go.mod`/`go.sum`; do not add them to pnpm.

## TypeScript API

Export these interfaces and `connect` from the new `@threenative/core/net` subpath.
Keep protocol implementation details unexported. All relative imports use `.js`.

```ts
export interface INetworkChannel {
  id: number;
  delivery: 'unreliable' | 'reliable-ordered';
}
export interface INetworkOptions {
  applicationProtocol: string;
  credential: string;
  channels: readonly INetworkChannel[];
  signal?: AbortSignal;
  connectTimeoutMs?: number;
  maxReliableMessageBytes?: number;
  maxQueuedReliableBytes?: number;
  maxQueuedDatagrams?: number;
}
export interface INetworkMessage {
  channel: number;
  data: Uint8Array;
}
export interface INetworkPoll {
  messages: INetworkMessage[];
  disconnected: boolean;
  reason: string | null;
}
export interface INetworkStats {
  transport: 'webtransport';
  state: 'connected' | 'closing' | 'closed';
  sessionId: string;
  maxDatagramPayload: number;
  maxReliableMessageBytes: number;
  maxQueuedReliableBytes: number;
  maxQueuedDatagrams: number;
  queuedReliableBytes: number;
  queuedDatagrams: number;
  droppedDatagrams: number;
  rttMs: number | null;
}
export interface INetworkConnection {
  send(channel: number, data: Uint8Array): boolean;
  poll(): INetworkPoll;
  getStats(): INetworkStats;
  close(): Promise<void>;
}
export function connect(url: string, options: INetworkOptions): Promise<INetworkConnection>;
```

`connect` validates before opening a socket, then completes TLS, HELLO/WELCOME and all
reliable channel bindings within one deadline. Defaults: 10,000 ms connect timeout,
65,536 payload bytes per reliable message, 1,048,576 queued reliable bytes per direction,
256 queued datagrams per direction. Limits must be positive safe integers; a message
limit cannot exceed its queue limit. A session supports 1–32 distinct channels with IDs
1–65535. Reject empty credentials, invalid URLs, duplicate channels, unknown delivery
values and applicationProtocol outside 1–64 printable ASCII characters.

`send` copies the supplied view's bytes, honoring byteOffset/byteLength. The caller can
immediately reuse its buffer. Return true only for admission to the local queue; return
false for reliable queue saturation. An unreliable queue discards its oldest waiting
message to admit the new one, increments the drop counter and returns true. Throw an
Error with a `TN_NET_INVALID_ARGUMENT`, `TN_NET_MESSAGE_TOO_LARGE` or `TN_NET_CLOSED`
message prefix for invalid calls. Never equate true with remote delivery.

`poll` drains at most the configured bounded receive queues and reports a disconnection
once. Later polls after closure return an empty batch, false and null. A connection error
after readiness closes the session and becomes that disconnection reason. Errors before
readiness reject `connect`. `close` is idempotent, clears queues and releases locks; it
resolves after local resources are released, without waiting indefinitely for a peer ACK.
The AbortSignal cancels pending connection establishment only; after readiness use close.

Receive-side reliable saturation pauses reads; do not drop reliable messages. Keep the
buffered partial frame bounded by the negotiated message limit plus its 8-byte header.
Limit open incoming streams before allocating buffers. Unreliable receive saturation
drops oldest and increments the same aggregate local counter. Never label this counter
as network packet loss. `queued*` stats report send queues; effective negotiated limits
stay readable after close. `rttMs` is null unless actually measured.

## Wire version 1

WebTransport handles QUIC/HTTP3 security and reliability. The following is application
framing inside its streams/datagrams; do not implement UDP ACKs, congestion control or
fragmentation. All integers in the header are unsigned big-endian.

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 1 | Wire version, exactly 1 |
| 1 | 1 | Kind: HELLO=1, WELCOME=2, BIND=3, BOUND=4, DATA=16 |
| 2 | 2 | Channel: 0 for HELLO/WELCOME; configured channel ID otherwise |
| 4 | 4 | Payload length excluding the 8-byte header |

A datagram is exactly one DATA frame; its length must equal 8 + declared length. Never
reassemble an application message across datagrams. A reliable stream carries repeated
frames and can split/coalesce at any byte boundary. Reject unknown versions/kinds,
wrong stream/channel, oversized declarations, trailing datagram bytes and truncated
stream frames. Rejecting a malformed reliable/control frame closes the session; malformed
datagrams are discarded and counted. Unknown channels are malformed, not auto-created.

The first client-created bidirectional stream is the control stream. Its first frame is
HELLO on channel 0 with UTF-8 JSON payload (maximum 4096 bytes):

```json
{"applicationProtocol":"threenative-smoke/1","credential":"opaque-token","channels":[{"id":1,"delivery":"unreliable"},{"id":2,"delivery":"reliable-ordered"}],"maxReliableMessageBytes":65536,"maxQueuedReliableBytes":1048576,"maxQueuedDatagrams":256}
```

JSON is limited to this handshake; gameplay payloads are arbitrary bytes. Reject unknown
keys, missing keys, duplicate IDs, invalid JSON/UTF-8 and invalid numeric types. The server
must require an exact match with its configured application protocol and channel map.
Authentication failure closes the session without a WELCOME or game-state allocation.
Do not log credentials or include them in the URL, stream error text or evidence.

WELCOME is the same schema without credential and with a `sessionId` string: 32 lowercase
hex characters from 16 cryptographically random bytes. It confirms the same channels and
the minimum of each client/server limit. Both sides apply those limits per direction.
A negotiated message limit exceeding negotiated queue capacity is an invalid handshake.
Duplicate HELLO/WELCOME closes the session; no further control frames are allowed in v1.

After WELCOME, the client opens one bidirectional stream for each reliable channel,
ascending by ID, and writes a BIND frame with that channel and zero payload. The server
responds on the same stream with BOUND, same channel, zero payload. Both directions then
carry DATA for that channel. Duplicate bindings and server-created application streams
close the session. No unreliable DATA is sent until bindings are complete. Reliable
ordering is per channel, not global. Application readiness occurs after the last BOUND.

Each sender computes its outbound datagram payload limit from its own transport's
current max datagram size minus eight bytes. `maxDatagramPayload` reports that local
send limit, not an invented end-to-end MTU. A size ≤8 or unavailable datagram support
rejects connection readiness. The native shim must query quiche's current writable
datagram length and subtract HTTP/3 session framing before exposing the browser-style
limit. The TypeScript layer then subtracts the application header exactly once.

## Shared fixtures and independent tests

The implementation creates `docs/PRDs/networking/protocol-v1-vectors.json`. This path
remains canonical after archival: update consumers and relative links in the archive
commit if the networking directory moves. Never copy vectors into per-language fixtures.
JSON schema: `{ "version": 1, "valid": [...], "invalid": [...] }`; valid items have
`name`, `hex`, `kind`, `channel`, `payloadHex`; invalid items have `name`, `hex`, `reason`.
Store framing vectors, not implementation-generated expected values.

Mandatory valid vectors: empty DATA on channel 1 (`0110000100000000`), bytes 61/62 on
channel 1 (`01100001000000026162`), BIND channel 2 (`0103000200000000`), BOUND channel 2
(`0104000200000000`), and DATA on channel 65535 (`0110ffff0000000100`). Mandatory invalid
vectors: wire version 2, unknown kind 255, DATA channel 0, declaration 0xffffffff, truncated
header, truncated payload and trailing datagram bytes. Test stream splits at every byte
boundary independently; trailing stream bytes may begin another frame and are not an error.
Go and TypeScript tests each decode these literal vectors and independently encode the
same expected bytes. A shared test generator must not generate both expected and actual.

## Authentication and reference gameplay

Development issuer: server process generates random 32-byte tokens using Go crypto/rand;
store only hashes mapped to room, player ID, expiry (60 seconds) and consumed flag. A
token is consumed atomically on HELLO, not on transport connect. The reference server
serves exactly one configured room (`--room`, default `networking-proof`). Compare the
token record's room to that configured room before consumption; a mismatch rejects the
join. `TestWrongRoom` starts room A, issues a token bound to room B, and verifies HELLO
is rejected with no player allocation. Replay and expiry also reject the join. Expose issuance through a loopback-only HTTP admin listener for tests.
Do not expose an unauthenticated public token issuer. Real products provide their own
identity service; this PRD does not implement accounts. Browser Origin uses an allowlist;
native authentication must not assume its Origin header proves identity.

The reference game uses channels 1=input unreliable, 2=state unreliable, 3=actions
reliable-ordered; channel 4=clock probes reliable-ordered, used only by the reference
qualification workload. It runs server simulation at 60 Hz and emits snapshots at 20 Hz.
For this example only, payloads are UTF-8 JSON with exact schemas documented alongside
its server code: input `{tick, x, z}` with axes clamped to [-1,1], snapshot
`{tick,serverMonoMs,player:{id,x,z,lastActionId}}`, action `{id}` and reply `{id,accepted}`.
Player IDs are nonempty strings matching `[a-zA-Z0-9_-]{1,64}`. Action IDs and ticks
are nonnegative safe integers; positions must be finite. Use per-player
monotonically increasing action IDs and reject duplicates. Do not claim persistence
across server restarts. Send one player per snapshot datagram; validate its encoded size against the actual
negotiated payload limit. Never pack all 32 players into an oversized datagram. Track
last applied tick separately per player; same-tick updates for different players must
all apply. Snapshots with tick ≤ that player's last applied tick are ignored. The server
integrates movement from input at a fixed speed; it never accepts client position.
Server-received messages must validate the schema before changing state.

## Backend compatibility rule

Passing raw WebTransport echo is necessary but insufficient for a supported adapter.
Every future Node/Rust adapter must pass the literal vectors, HELLO/BIND/authentication
negative cases, bounded queues, partial frames, reconnect and the existing browser/native
two-client scenario against the same server contract. Those adapters are not implemented
or advertised by this PRD. No FFI boundary or common native server binary is required.


## Reference clock probe (not a core timing API)

Channel 4 request is `{probeId,clientSentMs}`; reply is
`{probeId,clientSentMs,serverReceivedMs,serverSentMs}`. probeId is a nonnegative safe
integer. Times are finite monotonic milliseconds: performance.now on the client and
time.Since(processStart) on Go. Timestamp receipt/send at actual message handling.
Never use wall-clock UTC to calculate latency. The reference game samples five probes
at connection start and one per second thereafter. See EXECUTION.md Task 7metrics for
clock-error bounds and applied-state-age calculation. These messages are example
payloads; future applications may choose their own timing protocol.
