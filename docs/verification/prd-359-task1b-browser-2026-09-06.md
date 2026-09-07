# PRD-359 Task 1b browser trust proof

Status: qualified for the stated scope. Recorded 2026-09-06 in worktree
`networking-359`; Linux Chrome for Testing `151.0.7922.34` only.

## Commands and evidence

The final recorded commands run from
`artifacts/networking-359/task1b-browser-trust/`; their exits are:

```text
bash prepare-fixtures.sh > prepare-forced-quic-final.log 2>&1           exit 0
node --check run-forced-quic-proof.mjs                                 exit 0
node run-forced-quic-proof.mjs > run-forced-quic-proof-final.log 2>&1  exit 0
node ipv6-hostname-probe.mjs > ipv6-hostname-probe.log 2>&1            exit 0
node ipv6-numeric-diagnostic.mjs > ipv6-numeric-diagnostic.log 2>&1   exit 1 (expected)
```

Primary records are `artifacts/networking-359/task1b-browser-trust/results-forced-quic.json`
(10 page records, 7 listener records) and `PROOF.md`.

The ordinary HTTPS control returned exactly `HTTPS_TRUST_OK`. WebTransport positives
were:

| case | exact URL and transport | result |
| --- | --- | --- |
| IPv4 | `https://127.0.0.1:38480/echo` | 64 KiB byte-identical stream, 32-byte datagram, and 1 KiB unidirectional stream; 3/3 checks |
| DNS | `https://localhost:38480/echo` | same three checks; 3/3 |
| IPv6 socket | `https://localhost:53782/echo`, `MAP localhost [::1]` | same three checks; 3/3 |

The three TLS negatives have exact endpoint controls on the same UDP ports:

| negative | endpoint | control on same port |
| --- | --- | --- |
| wrong hostname | `https://127.0.0.1:44807/echo` | `https://localhost:44807/echo` passes 3/3 |
| untrusted root | `https://127.0.0.1:33967/echo` | trusted leaf swap at `:33967` passes 3/3 |
| expired leaf | `https://127.0.0.1:58334/echo` | current trusted leaf swap at `:58334` passes 3/3 |

Each negative has zero checks and Chrome
`ERR_QUIC_PROTOCOL_ERROR.QUIC_TLS_CERTIFICATE_UNKNOWN` with
`CERTIFICATE_VERIFY_FAILED`; the harness requires that TLS-specific observation
(`run-forced-quic-proof.mjs:366-378`). The seven Go listeners all report exit 0 and
`shutdownTimedOut:false` (`results-forced-quic.json:351-421`). Browser contexts close
in `run-forced-quic-proof.mjs:242-244`; fixture and static-server cleanup is in
`:497-504`.

## Trust boundary and provenance

`prepare-fixtures.sh:86-90` imports only the trusted CA into the two artifact-local
NSS databases. The runner deletes ambient `SSL_CERT_FILE` and `NODE_EXTRA_CA_CERTS`
(`run-forced-quic-proof.mjs:21-23`), sets child-only HOME/XDG paths and
`ignoreHTTPSErrors:false` (`:212-225`), and uses no certificate-error ignore flag,
SPKI/hash pin, or global WebTransport flag. The only QUIC policy flag is the
host-scoped `--origin-to-force-quic-on=<host:port>` (`:195-224`); the negative
certificate results show that chain, hostname, and expiry verification still run.

The recorded hashes are:

```text
Chrome executable  0b20b130e7edd9dd51873be867761295fe0cfad490c2b9a64f95bd3cfc08fa71
Go server          86b7b5661b9a6abaf6ea2c16f5fe55e5cbc40140693054bb3843985d23d5b4c6
client.html        e3b46d045b06e95e4e246f879ecdbd8c66dd6f1807093fdff80b680367dc83f8
trusted CA         df91eb2892b683938982862051ac644ef64b72e1cd018087aca0f76851830fb3
valid leaf         6bc17548b46e6f391f0b17593141bb9b6c5af85d3881c3480d437cd5a6f27c1f
wrong leaf         9b13e5dedb32b7ab685306971bb86a596c6972e30e8e40beb435957f9cc7ed4e
untrusted leaf     1c77d22227d7e03d150fe7f742274e3b15ef16b241cdc7a083628d17147f18bb
expired leaf       b71009fe4c66f9c8d384fc690b99dcd3fe7cf90e4b3201981aac536aa2df3d81
```

The policy and IPv6 interpretation are supported by the primary Chromium sources
linked from `PROOF.md:65-70`: [network session conversion](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/network_session_configurator/browser/network_session_configurator.cc), [per-origin WebTransport allowlist](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/quic/dedicated_web_transport_http3_client.cc), and [certificate verification](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/quic/crypto/proof_verifier_chromium.cc).

## Limits

This is a Linux Chrome 151 browser qualification. The direct numeric IPv6 URL
`https://[::1]:port` remains an expected exit-1 diagnostic and is not claimed as
passing. The positive IPv6 case uses the DNS name `localhost`, mapped to the owned
`[::1]` listener, so it proves IPv6 transport with DNS identity rather than direct
numeric-IPv6 origin allowlisting. No other browser version or platform is covered.
