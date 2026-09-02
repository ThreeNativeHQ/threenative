# PRD-317 generated authoring evidence — 2026-09-02

The shape/look owner is generated starter source, not a framework package. The authored controls
are in src/render/rockRidge.ts. The renderer-independent extractor and final-array audit are in
src/render/implicitSurface.ts. The Worker only transports the game-owned field result.

## Cold-agent instruction

The exact generated paragraph in starter AGENTS.md is:

~~~text
## Fused rock authoring
`src/render/rockRidge.ts` owns the granite field, seed, bounds, ridge material handoff, and quality choice; `src/render/implicitSurface.ts` is the local renderer-independent extractor and final-array topology audit. A fused mass is one implicit field; separate debris may be instanced.
After changing bounds, field, or resolution, run three fixed seeds and require the audit to report zero boundary edges, degenerate triangles, and winding conflicts with positive signed volume. Never hide holes with `DoubleSide` or a normal map.
`Play.enter` attaches Preview immediately, then the classic Worker refinement swaps atomically; do not add a main-thread showcase fallback.
~~~

The generated mirror contains the same paragraph. The line-cap command returned:

~~~sh
wc -l packages/create-threenative/templates/starter/src/render/implicitSurface.ts packages/create-threenative/templates/starter/src/render/rockRidge.ts packages/create-threenative/templates/starter/src/render/rockRidge.worker.ts packages/create-threenative/templates/starter/AGENTS.md packages/create-threenative/templates/starter/CLAUDE.md
~~~

~~~text
199 packages/create-threenative/templates/starter/src/render/implicitSurface.ts
199 packages/create-threenative/templates/starter/src/render/rockRidge.ts
 77 packages/create-threenative/templates/starter/src/render/rockRidge.worker.ts
 95 packages/create-threenative/templates/starter/AGENTS.md
 97 packages/create-threenative/templates/starter/CLAUDE.md
667 total
~~~

## Source and disposal contract

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts packages/create-threenative/__tests__/template.spec.ts
~~~

~~~text
Test Files 2 passed (2)
Tests 51 passed (51)
~~~

The source-level assertions cover: no framework import or hidden material in generated render
source; the live scenery caller; classic Blob Worker construction; transferred position/index
buffers; no module Worker; generation-token rejection; add-before-remove atomicity; previous
geometry disposal; Play.exit disposal; and the generated AGENTS/CLAUDE instruction pair.

The scaffold tree hash is intentionally updated only for starter:

~~~text
starter: e6ebc0b4dc5d09932fac3308f4c810f757cceebbe7c1a168d427dc73cc9914a8
~~~

## Documentation negative control

Deleting the generated rock paragraph and running its source contract produced:

~~~sh
pnpm exec vitest run packages/create-threenative/__tests__/looks.spec.ts -t "replace the block horizon"
~~~

~~~text
AssertionError: expected AGENTS source to contain 'rockRidge.ts'
1 failed, 15 skipped
~~~

Restoring AGENTS.md and running the mirror check produced:

~~~sh
pnpm sync:agents --check
~~~

~~~text
agent docs in sync: 17 CLAUDE.md mirrors
~~~
