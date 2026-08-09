# G2 — conformance

**Milestone:** M3
**State:** 2 pass / 49 total (`2 pass, 11 blocked by bounded selection, 36 planned`).

Reports must state the result as a fraction and must not summarize an empty, bounded, or
dry-run-only report as “the harness passes.” Acceptance requires browser and native
completion, finite visual metrics, clean GPU validation output, and explicit blocked/planned
rows.

## Bounded Linux execution — 2026-08-08

```sh
SDL_VIDEODRIVER=x11 \
TN_RUNTIME=/home/joao/projects/threejs-webgpu/packages/runtime-native/build/tn-linux/mystral \
TN_BROWSER_TIMEOUT_MS=30000 \
xvfb-run -a -s '-screen 0 1600x900x24' \
node packages/runtime-native/conformance/run-conformance.mjs \
  --only-tests 70-webgpu-renderer-init,89-module-import \
  --allow-blocked --out artifacts/conformance/report-2026-08-08.json
```

Both rows completed in Firefox and Linux V8+Dawn. Each reported
`pixelMismatchRatio=0.00007582720588235293`, `perceptualDeltaE=0.6168589999999999`, and
zero GPU validation errors, below tolerances `0.01` and `3.0`. The fraction is **2/49**.
Eleven other implemented rows were not selected and are blocked; 36 remain planned.

The run also corrected a harness error: ImageMagick Q16-HDRI absolute error was divided by
pixel count without first dividing by the 65,535 quantum range. Focused tests prove Q16
normalization and reject unknown quantum depth.
