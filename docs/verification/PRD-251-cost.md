# PRD-251 cost, residency and kill-switch record

Date: 2026-08-30

Baseline SHA: `4a73a5f58570335d3b5ae1988220ac6f8fc1f66a`

Status: three explicit local generation configurations are measured. Browser render-p50,
desktop-native generation/render-p50, and Pixel 8 numbers are unavailable, so no unmeasured
number is promoted to a budget.

## Measurement configurations

The probe instantiated `TerrainTiles` with the listed tile resolution, CPU erosion iteration count
and resident tile budget, followed the origin, and measured resident creation time with the local
CPU reference path. The shipped browser consumer uses configuration A.

| Config | Tile resolution | Erosion iterations | Resident tile budget | Initial resident-set generation probe | Peak resident bytes | Peak resident tiles |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A — shipped consumer | 65 | 4 | 9 | 359.22417199999995 ms | 3,175,992 | 9 |
| B — small unit | 9 | 0 | 4 | 28.41756600000008 ms | 36,192 | 4 |
| C — medium unit | 17 | 0 | 9 | 33.25510600000007 ms | 250,488 | 9 |

The A value is the nine-tile initial resident set, not a per-tile isolated sample; it is labelled
as a set measurement to avoid overstating it as a per-tile benchmark. The browser traversal for A
reported `383.3739925772788 m` movement, `9` peak resident tiles, `3,175,992` peak bytes, zero
diagnostics and adapter NVIDIA/Turing. The playtest did not emit `generationMs` or `render.p50`,
so those fields remain unmeasured.

## Platform matrix

| Platform | A | B/C | Evidence |
| --- | --- | --- | --- |
| Headed browser WebGPU | CPU fallback, measured residency and movement | not run | adapter NVIDIA/Turing; no render-p50 field |
| Native desktop WebGPU | blocked | not run | native verification has a pre-existing bindings-creation failure; world row unimplemented |
| Pixel 8 | unavailable | unavailable | `adb devices` found no device |
| iOS | unavailable | unavailable | `xcrun` is absent |

The browser consumer declares CPU fallback with four iterations. Mobile documentation declares the
same reduced fallback path, but no mobile execution evidence exists; unsupported is not silently
converted into a pass.

## Kill switch and repository gates

```sh
pnpm tsx scripts/count-loc.ts --world-repetitions=2
```

Exit code: `0`.

```text
world heightfield LOC: framework 444 (440 implementation + 4 wiring), repeated portable 880 across 2 proven games, 49.5% smaller
```

The framework arm is materially smaller across both repetitions, so the §11.1 kill switch is
honoured for the current measured scope. This does not waive the failed topology floors.

```sh
pnpm budgets
```

Exit code: `0`. Hard invariants passed. The report recorded framework LOC `38,725/15,000` and
native runtime LOC `114,148/100,000` as review triggers, not silent budget passes.

```sh
pnpm quality
```

Exit code: `0`; advisory report: `99 findings (21 new, 23 grew, 54 inherited, 1 waived)`.

```sh
pnpm sync:agents && pnpm sync:agents --check
```

Exit code: `0`; `16` mirrors in sync and `packages/core/CLAUDE.md` regenerated from
`packages/core/AGENTS.md`.

## Checkpoint record

- Exact baseline SHA: `4a73a5f58570335d3b5ae1988220ac6f8fc1f66a`
- Seeded red: count-loc's portable repeated arm remained materially larger than the framework
  arm; no cost mutation was needed because the three configurations are measurement probes.
- Headed evidence class: one browser traversal capture inspected; render-p50 absent.
- Native/mobile evidence class: blocked or unavailable as recorded above.

Changed files for this phase:

```text
docs/verification/PRD-251-cost.md
packages/create-threenative/capabilities.json
packages/core/AGENTS.md
packages/core/CLAUDE.md
```
