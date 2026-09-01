# PRD-313 — ThreeNative HQ, phases 0 to 3 and the hook lane

**Run 2026-08-31** against engine `4e1e1166`, game at `sandbox/threenative-hq` (`ae8cb7e`).
Everything below was executed on this machine; nothing is claimed that was not run.

## What is green

| Gate | Result | Negative control, observed |
| --- | --- | --- |
| `pnpm test` → `hq-office` (scripted fixture bridge) | PASS | Point the office at `ws://127.0.0.1:7999/office`: all four rows red, floor empty, `arrivals` stays 0 |
| `pnpm test` → `hq-office-live` (this machine's bridge) | PASS, 13 sessions / 13 workers | Skipped by the runner when no bridge answers on 7373, rather than reported as passing |
| Worker clip mapping, five clips at labelled steps | PASS | Point `working` at `Sitting_Idle_Loop`: `settle-work` red, other four green |
| Bridge `/sessions` vs `ps` | 13 = 13 | — |
| Hook path end to end | `Notification` → session `source: "hook"`, `state: "blocked"` | `{"host":"pirate"}` → `400`, registry unchanged |
| Hook installer against a copy of this machine's `~/.claude/settings.json` | existing `count_tokens.js` Stop hook and `env` block both survive | dry run by default; `--write` required |
| `pnpm typecheck` | PASS | — |

Screenshots, committed beside the game: `screenshots/office-live.png` (16 desks, 16 workers, lit
monitors on the working sessions), `screenshots/bridge-offline.png` (empty floor, `BRIDGE OFFLINE`
banner, nobody still typing).

## The finding that changed the design

The PRD specified transcript tailing as the discovery lane. On this machine it reported **606 live
sessions**: something had touched **4,413 transcripts** — May's included — inside one minute, so
`mtime` says nothing about whether an agent is sitting there working.

```
$ find ~/.claude/projects ~/.codex/sessions -name '*.jsonl' -mmin -15 | wc -l
4413
```

Liveness now comes from the process table (`tools/office-bridge/processes.ts`): a live session is a
live process, `/proc/<pid>/cwd` gives the repository, and CPU time between two scans says whether
it is doing anything. The transcript lane survives as the fallback for hosts without a readable
`/proc`, and every session reports which lane produced it.

## Not done

- **Phase 4** — arrivals and departures are placed, not walked. `NavigationRegion3D` / `NavigationAgent3D` are not wired yet.
- **Phase 5** — clicking a worker does not yet open a card; `PointerEvents3D` is unwired.
- **Inbound messaging** — out of scope by the PRD, and still is.
- **Native target** — browser only. The bridge is a Node daemon on loopback; a native HQ needs its own lane.

## Engine-shaped friction

Six items in `sandbox/threenative-hq/FRICTION.md`, of which two are worth reading before the next
game: the Fab importer is `StaticMesh`-only, so no rigged Fab character can reach a game
(`threenative-asset-mcp` `src/unreal/importer.ts:927,944`), and the engine repository's own
`.mcp.json` points at `./node_modules/@threenative/core/mcp/assets.mjs`, which cannot resolve in a
workspace checkout — so an agent working in this repository has no asset or capability tools at
all, and is told nothing.
