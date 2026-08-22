# Gate status/resume contract — P2-6 verification (2026-08-21)

Executed on `main` at `a6ac7652`. All commands run from the repository root.

## Premise correction (read first)

The PRD cites `scripts/worktree-lifecycle.ts:300` and "Batch C" phase leases as existing
infrastructure. Neither exists on `main`: Batch C landed only on the unmerged branch
`linchpin/technical-debt-c` (commit `4ae2a87e`), and a complete prior P2-6 implementation exists
unmerged on `linchpin/technical-debt-p2-6-gates` (`94cecab7`, branched off the PRD-filing commit
`7e0771a0`). This execution adopted that lane's implementation onto `main` by file write (no
cherry-pick), reviewed and re-verified every file here; `scripts/worktree-lifecycle.ts` therefore
arrives as **NEW** on main, not EDIT, and the lease registry it provides
(`.git/threenative-worktree-leases.json`) is what the status records bind ownership to. The PRD's
ledger line references were updated accordingly in the PRD file.

## What ships

- `scripts/gate-status.ts` — atomic (temp file + rename) status record: `runId`, `phase`, `owner`,
  `ownerPid`, `pid`, `command`, `heartbeatAt`, `startedAt`/`finishedAt`, `exitCode`,
  `terminalResult`, `lease`, `worktree`, `artifact` identity. Fail-closed reader
  (`GateStatusError` → `RED observed: invalid or stale gate status — <reason>`) for malformed JSON,
  wrong schema version, future timestamps, owner/lease/worktree drift, stale heartbeats, and
  terminal-state inconsistencies.
- `scripts/gate-cli.ts` — `status` (read-only, never deletes or repairs anything), `doctor`
  (read-only, names the concrete next probe), `resume` (refuses unless recorded path, branch,
  HEAD, lease, artifact identity, and liveness all verify; then re-runs the single recorded phase
  through the production `scripts/run-test-suite.sh --resume` path and returns the child's exit
  code).
- `scripts/worktree-lifecycle.ts` — phase-lease registry with lock, heartbeat, verify, release;
  cleanup removes stale lease records only ("no worktrees changed").
- `scripts/run-test-suite.sh` — phases `docs → build → package-test → unit`, each wrapped with
  lease verify + status start/heartbeat/finish; heartbeat loop every 5 s (output to /dev/null,
  child stdout untouched); child exit code is the phase's return value and the suite's exit code.
  `check:docs` moved inside the suite as the `docs` phase (was a `&&` prefix on `pnpm test`);
  each phase runs exactly once, resume mode runs only the named phase.
- `package.json` — `gate:status`, `gate:resume`, `gate:doctor`, `worktree:status`,
  `worktree:cleanup`; `test` is now `bash scripts/run-test-suite.sh`.
- `AGENTS.md` (and generated `CLAUDE.md`) — the contract paragraph naming the status path, the
  three commands, and the no-repair guarantee.

## Status record examples (real runs)

Running (polled mid-build during a live `pnpm test`; heartbeat advanced
`05:27:05 → 05:27:19 → 05:27:33` across polls):

```json
{
  "artifact": {
    "identity": "tn-20260822T052644Z-1810075:build",
    "path": "/home/joao/projects/threenative/threenative-engine/artifacts/gates/status.json"
  },
  "command": "pnpm run build",
  "exitCode": null,
  "finishedAt": null,
  "heartbeatAt": "2026-08-22T05:27:05.533Z",
  "lease": {
    "branch": "refs/heads/main",
    "expectedHead": "a6ac7652477c5109725cc5d5fd0d762a71df4271",
    "owner": "joao@joao-cachyos",
    "path": "/home/joao/projects/threenative/threenative-engine",
    "phase": "build",
    "pid": 1810075,
    "runId": "tn-20260822T052644Z-1810075",
    "startedAt": "2026-08-22T05:26:47.982Z"
  },
  "owner": "joao@joao-cachyos",
  "ownerPid": 1810075,
  "phase": "build",
  "pid": 1810075,
  "runId": "tn-20260822T052644Z-1810075",
  "schemaVersion": 1,
  "startedAt": "2026-08-22T05:26:47.982Z",
  "state": "running",
  "statusPath": "/home/joao/projects/threenative/threenative-engine/artifacts/gates/status.json",
  "terminalResult": null,
  "worktree": {
    "branch": "refs/heads/main",
    "head": "a6ac7652477c5109725cc5d5fd0d762a71df4271",
    "path": "/home/joao/projects/threenative/threenative-engine"
  }
}
```

Succeeded (final record of the green `pnpm test`, fields beyond these unchanged in shape):

