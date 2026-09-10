# PRD-371 phase 2 — qualified reference acquisition

Date: 2026-09-09. Scope: [PRD-371](../PRDs/authoring/PRD-371-dream-loop-authoring.md), phase 2.

`packages/create-threenative/agent-files/scripts/reference.mjs` is shipped as editable generated
source. It requires a run record, unique request ID, prompt file, and output path; discovers image
capability, sends one non-streaming request, accepts only validated inline raster bytes, writes
atomically, and records completion/unknown usage without printing credentials.

Executed:

```sh
pnpm exec vitest run packages/create-threenative/__tests__/reference.spec.ts
pnpm exec vitest run packages/create-threenative/__tests__/publication.spec.ts -t "packed tarball"
```

Observed: reference protocol 4/4 tests passed, including exact prompt preservation, missing-key
and invalid-image failures, interruption recovery without a duplicate POST, path containment, and
reference-conditioned input bytes. The packed-tarball test generated a valid PNG through a local
loopback fixture and recorded its provenance.

No real OpenRouter POST was authorized or executed. Muse dimensions, usage, editing quality, and
the exploration landmark therefore remain **UNVERIFIED**; the loopback fixture is transport proof,
not provider proof.
