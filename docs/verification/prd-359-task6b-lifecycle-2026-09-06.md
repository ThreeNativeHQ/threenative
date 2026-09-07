# PRD-359 task 6b lifecycle slice — 2026-09-06

This evidence closes the client-session lifecycle defect found while preparing
the full 6b live qualification. The EXECUTION row remains open for its required
server-restart, 30-second loss/suspend, and 100-cycle authenticated gameplay
run.

## Red/green

Before the fix, the new server-drop test failed after the connection reported
`disconnected`:

```text
× net > releases readers after a server restart
→ expected false to be true
```

The failure was in `packages/core/src/net-session.ts`: unexpected transport
closure changed state but left the reliable and datagram stream readers locked.

After the fix, the focused lifecycle tests passed:

```text
✓ net > does not replay actions on reconnect
✓ net > releases readers after a server restart
Tests 2 passed | 7 skipped
```

The complete core transport spec passed:

```text
Tests 9 passed (9)
```

## Contract changes

- Unexpected transport closure now runs the same idempotent resource release as
  explicit `close()`.
- Reliable readers and the datagram reader are canceled and released before the
  connection is considered cleaned up.
- Pending datagrams and reliable actions are cleared on explicit close; the new
  connection therefore writes only its fresh BIND frames and never replays the
  prior action.
- Rejoin creates a fresh server `gamePlayerState`; `TestRejoinStartsFresh`
  confirms input, action IDs, and position do not survive `Leave`.
- The example state increments `networkReconnects` only for an explicit retry.

## Remaining qualification

The shared `@threenative/core/net` client was also driven against the real
authenticated Go fixture with `MYSTRAL_WEBTRANSPORT_INSECURE=1` for this local
self-signed development server. The server was stopped after the first join,
the client waited 30 seconds with no server, and a fresh server was started
before the client requested a new one-time admin token and joined again:

```text
CONNECTED:1:cffb555f5c8cb2583afeb36f34ba53f4
DISCONNECTED:transport closed
CONNECTED:2:9d5d4e6488aaefa0a953cd206b0995b3
PASS: authenticated rejoin sessions=2 acks=2 snapshots=180
```

This is live loss/rejoin evidence, not trusted-TLS qualification. The
authenticated 100-cycle gameplay/resource-baseline and native suspend/resume
proof is still required before checking task 6b in `EXECUTION.md`.
