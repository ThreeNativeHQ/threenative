# PRD-359 Task 2b-proof — live queue and reconnect evidence — 2026-09-05

Task 2b-proof accepted after independent review, negative controls and final gates. This row uses the existing Go fixture and Linux V8 native
runtime built from accepted stream integration commit `2dc42fcc`. It does not
qualify positive trusted TLS or any additional platform.

## Permanent executable proof

`packages/runtime-native/tests/webtransport/webtransport.test.ts` now contains
`backpressures stalled receiver` and `releases 100 reconnects`. Each invokes the
existing `runScript` exactly once, with a 90-second process budget inside a
120-second test budget. Existing cases retain their 20-second process budget.

The stalled-reader test writes a deterministic 32 MiB payload in sequential
64 KiB chunks without acquiring a reader. It requires six consecutive 50 ms
samples with no producer progress, positive native and JS send queues, a populated
receive queue, and an unfinished write transfer (`written < total`). Each sample
checks the native and JS byte bounds and the 16 KiB readable bound. Only then does
it acquire the reader, compare all 33,554,432 bytes, observe FIN, await writer
completion and close the transport. A held FIN alone cannot satisfy pressure.

An independent run observed the producer blocked after 1,507,328 bytes, native
queued reliable bytes 983,043, JS queued reliable bytes 65,536 and JS queued receive
bytes 16,384. Native and JS send queues are separately bounded; their summed counter
is not a single 1 MiB limit. After draining, exact bytes/FIN and cleanup passed.
Log: `/tmp/prd359-root-stalled-reader-probe.log`.

The reconnect test starts one native process and creates 100 sequential sessions
inside it. Every cycle echoes a datagram and bidirectional stream, checks exact
bytes and FIN, closes, then polls eight actual native counters and eight JS counters
to zero before continuing. Missing or nonfinite counters fail. The initial baseline
must also be zero. It neither mutates diagnostic maps nor replaces observations with
constants. The independent probe printed `CYCLES 100` and
`PASS: native 100 reconnects active echo and zero resource baseline`, exit 0.
Log: `/tmp/prd359-root-reconnect-probe.log`.

## Negative controls

Both mutations compiled; neither is retained in source:

- Removing native payload read-credit enforcement made the stalled-reader test
  fail, exit 1: `sender never demonstrated stalled-reader pressure; written=33554432`.
  Log: `/tmp/prd359-proof-negative-credit.log`.
- Removing `g_sessions.erase(id)` from native teardown made the reconnect test
  fail after its first close, exit 1: `leak cycle 0`, with native sessions 1 and
  JS sessions 0. The test therefore observes native ownership independently of JS
  unregistering the session. Log: `/tmp/prd359-proof-negative-cleanup.log`.

The original native source was restored exactly and `mystral` rebuilt, exit 0.
Build logs use `/tmp/prd359-proof-negative-{credit,cleanup}-build.log` and
`/tmp/prd359-proof-restored-build.log`.

## Verification and review

Initial focused run: 2/2 selected tests passed. After the mutations and restoration,
the complete required fixture suite passed 17/17 with no skips:
`XDG_RUNTIME_DIR=/tmp/xdg-runtime-wt TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 sh scripts/xvfb.sh pnpm --dir packages/runtime-native exec vitest run --config vitest.config.ts tests/webtransport/webtransport.test.ts`.
Log: `/tmp/prd359-proof-live-green.log`.

Independent read-only review found no native/lifecycle blocker, but identified that
`!done` alone could count a pending FIN as write pressure. Root added `written < total`
and the matching failure guard before the full gate reached native test collection.
The final required fixture run after that strengthening passed 17/17 with no skips,
exit 0: `/tmp/prd359-proof-final-required-live.log`.

`pnpm typecheck` and `pnpm lint` exited 0; lint reported 614 warnings. Logs:
`/tmp/prd359-proof-typecheck.log`, `/tmp/prd359-proof-lint.log`.
`pnpm test` exited 0: native 101 files / 741 tests passed, 40 skipped; root
389 files / 4,265 tests passed, two files / seven tests skipped. Native build
contracts added 29 passes. Log: `/tmp/prd359-proof-full-test.log`. The normal
repository gate skips optional live tests; the separate required run above is
the evidence for all 17 live cases, rather than those skips.

These tests use the explicit development self-signed fixture override. They prove
local queue/lifetime integration, not trusted TLS, DNS responsiveness, the 32-client
soak, memory/RSS/goroutine qualification, CI release lanes, cold MCP discovery,
Android/Windows/macOS/iOS qualification or full PRD completion.
