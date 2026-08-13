# PRD-091 narrowed repair lane

Recorded 2026-08-12 in
`/home/joao/projects/threejs-webgpu/.worktrees/starter-kit-091-r4-20260812`, based on approved
repair commit `8d410696b30a3f60d4ac478b0cf075c06da87ea6`.

## Repair evidence

The visual gate now persists each accepted template capture to both the verification evidence
path and the package-safe Studio asset path in one operation. The regression test invokes the
production `captureAllTemplates()` orchestration with temporary output roots and an injected
capture, rather than calling `persistTemplateCapture()` directly.
The Studio regression removes `packages/studio/assets/platformer.png`; `/api/kits` omits its
`previewImage` and `/api/kits/platformer/preview` returns `404`. The test restores the capture.

The three existing verification/package captures remain byte-identical:

```text
minimal:    f96ccfefce6dad7c372373e7712736000dda6b1b5c4fcf86ffc211dfa842650f
platformer: 2fe0bcbdab9deedbc2afbd91fd59bbd7ffe49146a04bd97e110b816a282f8edd
starter:    15e2c47a7a914886231f08f6cf6901cd21358d81ca24d25e7dd4cf52b3068b55
```

The phase-1 negative-control text now names `packages/studio/assets/platformer.png`; it no
longer claims that deleting `docs/verification/visuals/platformer.png` changes Studio behavior.

## Repair round 1 evidence

The orchestration regression covers all three discovered templates. It verifies every capture is
written to both temporary roots and verifies that Studio discovers the package-safe
`platformer.png` preview. Removing the live `persistTemplateCapture()` call made the test fail
with `ENOENT` for the temporary `visuals/minimal.png`; the call was restored before the final run.

## Repair round 1 commands

| Command | Exact result |
| --- | --- |
| `pnpm exec vitest run scripts/__tests__/visual-gate.spec.ts packages/studio/__tests__/studio.spec.ts` | exit `0`; `2 passed`, `11 passed` |
| `pnpm --filter create-threenative build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/studio build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/playtest build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/core build` | ordered retry exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/physics build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/ui build` | exit `0`; publint: `All good!` |
| `pnpm typecheck` | exit `0`; root and workspace typechecks passed |
| `pnpm exec biome check packages/studio/src/server.ts packages/studio/__tests__/studio.spec.ts scripts/visual-gate.ts scripts/__tests__/visual-gate.spec.ts` | exit `0`; three existing cognitive-complexity warnings remain |
| `pnpm studio:probe --browser` | `24/24 checks passed` |
| `pnpm exec tsx scripts/visual-gate.ts --structural-only` | `Visual structure passed for minimal, platformer, starter.` |
| `git diff --check` | exit `0`; no whitespace errors |

The package build was first launched in parallel; the initial core process exited `1` because the
playtest dist export was not ready yet. After the playtest build completed, the ordered core retry
passed. The negative-control test was intentionally run with the live persistence call removed,
failed as recorded above, and was then rerun with the production call restored.

## Commands

| Command | Exact result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit `0` |
| `pnpm exec vitest run packages/studio/__tests__/studio.spec.ts scripts/__tests__/visual-gate.spec.ts` | final run: `2 passed`, `11 passed` |
| `pnpm --filter create-threenative build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/studio build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/playtest build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/core build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/physics build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/ui build` | exit `0`; publint: `All good!` |
| `pnpm typecheck` | exit `0`; root, 11 workspace projects, native-smoke, abyss-framework, and Studio passed |
| `pnpm exec biome check packages/studio/src/server.ts packages/studio/__tests__/studio.spec.ts scripts/visual-gate.ts scripts/__tests__/visual-gate.spec.ts` | exit `0`; three existing cognitive-complexity warnings remain |
| `pnpm studio:probe --browser` | `24/24 checks passed` |
| `pnpm exec tsx scripts/visual-gate.ts --structural-only` | `Visual structure passed for minimal, platformer, starter.` |
| `pnpm test:templates` | exit `0`; `minimal`, `platformer`, and `starter` scaffolded playtests passed |
| `git diff --check` | exit `0`; no whitespace errors |

The fresh worktree initially lacked `node_modules` and workspace `dist` outputs. The prerequisite
build commands above were run before the final typecheck and focused test run; no generated build
outputs are staged.

## Repair round 2 evidence

Studio kit creation now returns the observed `preview.ready` state, `/api/status` remains the live
readiness source, and the browser reloads the iframe only when readiness changes from `false` to
`true`. The Studio regression starts a fixture preview behind a marker file, observes `preview.ready`
as `false`, releases the preview, and proves the iframe reaches `#live-preview`; the old URL-only
assertion could not observe that transition. The browser probe now requires a visible `canvas` in
the iframe. The visual score validator now rejects any template registry whose keys differ from
the discovered `kit.json` manifest names; its focused negative control rejects the stale `retired`
entry with `TN_VISUAL_SCORE_TEMPLATES_MISMATCH`.

## Repair round 2 commands

| Command | Exact result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit `0`; lockfile up to date; 163 packages installed |
| `pnpm --filter create-threenative build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/studio build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/playtest build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/core build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/physics build` | exit `0`; publint: `All good!` |
| `pnpm --filter @threenative/ui build` | exit `0`; publint: `All good!` |
| `pnpm exec vitest run packages/studio/__tests__/studio.spec.ts scripts/__tests__/studio-probe.spec.ts scripts/__tests__/visual-gate.spec.ts` | exit `0`; 3 test files passed, 17 tests passed; Studio `5`, probe `4`, visual `8` |
| `pnpm studio:probe --browser` | exit `0`; `24/24 checks passed`; picker check loaded a live preview canvas |
| `pnpm exec tsx scripts/visual-gate.ts --structural-only` | exit `0`; `Visual structure passed for minimal, platformer, starter.` |
| `pnpm typecheck` | exit `0`; root and all 11 workspace typecheck projects passed, including native-smoke, abyss-framework, and Studio |
| `pnpm exec biome check packages/studio/src/server.ts packages/studio/src/app.tsx packages/studio/__tests__/studio.spec.ts scripts/studio-probe.ts scripts/__tests__/studio-probe.spec.ts scripts/visual-gate.ts scripts/__tests__/visual-gate.spec.ts` | exit `0`; no errors; three pre-existing cognitive-complexity warnings remain |
| `git diff --check` | exit `0`; no whitespace errors |

The first focused test attempt was blocked by the fresh worktree's missing dependencies; the first
typecheck attempts were blocked by missing workspace build outputs. Frozen install and the ordered
package builds above supplied those prerequisites before the final green results. No generated
build output is staged.
