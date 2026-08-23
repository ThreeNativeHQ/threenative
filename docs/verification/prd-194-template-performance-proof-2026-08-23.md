# PRD-194 template performance proof — 2026-08-23

Source PRD: [PRD-194](../PRDs/batch-2026-08-22-charter-performance/PRD-194-every-template-carries-a-real-performance-proof.md)

This is the committed raw measurement record for the seven shipped templates. The browser
measurements used Chromium WebGPU, `--browser-recipe webgpu`, an NVIDIA/Turing adapter, a
1920×1080 viewport, 60 warmup frames, and the scenario workload from the checked-in proof.
The deterministic workload is 60 warmup frames plus at least 600 fixed ticks. Those ticks are
workload units, not performance samples: `assert.performance` defines upper bounds only and the
runner does not enforce a minimum performance-sample count. Each template was run ten times. The
checked-in bound is `ceil(max observed × 1.10)` for each metric, with the frame-time bound capped
at the PRD's 33 ms p95 requirement.

## Scenario coverage

| Template | Scenario | Deterministic workload | Bounds: draws / p95 ms / triangles |
| --- | --- | ---: | ---: |
| action-rpg | `playtests/performance.playtest.json` | 60 warmup frames + at least 600 fixed ticks | 62 / 33 / 996 |
| defense | `playtests/performance.playtest.json` | 60 warmup frames + at least 600 fixed ticks | 44 / 33 / 1951 |
| minimal | `playtests/play.playtest.json` | 60 warmup frames + at least 600 fixed ticks | 20 / 33 / 1223 |
| platformer | `playtests/performance.playtest.json` | 60 warmup frames + at least 600 fixed ticks | 70 / 33 / 3350 |
| racing | `playtests/performance.playtest.json` | 60 warmup frames + at least 600 fixed ticks | 84 / 33 / 2070 |
| shooter | `playtests/performance.playtest.json` | 60 warmup frames + at least 600 fixed ticks | 96 / 33 / 1053 |
| starter | `playtests/play.playtest.json` | 60 warmup frames + at least 600 fixed ticks | 53 / 33 / 4403 |

The seven scenario files contain seven non-empty `assert.performance` objects and no empty
performance object. Every scenario uses `{ "width": 1920, "height": 1080 }` and
`warmupFrames: 60`.

## Raw browser runs

Actual values are `observed performance samples / frame p95 ms / max draw calls / max triangles`.

