# Reproduction — `navigation.playtest.json` red at HEAD, 2026-08-22

Filed as [PRD-176](../PRDs/batch-2026-08-22/PRD-176-navigation-scenario-navigator-never-moves.md).
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