```json
{
  "phase": "unit",
  "command": "vitest run",
  "runId": "tn-20260822T053055Z-1834694",
  "state": "succeeded",
  "exitCode": 0,
  "finishedAt": "2026-08-22T05:33:22.873Z",
  "heartbeatAt": "2026-08-22T05:33:22.873Z",
  "terminalResult": { "exitCode": 0, "finishedAt": "2026-08-22T05:33:22.873Z", "state": "succeeded" }
}
```

Failed (deliberately failing unit phase in a scratch copy of the suite — see exit preservation):

```json
{
  "phase": "unit",
  "command": "sh /tmp/gate-scratch-child.sh",
  "runId": "tn-20260822T053402Z-1864275",
  "state": "failed",
  "exitCode": 7,
  "finishedAt": "2026-08-22T05:36:06.095Z",
  "heartbeatAt": "2026-08-22T05:36:06.095Z",
  "terminalResult": { "exitCode": 7, "finishedAt": "2026-08-22T05:36:06.095Z", "state": "failed" }
}
```

Stale (constructed fixture: real repo identity, heartbeat backdated past the 30 s bound, owner pid
dead; construction method stated because staleness was induced, not awaited):

```
$ pnpm exec tsx scripts/gate-cli.ts doctor --status-path /tmp/stale-demo/status.json
gate doctor (read-only)
run: tn-stale-demo-1
phase: build
state: stale
heartbeat: 2026-08-21T00:00:00.000Z
next probe: pnpm exec tsx scripts/gate-cli.ts resume --status-path /tmp/stale-demo/status.json

$ pnpm exec tsx scripts/gate-status.ts read --status-path /tmp/stale-demo/status.json
RED observed: invalid or stale gate status — heartbeat or phase owner is stale
READ_EXIT=1
```

`pnpm gate:status` against the live gate (user-verification action, mid-run):

```
gate status (read-only)
run: tn-20260822T052644Z-1810075
phase: package-test
state: running
heartbeat: 2026-08-22T05:27:19.297Z
owner: joao@joao-cachyos/pid:1810075
phase pid: 1810075
command: pnpm -r --workspace-concurrency=1 --if-present run test
worktree: /home/joao/projects/threenative/threenative-engine
HEAD: a6ac7652477c5109725cc5d5fd0d762a71df4271
artifact: /home/joao/projects/threenative/threenative-engine/artifacts/gates/status.json (tn-20260822T052644Z-1810075:package-test)
terminal result: none
```

## Child exit-code preservation

