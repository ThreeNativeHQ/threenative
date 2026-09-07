# PRD-359: local patched-quiche host proof

Scope: Linux x86-64, V8, separate scratch-linked host. This is not shipped dependency or cross-platform qualification. Task 1b remains open.

The packaged quiche 0.24.6 TLS identity path uses a DNS-name check for numeric IP authorities. The prepared patch selects BoringSSL IP-SAN verification for IP literals, preserves DNS verification, and sends no numeric SNI. Upstream source version remains 0.24.6; distribution integration is pending.

The root reran the local link and real Go/native socket proof, then a fresh read-only reviewer accepted the evidence. The linker changes only its output path and quiche archive argument. Hashes are captured before linking and after the proof; the normal runtime and installed archive are unchanged.

## Executed commands

From the networking-359 worktree:

```sh
python3 artifacts/networking-359/ip-san-host-proof/link-patched-host.py
python3 artifacts/networking-359/ip-san-host-proof/run-ip-san-host-proof.py
```

Both exited 0. Proof output:

```text
PASS: IPv4 and IPv6 numeric IP-SAN 64KiB FIN echoes; wrong-IP secure rejection; insecure control
```

| Case | Host exit | Observation |
| --- | ---: | --- |
| ipv4-original-red | 1 | TLS receive error -10; no echo pass marker |
| ipv4-patched-green | 0 | 65,536 ordered bytes and FIN |
| ipv6-original-red | 1 | TLS receive error -10; no echo pass marker |
| ipv6-patched-green | 0 | 65,536 ordered bytes and FIN |
| wrong-ip-secure-red | 1 | TLS receive error -10; no echo pass marker |
| wrong-ip-insecure-control | 0 | 65,536 ordered bytes and FIN |

Both original-host failures and patched-host successes use the same live endpoints, certificates and process-local SSL_CERT_FILE. Verified positives do not set the insecure override. The wrong-IP negative has an exact-endpoint insecure byte-echo control. Per-run certificates include the tested IP SANs; the wrong-IP certificate has only IP:127.0.0.2. Every Go child is stopped after the run.

## Artifact identities

| Artifact | SHA-256 |
| --- | --- |
| Original host, before and after | `da520911c8cbe35f5d4b60cbc115ba7c37b03a6d81ea774018d522eb4aef542f` |
| Installed quiche, before and after | `a1ae1310280ec926314425253547c86ae5cb4b2fb5da2db75e8314efb019f26d` |
| Patched local quiche | `7a9b84fb989f9a82c8b36bce685a66b0835e99f9eaf0487024bb8ca2433f090f` |
| Scratch host | `0b0a4ef39ce48b1544baa921ce1c8bd174c2ff6a816f792c4f4494845c9e9241` |

Local logs, exact transformed linker command, fixture sources and machine-readable results are in ignored `artifacts/networking-359/ip-san-host-proof/`. The carried patch and six-case Rust TLS evidence are in `artifacts/networking-359/ip-san-investigation/`. These local artifacts are not published release assets.

Source-level controls also showed original numeric IPv4/IPv6 positives fail; a numeric DNS SAN is incorrectly accepted by the original DNS path; the patched source passes all six tests. An identity-bypass mutation makes the wrong-IP and DNS-only rejection tests fail. This does not replace the socket proof above.

Open: reproducible owned dependency build, published per-platform assets and checksums, normal-host integration, browser qualification and remaining non-iOS platform execution. No PR or merge is established by this evidence.
