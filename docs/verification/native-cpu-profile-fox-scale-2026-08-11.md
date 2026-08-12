# Native CPU fox-scale baseline — 2026-08-11

## Verdict

Phase 0 fox-scale baseline is verified for the browser profiling harness at source baseline `8c5fc40a3723fe7a78eae05d2f9ed6f373c34264`.

This report measures the dirty harness before the closing commit. It is a browser WebGPU/Xvfb baseline, not a physical-device or native-runtime performance claim.

Visual gate: **PASS**. The replacement screenshots show actual WebGPU geometry before and after profiling: a recognizable low-poly orange fox/platformer scene with green islands, bridge, trees, coins, clouds, and HUD markers. No major clipping was observed by the controller.

Screenshots:

- `docs/verification/visuals/native-cpu-profile-fox-scale-2026-08-11-ready.png`
- `docs/verification/visuals/native-cpu-profile-fox-scale-2026-08-11.png`

## Fresh collector command

Run under Node `v20.19.6`:

```sh
PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH"
TN_PROFILE_SHA=$(git rev-parse HEAD) xvfb-run -a -s '-screen 0 1600x900x24' pnpm profile:native-cpu -- --scenario fox-scale --objects 1850 --render-mode independent --visibility all-visible --dirty 10 --hierarchy flat --passes 1 --repeats 3 --samples 120 --warmup-frames 60 --warmup-ms 0 --allow-software --headed --port 5322 --output-dir artifacts/native-cpu-profile
```

Raw JSON:

- `artifacts/native-cpu-profile/profile-1786508741659.json` (ignored artifact, parsed for this checked-in report)

The CLI currently appends named preset rows after the requested synthetic matrix, so this run contains both a generic 1,850-object independent row and the `fox-scale` preset row. The acceptance baseline below isolates the three `scenario: "fox-scale"` rows.

## Adapter / evidence class

Raw JSON evidence class: `browser-hardware`.

Adapter from the fresh headed Xvfb collector:

```json
{ "architecture": "turing", "vendor": "nvidia" }
```

`--allow-software` was passed explicitly so SwiftShader/software fallback would be accepted if selected. The final fresh collector did **not** select SwiftShader; earlier headless/diagnostic attempts did. This is still not physical Android/iOS/desktop-native evidence and must not be used as a shipping frame-rate claim.

## Fox-scale workload

Configuration parsed from the raw JSON:

```json
{
  "scenario": "fox-scale",
  "objectCount": 1850,
  "renderMode": "independent",
  "visibility": "all-visible",
  "dirtyRatio": 0.1,
  "hierarchy": "flat",
  "passes": 1,
  "samples": 120,
  "warmupFrames": 60,
  "seed": 90210
}
```

Per-run medians and p95 values:

| run | renderMs median | renderMs p95 | frameMs median | frameMs p95 | matrixWorldMs median | matrixWorldMs p95 |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3.800000011920929 | 5.800000011920929 | 4.136363636363637 | 6.100000002167442 | 0.19999998807907104 | 0.3999999761581421 |
| 2 | 3.699999988079071 | 5.699999988079071 | 4.099999996748838 | 6.118181819265539 | 0.19999998807907104 | 0.3999999761581421 |
| 3 | 3.300000011920929 | 5.800000011920929 | 3.61818187345158 | 6.418181809512052 | 0.19999998807907104 | 0.3999999761581421 |

Aggregate over all 360 fox samples:

| metric | samples | median | p95 | mean |
|---|---:|---:|---:|---:|
| renderMs | 360 | 3.600000023841858 | 5.799999952316284 | 3.9205555548270543 |
| frameMs | 360 | 3.990909067067233 | 6.272727294401689 | 4.293030302693147 |
| matrixWorldMs | 360 | 0.19999998807907104 | 0.3999999761581421 | 0.20027777585718368 |

Aggregate over the three fox run medians:

| metric | runs | median of run medians | p95 of run medians | mean of run medians |
|---|---:|---:|---:|---:|
| renderMs | 3 | 3.699999988079071 | 3.800000011920929 | 3.600000003973643 |
| frameMs | 3 | 4.099999996748838 | 4.136363636363637 | 3.951515168854685 |
| matrixWorldMs | 3 | 0.19999998807907104 | 0.19999998807907104 | 0.19999998807907104 |

Per-run count medians:

| run | drawCalls | triangles | logicalObjects | materialIdentities | visibleCount | passes |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 1851 | 36101 | 1850 | 15 | 1850 | 1 |
| 2 | 1851 | 36101 | 1850 | 15 | 1850 | 1 |
| 3 | 1851 | 36101 | 1850 | 15 | 1850 | 1 |

## Extra synthetic row from the same invocation

Because the current CLI appends named presets to the requested matrix rather than replacing it, the same raw JSON also contains three generic 1,850-object independent rows without `scenario: "fox-scale"`.

Generic row aggregate over 360 samples:

| metric | samples | median | p95 | mean |
|---|---:|---:|---:|---:|
| renderMs | 360 | 3.099999964237213 | 5 | 3.2972222200698322 |
| frameMs | 360 | 3.39090910283002 | 5.427272715351799 | 3.6364646457813006 |
| matrixWorldMs | 360 | 0.19999998807907104 | 0.30000001192092896 | 0.1836111134952969 |

Generic count medians were `drawCalls=1851`, `triangles=22201`, `logicalObjects=1850`, `materialIdentities=1`, `visibleCount=1850`, `passes=1`.

## Console and page-error verdict

The fresh collector installs both console-error and page-error listeners and throws if either records an error before result collection. The headed Xvfb run completed and wrote raw JSON, so the final collector verdict is: **zero page errors and zero relevant console errors**.

Earlier blank-canvas failures were traced to headless Chromium WebGPU presentation, not missing scene content. The harness can report valid counters while headless presentation stays blank or throws `Instance dropped in popErrorScope`. Current collector hardening treats counters as timing-only unless presentation verification is requested and passed; canonical fox visual evidence must use `pnpm profile:native-cpu:fox`, which runs headed Chromium under Xvfb and validates canvas pixels before and after profiling.

## Gate results

- Targeted Vitest: `2` files passed, `14` tests passed.
- Sandbox production build: `pnpm --filter threenative-native-cpu-load-test build` passed; only the expected Vite chunk-size warning was emitted.
- Prerequisite package builds: `@threenative/core`, `@threenative/physics`, and `@threenative/ui` builds passed with `publint` green.
- Full typecheck: `pnpm typecheck` passed.

## Scope caveat

This closes Phase 0 evidence for the deterministic harness and fox-scale browser baseline only. It does not implement PRD-EXP-002, PRD-074, PRD-075, native kernels, renderer-stage hooks, SceneCollapse diagnostics, or any production render-work advisor.
