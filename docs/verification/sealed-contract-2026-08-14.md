# Sealed contract replay — 2026-08-14

PRD-113 evidence for the repaired physics-puzzle contract and the six-genre audit.

## Hash discontinuity

The old physics proof hash was `c241ea5e4120afd4a50325a5b9ee0606e81e1b9d8539896f2b6e9f6b8f85da0d`.
The pre-repair revised sealed proof set hash was
`d8e90936be7bec4046af766b108fdd7b1dcb92aad3d1e87e4c72b2de40d592f3`.
The previous repaired proof set hash was
`a778a22b8b311d427343970008f9d22ffb3a1e2fb59043ca2bcbb998ca16d36f`.
The current repaired sealed proof set hash is
`33c3acb029096205e3e04cc22afdd736575998b8a41ab3208888071ede654ab8`.
The current repaired physics brief hash is
`d950471f7bfc7e68778711ff44438f55022b769b9ffa0d26776252c8414d5935`.

All functional-column numbers recorded under the old proof contracts are explicitly
non-comparable with the current six-dimension behavior contract. Historical numbers remain
unchanged; they are not rewritten as current evidence.

## Committed archive replay status

The committed archive commands were run exactly as follows:

```sh
xvfb-run -a -s '-screen 0 1600x900x24' pnpm sweep:proof docs/benchmark/sweeps/physics-puzzle-2026-08-15-4
xvfb-run -a -s '-screen 0 1600x900x24' pnpm sweep:proof docs/benchmark/sweeps/physics-puzzle-2026-08-15-5
```

Both returned exit `1` at the hash gate. Each manifest still contains the previous repaired
hash `a778…`, while the sealed proof set contains `33c3…`. The archives are outside this lane,
so neither manifest nor archive source was edited.

To separate the stale-manifest gate from behavior, an untracked manifest-only diagnostic copy of
each committed archive was replayed with the current proof hash. The copied source reached
assertions and returned exit `1`; these copies are not evidence artifacts or delivery inputs.

The six direct behavior dimensions are movement, blocking contact, pass-through interaction,
goal-contact interaction, settled bodies, and terminal state after contact.

The former “positive” archive reached `1/6` direct dimensions: blocking contact passed; movement,
pass-through, goal contact, settling, and ordered terminal state failed. Its world seed and
diagnostic assertions also failed.

The gutted archive reached `2/6` direct dimensions: movement and blocking contact passed;
pass-through, goal contact, settling, and ordered terminal state failed. Its state result showed
no terminal candidate and no retained goal-contact evidence.

Neither replay is claimed as positive evidence. The required positive committed archive remains
blocked by the stale archive manifest and by the observed behavior of the committed source.

## Genre audit

`pnpm exec vitest run scripts/__tests__/sealed-contract.spec.ts` passes all four tests for the
six-genre audit. The audit walks entity fields, world seeds, input keys, every pinned
`assert.resources` and `setup.resources` id/path, plus parity resource ids. It treats the generic
`state` resource channel as a harness channel rather than a gameplay entity id.

The red controls remain fail-closed for named entities and mutated resource pins. The temporary
mutations were removed before delivery. The source PRD was not edited.
