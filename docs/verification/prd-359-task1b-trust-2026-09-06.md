# PRD-359 Task 1b-trust — process-local certificate trust — 2026-09-06

Linux desktop only. Executed on branch `networking-359` at parent commit `54b27cf2`
(Task 2c accepted). The quiche pin is unchanged at `quiche-0.24.6-3`. No machine or OS
trust store was modified; no private key was printed; every fixture key
and certificate was minted into the untracked `.test-tmp/webtransport/trust/` and removed
by the block's `afterAll`.

## What was implemented

`SSL_CERT_FILE`, when the process has it set, is loaded as an explicit trust anchor file
through the packaged `quiche_config_load_verify_locations_from_file`
(`third_party/quiche/include/quiche.h:161`), immediately after the existing
`quiche_config_verify_peer` decision in `openCandidate`. Peer verification stays enabled in
every case below; `MYSTRAL_WEBTRANSPORT_INSECURE` was never set in a positive case.

Unset means unchanged: no load call is made and quiche keeps its own default verify paths.
This row does **not** claim the call replaces, excludes or extends quiche's default roots —
that was not measured, and the native comments were corrected on 2026-09-06 to state only
explicit loading and retained verify-peer behavior. What is measured is that a supplied file is honored, and that a supplied file
which cannot be used is refused instead of silently falling back.

Refusal is fail-closed and names itself on stderr: an explicitly empty value, an unreadable
path and a file that is not certificates each abort the candidate, stop candidate iteration
(the next address would fail identically) and reject both establishment promises.

## Native contract red, before implementation

The regression was written first against a behavioral stub whose entire body was
`return true;` — today's semantics, so the red is behavior and not a missing symbol.

`build/tn-linux/threenative-webtransport-wire-test`, exit **1**:

```text
FAIL: empty trust file value refused
FAIL: empty trust file diagnostic names the variable
FAIL: unreadable trust file refused
FAIL: unreadable trust file diagnostic names the path
FAIL: malformed trust file refused
webtransport wire contract: 5 failure(s)
```

`unset trust file keeps quiche default verify paths` passed in the same red run, so the
red is the refusal behavior alone. The mutation that reproduces it is exactly: replace
`applyPeerTrust`'s body with `return true;`.

The live positive was red for the reason the
[TLS preflight](./prd-359-tls-preflight-2026-09-05.md) recorded — `verify-peer`,
`quiche_conn_recv failed: -10`, `FAIL: WebTransport closed before ready`, vitest exit 1
with 1 failed / 4 passed. Both reds were produced with prerequisites present, under
`TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1`, so neither is a missing-prerequisite skip.

## Green

| Command | Exit |
| --- | --- |
| `cmake --build build/tn-linux --target threenative-webtransport-wire-test threenative-webtransport-surface-test mystral -j4` | 0 |
| `build/tn-linux/threenative-webtransport-wire-test` -> `webtransport wire contract passed` | 0 |
| `build/tn-linux/threenative-webtransport-surface-test` | 0 |
| `cmake --build build/tn-linux-quickjs --target threenative-webtransport-wire-test threenative-webtransport-surface-test -j4` | 0 |
| `build/tn-linux-quickjs/threenative-webtransport-wire-test` / `-surface-test` | 0 / 0 |
| `XDG_RUNTIME_DIR=/tmp/xdg-runtime-wt TN_REQUIRE_LIVE_WEBTRANSPORT_FIXTURE=1 sh scripts/xvfb.sh pnpm exec vitest run tests/webtransport/webtransport.test.ts -t "verified certificate trust"` | 0 — 5 passed, 23 skipped |
| same command without `-t` (whole live file) | 0 — **28 passed (28)** |

Linux V8 and QuickJS wire/surface contracts pass 2/2 each. The 28/28 run re-executes every
Task 2a/2b/2b-proof/2c case — datagrams, streams, backpressure, 100 reconnects, OS
hostname lookup, delayed lookup, cancellation, IPv6, candidate fallback — so the shared
helpers this row touched preserve the existing DNS and stream behavior.

Compiled artifacts, SHA-256:

