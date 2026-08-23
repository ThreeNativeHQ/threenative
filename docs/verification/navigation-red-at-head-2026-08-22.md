# Reproduction — `navigation.playtest.json` red at HEAD, 2026-08-22

Filed as [PRD-176](../PRDs/done/PRD-176-navigation-scenario-navigator-never-moves.md) (complete 2026-08-22).
Recorded so the PRD's §1 quotes a run that actually executed, not a memory of one.

## What executed

- Repository state: `main` at `a84f08da`, working tree clean for all packages involved.
- Scenario: `examples/abyss-framework/playtests/navigation.playtest.json` (web target).
- Command:

```sh
sh scripts/xvfb.sh node packages/playtest/dist/runner/cli.js \
  examples/abyss-framework/playtests/navigation.playtest.json \
  --url http://127.0.0.1:5180 \
  --server-command 'pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5180 --strictPort' \
  --browser-recipe webgpu --headed
```

Exit code `1`, top-level `"pass": false`. Run twice with identical assertion rows; both runs under
`--headed` with the `webgpu` recipe and no adapter warning.

## Result (quoted from the runner JSON)

| Assertion | Pass | Details |
| --- | --- | --- |
| `diagnostics` | true | `consoleErrors: 0`, `networkErrors: 0`, policy all enforced |
| `movement.pathLength` | **false** | `{"minimum":9,"pathLength":0}` |
| `movement.reachesPosition` | **false** | `closestDistance: null`, expected `[0, 0.75, 0]`, `maxDistance: 0.7` |
| `visibility.navigator` | **false** | below `minProjectedPixels: 100` |

`frames: 212`. The scene loads clean — zero console errors, zero network errors — so this is not a
crash or a load failure: the `navigator` entity accumulates no movement across the entire run.
`closestDistance: null` means the runner never recorded even one sample near the target, which
points at the navigation driver never producing a route (or never driving the entity), not at a
route that overshoots or stalls partway.

## Also observed, attributed separately

One additional run without `--headed` fell back to SwiftShader
(`TN_PLAYTEST_SOFTWARE_ADAPTER`) and additionally captured 22 console errors and 22 runtime
diagnostics on top of the same three assertion failures. Those console errors are attributed to the
software-rasteriser lane, not to this defect; they are recorded here only so a later reader does not
rediscover them and mistake them for the cause.

## Artifacts

The run overwrote `artifacts/playtest/` (`console.json`, capture, trace). This file carries the
durable copy of the result; treat that directory as last-run-wins.

## Diagnosis (PRD-176 criterion 1) — 2026-08-22

**Layer: game/harness side, not engine.** The scenario was being driven against the wrong page,
and two later harness guards then fire on the scene it did load. No line of
`packages/physics/src/navigation/` is implicated.

1. **Wrong entry point — the cause of §1's three red rows.**
   `examples/abyss-framework/index.html` selects the game's entry by query parameter:
   `?navigation` loads `src/navigation-main.tsx` (the `NavigationProbe` scene that owns the
   `navigator` entity); any other URL loads `src/main.tsx`, the abyss game, which registers only a
   `player` entity (`examples/abyss-framework/src/scenes/Abyss.ts:230`). The scenario JSON cannot
   carry the route (`packages/playtest/src/scenario.ts` has no URL field), so the route lives in
   the invocation — and every invocation in this record, in PRD-171's stash check, and in today's
   reproduction used a bare `--url` with no query. The runner therefore sampled the abyss game for
   an entity that does not exist there. My own reproduction of the red (same recipe as above, port
   5173, hardware NVIDIA Turing adapter per `capture.adapter`) shows it directly:
   `observations.resources.state` contains `status: "attract"`, `hull`, `score` and a `player`
   component drifting to x≈297 — abyss-game state, not `NavigationProbe`'s lone
   `distanceToTarget`. With no `navigator` to sample, `pathLength` is 0, `closestDistance` is
   `null`, and visibility fails, while diagnostics stay clean — exactly §1's table. The green run
   below settles it: with `?navigation` the movement rows pass with values byte-identical to the
   2026-08-09 green in `docs/verification/PRD-034.md` (`pathLength 9.623701493015632`,
   `closestDistance 0.006768826545260287`) — deterministic fixed-step replay, so navigation
   behaviour at HEAD is unchanged since the last proof.
2. **Triviality guard, added after the scenario was authored.** With the right page loaded,
   `visibility.navigator` still failed:
   `TN_PLAYTEST_ASSERTION_TRIVIAL` — the probe camera frames the whole floor from tick 0
   (`NavigationProbe.ts:106-107`), so the row is already satisfied in the *before* snapshot and
   proves nothing by passing (`packages/playtest/src/assertion-evaluators.ts:944-945`,
   `guarded()` at 1929). Fixed in the scenario with `allowTrivial`, the same idiom
   `native-smoke/device-smoke.playtest.json` uses.
