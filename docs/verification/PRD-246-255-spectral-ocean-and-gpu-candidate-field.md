# PRD-246 and PRD-255 — spectral ocean and the GPU candidate field

**Run date:** 2026-08-29. **Branch:** `feature-mining-246-255-20260829`, cut from `main` at
`8ff06738`. **Adapter:** `nvidia / turing`, checked in every browser run — no result here came from
SwiftShader. **Method:** the feature-mining sandbox-validation loop — install from tarballs into
`/home/joao/projects/threenative/sandbox`, build a mini game whose *rule* is the feature, drive it
with a playtest, read the capture, mutate to red.

## What shipped

| Ledger row | PRD | Where | Consumer |
| --- | --- | --- | --- |
| `GPUReadback` — throttled, fire-and-forget, staleness-reporting | 246 #1 | `packages/core/src/gpu-readback.ts` | both sandbox games |
| `IRendererLike.readback` seam, WebGPU-guarded like `compute` | 246 #2 | `packages/core/src/renderer.ts:114` | `GPUReadback` |
| `SpectralOcean` — cascades, spectrum, inverse FFT, `IComputeDriven` | 246 #3 | `packages/core/src/ocean/{spectral,fft}.ts` | `sandbox/spectral-sea` |
| `sampleHeight(x, z)` with a declared staleness | 246 #4 | `SpectralOcean.sampleHeight` | `sandbox/spectral-sea` |
| Ocean **look** stays the kit's | 246 #5 | `sandbox/spectral-sea/src/render/ocean.ts` | — |
| Indirect-geometry projection guard | 255 #3 | `packages/core/src/projection-plan.ts` | `sandbox/last-harvest` |
| Game-owned million-candidate field | 255 #1 | `sandbox/last-harvest/src/render/grass.ts` | itself |
| `GPUInstanceField` generic extraction | 255 #2 | **DECLINED** — see below | — |

## Gates

```
pnpm typecheck        0 errors
pnpm lint             0 errors
pnpm exec vitest run  2546 passed | 1 failed (2547)
```

The one root failure, `packages/playtest/__tests__/generated-shooter-input.spec.ts`, is **red on
unmodified `main`** — verified by running it on the primary checkout at `main` — and is not this
branch's. `packages/runtime-native`'s four failures are unbuilt native executables in a fresh
worktree (`threenative-timestamp-query-test is not built`), not regressions; note that a
runtime-native red aborts `pnpm test` before the ~2,547 root tests run at all, so the root suite was
run separately.

## Unit evidence, with its red controls

Every red was applied, run, recorded and reverted.

| Claim | Green | Red control | Observed |
| --- | --- | --- | --- |
| `request()` never blocks the frame | 11/11 `gpu-readback.spec.ts` | drop the in-flight guard | `control.calls` 1 → 240, exit 1 |
| staleness grows while nothing lands | " | hardcode `staleFrames` 0 | `[1..6]` → `[0,0,0,0,0,0]`, 4 failed, exit 1 |
| the seam fails closed off WebGPU | " | return instead of throw | error names `getArrayBufferAsync`, exit 1 |
| the FFT plan is a real inverse transform | 6/6 `ocean-fft.spec.ts` | flip the twiddle sign | disagrees with a naive inverse DFT by 1.4658, exit 1 |
| the spectrum is Hermitian | 30/30 `ocean-spectral.spec.ts` | drop the mirrored conjugate | −0.0887 vs 0.0887, exit 1 |
| cascades partition the spectrum | " | every cascade starts at k=0 | band join 1.0053 vs 0, exit 1 |
| the same seed gives the same sea | " | ignore the seed | same-seed fields differ, exit 1 |
| wave height does not follow resolution | " | restore `1/resolution` on `h0` | energy 3.14e-6 vs 3.72e-5 needed, 16× low, exit 1 |
| the projection cannot fold an indirect mesh | 59/59 `renderProjection.spec.ts` | remove the guard | `report.exact.indirect` undefined, exit 1 |
| the charter guard reads every core file | 4/4 `constraints.spec.ts` | plant a material in `src/ocean/` | 1 failed, exit 1 |

## Consumer evidence

Both games were built outside the repository, installed from content-hashed tarballs, with no
workspace link and no `AGENTS.md` chain. Both are committed and pushed to `ThreeNativeHQ/examples`.

**`sandbox/spectral-sea` — the gate is only reachable on a crest.** Green, exit 0:

```
oceanSteps 287->1388   heightSamples 40->58    staleFrames 9->78
gateCrest    0->1.392  gateRange      0->2.152
gatesCleared 0->2      outcome  playing->won
```

