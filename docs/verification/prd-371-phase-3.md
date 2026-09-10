# PRD-371 phase 3 — bounded evidence decisions

Date: 2026-09-09. Scope: [PRD-371](../PRDs/authoring/PRD-371-dream-loop-authoring.md), phase 3.

`packages/create-threenative/agent-files/scripts/visual-loop.mjs` is the generated evidence
validator. It reconciles interrupted requests, verifies target/capture/source hashes, requires
nonempty functional assertions, distinct independent review, bounded scores, and measured FPS,
and emits an explicit decision instead of inferring acceptance from exit status.

Executed:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/visual-loop.spec.ts
```

Observed: 5/5 tests passed. The suite covers stale captures, interrupted allowance exhaustion,
one-replan/stall behavior, accepted fresh evidence, missing review/performance, invalid scores,
uncapped FPS, and a missing display cap. The validator's valid stop decisions remain explicit in
the generated JSON record.

An interrupted real exploration run and a real gameplay capture were not executed. Consumer
decisions on a browser/native subject remain **UNVERIFIED**.