3. **Blank-capture guard, also post-dating the scenario.** `TN_CAPTURE_BLANK`: bright pixel ratio
   0.02062 < 0.05 (`packages/playtest/src/capture.ts:4-5,99-102`). The probe renders sparse
   basic-material boxes on a dark background; its evidence is movement plus projected-bounds
   visibility, not pixels on screen, so the scenario now declares
   `"artifacts": { "screenshots": false }` — the idiom of its chain-mate
   `movement-axis.playtest.json`.

**Prime suspect checked and rejected.** The handed-over suspect —
`packages/physics/src/navigation/NavigationAgent3D.ts:160` storing the computed path before the
reachability judgment, with `syncCrowd`'s re-request gate at `:256-259` trusting `#path.length > 0`
— is real behaviour introduced by 8a5104cc but is unreachable in this scenario:
`NavigationProbe.ts:40` constructs the agent with `avoidanceEnabled: false`, so `#crowdAgent` is
undefined and `syncCrowd` returns at `:253`; and the target is reachable, so `#storeComputedPath`
stores the true path rather than a stale partial. It cannot produce this red. It remains a latent
inconsistency for avoidance-enabled agents chasing unreachable targets (the re-request can undo the
`resetMoveTarget` rejection) — filed here as an observation for a future PRD, not repaired in this
one, whose defect it does not touch.

## Fix and green (PRD-176 criteria 2) — 2026-08-22

Fix: `examples/abyss-framework/playtests/navigation.playtest.json` declares `allowTrivial` on its
visibility row and `"artifacts": { "screenshots": false }`; the invocation carries `?navigation`.
Green run — same recipe, port 5173:

```text
exit code 0, pass: true, frames: 212, diagnostics: []
  diagnostics              -> pass  consoleErrors: 0, networkErrors: 0, runtimeDiagnostics: 0
  movement.pathLength      -> pass  pathLength: 9.725507065552236   (minimum 9)
  movement.reachesPosition -> pass  closestDistance: 0.006768826545260287 (max 0.7)
  visibility.navigator     -> pass  projectedPixels: 241.7391083379146 (min 100), trivialityOptOut accepted
```

Adapter proof for the webgpu recipe: the same recipe's runs in this session report
`capture.adapter.vendor "nvidia"`, `architecture "turing"`; the `TN_PLAYTEST_SOFTWARE_ADAPTER`
guard was armed and silent on every headed run quoted here.

## Red-green mutations (PRD-176 criterion 3)

Each named line, reverted, reproduces a red; each was run, pasted, then restored.

| Named line | Reverted to | Observed red |
| --- | --- | --- |
| `?navigation` in the chain's `--url` (root `package.json` test:playtest) | bare URL, no query | exit `1`, `pass: false` — §1's table reproduced; payload shows abyss-game state (`status: "attract"`, `player` at x≈297), no `navigator` samples |
| `allowTrivial` on the visibility row (`navigation.playtest.json`) | row without the opt-out | exit `1`; `TN_PLAYTEST_ASSERTION_TRIVIAL`: "Assertion 'visibility.navigator' was already satisfied before the scenario ran"; movement rows still pass |
| `"artifacts": { "screenshots": false }` (`navigation.playtest.json`) | screenshots enabled | exit `1`; `TN_CAPTURE_BLANK`: "bright pixel ratio 0.02062 is below 0.05"; all assertion rows pass |

## Default-chain coverage (PRD-176 criterion 4) — 2026-08-22

`navigation.playtest.json` joined root `test:playtest` after `movement-axis.playtest.json`, same
server-command shape, with the route carried in its `--url` (`http://127.0.0.1:5180/?navigation`;
the scenario schema has no URL field, so the chain row is where the entry point is named). Full
chain run, exit code 0:

```text
framework-movement               -> pass: true
framework-camera                 -> pass: true
abyss-framework-movement-axis    -> pass: true
navigation-routes-around-blocker -> pass: true   CHAIN_EXIT=0
```

Navigation row quoted from the chain run:

```text
diagnostics              -> pass  consoleErrors: 0, networkErrors: 0, runtimeDiagnostics: 0
movement.pathLength      -> pass  pathLength: 9.678998035621026 (minimum 9)
movement.reachesPosition -> pass  closestDistance: 0.006768826545260287 (max 0.7)
visibility.navigator     -> pass  projectedPixels: 241.7391083379146 (min 100), trivialityOptOut accepted
url: http://127.0.0.1:5180/?navigation
```

## Scoped quality gates (PRD-176 criterion 5) — 2026-08-22

The lane's changes touch no TypeScript (one scenario JSON, one line of root `package.json`, this
record), so the scoped form applies:

```text
pnpm exec tsc --noEmit -p packages/physics   -> exit 0
pnpm exec biome check examples/abyss-framework/playtests/navigation.playtest.json \
  package.json docs/verification/navigation-red-at-head-2026-08-22.md -> no diagnostics
```

The full-workspace `pnpm test` suite is the coordinator's between-waves gate and was not run in
this lane.



