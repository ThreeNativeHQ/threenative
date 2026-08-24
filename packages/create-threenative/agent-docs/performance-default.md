## Performance default

Refill scratch; pool objects.

`TN_FRAME_BUDGET` prints `fps` and the frame split: `hostGap`, `update`, `render`, `overlay`,
`residual`. `defineGame({ frameBudget: false })` silences it, not the measurement.

`{"performance":{"maxFrameMsP95":33,"minFps":30,"maxPhaseMsP95":{"render":12}}}`
`agent-docs/assertion-reference.md#performance`
