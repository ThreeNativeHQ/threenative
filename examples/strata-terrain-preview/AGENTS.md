# AGENTS.md — Strata terrain preview

Read `/AGENTS.md` first. This example consumes build-baked arrays, not runtime recipes.

- Units are metres; Y is up; canonical heights are row-major Z then X, centred at zero.
- `scripts/bake.mjs` owns authoring. The game imports baked JSON and never evaluates terrain.
- Game appearance lives in `src/render/`; the ocean uses installed `SpectralOcean`.
- Use one `Heightfield` buffer for geometry and existing heightfield collision; do not resample.
- Ground contacts use actual mesh and physics queries. Bilinear heights are not triangle contacts.
- WASD/arrows move, Space jumps, C switches forest/coast. The player owns its camera.
- Starter art, editor controls and portable world export are subsequent PRD phases.

Run `pnpm --filter strata-terrain-preview test:terrain:web` and
`pnpm --filter strata-terrain-preview test:terrain:desktop` for the shared scenario.
