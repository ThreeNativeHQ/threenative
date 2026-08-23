# Gate records on every chain — PRD-179 Phase 2 — 2026-08-22

Lane: lane-hygiene. PRD: `docs/PRDs/batch-2026-08-22/PRD-179-instruments-measure-growth.md`.
Part 1 (writer + `run-test-suite.sh` reduction) landed in d477d3ed; this record covers part 2:
the six chains wired to the shared writer, plus the ordered end-to-end proof on `pnpm parity`.

## What was wired

`sweep-capture.ts`, `template-baseline.ts`, `visual-gate.ts`, `profile-native-cpu.ts`,
`packages/runtime-native/scripts/profile-production.mjs` and
`packages/runtime-native/conformance/run-conformance.mjs` now emit the shared record at their
phase boundaries through `scripts/gate-records.mjs`. The recorder also registers, heartbeats and
releases the matching worktree-lifecycle lease, because `gate:status` cross-checks a running
record against the live registry exactly as it does for the test suite.

Two design points found by execution, not by reading:

1. **A chain that blocks its own event loop starves an in-process heartbeat timer.** The
   conformance parent spends whole lanes inside `spawnSync`; its first live run showed
   `hbAgeSec` climbing 4→29 while "running". The recorder therefore spawns a detached
   `gate-records.mjs heartbeat-loop` helper that heartbeats both the record and the lease from
   its own event loop, exiting when the record turns terminal or the owning pid dies.
2. **The multi-target lane loop re-executes `runnerPath`.** Every lane child re-entered the
   entry block and tried to register its own lease on the same worktree
   (`TN_WORKTREE_OWNED`). The outermost invocation now sets `TN_GATE_NESTED=1` (inherited by
   spawn); nested children run bare.

Chains honour `TN_GATE_STATUS_PATH` directly, like the suite does when it passes `--status-path`.

## Ordered proof on pnpm parity

**During a live run** (state running, fresh heartbeat):

```
gate status (read-only)
run: tn-20260822214829156-139920
phase: parity
state: running
heartbeat: 2026-08-22T21:49:10.420Z
owner: joao@lane-hygiene/pid:139920
phase pid: 139920
command: pnpm parity
worktree: /home/joao/projects/threenative/threenative-engine
HEAD: 53decd00cf14ce2bc4ac7828648b18fa1ff86682
artifact: .../artifacts/gates/status.json (tn-20260822214829156-139920:parity)
terminal result: none
```

**Kill the chain mid-phase** (`kill -9` of the process group): the frozen record goes stale and
every tool answers from it alone —

```
pnpm gate:status -> RED observed: invalid or stale gate status — heartbeat or phase owner is stale

pnpm gate:doctor ->
gate doctor (read-only)
run: tn-20260822214829156-139920
phase: parity
state: stale
heartbeat: 2026-08-22T21:49:30.514Z
next probe: ... gate-cli.ts resume ...
```

**Negative control** — same chain, `TN_GATE_STATUS_PATH=/tmp/bogus-gate/status.json`: the bogus
path received the writer's record (`tn-20260822215051409-160244 parity succeeded`) and the real
record stayed byte-identical (sha256 equal before/after). The record comes from the writer at the
configured path, not from stale state on disk.

First live-run attempt also surfaced the value of the staleness contract: an earlier killed run's
frozen record made the next `gate:status` read fail closed until the stale lease was cleaned —
the instrument refuses to show a healthy-looking record nothing is updating.

## Gates this lane

| Gate | Result |
| --- | --- |
| `vitest run scripts/__tests__/gate-records.spec.ts` | 4 passed |
| biome on the nine touched files | 0 errors (pre-existing complexity warnings in untouched functions only) |
| `tsc --noEmit -p tsconfig.json` | clean except one foreign WIP error: `packages/playtest/__tests__/mailbox-silence.spec.ts` (untracked PRD-167 lane file referencing a `playtest` field core does not ship yet) |

Not claimed here: a green parity lane end-to-end (the lanes' own environment needs are outside
this PRD — the verification rows above need a *running* and a *killed* chain, both produced).
