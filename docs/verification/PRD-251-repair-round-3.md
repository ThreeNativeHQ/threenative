# PRD-251 repair-round-3 verification

Date: 2026-08-31

Baseline SHA: `8eb728542db40577b4f07f92db93a90f49f9e832`

Source PRD: `docs/PRDs/feature-mining/HIGH/PRD-251-procedural-world-fields-and-terrain-residency.md`

The source PRD remained read-only. This repair lane closes the five blockers from the second
review and carries forward the five round-one repairs. Native desktop, Android/Pixel 8, iOS,
three-capture visual comparison, and same-world material A/B evidence remain unverified.

## Red → green repair probes

Each focused mutation was run before restoring the implementation. The repair was then checked by
the corresponding focused test.

1. Manual LOD selection: before the fix, the tile regression exited `1` with `autoUpdate` observed
   `true` instead of `false` (`1 failed, 6 passed`). After the fix, the selected LOD, visible child,
   seam observation, and transition counter agree; the focused tile suite passes.
2. Consumer-facing seam evidence: before adding the scenario components, the scenario contract
   test exited `1` (`1 failed, 4 passed`) because visual seam, skirt coverage, and LOD-pop
   assertions were absent. After adding them, the contract test passes. Removing skirt geometry
   in the mutation exited `1` with zero skirt vertices and an uncovered visual seam; restoring it
   passes.
3. CPU dispatch budget: before validation, the new bounded-work regression exited `1` (`1 failed,
   9 passed`) because CPU erosion iterations ran despite `dispatchBudget: 1`. The implementation
   now rejects that impossible synchronous configuration; the heightfield suite passes.
4. Adapter truth: before the consumer source fix, the capability regression exited `1` (`1 failed,
   4 passed`) because `TerrainProbe` hardcoded `gpuAvailable: false`. The source now derives it
   from `ctx.renderer.kind === "webgpu"`; adapter-present and adapter-absent capability tests pass.
