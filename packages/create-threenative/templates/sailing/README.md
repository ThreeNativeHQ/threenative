# Sailing starter

This starter is a small bluewater passage: steer the ship through four buoys in order while the
analytic sea moves underneath the hull. `WaveField` measures the water for `Buoyancy3D`, and the
same packed parameters drive the WebGPU displacement node. `src/entities/Ship.ts` is deliberately
ordinary game code, so handling, hull points, density, and course rules are easy to replace.

Controls: WASD or the arrow keys steer and sail forward; `C` is a capsize/fail test; `R` restarts.

## Rendering credit

The water render organization and shader ideas are adapted from
[VictorZakharov/beautiful-water](https://github.com/VictorZakharov/beautiful-water), released
under the MIT License. The adapted files are `src/render/water-material.ts`,
`src/render/water-shaders.ts`, `src/render/wave-nodes.ts`, and `src/render/sky.ts`; the gameplay,
materials, palette, geometry, and ThreeNative integration are original to this starter.

## Commands

```sh
pnpm dev
pnpm build
pnpm typecheck
pnpm test
```
