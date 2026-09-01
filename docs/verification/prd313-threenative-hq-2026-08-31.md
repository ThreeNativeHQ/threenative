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

## Second run, same day: phases 4 and 5, first person, and two engine fixes

Game at `dc84ec8`, engine at `d114c509`. Three proof lanes, all green in one `pnpm test` (exit 0):

| Lane | Proves | Negative control, observed |
| --- | --- | --- |
| `hq-office` | fixture bridge: arrivals ≥ 4, departures ≥ 1, blocked seen, the focus desk changing hands, the fourth session **walking** ≥ 2 m to its desk, and the panel's own list selecting a session | dead bridge port: every row red, floor empty |
| `hq-visitor` | first person: 27.3 m walked, and the walls still hold you inside the room | before the floor collider existed the same run ended at (-21.9, 33.1), outside the building |
| `hq-office-live` | this machine's real bridge, no console errors | runner skips the lane when nothing answers on 7373 rather than passing it |

**Phase 4** — `NavigationRegion3D` bakes the floor, `NavigationAgent3D` paths each arrival, and the
worker walks in and sits down. Desks are ordered by distance from the door so the floor fills from
the entrance. Sessions already running when the office opens are seated where they are rather than
staged through a fake commute.

**Phase 5** — clicking a worker, or a row in the panel, opens its card: repository, host, state,
last tool, and which lane the bridge learned it from. No prompt text exists on the wire to leak.

**Beyond the PRD, at the owner's request:** you can walk the floor in first person, the room is
solid, and the HUD was replaced by a hideable right-hand panel with a live summary.

### Two engine bugs, found by this game and fixed in the engine

1. **Seven of eight templates asked for MRT targets nothing wrote** (`d114c509`). With SSGI, SSR and
   GTAO off, the generated render chain still called `getTextureNode("normal"|"metalness"|"roughness")`,
   so ordinary materials got colour attachments their fragment stage never writes and WebGPU refused
   the pipelines. Sailing already had the fix and it had never been propagated. Red: 12 console
   errors a frame. Green: 0.
2. **A duplicate clip name now says what to do about it.** Two clip libraries on one rig is how a
   character's vocabulary gets assembled and they all ship a bind pose under the same name.

A third suspected engine bug — that picking could not hit a loaded model or a skinned mesh — was
**disproved** by three new tests in `packages/core/__tests__/picking.spec.ts`, and the friction log
was corrected. The tests stay: that case had no coverage.

## Not done

- **Inbound messaging** — out of scope by the PRD, and still is.
- **Native target** — browser only. The bridge is a Node daemon on loopback; a native HQ needs its own lane.
- **`at: { entity }` clicks on workers** — the runner reports no observed screen bounds for an entity
  added during the frame loop, while the same entity's movement assertion resolves. Worked around by
  clicking the panel; not chased to a root cause.
- **`pnpm test:templates`** — not run for the render-chain fix. The seven changed files are now
  byte-identical to the one that already passes that gate.

## Engine-shaped friction

Six items in `sandbox/threenative-hq/FRICTION.md`, of which two are worth reading before the next
game: the Fab importer is `StaticMesh`-only, so no rigged Fab character can reach a game
(`threenative-asset-mcp` `src/unreal/importer.ts:927,944`), and the engine repository's own
`.mcp.json` points at `./node_modules/@threenative/core/mcp/assets.mjs`, which cannot resolve in a
workspace checkout — so an agent working in this repository has no asset or capability tools at
all, and is told nothing.
