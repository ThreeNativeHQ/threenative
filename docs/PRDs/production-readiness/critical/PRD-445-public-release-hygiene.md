# PRD-445 — Public release hygiene

**Status:** NOT STARTED
**Complexity:** 3 → LOW; all local, no credentials.
**Depends on:** none. Blocks rung R1 of [RELEASE-READINESS-2026-09-23](../RELEASE-READINESS-2026-09-23.md).

## Context

The 2026-09-23 inspection found the things a stranger sees first are wrong or stale, and no PRD
owned them:

- `pnpm audit --prod --audit-level high` reports one high advisory: `sharp <0.35.4`
  (GHSA-rgj7-g3m4-5g8c) via `@threenative/assets` → `@gltf-transform/functions` → `ndarray-pixels`.
  It ships to every consumer that installs `@threenative/assets`.
- `SECURITY.md` names `0.2.x` as the only supported line; 0.3.x is on npm `latest`.
- `CHANGELOG.md`'s last released section is `0.2.0`.
- `docs/CURRENT-CHALLENGES.md` was last reviewed 2026-09-02; its Android-CI row was superseded on
  2026-09-08.
- `pnpm alpha:bar` fails row A7: the committed `docs/verification/alpha-bar.md` does not match a run.
- `README.md` promises iOS ("Ship it to the browser, desktop, Android, and iOS"), which is not a
  supported target.
- The `site` workflow failed on `main` at `d3e6b7deb` in its Cloudflare deploy step (exit 1).
- PRD-060 exists twice with different progress; PRD-375's file carries the heading "PRD-153"; five
  release-blocking PRDs have no phase boxes, so `pnpm prd:progress` exits 1 on them.

## Solution

Fix each at its source. The `sharp` fix must reach consumers: a root `pnpm.overrides` entry does not
travel in a published tarball, so bump the dependency chain or pin a direct `sharp` dependency in
`@threenative/assets`, and prove it in a tarball install. No new scripts.

## Execution Phases

### Phase 1 — Security surface

- [ ] `@threenative/assets` resolves `sharp >=0.35.4` for consumers; `pnpm audit --prod --audit-level high` exits 0.
- [ ] A starter installed from packed tarballs reports no high `sharp` advisory in `npm audit --omit=dev`.
- [ ] `SECURITY.md` names the supported 0.3.x line.
- [ ] `CHANGELOG.md` has sections for every published 0.3.x version and the release candidate.

### Phase 2 — Public truth

- [ ] `docs/CURRENT-CHALLENGES.md` re-reviewed against the 2026-09-23 inspection; date updated; superseded rows corrected.
- [ ] No public doc claims iOS support (owner decision 2026-09-23: supported targets are web, Windows, macOS, Linux, Android); `README.md` lines 7, 38, 102, 132, 148 and the `runtime-native` and `create-threenative` READMEs corrected.
- [ ] `pnpm alpha:bar --write` regenerates `docs/verification/alpha-bar.md`; row A7 passes.
- [ ] Root cause of the `site` deploy failure recorded here; the next `site` run on `main` is green.

### Phase 3 — Release-path PRD bookkeeping

- [ ] One PRD-060 remains; the other is removed with its ticked boxes and evidence merged into the survivor.
- [ ] PRD-375's heading matches its file name, and links to it still resolve.
- [ ] Phase boxes added to PRD-054, PRD-058, PRD-064, PRD-066 and PRD-112-repair; `pnpm prd:progress` exits 0 on each.

### Phase 4 — Repository junk a stranger clones

Inventory 2026-09-23 (read-only arm; each "no references" re-checked with `git grep -l <name>`
excluding `docs/PRDs/done`, 0 hits). About 5.7 MiB of tracked bytes.

- [ ] Delete `packages/runtime-native/native/ui-overlay/composited.ppm` (2.76 MB, unreferenced).
- [ ] Delete `docs/verification/platformer-round-1-final-comparison.png` (1.73 MB, unreferenced, outside every walked evidence root).
- [ ] Untrack `artifacts/vsm-prototype/` (47 files, 1.42 MB, unreferenced; already matched by `.gitignore` `artifacts`).
- [ ] Untrack `.runtime/` and add it to `.gitignore` (3 tracked files; scripts write there at run time).
- [ ] Delete root `profile-l1.mjs`, `peek.mjs`, `packages/core/tmp-probe-instanced-write.mts` and `advisor-plans/` (all unreferenced).
- [ ] Delete the two tracked sweep `scaffold.sh` files carrying `/home/joao` paths (`docs/benchmark/sweeps/physics-puzzle-2026-08-15-9/`, `-2026-08-16/`); confirm no spec reads them first.
- [ ] Owner call: the two product-playbook PDFs in `docs/product/` (1.8 MB, unreferenced).
- [ ] Owner call: `docs/midway-adoption-verify/midway-adoption.patch` carries a personal email in its commit headers.
- [ ] Owner call: 214 tracked files carry absolute `/home/joao/...` paths (mostly verification records; not secrets). No tracked tokens or private keys were found.

## Acceptance criteria

- [ ] `pnpm audit --prod --audit-level high` exits 0 on `develop`.
- [ ] `pnpm alpha:bar` reports A7 pass.
- [ ] The latest `site` run on `main` is a success.
- [ ] `pnpm check:docs` and the prose-lane specs listed in the root `AGENTS.md` pass.
