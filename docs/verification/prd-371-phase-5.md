# PRD-371 phase 5 — bespoke asset handoff

Date: 2026-09-09. Scope: [PRD-371](../PRDs/authoring/PRD-371-dream-loop-authoring.md), phase 5.

Both generated asset adapters now route a bespoke-without-reference branch through
`agent-docs/dream-loop.md` and an explicitly selected target source. The existing license, credits,
`sculpt_plan`, `sculpt_spec_gate`, `sculpt_compare`, and `sculpt_pass_gate` requirements remain
in force; no image-to-3D or second Blender bridge was added.

Executed as part of the scaffold suite:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/scaffold.spec.ts -t "asset licensing|dream-loop"
```

Observed: fresh-scaffold, four missing-adapter, and asset license/sculpt-gate controls passed.

No bespoke landmark was imported into the exploration game. Blender qualification, browser/native
silhouette and floor-contact captures, and human two-angle inspection remain **UNVERIFIED**.
