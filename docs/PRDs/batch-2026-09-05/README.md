# Three priorities for September 5, 2026

Status: PROPOSED. These are implementation plans, not completed fixes.

| Rank | PRD | Why today | Engineering estimate |
| --- | --- | --- | --- |
| 1 | [360 — Resume unfinished friction rounds](PRD-360-unfinished-friction-rounds-remain-resumable.md) | The current `round:next` command exits 1; the same record makes alpha A4 unmeasured. Restore the team's next-action instrument first. | 3–5 hours |
| 2 | [361 — Prove release archives before publishing](PRD-361-release-tests-the-archives-before-publishing.md) | Release dry runs pack without exercising the consumer; installation is currently checked after immutable publication. | 4–6 hours, plus full golden-path execution |
| 3 | [362 — Bind install proof to the release](PRD-362-install-evidence-identifies-the-release-it-proves.md) | Today's A2 pass comes from an August 16 scaffolder run. The current registry runner requests `latest`, without identifying the intended release. | 3–5 hours, plus registry/native proof execution |

These are the highest priorities from this inspection, not an exhaustive product audit. Estimates
are active engineering time, not a promise that all three fit one person's working day. Start 360
today; sequence 361 before the next publication, then 362 before claiming that release installable.
361 and 362 both touch the release entry point and should land in that order.

## Evidence collected today

Baseline: `eb1149dd28a3cccf45c885e7caa2ae2bfaf9a0da`; the working tree was initially clean.
Read the root and PRD instructions, current round and alpha records, open backlog, related archived
PRDs, and production release/registry/golden-path/round implementations and their test coverage.
The commands below were executed read-only; excerpts are copied from their output.

```text
$ pnpm round:next
Malformed round ledger found in /home/joao/projects/threenative/threenative-engine/docs/verification. Rejected: /home/joao/projects/threenative/threenative-engine/docs/verification/round-14-2026-09-04.md: Round ledger section 'Dispositions' has no table.
ELIFECYCLE Command failed with exit code 1.

$ pnpm alpha:bar
A1  fail        A stranger can install it from the public registry
    3 of 11 publishable package(s) are absent from the registry: @threenative/raw-unreal, @threenative/ueformat, threenative-blender-mcp.
A2  pass        The golden path completes from published artifacts
    npx create-threenative@0.2.2 scaffolds, npm install resolves every package from registry.npmjs.org with zero file:/link: specifiers, and npm run build succeeds. (docs/verification/registry-install-2026-08-16.md, produced by: npx --yes create-threenative@0.2.2 my-game --template starter && npm install && npm run build, in a directory with no workspace above it)
A4  unmeasured  The value claim rests on one measured paired round
    1 of 14 round ledger(s) could not be parsed, so the current state is unknown: docs/verification/round-14-2026-09-04.md (Round ledger section 'Dispositions' has no table.).
A7  fail        The bar is runnable, not transcribed
    The generated table in docs/verification/alpha-bar.md does not match this run. Rerun pnpm alpha:bar --write.
1 of 7 rows unmeasured, 2 failed, 1 deferred. Not alpha.
ELIFECYCLE Command failed with exit code 2.
```

`pnpm gate:status` also exited 1 because its recorded HEAD differs from the current HEAD.
The required follow-up `pnpm gate:doctor` exited 0 and reported `status: blocked` with that same
reason. That is a correctly refused stale record, not sufficient evidence of a new gate bug.

## Scope decisions

1. Missing registry packages are a real release gap, but publication already has owners in
   [PRD-060](../BLOCKED/requires-release-credentials/PRD-060-promoted-consumer-distribution.md)
   and [PRD-119](../done/PRD-119-the-alpha-release-train.md). No new publishing campaign here.
2. Native reliability, performance regression CI, networking and capability discoverability already
   have substantial open PRDs. This batch repairs concrete failures in deciding and proving what ships.
3. The PRD creator skill shaped the plans: each names its existing caller, replacement, bounded
   phases, and negative controls. No new package or public gameplay API is proposed.

Full typecheck, lint, unit, browser and native gates were not run for this planning-only change.
The observed failures above are discovery evidence; future implementation must record red/green
outputs in `docs/verification/` and link them from its PRD. No platform pass is claimed here.

Next action (under 2 minutes): open PRD-360 and run its first reproduction command.