```text
89463e2fcabac22611040e22503ffdeb6e088c93ca84e7eb22a2c49ef4488f0f  build/tn-linux/threenative-webtransport-wire-test
3eef82336003518652ac872655bc1c8b00db7f3fdcbd225e4d1a03bbb7dc5f43  build/tn-linux/threenative-webtransport-surface-test
da520911c8cbe35f5d4b60cbc115ba7c37b03a6d81ea774018d522eb4aef542f  build/tn-linux/mystral
19a6c01c58f2ed6b10afd79270ee40c36446a06ca222e223ec9648f6096b96e5  build/tn-linux-quickjs/threenative-webtransport-wire-test
af659919c74743342e8be10076bdfe757f37e4488a1b41ac09abf96c39e5e1cf  build/webtransport/tn-network-server
```

## The five live cases

The fixture certificate is a two-day P-256 self-signed certificate with
`subjectAltName=DNS:localhost,IP:127.0.0.1`, minted per run by `openssl req -x509`, serving
a `--cert/--key` Go fixture on an ephemeral 127.0.0.1 port. A second `--dev-self-signed`
fixture supplies the untrusted peer, so the untrusted negative is refused by verification
rather than by nothing listening.

1. **accepts a trusted certificate without the development override** — datagram echo round
   trip completes; output carries `TLS peer verification mode: verify-peer` and carries
   neither `TLS peer verification disabled` nor `MYSTRAL_WEBTRANSPORT_INSECURE=1`.
2. **rejects a trusted certificate presented for the wrong hostname** — the Task 2c resolver
   seam points `networking-test.invalid` at the trusted fixture. The anchor is loaded and
   verification is on, so the name is the only thing wrong; the trust diagnostic is absent.
3. **rejects an untrusted certificate while an explicit trust file is set** — the
   development peer is addressed by a name its certificate does carry, so only the anchor
   differs.
4. **refuses an unreadable trust file** — output names the path and
   `could not be loaded as trusted CA certificates`.
5. **refuses a malformed trust file** — same named diagnostic for a file of non-certificate
   bytes.

The pre-existing `rejects the echo server certificate without the development override` and
the explicit development-override echo cases are unchanged and set no `SSL_CERT_FILE`;
`runScript` now removes an inherited `SSL_CERT_FILE` from every child that does not ask for
one, so an operator's ambient value cannot change what any other case here proves.

## Exact-endpoint reachability controls and the verification mutant

Added 2026-09-06 after review: a "rejected" negative proves nothing until the identical
endpoint is shown reachable. Each secure negative now runs, first, a development-mode
control against the **same URL, same DNS mapping and same listening peer**, with
`MYSTRAL_WEBTRANSPORT_INSECURE=1` through the existing `runTrustedScript` helper. The
control asserts a byte-exact datagram echo, not `ready` alone, and asserts
`TLS peer verification disabled` so it cannot silently be the secure path. The controls
are explicitly insecure and are never used by the trusted positive, which still runs with
verification on and no override.

| Negative | Control endpoint | Control asserts |
| --- | --- | --- |
| wrong hostname | `https://networking-test.invalid:<trust-port>/echo`, `MYSTRAL_WEBTRANSPORT_TEST_DNS_ADDRESSES=127.0.0.1` | `PASS: endpoint reachable` + `TLS peer verification disabled` |
| untrusted certificate | `https://localhost:<untrusted-port>/echo` | `PASS: endpoint reachable` + `TLS peer verification disabled` |

The secure attempt that follows each control keeps its original assertions, so one test
shows reachable-then-refused rather than refused-for-unknown-reasons.

**Mutant proof.** With `quiche_config_verify_peer(s->config, !allowInsecurePeerVerification)`
temporarily replaced by `quiche_config_verify_peer(s->config, false)` and `mystral` rebuilt,
both negatives fail while their controls still pass:

| Run | Exit | Observation |
| --- | --- | --- |
| `-t "rejects a trusted certificate presented for the wrong hostname"` | **1** | `FAIL: accepted the wrong hostname`, 1 failed / 27 skipped |
| `-t "rejects an untrusted certificate while an explicit trust file is set"` | **1** | `FAIL: accepted an untrusted certificate`, 1 failed / 27 skipped |

