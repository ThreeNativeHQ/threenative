# PRD-359 task 7a — paired-client proof on the native desktop host

Recorded 2026-09-07 UTC, worktree `.worktrees/networking-359`, branch `networking-359`.
Linux x64, V8 + Dawn host at `packages/runtime-native/build/tn-linux/mystral`.

This is the native half of task 7a. The browser half is in
[task 7a browser](./prd-359-task7a-browser-2026-09-06.md). The row stays open: the
whole-frame budget the proof runner requires cannot be produced on this target, recorded
under **What is still missing** below.

## Result

Two authenticated clients joined `/game` on the native desktop host through the real Go
reference server, observed each other, moved, and had actions acknowledged. Every networking
assertion the scenario authors passed, across 364 frames:

```text
  assert resource.state.networkConnected                  True
  assert resource.state.networkConnected.throughoutSteps  True
  assert resource.state.networkPeerObserved               True
  assert resource.state.networkRemoteDistance             True
  assert resource.state.networkActionAcks                 True
  assert resource.state.networkProtocolErrors             True
  assert diagnostics                                      True
  frames: 364
```

Those are the five assertions the execution row names — `connected=true`,
`peerObserved=true`, `remoteDistance>=1` metre, `actionAcks>=1`, `protocolErrors=0` — plus
the throughout-steps form of the first and the diagnostics policy.

The transport itself was proven separately against the same server before the game ran, so a
game-level failure could not be confused with a transport one:

```text
$ SSL_CERT_FILE=<lane>/certs/cert.pem \
    packages/runtime-native/build/tn-linux/mystral run probe.js --no-sdl
[WebTransport] TLS peer verification mode: verify-peer (parsed from MYSTRAL_WEBTRANSPORT_INSECURE=<unset>)
[log] TN_PROBE ready-ok
```

That is a verified-peer handshake — no insecure override — against the fixture certificate
(EC P-256, `CN=threenative-networking-fixture`, SAN `DNS:localhost,IP:127.0.0.1`) loaded as a
process-local trust anchor.

Live metrics were collected during the run, which is the sample source task 7metrics needs:

```text
TN_NETWORK_METRICS:{"actionAckLatencyMs":[101.3025179999986],
  "appliedStateAgeMs":[103.275,103.419,53.902,53.961,3.436,3.477,53.280,53.350,3.327,...],
  "clockProbes":[{"rttMs":104.245,"offsetMs":1532.581,"uncertaintyMs":52.122}], ...}
```

## Three defects this lane found, each fixed with a red and a green

The lane did not run at first. Each failure was a real defect in the engine, not in the
fixture, and each is fixed in this branch with its own regression.

### 1. The playtest CLI could not launch a desktop game

`--target desktop` spawned the host with no arguments, so every desktop scenario reported
`TN_PLAYTEST_BRIDGE_MISSING` at zero frames. Full record:
[desktop host args](./prd-359-desktop-host-args-2026-09-06.md).

### 2. The host reported its secure TLS default as an error

`[WebTransport] TLS peer verification mode: verify-peer` was written to `stderr`. It is a
status line, and the secure default is the ordinary case, so every scenario with
`noConsoleErrors` failed on a host that was behaving correctly. It now goes to `stdout`; the
insecure-override warning stays on `stderr`, because that one is worth shouting about.

Red, before the repair:

```text
× reports the secure default on stdout, not stderr
  AssertionError: expected 'TN_COLD_START:{"segment":"process"…' to contain
  'TLS peer verification mode: verify-pe…'
```

Green, after: `Tests 2 passed | 34 skipped (36)`.

### 3. A handled audio rejection was also written to stderr

`decodeAudioData` with an empty buffer already reaches the caller three ways — a rejected
Promise, the legacy `onError` callback, and the `AudioError` it settles with — and also wrote
`[Audio] decodeAudioData received an empty or non-ArrayBuffer argument.` to `stderr`. A
browser rejects without printing. `examples/native-smoke/src/game.ts:185` calls it with an
empty buffer **on purpose**, to prove the rejection path, so every native playtest with
`noConsoleErrors` failed on a game exercising its own error handling.

Red, before the repair:

```text
× a handled decode rejection does not also write to stderr
  AssertionError: a rejection the caller handles must not also be reported as a console error
```

Green, after: `Tests 4 passed (4)`, with the caller still receiving `HANDLED:true`.

## How the lane is driven

A desktop client needs one thing the browser lane gets for free. Task 5a made the networking
config build-time — vite injects `__TN_NETWORKING_CONFIG__` — and the browser lane's dev
server starts inside the runner's environment, so it picks the config up. A desktop client has
no dev server, so the proof runner's `client.command` hook runs a wrapper that builds the
bundle with `THREENATIVE_NETWORKING_CONFIG` in env, then execs the playtest CLI with
`--host-arg run --host-arg <bundle>`.

The bundle and the runner's staged grant have to share one directory, because the native host
resolves a relative `fetch` against its CWD where a browser resolves against the page origin,
and `networking-session.json` is fetched by that relative path. The wrapper copies the grant
in beside the built bundle and points `--project` there.

The run is wrapped in `sh scripts/xvfb.sh`. Without it the host exits during frame sampling
with an Xrandr error (`Minor opcode of failed request: 9 (RRGetOutputInfo)`).

## What is still missing

`scripts/run-networking-proof.mjs`'s `requireWholeFrameBudget` demands that both
`performance.samples` and `performance.maxFrameMsP95` pass on every lane. The desktop playtest
target produces **no render samples at all** — not a low count, zero — so those assertions
cannot pass there regardless of how long the run is:

```text
  FAIL performance.samples        {"sampleCount": 0, "valid": false}
  FAIL performance.maxFrameMsP95  {"actual": null, "expected": 33, "sampleCount": 0}
  FAIL performance.minFps         {"actual": null, "expected": 30, "sampleCount": 0}
  frames: 364
```

364 frames with zero samples is the shape of a missing observer, not a slow game. This is the
same class as the browser-only diagnostics rows: a requirement one target structurally cannot
satisfy. It needs a deliberate decision on the runner's contract — either the desktop lane
gains a render-sample observation, or the whole-frame budget becomes a per-lane requirement
that records "unavailable on this target" rather than failing it. Weakening the check to pass
silently would be the false green the row forbids, so it is left failing and recorded here.

Until that is settled the runner's overall verdict for this lane is `failed`, even though
every networking assertion passed. This document does not claim task 7a complete.

## Limits

Linux x64 desktop only, one host build, one machine, a loopback server and a locally minted
fixture certificate. No Windows, macOS, Android or iOS claim follows from it, and no browser
claim — the browser half is its own record. The 100-cycle and suspend/resume work of task 6b
is separate and not attempted here.
