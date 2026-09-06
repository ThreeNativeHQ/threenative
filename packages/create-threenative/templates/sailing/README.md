# Sailing starter

This starter is a small bluewater passage: steer the ship through four buoys in order while a
simulated sea moves underneath the hull. `SpectralOcean` inverse-transforms cascaded wave spectra
on the GPU every frame; the same field displaces the surface that is drawn and answers the height
query `Buoyancy3D` measures the hull against, so the ship floats on the water you can see.
`src/entities/Ship.ts` is deliberately ordinary game code, so handling, hull points, density, and
course rules are easy to replace.

Controls: drag the left touch stick to steer and sail forward, or use WASD/the arrow keys; `C` is a
capsize/fail test; `R` restarts.

## Rendering credit

`src/render/sky.ts`'s organization is adapted from
[VictorZakharov/beautiful-water](https://github.com/VictorZakharov/beautiful-water), released
under the MIT License. The water is no longer adapted from it: `src/render/ocean.ts` is written
against `SpectralOcean` and is original to this starter, as are the gameplay, materials, palette,
geometry, and ThreeNative integration.

## Commands

```sh
pnpm dev
pnpm build
pnpm typecheck
pnpm test
```
