# PRD-359 task 7a — paired-client proof on the native desktop host

Recorded 2026-09-07 UTC, worktree `.worktrees/networking-359`, branch `networking-359`.
Linux x64, V8 + Dawn host at `packages/runtime-native/build/tn-linux/mystral`.

This is the native half of task 7a. The browser half is in
[task 7a browser](./prd-359-task7a-browser-2026-09-06.md). **The row stays open, and this
result is not reproducible on the host this branch ships** — read **What is still missing**
before citing anything here.

## Result

Two authenticated clients joined `/game` on the native desktop host through the real Go
reference server, observed each other, moved, and had actions acknowledged. Every networking
assertion the scenario authors passed, across 364 frames.

**The host in that run was not the host this branch ships.** It carried an extra change that
moved the `[Audio]` decode-failure line from stderr to stdout, which a later review rejected —
see item 3 — and that change is reverted. On the shipped host the same run fails on the
example's deliberate probe. What the run demonstrates is the transport and the gameplay; it is
not a lane that can be re-run green today.

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

## What the lane found

The lane did not run at first. Two of the three causes were real engine defects, fixed in
this branch with their own regressions; the third turned out to be the example's own
deliberate probe, and the scenario names it rather than the host being changed.

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

### 3. Not a defect — and the reason this lane cannot be green yet

`examples/native-smoke/src/game.ts:185` calls `decodeAudioData(new ArrayBuffer(0))` **on
purpose**, to prove the rejection path, and the host reports that failure on `stderr`. Every
native playtest of this example with `noConsoleErrors` therefore sees one console error.

This was briefly "fixed" by moving that write to stdout, and the 364-frame result above comes
from a host built that way. A review rejected it: the host has no unhandled-rejection
reporter, so moving the line also let a game that *ignores* a rejected decode escape the
console-error gate. The stderr write is the protection. It is reverted, and the host is
unchanged from `main` here.

The browser scenario handles its equivalent — a known popErrorScope diagnostic — with a
`noConsoleErrors: false` opt-out and a reason. **The desktop target cannot do that.** Any
`assert.diagnostics` block at all requires a `runtimeDiagnostics` observation the desktop
runner does not produce, so both roads are closed:

```text
# no diagnostics block: defaults apply, and the deliberate probe fails the run
TN_PLAYTEST_CONSOLE_ERROR   1 browser console error(s) were captured during playtest.

# any diagnostics block, however it is configured:
TN_PLAYTEST_OBSERVATION_UNAVAILABLE
  Assertion 'diagnostics' requires observation 'runtimeDiagnostics', but this runner does
  not produce it.
```

Both were run against the shipped host. `__TN_LOADING_PROOF__` would skip the probe but also
repaints the scene, so it is not a way out either.

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

Two structural gaps, either of which is enough to keep row 7a open.

**The desktop target cannot express a diagnostics opt-out**, so a game that exercises its own
error paths cannot pass a desktop scenario at all. That is item 3 above and it is what stops
this lane being re-run green on the shipped host.

**The whole-frame budget cannot be produced on this target.**
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

Until both are settled the runner's overall verdict for this lane is `failed`, even in the
run where every networking assertion passed. This document does not claim task 7a complete,
and row 7a is unchecked.

## Limits

Linux x64 desktop only, one host build, one machine, a loopback server and a locally minted
fixture certificate. No Windows, macOS, Android or iOS claim follows from it, and no browser
claim — the browser half is its own record. The 100-cycle and suspend/resume work of task 6b
is separate and not attempted here.