| Template | Run | Observed performance samples | Frame p95 ms | Draw calls | Triangles |
| --- | ---: | ---: | ---: | ---: | ---: |
| action-rpg | 1 | 255 | 5.6 | 56 | 905 |
| action-rpg | 2 | 257 | 4.7 | 56 | 905 |
| action-rpg | 3 | 260 | 5.3 | 56 | 905 |
| action-rpg | 4 | 257 | 4.6 | 56 | 905 |
| action-rpg | 5 | 256 | 4.9 | 56 | 905 |
| action-rpg | 6 | 260 | 5.5 | 56 | 905 |
| action-rpg | 7 | 256 | 4.9 | 56 | 905 |
| action-rpg | 8 | 257 | 4.6 | 56 | 905 |
| action-rpg | 9 | 252 | 5.0 | 56 | 905 |
| action-rpg | 10 | 256 | 5.2 | 56 | 905 |
| defense | 1 | 260 | 5.3 | 40 | 1773 |
| defense | 2 | 260 | 3.9 | 40 | 1773 |
| defense | 3 | 259 | 4.7 | 40 | 1773 |
| defense | 4 | 258 | 4.7 | 40 | 1773 |
| defense | 5 | 254 | 4.8 | 40 | 1773 |
| defense | 6 | 256 | 4.9 | 40 | 1773 |
| defense | 7 | 257 | 5.6 | 40 | 1773 |
| defense | 8 | 258 | 3.8 | 40 | 1773 |
| defense | 9 | 258 | 4.5 | 40 | 1773 |
| defense | 10 | 262 | 4.1 | 40 | 1773 |
| minimal | 1 | 258 | 3.3 | 18 | 1111 |
| minimal | 2 | 261 | 3.4 | 18 | 1111 |
| minimal | 3 | 258 | 3.1 | 18 | 1111 |
| minimal | 4 | 262 | 2.9 | 18 | 1111 |
| minimal | 5 | 262 | 3.4 | 18 | 1111 |
| minimal | 6 | 259 | 3.0 | 18 | 1111 |
| minimal | 7 | 258 | 3.8 | 18 | 1111 |
| minimal | 8 | 260 | 3.1 | 18 | 1111 |
| minimal | 9 | 258 | 3.5 | 18 | 1111 |
| minimal | 10 | 260 | 3.4 | 18 | 1111 |
| platformer | 1 | 254 | 6.2 | 63 | 3045 |
| platformer | 2 | 257 | 4.9 | 63 | 3045 |
| platformer | 3 | 257 | 6.2 | 63 | 3045 |
| platformer | 4 | 257 | 5.4 | 63 | 3045 |
| platformer | 5 | 258 | 5.1 | 63 | 3045 |
| platformer | 6 | 254 | 5.6 | 63 | 3045 |
| platformer | 7 | 251 | 5.1 | 63 | 3045 |
| platformer | 8 | 255 | 5.2 | 63 | 3045 |
| platformer | 9 | 253 | 5.2 | 63 | 3045 |
| platformer | 10 | 253 | 5.3 | 63 | 3045 |
| racing | 1 | 257 | 5.5 | 71 | 1821 |
| racing | 2 | 255 | 5.1 | 71 | 1821 |
| racing | 3 | 259 | 5.0 | 71 | 1821 |
| racing | 4 | 263 | 6.0 | 71 | 1821 |
| racing | 5 | 254 | 4.9 | 71 | 1821 |
| racing | 6 | 256 | 5.1 | 71 | 1821 |
| racing | 7 | 254 | 5.5 | 71 | 1821 |
| racing | 8 | 254 | 4.9 | 71 | 1821 |
| racing | 9 | 259 | 5.0 | 76 | 1881 |
| racing | 10 | 253 | 4.9 | 71 | 1821 |
| shooter | 1 | 255 | 5.5 | 87 | 957 |
| shooter | 2 | 252 | 4.5 | 87 | 957 |
| shooter | 3 | 255 | 5.4 | 87 | 957 |
| shooter | 4 | 258 | 5.3 | 87 | 957 |
| shooter | 5 | 254 | 5.3 | 87 | 957 |
| shooter | 6 | 253 | 5.5 | 87 | 957 |
| shooter | 7 | 254 | 5.0 | 87 | 957 |
| shooter | 8 | 255 | 4.7 | 87 | 957 |
| shooter | 9 | 258 | 4.7 | 87 | 957 |
| shooter | 10 | 255 | 4.7 | 87 | 957 |
| starter | 1 | 260 | 4.7 | 48 | 4002 |
| starter | 2 | 264 | 5.7 | 48 | 4002 |
| starter | 3 | 263 | 4.9 | 48 | 4002 |
| starter | 4 | 263 | 5.4 | 48 | 4002 |
| starter | 5 | 259 | 4.9 | 48 | 4002 |
| starter | 6 | 262 | 4.5 | 48 | 4002 |
| starter | 7 | 260 | 4.6 | 48 | 4002 |
| starter | 8 | 264 | 4.7 | 48 | 4002 |
| starter | 9 | 265 | 4.3 | 48 | 4002 |
| starter | 10 | 263 | 4.4 | 48 | 4002 |

## Final browser scenario

Each command was run through `sh scripts/xvfb.sh` with the WebGPU browser recipe. Every command
exited 0.

