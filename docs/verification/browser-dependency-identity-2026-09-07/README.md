# Browser dependency identity — 2026-09-07

The existing Vite plugin now resolves `three`, `react`, and `react-dom` from the game in both
development and production. Linked engine packages previously loaded separate shader state or
React dispatchers. Vite merges these defaults with the game's own deduplication entries; the
engine freshness hash and cache invalidation remain limited to the development server.

## Red and green

The regression creates physically separate game and linked-package dependencies. It checks real
Vite development resolution, then executes the production bundle and compares exported object
identities, including `three/webgpu`, `three/tsl`, and `react-dom/client` imports.

```text
pnpm exec vitest run packages/create-threenative/__tests__/engine-freshness.spec.ts
RED:   Tests  2 failed | 7 passed (9)
GREEN: Tests  9 passed (9)
```

The red resolved Three.js beside the linked engine and produced five unequal identities in the
production bundle. The green shares all six tested identities, including the game's independent
`game-singleton` entry. Full output is retained in [unit-red.txt](./unit-red.txt) and
[unit-green.txt](./unit-green.txt).

Native web-view packaging and template plugin regressions also pass: **22/22 tests** in
`build.spec.ts` and `template-vite-plugins.spec.ts`, including the actual native UI bundle's React
identity check. [Output](./build-regressions.txt). Package build/publint, full repository typecheck,
and lint passed; lint reports 653 existing warnings. Retained outputs: [package build](./package-build.txt), [typecheck](./typecheck.txt), and [lint](./lint.txt).

## Real Bayview browser proof

The repaired Bayview game was copied to an isolated browser verification folder. All **302**
recorded source, asset, configuration, package and lockfile hashes remained identical. The authored
object-granularity warm-up override and every render setting remained present for this run.
The game links the PR #136 engine packages plus this Vite fix; exact source, dependency and built
entry hashes are in [proof.json](./proof.json).

Executed from the verification game:

```sh
TN_PLAYTEST_HOST_DISPLAY=0 node node_modules/@threenative/playtest/dist/runner/cli.js \
  playtests/survives.playtest.json --url http://127.0.0.1:4197 \
  --server-command 'pnpm dev --host 127.0.0.1 --port 4197 --strictPort' \
  --browser-recipe webgpu --headed --timeout 120000
```

The four assertions passed: **2.146736 m** of input-driven movement, **99.9316%** nonblank region,
177 invisible pooled meshes below the existing 300 ceiling, and **zero** console errors, network
errors or runtime diagnostics. There were **zero** “multiple instances of Three.js” warnings. The actual adapter
reported **NVIDIA / Turing** at 1280×720. See [the report](./playtest-result.json),
[adapter receipt](./capture.json), [console](./console.json), and [captured world](./after.png).
The same [scenario](./survives.playtest.json) is retained with repository formatting.

Earlier headless runs selected SwiftShader and failed; an attempted desktop-display run failed X11
authentication before browser launch. Those runs establish no rendering or performance acceptance.
A separate [adapter probe](./adapter-probe.txt) proved headed Chromium on private Xvfb reaches the
hardware before the successful game run. No screenshot threshold or diagnostic assertion was
relaxed.

This closes the repaired game's browser movement/visual gap. It does **not** establish PRD-360's
three physical Android launches within 8,000 ms or its correlated 250 ms pump-silence bound.
The browser's observed ready milestone was 13,552.9 ms; it is not an Android measurement.

JSON receipts are formatted for the repository while retaining their measured values. Text receipts
normalize line endings and trim trailing whitespace. The result object is extracted from runner stdout after its
capture-environment preamble. Artifact hashes in `proof.json` refer to the retained files.
