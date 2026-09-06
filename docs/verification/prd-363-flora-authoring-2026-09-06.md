# PRD-363 Phase 3 authoring record — 2026-09-06

## Instruction

`packages/create-threenative/templates/starter/AGENTS.md` gains a `Flora
authoring` paragraph (mirrored to `CLAUDE.md` by `pnpm sync:agents`):

- recipe lives in `src/render/floraStand.ts` (envelope, seed, bounds,
  budgets, wind strength);
- `floraField.ts` grows, `floraMesh.ts` attaches, `floraWind.ts` sways;
- never reorder RNG draws; never hide holes with `DoubleSide`;
- after changing the recipe, re-check hashes and the fixed camera.

## Proof

`should tell the game's agent where the flora recipe lives`
(`packages/create-threenative/__tests__/looks.spec.ts`) asserts the
paragraph and its mirror. Observed red: deleting the paragraph body from
`AGENTS.md` fails the test (negative control N3r, recorded 2026-09-06).

A full cold-agent change-and-proof loop (fresh agent edits the envelope,
re-checks hashes across three seeds, opens captures) has **not** been run;
the instruction assertion is the committed gate.
