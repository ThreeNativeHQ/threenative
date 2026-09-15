# PRD-375 phase 2 — distributed desktop brand inspection: evidence

**Date:** 2026-09-15
**Branch:** `prd-375/desktop-brand` (cut from `origin/develop` at `26bf28a66`)
**Scope proved:** the brand-inspection half — `inspectContainerBrand(root, config)` in
`packages/runtime-native/scripts/verify-starter-desktop.mjs`, its fixtures in
`packages/runtime-native/tests/starter-desktop.test.mjs`, and the game-owned-branding section in
`packages/create-threenative/README.md`.
**Scope not proved:** any real packaged-app launch, real OS launcher/file-manager inspection, or
human capture. Those consume PRD-365's containers, which live only on the still-open draft PR #224
(`prd-365/desktop-distribution-phase-1`) and are not on `develop`. The desktop native playtest lane
is additionally environmentally blocked on this host (GBM buffer creation fails on every desktop
run); no desktop launch was attempted or claimed green.

## What landed

`inspectContainerBrand(root, config, options)` takes an unpacked PRD-365 container directory and the
consumer config, and compares three independent surfaces, each failing closed with a distinct code:

- **Embedded application icon** — `manifest.app.icon` + `iconSha256` and the bytes on disk against
  `app.icon`: `TN_NATIVE_STARTER_CONTAINER_ICON_MISSING`,
  `TN_NATIVE_STARTER_CONTAINER_ICON_MISMATCH`,
  `TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT` (bytes equal the scaffold's default art),
  `TN_NATIVE_STARTER_CONTAINER_TAMPERED`.
- **Launcher/file-manager name** — Linux `.desktop` `Name=` and macOS `Info.plist`
  `CFBundleName`/`CFBundleDisplayName` against `app.name`; Windows uses the manifest identity
  because PE resources are written/read by OS tooling, not this inspector:
  `TN_NATIVE_STARTER_CONTAINER_DESKTOP_ENTRY_MISSING`,
  `TN_NATIVE_STARTER_CONTAINER_PLIST_ENTRY_MISSING`,
  `TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH`.
- **Declared loading/launch sequence** — a container `manifest.loading` block, when present, against
  the consumer's `bootSplash`; otherwise the PRD-365 `manifest.ui` launch entry against
  `ui.renderer`: `TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING`,
  `TN_NATIVE_STARTER_CONTAINER_LOADING_MISMATCH`.

Missing container, malformed manifest and a non-object config each throw. A container with nothing
inspectable is a failure, not a pass (`TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED`).

## Red then green

Red (test first, before the export existed):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs
# Test Files  1 failed (1)
# Tests  10 failed | 19 passed (29)
# TypeError: (0 , __vite_ssr_import_9__.inspectContainerBrand) is not a function
```

Green (after implementing, 29/29 including the required row):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs
# Test Files  1 passed (1)
# Tests  29 passed (29)
```

Required row: *"should reject a distributed starter when the embedded application icon or runtime
brand differs from its consumer config"* — proven for both axes (icon mismatch and name mismatch).
Negative controls also green: engine-default icon substituted, macOS `CFBundleName` removed, Linux
`.desktop` `Name=` removed, icon resource dropped, missing container, malformed manifest, loading
mismatch, empty brand, malformed config.

## Gates

| Command | Result |
| --- | --- |
| focused `starter-desktop.test.mjs` | **pass** — 1 file, 29 tests |
| `pnpm typecheck` | **pass** (after `pnpm build`; unbuilt workspace packages made the first run fail on unrelated module resolution) |
| `pnpm lint` (`biome check .`) | **exit 0** — 721 repo-wide warnings; the touched script keeps its one pre-existing `noExcessiveCognitiveComplexity` warning and adds none |
| `pnpm test` | **exit 1** — 18 failures in 5 `runtime-native` files (`crash-handler-policy`, `pump-silence`, `rg11b10-renderable`, `runtime-next-contract`, `timestamp-query`), every one `build/tn-linux/...` "is not built", i.e. the opt-in `pnpm native:build` C++ lane. None in the touched files; the abort stops the walk before the root unit phase. |
| root `pnpm exec vitest run` (the phase `pnpm test` never reached) | **exit 0** — 440 files passed, 5257 tests passed |
| `pnpm exec vitest run scripts/__tests__/primary-docs.spec.ts` | **pass** — 7 tests; the README names only shipped packages/commands |

## Not verified (blocked on PRD-365 / PR #224)

- Real `threenative build --target desktop --mode release` container: PR #224 is not on `develop`,
  so there is no `.app`, Windows resource, or Linux `.tar.gz` to extract and inspect.
- Opening the packaged app from a real OS launcher/file manager, and any capture of it: blocked on
  the same container plus this host's GBM failure on desktop runs.
- Windows PE-resource identity and macOS `Info.plist`/`.icns` against a real writer: fixture-only
  here; PR #224's own evidence records them fixture-only as well (`rcedit`, `sips`/`iconutil`).
- The container `manifest.loading` record is forward-looking: PRD-365 as written on #224 does not
  emit it, so today's real containers are checked through the `manifest.ui` fallback.

## Files

- EDIT `packages/runtime-native/scripts/verify-starter-desktop.mjs`
- EDIT `packages/runtime-native/tests/starter-desktop.test.mjs`
- EDIT `packages/create-threenative/README.md`
- EDIT `docs/PRDs/production-readiness/PRD-375-release-artifacts-carry-the-game-brand.md`
- NEW `docs/verification/prd-375-readiness-phase-2-2026-09-15.md`
