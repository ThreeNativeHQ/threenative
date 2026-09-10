# PRD-371 phase 4 — identity-preserving refinement

Date: 2026-09-09. Scope: [PRD-371](../PRDs/authoring/PRD-371-dream-loop-authoring.md), phase 4.

The generated reference script accepts `--reference <local-image>` only inside the run artifact
root, preserves the original prompt and reference bytes, and writes a new output path without
overwriting a locked target. Request accounting, hashes, and the original completed receipt stay
in the same run record.

Executed:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/reference.spec.ts
```

Observed: 4/4 tests passed, including the loopback assertion that the original screenshot bytes
are sent to the selected edit request and that wrong/empty provider results cannot become a target.

Live screenshot-conditioned Muse editing, two gameplay positions, and human unchanged-layout
inspection remain **UNVERIFIED**. No provider substitution was attempted.
