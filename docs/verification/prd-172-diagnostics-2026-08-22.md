# PRD-172 — renderer.info fails closed; render metrics cost nothing until asked

Date: 2026-08-22. Commit `656eba69` + the scenario below.

## What changed

- `IRendererLike.info`: getter exposing the underlying renderer statistics; throws
  `` info is unavailable on the {kind} renderer. `` when absent — never returns undefined.
- `FixedStepLoop.collectMetrics` (default false) + `setCollectMetrics()`: no sample objects, no
  metric spreads per frame unless a consumer announced itself via
  `IGamePluginRuntime.enableRuntimeDiagnostics()`. The playtest plugin announces exactly when the
  runner-expected global is set — collection runs on playtests, not on plain `pnpm dev` frames.
  Existing series consumers see identical data once enabled.
- New scenario `examples/abyss-framework/playtests/draw-calls.playtest.json`.

## Negative controls (observed red)

| Assertion | Red observation |
|---|---|
| info throws when absent | test expected throw, got undefined access path — red before implementation |
| no collection without a consumer | `collects no samples by default` failed while collection was unconditional |
| enablement boundary | `starts collecting only from enablement when enabled mid-run` failed before `setCollectMetrics` existed |

Final: core suite **310/310**, full root suite **1569/1569** at commit time.

## End-to-end proof (row 3)

`draw-calls.playtest.json` on browser WebGPU: `performance.samples` **pass**,
`performance.maxDrawCalls` **pass** — real draw-call counts flowed three-renderer → wrapper
`info` → loop sampling → bridge → assertion. The scenario's overall result is exit 1 solely from
`diagnostics` (WebGPU `OperationError: Instance dropped in popErrorScope` console noise), which
fails identically at HEAD on this machine tonight — same noise documented in
`prd-171-navigation-2026-08-22.md`. Not caused by this change; recorded, not silenced.