| Template | Exit | Observed performance samples | Frame p95 ms | Draw calls | Triangles | Adapter | Viewport |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| action-rpg | 0 | 253 | 4.9 | 56 | 905 | nvidia/turing | 1920×1080 |
| defense | 0 | 256 | 4.3 | 40 | 1773 | nvidia/turing | 1920×1080 |
| minimal | 0 | 259 | 3.7 | 18 | 1111 | nvidia/turing | 1920×1080 |
| platformer | 0 | 256 | 5.7 | 63 | 3045 | nvidia/turing | 1920×1080 |
| racing | 0 | 256 | 4.9 | 71 | 1821 | nvidia/turing | 1920×1080 |
| shooter | 0 | 255 | 4.6 | 87 | 957 | nvidia/turing | 1920×1080 |
| starter | 0 | 265 | 5.0 | 48 | 4002 | nvidia/turing | 1920×1080 |

Platformer browser p95 maximum across the ten runs was 6.2 ms, below the 33 ms bound.

## Negative controls

| Control | Command/result | Observed red evidence |
| --- | --- | --- |
| `maxDrawCalls: 0` | Seven browser runs, one per template; every child exited 1 | Every report contained `TN_PLAYTEST_PERFORMANCE_ASSERTION_FAILED` and `pass: false` |
| Delete one scenario | Temporarily moved `action-rpg/playtests/performance.playtest.json`; focused template test exited 1 | Named missing path: `action-rpg/playtests/performance.playtest.json: expected undefined to be defined`; file restored before delivery |
| Missing samples | Focused evaluator/schema suite exited 0 after exercising the negative case | Empty performance series emitted `TN_PLAYTEST_PERFORMANCE_SAMPLES_MISSING` |
| False bound | Focused evaluator/schema suite exited 0 after exercising the negative case | Regressed draw/frame scene emitted `TN_PLAYTEST_PERFORMANCE_ASSERTION_FAILED`; missing renderer counters also failed with that code |
| Missing provider | Fake bridge omitted `runtime.performance`; expected-control wrapper exited 0 after the child failed | Child exited 1 with `TN_PLAYTEST_CAPABILITY_MISSING`, capability `runtime.performance` |
| Slow native comparison | Native production profile could not reach a valid pair; evaluator control was run separately | `slow-path` fixture returned `status: FAIL`, `exitCode: 1`, `codes: ["TN_PROD_PERFORMANCE_BUDGET"]`, p99 `50.141444 ms` |
| Remove one raw run | Completeness checker over this table reports 10 rows per template | Removing any one row from a temporary copy reports `expected 10 raw runs, found 9` and exits 1 |

## Commands and harness status

Successful setup and focused verification:

```text
pnpm install --frozen-lockfile --reporter=append-only                         # exit 0
pnpm --filter @threenative/playtest build                                    # exit 0
pnpm --filter @threenative/core build                                        # exit 0
pnpm --filter @threenative/physics build                                     # exit 0
pnpm --filter create-threenative build                                       # exit 0
pnpm exec vitest run packages/playtest/__tests__/scenario.spec.ts packages/playtest/__tests__/performance.spec.ts packages/playtest/__tests__/vacuous-assertion.spec.ts packages/playtest/__tests__/silent-drop.spec.ts  # exit 0; 84 passed
pnpm exec vitest run packages/create-threenative/__tests__/template.spec.ts packages/create-threenative/__tests__/platformer.spec.ts -t 'performance|template'  # exit 0; 28 passed
```

The required root production command was also attempted exactly as declared:

```text
pnpm profile:production --target desktop-pair --repetitions 10 --cold-starts 1 --duration 10 --warmup 1 --out /tmp/prd194-production-parity
# exit 2: TN_PROD_PACKAGE_ARCHIVE_FAILED — local package 'studio' is absent in this checkout
```

After a temporary, uncommitted harness-only copy supplied the local engine MCP package, the
profile reached the native arm but failed closed before comparison with
`TN_PROD_PLAYTEST_FAILED`, `TN_PROD_RENDER_SAMPLES_INCOMPLETE`,
`TN_PROD_STARTUP_SAMPLES_INCOMPLETE`, and `TN_PROD_COMPARISON_METRICS_INCOMPLETE`. The native
host itself initialized WebGPU under Xvfb on an NVIDIA GeForce RTX 2080 at 1920×1080 and emitted
frame samples, but no valid desktop-pair result is claimed here. The out-of-scope profile script
was not changed.

The missing native parity result is therefore a harness/setup block, not a green acceptance claim.
