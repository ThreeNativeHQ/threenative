# Visual baseline

Every generated project owns its look in `src/render/`. The framework owns renderer
plumbing and the measurement gate; it does not own colours, materials, lighting, camera
framing, fog, tonemapping, exposure, bloom, or post-processing defaults.

Each template ships the same six render entry points:

1. `palette.ts` — at most six named colours, exactly one `accent` role.
2. `camera.ts` — deliberate framing and projection values.
3. `sky.ts` — a sky or background whose fog colour is derived from that sky.
4. `lighting.ts` — a key, fill/bounce, rim, and soft-shadow settings with `normalBias`.
5. `materials.ts` — scene materials imported from the palette.
6. `postprocessing.ts` — deliberate tonemapping and exposure, plus bloom through
   `renderer.setOutputNode()` with a threshold that leaves midtones readable.

These are a quality floor, not a shared style. Users can rewrite or delete the generated
source. A framework package must never import or provide these visual decisions.

`pnpm visuals` checks the six-file structure, scaffolds and builds each template, captures a
headed WebGPU frame through `scripts/xvfb.sh`, rejects blank frames with the capture guard, and writes
reference images under `docs/verification/visuals/`. A human scores the frames with the
blind Visuals rubric; the floor is 4/5. The framework arm and frozen vanilla control are
also scored as a blind pair, with any loss recorded rather than hidden.
