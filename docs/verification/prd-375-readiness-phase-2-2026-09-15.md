# PRD-375 phase 2 — distributed desktop brand inspection: evidence

**Date:** 2026-09-15
**Branch:** `prd-375/desktop-brand` (cut from `origin/develop` at `26bf28a66`)
**Historical scope at `7bbb2216f327cbec8ca033979759cf209dd00eee`:** the brand-inspection half — `inspectContainerBrand(root, config)` in
`packages/runtime-native/scripts/verify-starter-desktop.mjs`, its fixtures in
`packages/runtime-native/tests/starter-desktop.test.mjs`, and the game-owned-branding section in
`packages/create-threenative/README.md`.
**Scope not proved:** any real packaged-app launch, real OS launcher/file-manager inspection, or
human capture. Those consume PRD-365's containers, which live only on the still-open draft PR #224
(`prd-365/desktop-distribution-phase-1`) and are not on `develop`. The desktop native playtest lane
is additionally environmentally blocked on this host (GBM buffer creation fails on every desktop
run); no desktop launch was attempted or claimed green.

## Historical implementation (superseded where corrected below)

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

## Historical red then green

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

## Historical gates (not rerun for the review correction)

| Command | Result |
| --- | --- |
| focused `starter-desktop.test.mjs` | **pass** — 1 file, 29 tests |
| `pnpm typecheck` | **pass** (after `pnpm build`; unbuilt workspace packages made the first run fail on unrelated module resolution) |
| `pnpm lint` (`biome check .`) | **exit 0** — 721 repo-wide warnings; the touched script keeps its one pre-existing `noExcessiveCognitiveComplexity` warning and adds none |
| `pnpm test` | **exit 1** — 18 failures in 5 `runtime-native` files (`crash-handler-policy`, `pump-silence`, `rg11b10-renderable`, `runtime-next-contract`, `timestamp-query`), every one `build/tn-linux/...` "is not built", i.e. the opt-in `pnpm native:build` C++ lane. None in the touched files; the abort stops the walk before the root unit phase. |
| root `pnpm exec vitest run` (the phase `pnpm test` never reached) | **exit 0** — 440 files passed, 5257 tests passed |
| `pnpm exec vitest run scripts/__tests__/primary-docs.spec.ts` | **pass** — 7 tests; the README names only shipped packages/commands |

## Historical blockers (current status below)

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

## Review correction — 2026-09-15

Parent: `7bbb2216f327cbec8ca033979759cf209dd00eee`. Compared the actual PRD-365 writer at
`ab44d634b4378b007b7ea9f843bf40cff7bf33f4`; that draft dependency is not merged by this change.
This correction stays within the original five-file phase budget (four existing files edited).

**Corrected behavior:**

- Inspected paths must be files within the physical container root, including manifest and resource
  symlinks. Resource hashes are required and verified; nested config, platform and loading records
  are validated. Existing fixtures now use the writer's `{ sha256 }` inventory objects.
- Linux reads only the authored application's `[Desktop Entry]`, not another desktop action or
  another inventory entry, and checks its icon reference. macOS checks both displayed names,
  rejects duplicate keys and checks the plist's icon link.
- `app.iconSha256` means source-icon identity; `resources[app.icon].sha256` means final payload
  integrity. Converted ICNS bytes need not equal the input PNG. This proves provenance and integrity,
  not conversion correctness or Finder pixels. Missing engine-default comparison fails unverified.
- Windows now throws `TN_NATIVE_STARTER_CONTAINER_BRAND_UNVERIFIED`: manifest identity and a sidecar
  are not PE-resource inspection. The earlier Windows acceptance was a false pass.
- A configured splash without a loading record fails. A loading record cannot bypass a missing or
  directory-valued web entry. UI-only metadata and an empty splash object do not establish a brand.
  Splash declarations remain declarations, not evidence of a nonblank live handoff. Missing authored
  images have a named config error; relative input assets use `options.project` (default: cwd).

**Actual local verification:** Linux x64 sandbox, Node 22.16.0. The shell could not resolve
`github.com`; pnpm, Vitest, pngjs, the workspace build and a native runtime were unavailable.
GitHub connector reads supplied the source. Tests used real temporary files and the unchanged
brand-function text extracted from the actual candidate script, with built-in Node imports only.
Vitest `test` and the temp-directory helper were adapted in the disposable harness; no filesystem
or metadata assertions were mocked. This is not a full-module, screenshot, CLI, Vitest or native run.

| Executed check | Result |
| --- | --- |
| Initial new controls against the parent inspector | 25 failed / 2 passed, exit 1 |
| First corrected inspector | 27 passed / 0 failed, exit 0 |
| Additional empty-splash, missing-image and duplicate-plist controls before fixes | 3 failed / 27 passed, exit 1 |
| New regression controls after iteration | 30 passed / 0 failed, exit 0 |
| Combined branding section: 10 retained tests + 30 new tests | 40 passed / 0 failed / 0 skipped, exit 0 |
| `node --check` on both changed `.mjs` files | exit 0 |

**Still pending:** full focused Vitest (59 total tests after this change), workspace typecheck,
Biome/format, budgets, full test suite and platform lanes for this candidate. The inspector remains
an export: no current `verifyStarterDesktop`/CLI path calls it. Live container integration, real
Windows PE inspection, converted-art verification, loading/gameplay capture and independent human
review remain acceptance work. No independent reviewer PASS, release, dependency merge or done move
is claimed. Phase 2's caller and full-required-test boxes are reopened rather than treating the
historical or isolated results as current end-to-end verification.

Re-run the full focused suite in the repository environment:

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs
pnpm typecheck && pnpm lint && pnpm test
pnpm budgets
```

To reproduce only the isolated 40-test branding check from the repository root:

```sh
node --input-type=module <<'JS'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'prd375-isolated-'));
try {
  const script = readFileSync('packages/runtime-native/scripts/verify-starter-desktop.mjs', 'utf8');
  const tests = readFileSync('packages/runtime-native/tests/starter-desktop.test.mjs', 'utf8');
  const imports = script.slice(0, script.indexOf('const READY_MARKER')).replace("import { PNG } from 'pngjs';", '');
  const body = script.slice(script.indexOf('const CONTAINER_MANIFEST'), script.indexOf('export function verifyStarterDesktop'));
  writeFileSync(join(dir, 'brand.mjs'), imports + body);
  const header = `import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { inspectContainerBrand } from './brand.mjs';
function makeTempDirSync(prefix) { return mkdtempSync(join(${JSON.stringify(dir)}, prefix)); }
`;
  writeFileSync(join(dir, 'brand.test.mjs'), header + tests.slice(tests.indexOf('// PRD-375 phase 2:')));
  const run = spawnSync(process.execPath, ['--test', join(dir, 'brand.test.mjs')], { stdio: 'inherit' });
  if (run.error) throw run.error;
  process.exitCode = run.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
JS
```
