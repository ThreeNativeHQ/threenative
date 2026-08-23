# PRD-094 execution evidence — asset compile step, 2026-08-22

Lane: `lane/asset-pipeline` (worktree). Execution ordered by the product owner on 2026-08-22,
superseding the ASSET-PIPELINE.md deferral; neither deferral trigger had fired and that is
recorded in the PRD and the product doc rather than argued away.

## What executed

| Gate | Result | Evidence |
| --- | --- | --- |
| `pnpm typecheck` | exit 0 | all workspace `typecheck: Done` tails |
| `pnpm lint` | exit 0 | 239 warnings, all pre-existing complexity warns; zero in touched files |
| `pnpm test` (full suite) | **exit 0** | 1,627 tests; run three times — first two runs carried real defects this record names below, final run green |
| `pnpm check:docs` | exit 0 | 712 links across 530 files |
| `pnpm budgets` | reports, does not fail | framework LOC **15,008/15,000 — the 15k review trigger is now crossed (+8)**; see below |
| starter template playtests (16 scenarios incl. new `assets.playtest.json`) | PASS, exit 0 | `verify-one-template.ts starter` under `sh scripts/xvfb.sh`: "starter: scaffolded playtests passed"; goal visibility `projectedPixels ≈ 69,429` against floor 20 |

## The proof that matters

`assets.playtest.json` passes in a scaffolded project whose `public/` holds no raw sources —
the compiled pennant renders because the serve-time compile fed the game through the manifest.

## Defects the full suite caught after phase-level gates were green

1. `@threenative/assets` was declared as a runtime dependency of `create-threenative`; the
   packed CLI then 404'd inside `pnpm dlx` because the package is unpublished. Fix: moved to
   devDependencies so tsup bundles it (`@gltf-transform/core` included) — the tarball is
   self-contained again, matching the house rule that only public packages sit in dependencies.
2. Four package enumerations did not know the new package: root README table, sandbox pack
   list, shooter-input local-package list, CI scaffold-smoke pack block (fixed earlier in
   5ebea515).
3. A checkpoint reviewer found before commit: an empty-but-present `assets/` published an empty
   manifest, which the fail-closed runtime then rejects every load against. Fix: zero-entry
   walks publish nothing and drop stale manifests.
4. `docs/README.md` and the physics documentation spec referenced `docs/PRDs/native/`, which
   another lane deleted at d2ca4f0f — main was red at HEAD independent of this lane. Repaired:
   index list updated, spec repointed at the archived `done/PRD-049`.

## Integration proofs (PRD §6)

- Caller census: `compileAssets` called at `create-threenative/src/build.ts:86` (before vite,
  every target) and `:229` (before native packaging); `watchAssets` called from all seven
  templates' `vite.config.ts:17`. No export without a non-test consumer.
- Incumbent: one `resolvePath` definition in `core/src/assets.ts:41`; three call sites are the
  structurally required joins (default manifest URL :111, no-manifest fallback :132,
  manifest-output :138) — updated expectation recorded in the PRD.
- Revert control: scaffolded project with renamed `assets/native-proof.glb` → manifest
  regenerates without the entry → core throws at load naming the asset → playtest exits
  failing (exit 2 = never reached assertions) before any assertion evaluates.
- Manifest-trust control: corrupted `output` value in a served manifest heals on recompile;
  a unit-level corrupt-output test proves the load breaks loudly rather than silently falling
  back to the raw path.
- Stale-artifact control: deleted manifest regenerates with the identical content-addressed
  output name and byte content; emptied source drops the stale manifest instead of serving one.

## Budget disclosure (the number the PRD promised to move)

Framework LOC 14,178 → **15,008** across this lane (assets +1,114 including health/watch,
core +658, create-threenative +177, physics +123 per budget attribution). The 15,000-line
review trigger is now crossed by 8 lines and the review is owed; the kill-switch question
(encoder orchestration no game should hand-write) is answered in the PRD and stands.

## Desktop acceptance criterion

EXECUTED and PASSED, 2026-08-22. `pnpm native:build` compiled the C++ host (382/382 targets,
`mystral` binary). A starter project was scaffolded outside the repository from freshly packed
tarballs (`--cli-package` included — the first attempt omitted it and silently installed the
older published CLI, which rejected the template's `bootSplash` key; recorded because it is
exactly the version-skew the local-pack flags exist to prevent). Then:

- `threenative build --target desktop` produced `dist-native/desktop-proj`, a single
  self-contained executable; the compile step ran inside it (public/ held only hand-owned
  statics; the manifest and hashed outputs were compiled in).
- `strings` on the artifact shows the embedded manifest entries with content-addressed names
  (`native-proof.<hash>.glb`) and no raw-source copies in the packaged tree.
- `verify-starter-desktop.mjs`: **"starter desktop gate passed: 300 frames, 14995 colors,
  156 asset pixels"**, exit 0 — `TN_NATIVE_SMOKE_READY:webgpu`,
  `TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb` and the 300-frame completion marker all
  present in the captured log; the pennant is visible in the screenshot. Manifest resolution
  therefore works through the native host's fetch shim end to end.

## What this record does not claim

No KTX2/Basis compression (PRD-095), no mesh optimization (PRD-096), no native decode change
(PRD-097): `packages/runtime-native` is untouched by this PRD. No platform claim beyond the
browser playtest above and whatever the desktop section appends.