- Controlled: a scratch copy (`scripts/run-test-suite-scratch.sh`, untracked, deleted after) ran
  the identical phase wrapper with the unit phase pointed at a child that prints to stdout and
  stderr then exits 7. Suite exit `SCRATCH_EXIT=7` (= child's exit code), child output passed
  through verbatim (`scratch-child stdout marker: starting`, `scratch-child stderr marker`,
  `scratch-child failing on purpose` at log lines 2196–2198), status record `failed`/`exit 7`.
  The real script was not weakened.
- Observed in the wild: invoking the suite directly (not via `pnpm test`) leaves `node_modules/.bin`
  off PATH, so the unit phase's `vitest` exits 127 — the suite exited 127 and recorded
  `state: failed, exitCode: 127` faithfully. Same property as the pre-change script (bare `vitest`
  assumed pnpm's PATH).
- Resume: `pnpm gate:resume` on the failed record re-ran only the `unit` phase via the production
  script, preserved the run id `tn-20260822T053402Z-1864275`, vitest `Tests 1544 passed (1544)`,
  `RESUME_EXIT=0`, final record `succeeded`/`exit 0`.

## Observed-red negative controls

Control 1 — status integrity. Mutation: removed the fail-closed validation from the status reader
(`scripts/gate-status.ts`, `readRawStatus` parse/validate block replaced by a permissive passthrough).
Command and result (verbatim excerpts):

```
$ pnpm exec vitest run --config vitest.config.ts scripts/__tests__/gate-status.spec.ts
CONTROL1_RED_EXIT=1

 FAIL  scripts/__tests__/gate-status.spec.ts > gate status record > records running, heartbeat, and terminal child results atomically
TypeError: The "paths[0]" argument must be of type string. Received undefined
 FAIL  scripts/__tests__/gate-status.spec.ts > gate status record > should reject a stale or malformed phase record
AssertionError: expected [Function] to throw error including 'RED observed: invalid or stale gate s…' but got 'The "paths[0]" argument must be of ty…'
Expected: "RED observed: invalid or stale gate status"
Received: "The "paths[0]" argument must be of type string. Received undefined"
 FAIL  scripts/__tests__/gate-status.spec.ts > gate status record > rejects future heartbeats and owner-drifted worktrees
AssertionError: expected [Function] to throw error matching /RED observed: invalid or stale gate …/u
 Test Files  1 failed (1)
      Tests  3 failed (3)
```

Restored the block byte-identical; spec green again (3 passed, exit 0).

Control 2 — resume safety. Mutation: bypassed lease/drift verification in `scripts/gate-cli.ts`
(`assessResumeRecord(...)` call removed from `resumeGate`). Command and result (verbatim):

```
$ pnpm exec vitest run --config vitest.config.ts scripts/__tests__/gate-cli.spec.ts
EXIT=1
     ✓ keeps status read-only and names the next diagnostic probe 6ms
     × should refuse resume after worktree HEAD drift 5ms
     ✓ returns the exact child exit code after safe resume validation 2ms
 FAIL  scripts/__tests__/gate-cli.spec.ts > gate status and resume CLI > should refuse resume after worktree HEAD drift
AssertionError: promise resolved "+0" instead of rejecting
- Expected:
Error { "message": "rejected promise" }
+ Received:
0
      Tests  1 failed | 2 passed (3)
```

With verification bypassed, the drifted-HEAD resume started the child (stub returned 0) instead of
refusing — the guard is load-bearing. Restored byte-identical; spec green again (3 passed, exit 0).

## Gates

| Gate | Command | Exit |
| --- | --- | --- |
| Focused specs | `pnpm exec vitest run --config vitest.config.ts scripts/__tests__/gate-status.spec.ts scripts/__tests__/gate-cli.spec.ts` | 0 (2 files, 6 tests) |
| Full suite | `pnpm test` | 0 (docs → build → package-test → unit all green, status records closed `succeeded`) |
| Typecheck | `pnpm typecheck` | 0 |
| Lint | `pnpm lint` | 0 (warnings pre-existing/non-fatal; each changed file individually produces zero biome diagnostics) |
| Mirror sync | `pnpm sync:agents` then `pnpm sync:agents --check` | 0 ("agent docs in sync: 16 CLAUDE.md mirrors") |
| Biome on new files | `pnpm exec biome check scripts/gate-*.ts scripts/worktree-lifecycle.ts scripts/__tests__/gate-*.spec.ts` | 0, no fixes applied |

## Caller census (Integration Ledger)

| # | New thing | Live caller (non-test) | Negative control |
| --- | --- | --- | --- |
| 1 | Atomic gate status record | `scripts/run-test-suite.sh:108` (`gate-status.ts start`), `:132` (heartbeat loop), `:160` (finish), inside `run_phase()` at `:92` which wraps docs/build/package-test/unit | corrupt/stale JSON → reader fails closed (control 1 above, observed red) |
| 2 | Stable status/resume CLI | `package.json:24-28` (`gate:status`/`gate:resume`/`gate:doctor` + worktree commands), `AGENTS.md:163` documents them; `scripts/gate-cli.ts:186` (`spawnResume`) delegates to the production suite `--resume` path | drifted HEAD → resume refuses, no child starts (control 2 above, observed red) |
| 3 | Heartbeat and stale-owner policy | `scripts/worktree-lifecycle.ts:351` (`verifyCurrentWorktreeLease`, the `TN_WORKTREE_GUARD_FAILED` authority) invoked per phase at `scripts/run-test-suite.sh:102`; heartbeat loop at `scripts/run-test-suite.sh:132-151` feeds both the status record and the lease | stale heartbeat/dead owner → strict read fails closed (`READ_EXIT=1`, output above); doctor reports `state: stale` with a resume probe |

## No destructive cleanup

`status` and `doctor` only read. `resume` verifies then re-runs the recorded phase; it never deletes
or repairs a worktree. `worktree:cleanup` removes stale lease records only and prints "no worktrees
changed". The lease registry lives in `.git/threenative-worktree-leases.json`; after the green runs
it is empty (`{"leases": [], "version": 1}`).

## Unmet / notes

- The PRD's "EDIT `scripts/worktree-lifecycle.ts`" wording is unfulfillable on main as written —
  the file did not exist here; it ships NEW in this change (see premise correction). The PRD file's
  ledger rows were annotated accordingly.
- Revert check ("remove the status write from one phase; the status integration test fails"): there
  is no dedicated meta-test asserting per-phase status writes; the proof that phases write status is
  observational (live polls above show the record appearing, advancing, and closing per phase). If a
  phase's status write were removed, the record would hold the previous phase's terminal state and
  `gate:doctor` would report that stale/failed state with a resume probe — demonstrated by the
  stale fixture — rather than live progress.
- The suite must be invoked through `pnpm test` (as before the change): direct invocation leaves
  `node_modules/.bin` off PATH and the unit phase fails 127 (recorded honestly, see above).
