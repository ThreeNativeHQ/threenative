# PRD-371 phase 6 — packed scaffold hygiene

Date: 2026-09-09. Scope: [PRD-371](../PRDs/authoring/PRD-371-dream-loop-authoring.md), phase 6.

The live scaffold path merges `.dream-loop/`, `node_modules/`, `.env`, `.env.*`, and
`!.env.example` without replacing existing asset rules. Reference links are validated across both
host adapters. The root sandbox skill delegates target iteration to the generated validator and
keeps supplied targets immutable.

Executed:

```sh
pnpm build
pnpm exec vitest run packages/create-threenative/__tests__/publication.spec.ts
```

Observed: the workspace build passed; publication 6/6 tests passed after all package `dist`
outputs were built. The packed-tarball test extracted the actual `create-threenative` archive,
scaffolded a starter, ran both generated scripts, and reached an accepted record decision through a
local fixture. The hygiene test used a synthetic key and confirmed it was absent from staged-file
output, generated records, and runtime output.

The real exploration comparison, fresh Codex/Claude host sessions, provider access, browser/native
consumer, and Android/iOS lanes remain **UNVERIFIED**. This phase does not claim PRD acceptance.
