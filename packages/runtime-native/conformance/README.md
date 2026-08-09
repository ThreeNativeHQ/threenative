# ThreeNative conformance harness

This directory is the same-source browser/native compatibility harness for upstream Three.js WebGPU.

- `registry.json` is the versioned public test registry. All required M3 IDs are present from the PRD, even when a case is still `planned`.
- `scenes/shared/first-proof-game.js` is the first proof source. It contains no runtime conditional branches; host adapters provide the canvas/dimensions.
- `browser-reference/` and `native-runner/` are thin adapters around the same scene sources.
- `run-conformance.mjs` writes a machine-readable report with pixel/perceptual metric slots, render completion, GPU validation error slots, and per-test tolerance metadata.
