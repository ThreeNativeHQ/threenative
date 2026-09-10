# PRD-371 phase 1 — shared Dream Loop workflow

Date: 2026-09-09. Scope: [PRD-371](../PRDs/authoring/PRD-371-dream-loop-authoring.md), phase 1.

Automated proof is green for the generated workflow, both host adapters, the MIT attribution, and
the missing-recipe controls. `createProject` copies `agent-docs/dream-loop.md`, the two authoring
scripts, and both `.agents`/`.claude` adapter pairs into a fresh scaffold. The root AGENTS/CLAUDE
pair links the recipe in all ten templates.

Executed:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts
```

The focused suite reached 61 tests; its hash, fresh-scaffold, four missing-adapter, and asset-gate
controls passed after the final generated bundle hash was refreshed. The full package build also
passed before this record was written.

The removed-recipe negative controls are the four host adapter paths in
`packages/create-threenative/__tests__/scaffold.spec.ts`; each fails closed with
`RED observed: referenced recipe missing` when its link is changed to an absent page.

Real exploration gameplay, independent visual review, and human target acceptance remain
**UNVERIFIED**. No browser/native game was changed or claimed by this phase.