Logs: `/tmp/tn-1btrust-evidence/mutant-wrong-hostname.log`,
`/tmp/tn-1btrust-evidence/mutant-untrusted.log`.

The mutation was then reverted from the backup and the source hash checked equal to the
pre-mutation hash (`ea75953…`), leaving no mutant in the tree; `grep -c "TEMPORARY MUTANT"`
returns 0. After rebuilding, `mystral`, the wire test and the surface test hash **identical**
to the values listed above, and the focused trust run returns to exit 0 (5 passed, 23
skipped) with the whole live file at exit 0, **28 passed (28)**. Logs:
`/tmp/tn-1btrust-evidence/live-trust-controls.log`, `live-trust-restored.log`,
`live-full-restored.log`, `wire-restored.log`, `surface-restored.log`.

## Measured, out of scope, and open

An IP-literal authority is refused by this quiche build **even when the certificate carries
the matching `IP Address:127.0.0.1` SAN and is the loaded trust anchor**, while the same
certificate, anchor and server verify through `https://localhost:<port>`. Probe output, one
server, one run, both hosts:

```text
=== localhost ===     [log] PROBE_OK localhost
=== 127.0.0.1 ===     [log] PROBE_FAIL 127.0.0.1 WebTransport closed before ready
```

That is a server-name check limitation, not a trust-loading one, and it is left open rather
than worked around: it is **not accepted as final behavior**, and root carries it into Task 1b
as a blocking requirement with the certificate/hostname fixture work. Nothing here papers over
it — trust cases address the fixture by name, and the hostname proof above stands on its own.

Not executed and not claimed: browser, macOS, Windows, Android, iOS; any non-Linux trust
behavior; whether the loaded file adds to or replaces quiche's default roots; expired
certificate handling (Task 1b).

## Repository gate note

`pnpm budgets`' native coverage gate reports
`native coverage report is stale: source digest changed`. The digest covers
`packages/runtime-native/src/**` and all of `packages/runtime-native/tests/**`, which
commit `54b27cf2` also changed without regenerating the record, so the gate was already
stale before this row. Regenerating it writes
`docs/verification/native-coverage-2026-08-28.md` via
`pnpm --filter @threenative/runtime-native native:coverage`; that file was outside the worker's original ownership and was left to the integrating owner.

## Coordinator integration

Final review found one fixture cleanup failure path: stopping the first child could
throw before the second was stopped. The coordinator changed teardown to attempt both
with `Promise.allSettled`, then report failures. The complete required live file passed
28/28 after this fix, exit 0 (`/tmp/prd359-trust-final-live.log`).

The execution row now assigns its unused fifth source slot to the generated coverage
record; the surface test is unchanged and still executed. The canonical command
`CMAKE_BUILD_PARALLEL_LEVEL=4 pnpm --filter @threenative/runtime-native native:coverage`
completed, exit 0 (`/tmp/prd359-trust-native-coverage.log`). It executed 33 native contract
targets with the existing physics/video targets explicitly blocked by configuration.
WebTransport instrumented line coverage is 959/1391 (68.94%); total 9388/21425 (43.82%).
This measured record is not browser/mobile or full networking qualification.
`pnpm test` passed, exit 0: native 101 files / 741 tests passed, 51 optional tests
skipped; native build contracts 29 passed; root 389 files / 4,265 tests passed,
two files / seven tests skipped (`/tmp/prd359-trust-full-test.log`). The separate
required 28/28 live run supplies the networking evidence instead of optional skips.
Sequential `pnpm typecheck` passed, exit 0 (`/tmp/prd359-trust-typecheck.log`);
`pnpm lint` passed, exit 0, 613 warnings (`/tmp/prd359-trust-lint.log`).

Budgets exposed stale generated native census and evidence retention records in
addition to coverage. `pnpm census` regenerated four line-count cells, exit 0
(`/tmp/prd359-trust-census.log`); `pnpm exec tsx scripts/generate-retention-index.ts`
regenerated the index after staging the new evidence. No floor or limit was changed.
Final budget command: `pnpm budgets`, log `/tmp/prd359-trust-budgets-final.log`.
Acceptance requires that command to exit 0 and is recorded in EXECUTION.md.
Numeric-IP identity verification remains an explicit blocking Task 1b requirement.