5. Quality denominator: before validation, the mismatched observation test exited `1` (`1 failed,
   7 passed`) because a 65×65 field could be reported over 1,024 m. The producer now requires the
   tile-grid denominator (1,025×1,025 for the consumer's 64 m tiles); the tile suite passes.

The carried-forward declared negative controls are recorded in
`docs/verification/PRD-251-review-repair.md`: PRD-043 sine topology, Rapier row-order mutation,
eviction removal, zero erosion iterations, and the world look-ownership grep all produced red
results before restoration. The current source grep is green:

```text
rg -ni "material|light|tonemapping|postprocessing|\.wgsl" packages/core/src/world*.ts
exit code: 1 (no matches)
```

## Focused green suite

```sh
pnpm exec vitest run packages/core/__tests__/world-capabilities.spec.ts \
  packages/core/__tests__/world-erosion.spec.ts \
  packages/core/__tests__/world-heightfield.spec.ts \
  packages/core/__tests__/world-terrain-tiles.spec.ts \
  packages/playtest/__tests__/world-gameplay.spec.ts
```

Exit code: `0`: 5 files and 37 tests passed.

The large topology observation is 1,025×1,025. Its raw height and flow channels are retained for
small unit observations; the live bridge report uses an exact eight-metric summary so the report
stays below the 1,000,000-byte bridge limit. The evaluator accepts only a complete summary and
fails closed on missing or partial metrics.

## Capability discovery

The installed `threenative-engine-mcp` server was run against
`packages/create-threenative/capabilities.json` with three `engine_search_capabilities` calls.
The returned matches were:

```text
"generate a terrain a player can walk across" → Heightfield
"ask how high the ground is here" → Heightfield
"stream terrain without cracks" → TerrainTiles
```

The session tool list did not expose the deferred MCP connector directly, so this is the local
stdio server invocation of the same shipped tool, not a claim that an external MCP call ran.

## Gate results

| Command | Exit | Exact result |
| --- | ---: | --- |
| `pnpm build` | 0 | Workspace build completed; capability manifest regenerated with 200 entries. |
| `pnpm typecheck` | 0 | All workspace TypeScript projects completed. |
| `pnpm lint` | 1 | Unrelated pre-existing errors in `examples/engine-load-test`, `examples/prd243-cloth`, `examples/native-smoke`, `examples/abyss-framework/src/replay-proof.ts`, and `packages/assets`; no changed-file errors. |
| `pnpm test` | 1 | Gate stopped at native runtime: 87 files passed, 626 tests passed, 39 skipped; 6 failures in 4 files because required CMake test executables were not built. |
| `pnpm budgets` | 1 | Pre-existing out-of-scope native census drift: recorded 8,030, measured 8,043, tolerance 5. |
| `pnpm quality` | 0 | 99 findings: 21 new, 23 grew, 54 inherited, 1 waived; quality is non-fatal. |
| `pnpm tsx scripts/count-loc.ts` | 0 | Platformer 2,569 LOC; generated HUD 60 (geometry HUD 69); cloth framework 46 vs hand-written 761. |
| `pnpm sync:agents` | 0 | 16 mirrors, 0 written. |

`pnpm --filter @threenative/playtest build` and `pnpm --filter abyss-framework build` also exited
`0` before the browser run. The browser used the rebuilt WebGPU playtest runner.

## Headed browser evidence

```sh
node packages/playtest/dist/runner/cli.js \
  examples/abyss-framework/playtests/terrain.playtest.json \
  --url 'http://127.0.0.1:5173/?terrain' \
  --server-command "pnpm --filter abyss-framework dev --host 127.0.0.1 --port 5173 --strictPort" \
  --browser-recipe webgpu --headed --no-screenshots
```

Exit code: `1`, fail-closed on `power-spectrum-slope`, `median-64m-relief`, and
`horton-strahler-order`. The report otherwise recorded:

- real `move` input: player distance `383.9246107652323` m, path length
  `390.33205123064874` m, movement X delta `383.04400634765625` m, six tile-column boundaries,
  and 180 frames;
- initial `lodTransitions: 0`, then `38` after traversal; resident peak `9` tiles and
  `3,175,992` bytes;
- raw seam gap `2.6062299013137817` m, visual seam gap `0` m, skirt vertices `4,140`, and
  maximum observed LOD pop `13.909428596496582`;
- no console errors, network errors, runtime errors, or diagnostics;
- `rendererKind: "webgpu"`, `gpu: true`, generation `"cpu-fallback"`,
  `cpuFallbackIterations: 4`, adapter architecture `turing`, vendor `nvidia`, and
  `maxStorageBufferBindingSize: 2147483644`;
- topology dimensions `1025×1025` over `1024×1024` m and the compact exact metrics in
  `docs/verification/PRD-251-quality.md`.

No screenshot was produced because this run used `--no-screenshots`; the required three inspected
side-by-side captures and same-world two-material A/B evidence are unverified.

## Native and mobile status

`pnpm -r --workspace-concurrency=1 --if-present run test` exited `1` in
`packages/runtime-native`: 91 runtime test files were collected, 87 passed, and six tests failed
because `threenative-crash-handler-policy-test`, `threenative-rg11b10-renderable-test`, and
`threenative-timestamp-query-test` were not built in the Linux and QuickJS CMake directories.
No native world execution is claimed. `pnpm native:build`, `pnpm native:verify:desktop`, Android /
Pixel 8, and iOS runs were not executed; mobile capability is therefore unverified.

## Checkpoint and changed files

The checkpoint baseline is exactly `8eb728542db40577b4f07f92db93a90f49f9e832`. The source PRD was
not edited. The headed evidence class is one live WebGPU browser report without screenshots; no
native, mobile, or visual pass is claimed.

```text
docs/verification/PRD-251-native.md
docs/verification/PRD-251-quality.md
docs/verification/PRD-251-repair-round-3.md
examples/abyss-framework/playtests/terrain.playtest.json
examples/abyss-framework/src/scenes/TerrainProbe.ts
packages/core/__tests__/world-capabilities.spec.ts
packages/core/__tests__/world-heightfield.spec.ts
packages/core/__tests__/world-terrain-tiles.spec.ts
packages/core/src/world-passes.ts
packages/core/src/world-tiles.ts
packages/core/src/world-topology.ts
packages/core/src/world.ts
packages/playtest/__tests__/world-gameplay.spec.ts
packages/playtest/src/evaluators/world-gameplay.ts
```
