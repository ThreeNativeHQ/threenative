# Studio hosting — sandbox boundary evidence, 2026-08-13

What was executed against the session sandbox, and what was not. Nothing here is a security
claim about a deployed service; there is no deployed service.

**Environment.** One Linux operator workstation, kernel 7.1.4, Docker 29.6.2, `runc` as the only
registered OCI runtime. No microVM host, no cloud account, no deployment. Branch
`docs/studio-hosting-series`.

## Executed, with the negative control observed

| Probe | Result | Negative control seen failing |
|---|---|---|
| A sandbox cannot reach the database | pass | Joining the sandbox to the `data` network → `TN_REACHED_DB` |
| No container or hypervisor socket inside a sandbox | pass | Mounting `/var/run/docker.sock` → found |
| No capabilities, and none obtainable | pass | Dropping `--cap-drop ALL` and `no-new-privileges` → `CapEff` non-zero |
| A fork bomb is contained at the pid cap | pass | Dropping `--pids-limit` → ran past four times the cap |
| Allocation refused past the memory cap | pass | Dropping `--memory` → allocated 4 GB |
| The provider key is absent from a live sandbox | pass | The same search run against a sandbox with a planted key found it |
| The control plane refuses to boot on the container driver outside `local` | pass | Removing the guard call → the socket bound |
| A live sandbox cannot reach the control plane or the database | pass | The gateway probe on the same run connects, so a refusal is isolation and not a dead network |
| **gVisor gives a process its own kernel on this host** | pass | Same probes without gVisor: kernel `7.1.4-1-cachyos` both sides, all 851 host pids visible, `/dev/kvm` present |

The database probe is worth recording separately. It first used `nc`, which the sandbox image does
not ship, so it reported "denied" for a missing tool and stayed **green with the network boundary
removed**. It was rewritten to use node. A probe that cannot fail for the reason it claims is
worse than no probe, because it is counted as evidence.

## The kernel boundary, measured

gVisor `release-20260810.0`, run rootless from a user directory — no root, no daemon change:

| Probe | Host | Inside gVisor |
|---|---|---|
| `uname -r` | `7.1.4-1-cachyos` | `4.19.0-gvisor` |
| Visible pids in `/proc` | 851 | 3 |
| `/dev/kvm` | present | absent |

And the **session image itself**, exported to an OCI bundle and run by gVisor directly:

| Probe | Host | Sandbox image under gVisor |
|---|---|---|
| `uname -r` | `7.1.4-1-cachyos` | `4.19.0-gvisor` |
| `node --version` | — | `v22.23.2` — the runtime a session needs, working |
| Visible pids | 851 | 3 |

So the mechanism works, and the image a session boots runs correctly under it. **Neither is the
same as a session actually using it.** A
sandbox is started by `DockerDriver`, which passes `--runtime` only when `SANDBOX_RUNTIME` is set,
and Docker will only accept `runsc` once it is registered in `/etc/docker/daemon.json` — which
needs root. Until that registration happens, sessions still run on `runc` and share the host
kernel.

## Not executed — no claim is made

| Property | Why not |
|---|---|
| Two **sessions** do not share a kernel | gVisor is installed and proved to separate the kernel (above), but it is not registered with the Docker daemon, so `DockerDriver` cannot hand a session to it. The mechanism is proved; its use by a session is not. |
| ~~The control plane is unreachable from inside a sandbox~~ | **Now executed.** From inside the container the broker started: `control-plane:8081` refused, `postgres:5432` refused, `gateway:8083` connected. The control plane reaches sessions over a per-session unix socket and is not on the sandbox network. |
| The cloud metadata endpoint is unreachable | Denied in the `MachineDriver` payload. Never enforced, because no microVM has run. |
| The gateway is reachable and nothing else is | The allowlist exists at payload level only. |
| Disk is capped per session | Not implemented. `repositoryBytes` is stored and never measured. |
| Anything about a deployed environment | Nothing is deployed. |

## What this evidence supports

That a session sandbox on this host is bounded in pids, memory and cpu, holds no capabilities,
cannot obtain any, has no route to the database, and carries no provider credential — each proved
from inside a live container and each seen failing when its rule was removed.

It also supports that gVisor separates the kernel on this host, measured rather than assumed.

**It does not yet support the claim PRD-103 is named after.** A *session* still runs on `runc`,
because Docker has not been told about `runsc`. Registering it is one root command; until then the
boundary between two customers' sessions is namespaces, not a kernel.