`gateCrest` and `gateRange` are measured only inside the beacon ring and read exactly zero before
the scenario steers there. Red controls: never `ctx.add` the ocean → every number zero, exit 1;
`sampleHeight` returns a constant → **the sea still simulates and still draws** and the game is
unwinnable, exit 1.

**`sandbox/last-harvest` — 1,048,576 candidates, compacted by an atomic counter into an indirect
draw.** Green, exit 0, twice in a row:

```
candidateCount 1048576 (held)   cpuCandidateWrites 0 (held, throughout)
indirectBound        1 (held)   resetDispatches  220->904
cullDispatches   220->904       standingNow   201035->172824
cutTotal        4843->41708     outcome  harvesting->cleared
```

Red controls: never `ctx.add` the field → dispatches 0, exit 1; drop the reset pass → the counter
accumulates across frames to `cutTotal` 3,101,015, more blades than the field contains, exit 1;
remove `geometry.setIndirect()` → `indirectBound` 0, exit 1.

Captures: `sandbox/spectral-sea/capture-ride-the-crest.png`,
`sandbox/last-harvest/capture-mid-harvest.png`. Both were read, not merely produced.

## Defects the loop found that no unit test could

1. **The unpack divided the transform by N²**, making `resolution` a wave-height knob: a game
   doubling its grid for detail got a sea four times flatter. Symptom reads as "the amplitude needs
   tuning". Fixed; `h0` now carries `Δk = 2π/patchSize`.
2. **The ocean was render-cadence and froze**, dispatching 4 times in 1,101 ticks while every
   assertion still passed — the raft was moving across a frozen field, so its sampled height kept
   changing. A number that moves is not proof the thing producing it is running. Default is now the
   game's fixed step.
3. **`ctx.add()` erased the node's type**, so `ctx.add(new SpectralOcean(...)).sampleHeight(...)` did
   not compile and every typed node in every scene needed a cast back to what it already was.
4. **The charter's own guard could not see `src/ocean/` or `src/atmosphere/`** — it globbed
   `src/*.ts` flat, leaving five files outside the rule that keeps appearance out of core. It also
   matched prose, so a comment saying "creates no material" was a violation. Now recursive, and it
   strips comments.
5. **A plain assignment to an atomic buffer does not compile in WGSL** (`cannot assign 'u32' to
   'atomic<u32>'`) — it typechecks on the CPU and fails at pipeline creation in the browser, and the
   game then declared itself won on a counter that stayed zero.

## Harness findings

- **A long `holdTicks` step starves an async GPU readback.** The scenario pumps the fixed-step clock
  far faster than real time, and `getArrayBufferAsync` needs the event loop. Across two 300-tick
  steps a copy landed **twice in 900 dispatches**. Twenty-five short steps land it repeatedly. Any
  rule that depends on a readback cannot be proven by one long step; there is no real-time wait step
  in the scenario schema.
- The same limit is why `spectral-sea` reports `staleFrames` 78 rather than single digits.

## PRD-255 Phase 4 — DECLINED

`GPUInstanceField` was not created. The gate requires two independent consumers demonstrating that a
generic reset/compaction/indirect/lifecycle wrapper is smaller and appearance-neutral across both
repetitions. There is one consumer. Per the PRD, skipping this phase is a successful game-source
outcome, not an unfinished implementation. `packages/core` contains no grass, blade, species, biome,
density or foliage vocabulary.

## UNVERIFIED

Named rather than implied. None of the following ran:

- **Native desktop conformance** for either feature. PRD-255's `77-gpu-driven-indirect-instances`
  registry row was not added; PRD-246's Phase 1 conformance case was not added.
- **Android and iOS**, including PRD-246 Phase 4's physical-Pixel-8 decision about whether the FFT
  fits a mobile frame. `SpectralOcean` therefore claims **web only**.
- **`pnpm budgets`, `pnpm quality`, `pnpm tsx scripts/count-loc.ts`** — not run on this branch.
- **An A/B capture against `WaveField`**, required by PRD-246's acceptance criteria. `WaveField`
  does not exist: PRD-236 has not been implemented, so there is nothing to compare against and the
  "visibly better than the analytic ocean" criterion cannot be evaluated at all. The sibling-contract
  argument stands on its own; the comparison does not.
- **Frame meters.** No `render.p50`/`p95`, hitch maximum, or buffer-byte figures were recorded for
  either feature, so PRD-246 Phase 2's per-cascade cost at N=256/512 and PRD-255 Phase 5's paired
  measurements are both outstanding.
