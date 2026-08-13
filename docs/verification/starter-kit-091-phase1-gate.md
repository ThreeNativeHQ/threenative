# PRD-091 Phase 1 — unregistered broken template is rejected

Recorded 2026-08-12 after manifest discovery replaced the hardcoded gate enumeration.

The same temporary control was used: a copy of `platformer` was added at
`packages/create-threenative/templates/starter-kit-091-unregistered-broken/`, its `kit.json`
name was changed to match the directory, and `src/render/postprocessing.ts` was removed. No
TypeScript list was edited. The fixture was moved out of the templates directory after the run.

Command:

```sh
pnpm test:templates
```

Observed result:

```text
exit=1
TN_VISUAL_STRUCTURE_FAILED:
starter-kit-091-unregistered-broken: missing src/render/postprocessing.ts
starter-kit-091-unregistered-broken: postprocessing.ts is missing toneMapping
starter-kit-091-unregistered-broken: postprocessing.ts is missing toneMappingExposure
starter-kit-091-unregistered-broken: postprocessing.ts is missing setOutputNode
starter-kit-091-unregistered-broken: postprocessing.ts is missing bloom(
```

The directory was discovered from `kit.json` and failed before scaffolding. This is the required
red-after control, paired with the green-before recording in the Phase 0 file.

With the temporary fixture removed, the normal gate was rerun:

```text
exit=0
minimal: scaffolded playtests passed.
platformer: scaffolded playtests passed.
starter: scaffolded playtests passed.
```

The normal run therefore covers every current manifest without a second registration list.

## Budget delta

`pnpm budgets` reports 7 framework packages and 10,604 framework LOC, versus 6 packages and
8,560 LOC at the Phase 0 baseline: +1 package and +2,044 LOC for the Studio delivery surface and
manifest rail. The 15,000-line framework review trigger was not crossed. Native runtime LOC is
unchanged at 68,516, retaining its pre-existing 50,000-line review trigger; this lane added no
native runtime source.

The CLI smoke created `minimal`, `starter`, and `platformer` projects with `--no-install`, and
`--help` listed the same three manifests with their generated blurbs. The probe removal guard is
covered by `scripts/__tests__/studio-probe.spec.ts`: a reduced report returns `Assertions were
removed`, while an empty report remains non-passing.

The guard's red mutation control was also exercised directly: reducing a two-check report to one
produced exit 1 with `The probe now observes 1 checks, down from 2. Assertions were removed.`

The preview negative control temporarily removed the package-safe capture
`packages/studio/assets/platformer.png` and `studioKits()` returned the platformer manifest
without `previewImage`; the capture was restored immediately. The visual gate now writes this
package asset from the same capture bytes as `docs/verification/visuals/platformer.png`, so a new
kit capture reaches the published Studio package without a hand-copied second source. The picker
therefore cannot claim a gated image when the visual gate has not supplied one.

The parity negative control wrote different `package.json` bytes into two temporary scaffold
trees; `sameProjectTree()` observed `false` in `scripts/__tests__/studio-probe.spec.ts`.

## Repair round 2 — readiness and score-registry controls

The Studio preview path now reports readiness in the create response and status endpoint. A
deterministic browser regression observes the delayed preview as `preview.ready: false`, releases
the server, and then proves that status polling reloads the iframe until `#live-preview` is live.
The production browser probe separately requires a visible canvas inside the preview iframe, so a
connection-error document with only the expected iframe `src` cannot pass. The visual score gate
compares the score registry keys with the discovered manifest keys and rejects a stale `retired`
entry with `TN_VISUAL_SCORE_TEMPLATES_MISMATCH`.

### Repair round 2 commands

| Command | Exact result |
| --- | --- |
| `pnpm exec vitest run packages/studio/__tests__/studio.spec.ts scripts/__tests__/studio-probe.spec.ts scripts/__tests__/visual-gate.spec.ts` | exit `0`; 3 test files passed, 17 tests passed (`5` Studio, `4` probe, `8` visual) |
| `pnpm studio:probe --browser` | exit `0`; `24/24 checks passed`; `kits.picker.clicks` loaded a live preview canvas |
| `pnpm exec tsx scripts/visual-gate.ts --structural-only` | exit `0`; `Visual structure passed for minimal, platformer, starter.` |
| `pnpm typecheck` | exit `0`; root and all 11 workspace typecheck projects passed, including native-smoke, abyss-framework, and Studio |
| `pnpm exec biome check packages/studio/src/server.ts packages/studio/src/app.tsx packages/studio/__tests__/studio.spec.ts scripts/studio-probe.ts scripts/__tests__/studio-probe.spec.ts scripts/visual-gate.ts scripts/__tests__/visual-gate.spec.ts` | exit `0`; no errors; three pre-existing cognitive-complexity warnings remain |
| `git diff --check` | exit `0`; no whitespace errors |
