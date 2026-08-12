# Native CPU WebGPU presentation hardening verification — 2026-08-11

## Verdict

**PASS — harness hardening verified.** Canonical fox visual evidence now fail-closes on blank/headless presentation and the canonical `pnpm profile:native-cpu:fox` path produced exactly **3** `fox-scale` WebGPU runs, all with before/after presentation validation passing and zero page/relevant console errors.

This is **not an optimization result**. The timing deltas below compare the hardened collector against the committed Phase 0 fox baseline only to check that the harness remains in the same noise envelope; they are browser/Xvfb evidence, not native-runtime, physical-device, or shipping frame-rate evidence.

## RED / GREEN trail

- RED already captured before implementation: `pnpm exec vitest run scripts/__tests__/profile-native-cpu.spec.ts` produced `7 failed | 4 passed` because the visual evidence APIs and fail-closed behavior did not exist yet.
- GREEN after final matrix/parser hardening:
  - `pnpm exec vitest run scripts/__tests__/profile-native-cpu.spec.ts` → **1 file passed, 13 tests passed**.
  - `pnpm exec vitest run scripts/__tests__/native-cpu-profile*.spec.ts scripts/__tests__/profile-native-cpu.spec.ts` → **2 files passed, 22 tests passed**.
- Added explicit regression coverage that `--visual-evidence fox-scale` builds exactly one `fox-scale` scenario, while ordinary `--scenario fox-scale` still appends the named preset to the controlled synthetic matrix rows.

## Fail-closed headless proof

Command run under Node `v20.19.6`:

```sh
PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" pnpm profile:native-cpu -- --verify-presentation --diagnostic --allow-software
```

Result: **failed before browser launch as intended** with:

```text
Presentation verification is fail-closed and cannot run headless. Use --headed --verify-presentation under Xvfb. Canonical visual evidence command: xvfb-run -a -s '-screen 0 1600x900x24' pnpm profile:native-cpu -- --headed --verify-presentation --scenario fox-scale
```

## Canonical command and raw JSON

Run under Node `v20.19.6`:

```sh
PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" TN_PROFILE_SHA=$(git rev-parse HEAD)-presentation-hardening pnpm profile:native-cpu:fox
```

Output:

```text
1850 independent passes=1 flat dirty=0.1 all-visible run=1: matrix=0.100ms render=3.200ms draws=1851 frame=3.509ms (hardware)
1850 independent passes=1 flat dirty=0.1 all-visible run=2: matrix=0.200ms render=3.500ms draws=1851 frame=3.791ms (hardware)
1850 independent passes=1 flat dirty=0.1 all-visible run=3: matrix=0.200ms render=3.200ms draws=1851 frame=3.591ms (hardware)
wrote artifacts/native-cpu-profile/profile-1786509976873.json
```

Parsed raw JSON facts:

- `recordedAt`: `2026-08-12T04:46:16.873Z`
- `source.sha`: `e77c820e692dc24a4fa79277cb8af3d980be816e-presentation-hardening`
- `host.node`: `v20.19.6`
- `host.cpu`: `AMD Ryzen 9 5900X 12-Core Processor`
- `browser`: headed `true`, `verifyPresentation: true`, X display `:157`
- top-level evidence: `visual-verified`
- adapter per run: `hardware`, `{ "architecture": "turing", "vendor": "nvidia" }`
- run count: exactly `3`
- every run scenario: `scenario="fox-scale"`, `objects=1850`, `renderMode="independent"`, `dirtyRatio=0.1`, `hierarchy="flat"`, `visibility="all-visible"`, `passes=1`, `samples=120`, `warmupFrames=60`, `seed=90210`
- `browserErrors`: `[]` for all three runs
- `presentation.before.status`: `pass` for all three runs
- `presentation.after.status`: `pass` for all three runs

## Presentation pixel validation

The harness validates PNG canvas screenshots before and after the measured `run()` call. Saved run-1 evidence files are ignored raw artifacts:

- `artifacts/native-cpu-profile/native-cpu-profile-fox-scale-run-1-before.png`
- `artifacts/native-cpu-profile/native-cpu-profile-fox-scale-run-1-after.png`

Visual inspection: both screenshots show non-blank fox-scale scene geometry: sky, clouds, green islands/platforms, trees, bridge/planks, coins, HUD/status overlay, and low-poly fox/platformer scene elements. The after screenshot shows the completed HUD and the same visible scene after profiling.

Pixel stats from the real screenshots:

| phase | dimensions | unique buckets | opaque ratio | foreground ratio | luminance stddev | luminance variance | luminance range | max bucket ratio | status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| before | 1280x720 | 99 | 1.000000 | 0.999602 | 0.160221 | 0.025671 | 1.000000 | 0.848130 | pass |
| after | 1280x720 | 98 | 1.000000 | 0.999912 | 0.162423 | 0.026381 | 1.000000 | 0.847122 | pass |

Threshold sanity:

- blank/uniform test remains meaningful: uniform 64x64 RGBA image is rejected by the `uniqueColorBuckets` / uniformity checks.
- varied-frame test remains meaningful: representative varied 64x64 image passes and asserts meaningful bucket and foreground counts.
- real fox evidence is far from the blank/near-uniform thresholds: 98–99 buckets, high opacity, luminance standard deviation around 0.16, and max bucket ratio around 0.848, below the `0.985` near-uniform cutoff.

## Metrics and percent deltas versus committed Phase 0 baseline

Formula: `(candidate - baseline) / baseline * 100`. Positive means regression/slower; negative means improvement/faster. Candidate is the median across the three fresh canonical run medians. Baseline medians are from the committed Phase 0 fox baseline report.

| metric | baseline median of run medians | fresh run medians | candidate median | % delta |
|---|---:|---:|---:|---:|
| renderMs | 3.699999988079071 | 3.199999988079071, 3.5, 3.199999988079071 | 3.199999988079071 | -13.513513557052335% |
| frameMs | 4.099999996748838 | 3.5090908841653303, 3.790909078988162, 3.590909090909091 | 3.590909090909091 | -12.416851371791191% |
| matrixWorldMs | 0.19999998807907104 | 0.10000002384185791, 0.19999998807907104, 0.19999998807907104 | 0.19999998807907104 | 0.0% |

Equivalent p95 aggregate available in the baseline report is p95 over the three run medians, so the comparison below uses p95 over fresh run medians as well:

| metric | baseline p95 of run medians | fresh p95 of run medians | % delta |
|---|---:|---:|---:|
| renderMs | 3.800000011920929 | 3.5 | -7.894737131047445% |
| frameMs | 4.136363636363637 | 3.790909078988162 | -8.351648639846642% |
| matrixWorldMs | 0.19999998807907104 | 0.19999998807907104 | 0.0% |

Interpretation: the hardened harness did not optimize render code. The lower render/frame medians are treated as browser/GPU/Xvfb run-to-run noise and workload measurement variance; matrix timing is unchanged at the collector's 0.2ms granularity.

## Evidence limitation

This closes blank-capture hardening for the browser WebGPU collector only. It proves that the canonical fox evidence path rejects blank/headless presentation and records visibly non-blank WebGPU canvas pixels before and after profiling. It does **not** prove Android QuickJS, iOS, physical hardware, desktop native host performance, renderer optimization, or any PRD-EXP-002/074/075 work.

## Final gates

- Targeted profiler tests: passed as listed above.
- Sandbox production build: `PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" pnpm --filter threenative-native-cpu-load-test build` → **passed**; Vite emitted only the expected chunk-size warning.
- Prerequisite package builds: `PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" pnpm --filter @threenative/core build && pnpm --filter @threenative/physics build && pnpm --filter @threenative/ui build` → **passed**, including `publint` for each package.
- Full typecheck: `PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH" pnpm typecheck` → **passed**.
- `git diff --check` → **passed**.
