# PRD-348 painterly admission — 2026-09-03

Source: `docs/PRDs/stylized-components/PRD-348-painterly-paint-is-generated-source-and-pays-for-its-pixels.md`.
The source PRD is outside this lane and was read but not edited.

Verdict: implementation smoke-tested on web; Phase 0 admission is `UNVERIFIED`. No tier is called
admitted and the PRD is not marked declined. The current browser runner captured timestamp-query
availability but did not resolve per-pass GPU timings, and the native runtime prebuilt is missing.

## Required admission matrix

The required matrix is DPR `1` and `2`, radius `3`, `5`, and `9`, and full/half-resolution
scratch, after 60 warm-up and 120 steady frames at `1280×720`. The physical-pixel column below is
the target drawing-buffer size, not an observation; all cells remain `UNVERIFIED` until a
pass-cost capture records the actual adapter and GPU time.

| DPR | Radius | Scratch | Target physical pixels | Warm-up / steady | GPU pass cost | Verdict |
| ---: | ---: | --- | ---: | --- | --- | --- |
| 1 | 3 | full | 921,600 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 1 | 3 | half | 230,400 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 1 | 5 | full | 921,600 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 1 | 5 | half | 230,400 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 1 | 9 | full | 921,600 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 1 | 9 | half | 230,400 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 2 | 3 | full | 3,686,400 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 2 | 3 | half | 921,600 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 2 | 5 | full | 3,686,400 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 2 | 5 | half | 921,600 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 2 | 9 | full | 3,686,400 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |
| 2 | 9 | half | 921,600 | 60 / 120 | `UNVERIFIED` | `UNVERIFIED` |

The web smoke capture used an NVIDIA/Turing adapter, `1280×720`, and a timestamp-query feature,
but reported only the runner-level frame and compile observations. It emitted:

```text
THREE.WebGPUTimestampQueryPool [render]: Maximum number of queries exceeded ... resolveTimestampsAsync
THREE.WebGPUTimestampQueryPool [compute]: Maximum number of queries exceeded ... resolveTimestampsAsync
```

Those warnings are evidence that the current path cannot supply the required per-pass timings;
they are not zero-cost measurements. The captured starter look still passed with `frames: 741`,
`compileSettled: true`, and changed-pixel ratio `0.3631499565972222`.

## Generated implementation

The painterly chain is ordinary generated `src/render/` source:

- `outline.ts` performs physical-pixel Sobel colour/depth edge detection;
- `kuwahara.ts` writes a half-float structure-tensor scratch, samples the original scene source in
  eight anisotropic sectors, and writes a second half-float paint scratch;
- `watercolor.ts` applies scalar luminance grouping and deterministic procedural paper, without a
  private tone curve;
- `quality.ts` selects radius 5 / half-resolution for high, radius 3 / half-resolution for medium,
  and omits all three authored stages for low;
- `WorldEnvironment` requests the three ids independently through the existing `RenderChain`.

The Kuwahara stage validates finite bounded controls, uses `HalfFloatType`, releases both scratch
targets idempotently, and returns the input exactly when strength is zero. Every sector samples
the unfiltered `source`; no prior filtered result is fed back into the next sector. The generated
watercolour stage quantises one luminance scalar and scales RGB together, preserving hue. The
existing final ACES/AgX/Neutral transform remains outside the stage.

## Focused proof

```sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "painterly|tensor"
```

PASS, 4 tests. The tests cover generated-source ownership, no raw GLSL or framework dependency,
half-float/disposal markers, principal-axis direction, anisotropic matrix order, and hue-preserving
luminance grouping.

```sh
pnpm --filter @threenative/core build
pnpm --filter create-threenative build
```

PASS. The clean sandbox then passed `pnpm typecheck && pnpm vite build` and the real web
`playtests/look.playtest.json` scenario. Repository and scaffold source hashes for the three
generated stages matched:

```text
outline.ts    b7dea8cee21a0225ca7bcb82bb0b0c35ec5a77178b510d861c4e9d3c593882fa
kuwahara.ts   219e46dddd6fb020294cd2b79450852f7d47548d8333a5ef94967df0317f3f6f
watercolor.ts 433f68b411fc33ecdd866eb6ee5e417d6b83631ff7a5bf5571f6db5cfa010cb7
```

## Negative controls

Observed red evidence exists for the pre-change closed-name seam and for the locally runnable
mutation controls:

- transposing the kernel multiplication made the direction test observe `0.25` instead of
  `1.75`;
- quantising RGB channels independently made the hue test observe scale ratios `0.9375` and
  `1.25`;
- adding a private `ACES` marker made the generated-source tone-map guard fail;
- omitting `watercolor` from the observed stage list made both authored-stage assertions fail;
- removing cycle validation made the malformed-graph test fail with `Maximum call stack size
  exceeded` instead of a named cycle;
- the chain test throws when `outline` has no supplied definition, malformed authored graphs
  leave `setOutputNode` untouched, and the playtest evaluator fails when `outline` is missing
  from `TN_RENDER_CHAIN`.

The following mutation captures were not run as separate red runs and remain unverified: a black
paper source, zero-strength edge-region A/B, and a DPR-2 radius-9 frame-budget run. No claim is made
that these controls passed.

## Native status

The clean sandbox's `pnpm build:desktop` produced the web/native bundles but exited `1` because
the `linux-x64` runtime binary was absent after the published prebuilt manifest returned HTTP 404.
Therefore web/native source identity is established by matching generated source hashes, while
desktop execution and Android/iOS captures are `UNVERIFIED`.
