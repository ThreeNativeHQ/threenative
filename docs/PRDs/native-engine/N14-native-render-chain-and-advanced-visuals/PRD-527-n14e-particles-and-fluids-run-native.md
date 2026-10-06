# PRD-527 — Particles and fluids run native (N14e)

**Status:** PROPOSED
**Complexity:** 3 — compute-driven systems on top of N08d's compute proof
**Owner:** João
**Work package:** N14 — [native-engine batch](../README.md)
**Depends on:** [PRD-523 (N14a)](PRD-523-n14a-the-render-graph-owns-passes-and-history.md), [PRD-513 (N08d)](../N08-native-tsl-and-shader-packages/PRD-513-n08d-compute-multipass-and-a-dynamic-graph.md)

## Context

§11.3 lists particles and fluid systems among the framework systems to port. Today they are
`packages/core/src/particles.ts` (including `GPUParticles3D`, the shape the charter holds up for
"never own the look"), `packages/core/src/fluid-field.ts` and `packages/core/src/fluid-particles.ts`.
The engine owns pooling, lifetime, billboarding, instancing and dispatch; geometry, material, colour,
curve and timing stay game-supplied.

## Solution

1. Port emitter pooling, lifetime, sorting, billboarding and compute dispatch into proposed
   `packages/runtime-native/src/engine/world/particles/`, with simulation as render-graph compute
   passes (N14a) and appearance supplied as the game's TSL material (N08).
2. Port the fluid field and fluid particles onto the same compute path.
3. Every appearance parameter keeps coming from the game; the port adds none of its own.
4. Rollback: the legacy backend keeps the TS systems.

## Out of scope

- Physics-coupled particles beyond what the TS systems do today (N15).

## Execution Phases

#### Phase 1: Particles
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/world/particles/`, `packages/runtime-native/tests/native-engine/particles_*.cpp`
- [x] Emission, lifetime and recycling counts match the TS reference for the same seed and tick count. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_particles_lifetime` — 2026-10-05: green on Dawn, ASan and wgpu (`native_engine_particles_lifetime`). `GpuParticles3D` (`src/engine/world/particles/gpu_particles.{h,cpp}`) ports the mechanism of `particles.ts`: two vec3 storage buffers, the game's `start` once on the first attach, `process` per render while emitting, nothing after release. The TS reference is the real core `GPUParticles3D` with a game emitter (seeded u32 LCG lifetimes, recycle on expiry) run in headed Chromium's WebGPU by `tests/native-engine/tsl-compute/programs.js` (`compute-reference.ts` records `compute_reference.json`, NVIDIA Turing, not a software adapter); the native test authors the same kernels with the native TSL builder. Seed 1337, 256 particles, 90 ticks: 256 emitted at start and 744 recycled on both sides, all 512 life and generation values equal, positions equal (129 components within f32 rounding). Red controls: lifetime one tick longer, 726 recycled and 274 state values differ; process dispatched twice per render, 1528 recycled; `emitting` ignored, the dispatch count check fails.
- [ ] A `GPUParticles3D` fixture with a game-supplied material renders within tolerance of the legacy backend. proof: `pnpm parity` (new case `native-engine-gpu-particles`)

#### Phase 2: Fluids
**Status:** NOT STARTED
**Files:** proposed `packages/runtime-native/src/engine/world/fluids/`
- [ ] The fluid field advances to the same state as the TS reference after N fixed steps, within tolerance. proof: `ctest --test-dir packages/runtime-native/build/tn-linux -R native_engine_fluid_field`
- [ ] A fluid-particles fixture renders within tolerance of the legacy backend. proof: `pnpm parity` (new case `native-engine-fluid-particles`)
