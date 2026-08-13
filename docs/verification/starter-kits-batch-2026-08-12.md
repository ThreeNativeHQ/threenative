# Starter-kit batch verification — 2026-08-12

**Status: implementation batch integrated locally; platform and closure boundaries remain explicit.**

This record covers the cumulative integration of PRD-087 through PRD-093. The generated games,
the Studio delivery rail, and the web/native spatial-query plumbing were tested from the same
workspace build.

## Passing evidence

- `NPM_CONFIG_USERCONFIG=/home/joao/projects/threejs-webgpu/.npmrc pnpm test:templates` — all
  seven templates passed their generated playtests: `action-rpg`, `defense`, `minimal`,
  `platformer`, `racing`, `shooter`, and `starter`.
- `pnpm exec tsx scripts/visual-gate.ts --structural-only` — all seven template structures
  passed. Headed captures were also recorded for the four new kits under `packages/studio/assets/`.
- `xvfb-run -a -s '-screen 0 1600x900x24' env NPM_CONFIG_USERCONFIG=/home/joao/projects/threejs-webgpu/.npmrc pnpm studio:probe --browser` — **24/24** checks passed, including Studio/CLI scaffold parity and a nonblank WebGPU canvas after the Platformer picker click.
- `pnpm native:verify:desktop` — **300 frames**, native-smoke one-file bundle, 14 physics playtest assertions, and the native spatial-query proof passed after the opt-in native build.
- `pnpm typecheck` and the focused starter-kit, physics, Studio, probe, visual, and scaffold
  tests passed. The focused run covered 12 files and 97 tests; the final Studio/probe run covered
  2 files and 14 tests.

## Boundaries

- PRD-088 remains **BLOCKED** because its required pre-implementation ray measurement was not
  recorded. The web and Linux desktop implementation is present, but this evidence gap is not
  silently promoted to completion.
- Desktop execution is proved. Android and iOS were not executed on this operator machine, so
  this batch makes no mobile-ready claim.
- The latest full `pnpm test` run reached 107/108 files and 898/899 tests; the only failure was
  the existing `scripts/__tests__/quality-json.spec.ts` five-second timeout under full workspace
  load. The isolated quality command passed. `pnpm lint` exits 0 with 191 existing cognitive-
  complexity warnings; changed-file checks are clean. `pnpm budgets` passed and reported the
  existing native LOC review trigger (69,805 versus 50,000).
