# Quality resource lifetime evidence

This directory retains the reproducible probe, browser driver, mutation builder, and receipt.
The generated bundle remains at `artifacts/batch-2026-09-05/quality-resource-lifecycle-probe.js`.
The receipt records a browser WebGPU run with synthetic quality windows; it is not phone or
measured adaptive-load acceptance.

The [native recipe](native-resource-lifetime-recipe.md) and [native receipt](native-receipt.json)
record the same positive resource assertions on desktop V8/Dawn. The screenshot-mode command
exited 0; its shutdown capture is not visual acceptance evidence.

Commands below run from the repository root. The package filter changes esbuild's cwd, so the
`../../` prefixes are intentional. The browser command uses the repository's private Xvfb wrapper.

Normal bundle (installed `create-threenative` esbuild):

```sh
pnpm --filter create-threenative exec esbuild ../../docs/verification/batch-2026-09-05-quality-live/resource-lifetime/quality-resource-lifecycle-probe.mjs --bundle --format=esm --platform=browser --target=es2022 --outfile=../../artifacts/batch-2026-09-05/quality-resource-lifecycle-probe.js
```

Normal private-Xvfb run:

```sh
sh scripts/xvfb.sh pnpm exec tsx docs/verification/batch-2026-09-05-quality-live/resource-lifetime/quality-resource-lifecycle-browser.mjs
```

Mutation bundle and private-Xvfb run:

```sh
pnpm --filter create-threenative exec node ../../docs/verification/batch-2026-09-05-quality-live/resource-lifetime/quality-resource-lifecycle-negative-build.mjs
sh scripts/xvfb.sh pnpm exec tsx docs/verification/batch-2026-09-05-quality-live/resource-lifetime/quality-resource-lifecycle-browser.mjs
```

Run the normal bundle and normal private-Xvfb command again to restore the passing artifact.
