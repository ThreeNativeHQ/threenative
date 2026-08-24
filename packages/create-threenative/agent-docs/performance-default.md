## Performance default

Refill scratch; pool objects.

`TN_FRAME_BUDGET` prints `fps` and the frame split: `hostGap`, `update`, `render`, `overlay`,
`residual`. `defineGame({ frameBudget: false })` silences it, not the measurement.

`{"performance":{"maxFrameMsP95":33,"minFps":30,"maxPhaseMsP95":{"render":12}}}`
`agent-docs/assertion-reference.md#performance`

Phone memory is a ~500 MiB driver floor plus what you ask for, and one equirect on both
`scene.background` and `scene.environment` costs 48 MiB extra — measured, Pixel 8.
Budgets and the fix: `agent-docs/mobile-memory-budget.md`.
