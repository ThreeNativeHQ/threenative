# Genre sweep ledger — `<genre>` — `<date>`

Genre: `<genre>`
Round: `<1 or 2>`
Brief SHA-256: `<sha256>`
Arm: `<framework or vanilla>`
Proof result: `<passed>/<total>`
Proof SHA-256: `<sha256>`
Template: `<template or none>`
Archive: `docs/benchmark/sweeps/<genre>-<date>`
Framework version: `<version>`
User source LOC: `<number>`
Source files: `<number>`
Framework files: `<number>`
Three-only files: `<number>`
Reach rate: `<decimal>`
Used exports: `<comma-separated names or None>`
Unused exports: `<comma-separated names or None>`
Measurement command: `pnpm sweep:measure docs/benchmark/sweeps/<genre>-<date>`
First game-code tool call: `<number>`
Visual result: `<pass or fail, with the largest remaining difference>`

Round 1 is the baseline. A round-2 ledger must use the same genre and brief hash so
`pnpm sweep:delta <round-1-archive> <round-2-archive>` can compare it. The command refuses
different genres, different briefs, and the same archive, then carries repeated friction rows
into the delta record.

## Friction ledger

Record every framework API or surface that blocked the build. If none blocked it, keep one
row saying `None` so the absence is an observed result rather than a blank field.

| API or surface | What blocked the build | Workaround | Evidence |
| --- | --- | --- | --- |
| `<API or None>` | `<specific blocker or no blocker>` | `<plain Three.js workaround or None>` | `<file, command, or observation>` |
