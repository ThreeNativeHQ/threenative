# PRD-359 TLS trust prerequisite — 2026-09-05

Executed while Task 2a was running. This is a prerequisite probe, not Task 1b qualification.
A copy of the already-rebuilt native binary (SHA256
`2ef26e4713f60f6702b6a8db29e9654ca46a8dbc8b40195a8b2d5681b4612e6e`) was isolated at
`/tmp/networking-359-tls-preflight/mystral` to avoid concurrent build changes.

Generated a two-day P-256 self-signed certificate with SANs localhost and 127.0.0.1,
using `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes ...`.
The key and certificate remain only in the temporary fixture directory. Started the
canonical Go server with `--listen 127.0.0.1:0 --cert <fixture-cert> --key <fixture-key>`.
The client received `SSL_CERT_FILE=<fixture-cert>` only in its child environment;
`MYSTRAL_WEBTRANSPORT_INSECURE` was removed. No machine trust store was changed.

Command from the worktree:

```sh
XDG_RUNTIME_DIR=/tmp/xdg-runtime-wt sh scripts/xvfb.sh \
  node /tmp/networking-359-tls-preflight/probe.mjs
```

Exit 1. A repeat captured the complete native diagnostic (same configuration, no attempted fix):

```text
[WebTransport] TLS peer verification mode: verify-peer (parsed from MYSTRAL_WEBTRANSPORT_INSECURE=<unset>)
[WebTransport] quiche_conn_recv failed: -10
[log] TLS_PREFLIGHT_REJECTED:WebTransport closed before ready
NATIVE_EXIT=1
```

The script awaited its owned Go server shutdown and used a 15-second client deadline.
Logs: `/tmp/networking-359-tls-preflight/result.log` and `native.log`.

The packaged header exposes `quiche_config_load_verify_locations_from_file` at line161.
Upstream quiche0.24.6 TLS Context::new calls load_ca_certs; its non-Windows implementation
uses SSL_CTX_set_default_verify_paths. This inspection did not prove that this packaged
BoringSSL honors SSL_CERT_FILE; the live run demonstrates that the intended fixture trust
was not effective. Source: https://github.com/cloudflare/quiche/blob/0.24.6/quiche/src/tls/mod.rs
(lines143,207–208). Do not claim a definitive library-internal cause from this probe alone.

Task1b-trust will explicitly load the operator-provided process-local CA through the
existing quiche API and verify positive and negative cases. Peer verification must remain
on; an insecure flag cannot satisfy this lane. Browser/other platforms are unexecuted here.
