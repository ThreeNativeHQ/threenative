# PRD-359 isolated network impairment preflight — 2026-09-05

The Linux host can create a disposable user/network namespace and install netem on its
own loopback device. This is a prerequisite check for the required impaired lane, not
networking or platform qualification. No host route or host qdisc was changed.

Executed from the networking worktree, direct exit 0:

```sh
unshare --user --map-root-user --net -- sh -c 'ip link set lo up && tc qdisc add dev lo root netem delay 50ms 10ms loss 2% && tc qdisc show dev lo && ping -n -c 6 -W 2 127.0.0.1'
```

Output retained at `/tmp/prd359-netns-preflight.log`:

```text
qdisc netem 8001: root refcnt 2 limit 1000 delay 50ms  10ms loss 2% seed 3379996323778778814
6 packets transmitted, 5 received, 16.6667% packet loss, time 5047ms
rtt min/avg/max/mdev = 100.989/108.633/115.186/5.260 ms
```

The child namespace exited with the command. The six ICMP probes establish that the
isolated qdisc executes; they do not establish the required UDP loss/jitter distribution,
game latency, or transport behavior. In particular, configured 2% loss is not a measured
2% loss result: this tiny sample lost one packet. The eventual lane must run the real
server and both clients in the isolated environment, measure its required profile, and
collect the game assertions and metrics. Physical-device impairment needs its own
provisioning and cannot inherit this loopback result.
