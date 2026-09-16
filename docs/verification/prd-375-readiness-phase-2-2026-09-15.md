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

## Live caller, real Windows PE inspection and a real container — 2026-09-15 (candidate `2b94a243473b295ed41ab8fb759bd371267182d1`)

**What changed since the section above.** PRD-365 landed on `develop` (PR #224, `b66585f08`), so
its desktop release containers exist and the "blocked on PRD-365" items are no longer blocked. This
pass closed the two gates that section left open: the inspector had no live caller, and Windows
identity was trusted from the application manifest, which was a false pass.

- `verifyStarterContainer` in `packages/runtime-native/scripts/verify-starter-desktop.mjs` now calls
  `inspectContainerBrand` after `resolveContainer` and **before** `assertPlayerPrerequisites` and the
  launch, records the result as `report.brand`, and its CLI reads the consumer config from
  `--config <resolved config json>` — the `.threenative/build/config.json` the build already writes.
  Without `--config` the gate prints `brand NOT inspected`; it never implies the identity was checked.
- `inspect-container-brand.mjs` parses the packaged Windows `.exe` itself: DOS/COFF/PE headers, the
  section table, RVA→file-offset mapping, the three-level `.rsrc` tree, `RT_GROUP_ICON`/`RT_ICON`
  and `RT_VERSION`/`VS_FIXEDFILEINFO` plus its `StringFileInfo` table. Plain `fs` + `Buffer`, no new
  dependency. The manifest-only Windows acceptance is gone.

### Red then green

| Step | Command | Result |
| --- | --- | --- |
| Baseline before the change | `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-brand.test.mjs tests/starter-desktop.test.mjs` | **2 files, 64 passed**, exit 0 |
| Red, tests first (14 added) | `... tests/starter-brand.test.mjs` | **12 failed / 42 passed (54)**, exit 1 |
| Green, after implementing | `... tests/starter-brand.test.mjs tests/starter-desktop.test.mjs` | **2 files, 78 passed**, exit 0 |

The 14 new rows: three for the live caller (the verifier rejects a mismatched brand before it
launches anything; a matching brand reaches the launch it guards; the CLI inspects the container it
is pointed at, spawned as a real process and asserted on exit code and stderr), and eleven for
Windows PE inspection (a packaged `.exe` inspected through its real resources; no resource
directory; not a PE image at all; a differing `ProductName`; a stale `FileDescription` behind a
correct `ProductName`; a differing PE file version; an embedded engine-default icon; an embedded
icon that is neither the authored art nor the engine default; an `RT_GROUP_ICON` naming an absent
`RT_ICON`; no `RT_VERSION`; no icon resources).

**The Windows rows are backed by a byte-accurate PE32 fixture this change constructs, not by a real
Windows build.** No Windows host was used, `rcedit` was not run, and nothing here claims that
rcedit's output matches the fixture's layout. The fixture writes the structures the inspector reads
and nothing else.

### Workspace gates

| Command | Result |
| --- | --- |
| `pnpm typecheck` | **exit 0** |
| `pnpm lint` | **exit 0** (745 repo-wide warnings, pre-existing style). On the touched files: three `noExcessiveCognitiveComplexity` warnings in `inspect-container-brand.mjs` (one pre-existing, two added by the PE parser) and one pre-existing `noDelete` in the test. No errors. |
| `pnpm check:docs` | **pass** — 2130 links across 1101 Markdown files |

`pnpm typecheck` first failed on `examples/auto-lod` for two reasons that predate this change and
are worktree state, not the diff: the post-merge install was stale (no `node_modules` for the new
example) and `dist` was stale for the `assets.lod` config type. `pnpm install` then `pnpm build`
repaired both; the diff was not touched.

### A real PRD-365 container, linux-x64, 2026-09-15

The starter was scaffolded from local workspace tarballs (`packageLocalFramework` +
`createProject({ template: "starter", install: true })`) into `orbit-brand`, and **only game files
were edited** to brand it: `threenative.config.ts` got `app.id com.example.orbitbrand`,
`app.name "Orbit Brand"`, `app.version 1.4.2`, `app.build 3`, `app.icon public/brand-icon.png`, and
`public/brand-icon.png` was authored as art distinct from the scaffold's `public/icon.png`
(`c414cd0e…` vs the engine default `e6284520…`).

```sh
THREENATIVE_RUNTIME_BINARY=<checkout host binary> pnpm exec threenative build --target desktop --mode release
# ThreeNative desktop container (unsigned): dist-native/orbit-brand.tar.gz
```

- container `orbit-brand.tar.gz` sha256 `1da759941c9724983d69a0ebe6e845a5e2fb6a825014f31f08f8a85d6e6c8ada`,
  root folder `Orbit-Brand/`, `schemaVersion 1`, `platform linux-x64`, `signed false`, 145 recorded
  player prerequisites.
- **the new CLI path, end to end, on that container:**

  ```sh
  node packages/runtime-native/scripts/verify-starter-desktop.mjs     --container unpacked/Orbit-Brand --config config.json --project orbit-brand
  # starter desktop gate passed: 300 frames, 21910 colors, 337 asset pixels, brand Orbit Brand verified
  ```

  exit 0. The container launched under the verifier's own `xvfb.sh`, logged
  `TN_NATIVE_SMOKE_READY:webgpu`, `TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb` and
  `Rendered 300 frames in 3017ms`-class completion, and captured a non-blank 1280x720 frame
  (sha256 `e099b09d3e0fde636b62c2321116d599df4aef1cd9bf9a725fc924361d7006f3`, 21 910 distinct
  colours, 524 magenta / 337 cyan proof pixels). **The capture was viewed by the implementing agent
  before shipping** — an island scene over water with the checkerboard pennant visible, the starter
  drawn rather than a loading state. That is a look at the pixels rather than trust in a hash, and it
  is **not** human inspection: no person has viewed this capture. It does not satisfy acceptance
  criterion 5's human-inspection half on any platform.
- brand evidence recorded in `artifacts/native/starter-container-report.json`: icon
  `share/icons/hicolor/256x256/apps/com.example.orbitbrand.png` with payload and source sha256 both
  `c414cd0e…` (the authored art), name `Orbit Brand` read from
  `share/applications/com.example.orbitbrand.desktop`, UI entry `ui/index.html`.
- the real launcher entry, and `desktop-file-validate` on it: **clean**.

  ```
  [Desktop Entry]
  Type=Application
  Name=Orbit Brand
  Exec=Orbit-Brand
  TryExec=Orbit-Brand
  Icon=com.example.orbitbrand
  Terminal=false
  Categories=Game;
  StartupNotify=true
  ```

### Negative controls on the real container (not fixtures)

| Control | Result |
| --- | --- |
| Config renames the game, container not rebuilt | `TN_NATIVE_STARTER_CONTAINER_NAME_MISMATCH: the linux launcher names 'Orbit Brand', config says 'Wrong Name'` — and through the CLI it exits 1 in **0.17 s**, i.e. before any launch |
| Embedded icon bytes swapped for the engine default, manifest hashes untouched | `TN_NATIVE_STARTER_CONTAINER_TAMPERED` |
| Engine-default icon redistributed with every hash updated to match | `TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT` |

### Found by the real run: a configured `bootSplash` cannot pass today

Running the CLI against the container with the **stock** resolved config failed closed:

```
TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING: the configured splash has no container declaration.
```

This is the behavior this PRD specified — a UI entry must never stand in for a configured splash —
and it is correct, but it means the brand gate cannot pass on any container built from a config that
declares `bootSplash`, which the scaffolded starter's config does by default. PRD-365's
`packageDesktopContainer` writes no `loading` record into `threenative-container.json`. Emitting one
is container-writer work that belongs to PRD-365, not to this phase's five-file budget, so it is
**not** done here and is named as the remaining gap. The real-container evidence above was therefore
produced with the same container and the same config minus `bootSplash`; both arms are recorded.

### Brand inspection is opt-in, deliberately

The scaffold copies the engine's own `packages/create-threenative/template-assets/icon.png` to a
starter's `public/icon.png`. A stock, unbranded starter container therefore fails
`TN_NATIVE_STARTER_CONTAINER_ICON_ENGINE_DEFAULT` by design. Turning `--config` on by default would
red the existing starter lane rather than prove anything, so the CLI requires the flag and says
`brand NOT inspected` when it is absent.

### Still not executed

- **Windows and macOS hosts.** No Windows or macOS machine was used. Windows PE inspection is
  fixture-backed; macOS `.icns` conversion, `Info.plist` linkage and Finder appearance are
  fixture-backed. Neither claims a real packaged artifact on those platforms.
- **Opening the app from a real GUI file manager or launcher session.** The `.desktop` entry and the
  icon were inspected at their XDG paths and validated, and the app was launched from the verifier;
  nothing was installed into the operator's desktop environment, so no Finder/Explorer/GNOME-Shell
  appearance is claimed.
- **Icon appearance.** The authored icon used for the real run is a 1x1 PNG: byte-distinct from the
  engine default, which is what the inspector asserts, but not a visual icon inspection.
- **An independent reviewer PASS**, and the acceptance criteria that depend on Windows/macOS.

## Independent review of `7bb0df3a6` — NEEDS CORRECTION, three findings, all fixed

An independent reviewer reproduced the red-green above exactly (12 failed / 42 passed, the twelve
being the twelve new rows; then 78 passed) and confirmed by a live CLI run against a real container
that the brand is judged before the launch — `NAME_MISMATCH` fired before `ldd` ran. It then found
three checks that **retire themselves when the artifact under test omits or duplicates the evidence
they read**, which is the false-pass shape this phase exists to close. All three are the reviewer's
findings, not this lane's; they are recorded here with that provenance.

### Red then green, from the reviewer's own inputs

| Step | Command | Result |
| --- | --- | --- |
| Red, the reviewer's repros written as tests first | `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-brand.test.mjs` | **4 failed / 55 passed (59)**, exit 1 — including the reviewer's exact `RangeError [ERR_OUT_OF_RANGE]: ... It must be >= 0 and <= 156. Received 244` |
| Green, after the three fixes | `... tests/starter-brand.test.mjs tests/starter-desktop.test.mjs` | **2 files, 83 passed**, exit 0 |

Five rows were added; four were red. The fifth — a container version that disagrees with the
consumer config — already passed through the existing manifest-anchored comparison and is kept as a
corroborating row, not counted as a red.

### 1 (blocking) — a manifest that omits `app.version` retired the PE version check

`inspectWindowsResources` read `manifest.app.version` and compared only `if (typeof declared ===
'string')`. Deleting that field from a `win32-x64` container whose `.exe` declares file version
9.9.9 against a config declaring 1.2.3 **returned success**; so did `app.version: 1`. The assertion
was anchored on the artifact under test, in a field `readContainerManifest` never required, so the
artifact could switch off the check against itself — while every sibling check in the same file
fails closed on exactly that shape.

Fixed by lifting the comparison into `assertWindowsVersion(windows, manifest, config)`, called from
`inspectContainerBrand` where the consumer config is in hand. A missing or non-string
`manifest.app.version` is now `TN_NATIVE_STARTER_CONTAINER_MANIFEST_INVALID`, and when the config
declares a version the container's version must equal it before the PE file version is compared at
all — so the assertion is anchored on the author's config, not only on the artifact.

### 2 — only the first `RT_GROUP_ICON` was inspected

`groupIconIds(groups[0].data)` left every later group unexamined, and `resourceLeaves` returns tree
order rather than the lowest id Explorer actually draws. An `.exe` carrying group 1 (authored art)
and group 2 (the engine default) returned success. `groups.length > 1` is now
`TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID` as ambiguous; rcedit writes exactly one.

### 3 — a truncated PE crashed with an unnamed `RangeError`

The data-directory count was read at `optional + 92` before the `directoriesOffset + 24 >
buffer.length` bounds check, so a `.exe` truncated to 0xA0 bytes raised a bare `RangeError` instead
of failing closed with a cause. The bound is now taken before the read and names the file:
`TN_NATIVE_STARTER_CONTAINER_WINDOWS_RESOURCES_INVALID: <path> is truncated before its resource data
directory.`

### Gates after the corrections

| Command | Result |
| --- | --- |
| `... tests/starter-brand.test.mjs tests/starter-desktop.test.mjs` | **2 files, 83 passed**, exit 0 |
| the desktop family (`desktop-container`, `desktop-release-transaction`, `distribution`, `starter-brand`, `starter-desktop`, `desktop-core-gate`) | **6 files, 192 passed**, exit 0 |
| `pnpm typecheck` | **exit 0** |
| `pnpm lint` | **exit 0** (746 repo-wide warnings; on the touched files three `noExcessiveCognitiveComplexity` and one pre-existing `noDelete`, no errors) |
| the real linux-x64 container re-inspected with the corrected code | still passes: name `Orbit Brand` from `share/applications/com.example.orbitbrand.desktop` |

### 4 — a missing `FileDescription` passed on `ProductName` alone (found by this lane, not the reviewer)

Sweeping the same file for the shape the reviewer named turned up one more.
`windowsLauncherName` returned `displayName: windows.strings.FileDescription` unconditionally, and
`inspectContainerName` compares it only `if (found.displayName !== undefined)`. An `.exe` whose
`RT_VERSION` carries `ProductName` but no `FileDescription` therefore **passed on one name while the
second went unexamined** — the same self-retiring shape, and the exact mirror of the macOS
`CFBundleDisplayName` row this phase already refuses. `packageDesktopContainer` writes both strings
in one `rcedit` call, so an absent `FileDescription` is a name that was never embedded, not an
optional field. Both are now required, each naming the missing key.

Red: **1 failed / 59 passed (60)**, exit 1. Green: **2 files, 84 passed**, exit 0; the desktop
family **6 files, 193 passed**, exit 0; `pnpm typecheck` and `pnpm lint` exit 0.

### 5 — a `--config` that silently evaluated to nothing turned the brand check off

`parseCliFlags` matched `flag === '--config' && value`, so a trailing `--config` or an empty shell
expansion dropped the flag and the run passed printing `brand NOT inspected`. Announced, so not a
false green — but a typo quietly disabled the whole check. The same shape was worse on `--container`. Both
`native-platforms.yml` jobs invoke the verifier as `--container "$TN_RELEASE_CONTAINER_ROOT"`
(`:1379`, `:1636`), and the variable travels through `$GITHUB_ENV` (`:1278`, `:1594`), so an
empty-but-set value survives `set -u`. Had it ever been empty, the old parser dropped the flag, the
run fell through to `verifyStarterDesktop`, and the job would have **judged the developer artifact
in `dist-native/` instead of the release container it claimed to verify, and printed a pass**, with
nothing announcing the substitution.

**That path was not reachable, and the reason matters.** Independent review checked it in both
directions: three upstream guards red the job first, in both jobs. The relocate step derives
`container` by suffix-stripping a `$manifest` that an exact-count check has already proved
non-empty, so the exported value cannot be blank to begin with; and `manifest=$(find
"$TN_RELEASE_CONTAINER_ROOT" ...)` then runs twice more before the verifier (`:1291` and `:1300`;
`:1607` and `:1612`) under `set -euo pipefail`, where `find ""` exits 1 and takes the step with it
— confirmed locally under `bash`, which does trip `set -e` on a failing command-substitution
assignment. So **no false green occurred or could have** without an earlier step failing first.

The defect was latent and real, the fix stands, and what masked it was three unrelated guards rather
than anything in the CLI or in those steps designed to catch it. That is the part worth carrying
forward: a workflow refactor that dropped those `find` calls would have exposed it silently.

Every flag is now recognized or refused, and every value must be present and non-blank:
`TN_NATIVE_STARTER_CLI_INVALID` for an unknown flag, a missing or empty value, or a `--frames`
that is not a positive whole number (it previously became `NaN`). `--container` and `--project`,
the only flags any existing caller passes, are unaffected — verified against the real container
with the CI's exact flag shape.

Red: **5 failed / 62 passed (67)**, exit 1. Green: **2 files, 91 passed**, exit 0.

### 6 — macOS `.icns` payload content stays unverified (pre-existing, phase 1, deliberately not fixed)

The reviewer passed an `.icns` whose entire contents were the literal string
`TOTAL GARBAGE, NOT AN ICNS, NOT DERIVED FROM THE AUTHORED PNG` and it passed, through the
`!manifest.platform.startsWith('darwin-')` bypass. This is by design and predates this phase:
`app.iconSha256` means source-icon identity and `resources[app.icon].sha256` means final payload
integrity, and a PNG cannot be compared byte-for-byte against the ICNS `sips`/`iconutil` generate
from it. The existing test that writes `'converted ICNS payload'` and asserts success enshrines
exactly that contract. **This proves provenance and integrity, not conversion correctness or Finder
pixels** — macOS icon content is unverified until a real `sips`/`iconutil` lane exists on a macOS
host. The reviewer judged it disclosed rather than overclaimed; it is left unchanged and is now
also named as a known limitation in the PRD.

### Reviewer probes that came back clean

Five further malformed-PE shapes — truncation at `0x100` and `0x200`, an out-of-section resource
RVA, `NumberOfSections = 65535`, and `e_lfanew = 0xfffffff0` — all failed closed with named codes.

The verdict on `7bb0df3a6` was **NEEDS CORRECTION**, on finding 1 alone. Findings 1, 2 and 3 were
corrected in `16fd1593d`, finding 5 here; finding 6 is disclosed and unchanged by design.

**Provenance settled by the reviewer's follow-up:** finding 4 (`FileDescription`) is a genuinely
distinct defect this lane found, not the reviewer's unaccounted-for third — its own `windowsFixture`
always wrote both `ProductName` and `FileDescription`, so its probe set structurally could not have
reached it. The reviewer's third silent pass is the darwin `.icns` case recorded as finding 6, which
is pre-existing (the same bypass exists at `0b90ec812`, so this phase neither introduced nor widened
it) and stays disclosed rather than fixed. Nothing from the review is now unaccounted for.

No reviewer PASS is claimed for the corrected head; a re-review is the next step, and the phase's
reviewer box stays open.

## The container now records its loading sequence — owner decision, 2026-09-15

The gate as shipped above was unreachable for real projects. `templates/starter/threenative.config.ts`
sets `bootSplash`, and a grep of both `package-desktop.mjs` and `desktop-distribution.mjs` found
**zero** occurrences of `loading`, so every container derived from the stock template failed
`TN_NATIVE_STARTER_CONTAINER_LOADING_MISSING` — which is exactly why the real-container arm recorded
earlier had to strip `bootSplash` to go green. The owner widened this phase's file budget by one file
to fix it here rather than in a separate PR against PRD-365's now-landed surface.

`desktop-distribution.mjs` owns the manifest write (`packageDesktopContainer`, the `writeFileSync` at
`stage(paths.manifest)`); `package-desktop.mjs` only passes the config through. The new
`containerLoading(config)` records the authored `backgroundColor` and the authored image's sha256,
and records `{ bootSplash: null }` when the game configures none. It resolves before any staging, so
a declared-but-absent splash refuses the release with `TN_DESKTOP_SPLASH_IMAGE_MISSING` rather than
producing an archive.

The splash is drawn by the game's own generated `src/render/loading.ts` from assets already inside
the bundle, so the record is identity, not a second copy of the image.

### Red then green — producer and consumer in one test

Written against `tests/desktop-container.test.mjs` deliberately as a **seam** test: each side alone
proved nothing before, which is how the mismatch survived.

| Step | Command | Result |
| --- | --- | --- |
| Red | `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/desktop-container.test.mjs` | **5 failed / 32 passed (37)**, exit 1 |
| Green | the desktop family (6 files) | **205 passed**, exit 0 |

The five rows: a configured `bootSplash` with an image is recorded and the inspector reads the same
colour and hash back; a colour-only splash round-trips with a null image hash; a game with no splash
records `{ bootSplash: null }` rather than omitting the evidence; a recorded splash that disagrees
with the config is still refused (`LOADING_MISMATCH`); and a declared splash image that is not on
disk refuses the release.

## The real Linux container, rebuilt with `bootSplash` kept and art a human can look at

The earlier real-container arm had to strip `bootSplash` to go green. With the `loading` record
emitted, it does not. This is the **current** arm; the stripped-`bootSplash` run recorded further up
is retained as the historical record of the gate before the writer existed.

The starter was scaffolded from local workspace tarballs and, **only in game files**, given
`app.id com.example.orbitbrand`, `app.name "Orbit Brand"`, `app.version 1.4.2`, `app.build 3`,
`app.icon public/brand-icon.png` and `bootSplash { backgroundColor "#0d1b2a", image
public/brand-splash.png }`. The art is authored, not a placeholder: a 256x256 amber ringed planet on
deep indigo for the icon (sha256 `48b3782a7fc5731f088eef3ecf17464cfd41a2219a2758d9f21d2da4ab89d907`)
and a 1024x576 splash carrying the same mark over the configured background with a loading bar
**The capture was viewed by the implementing agent
  before shipping** — an island scene over water with the checkerboard pennant visible, the starter
  drawn rather than a loading state. That is a look at the pixels rather than trust in a hash, and it
  is **not** human inspection: no person has viewed this capture. It does not satisfy acceptance
  criterion 5's human-inspection half on any platform. This replaces the 1x1 PNG used in the first run, which was byte-distinct
but nothing a person could look at.

- container `orbit-brand.tar.gz` sha256 `f93e0953f5d0665e96ab863b6ee108a24a3d5cd0d86e998eb203ec86ea7c743b`
- the container's own record, read back out of the archive:

  ```json
  "app": { "id": "com.example.orbitbrand", "name": "Orbit Brand", "version": "1.4.2", "build": 3,
           "icon": "share/icons/hicolor/256x256/apps/com.example.orbitbrand.png",
           "iconSha256": "48b3782a7fc5731f088eef3ecf17464cfd41a2219a2758d9f21d2da4ab89d907" },
  "loading": { "bootSplash": { "backgroundColor": "#0d1b2a",
                               "imageSha256": "86b5578f1c389493c3fff843fc103b023ee0ea66b6639883209063b1f8c05ad5" } }
  ```

- `--brand-only` against it, **stock `bootSplash` kept**: exit 0, reporting the icon (payload and
  source hash both the authored art), the name `Orbit Brand` from the real `.desktop` entry, and the
  loading record matching the config's colour and splash hash.
- the full launching gate against the same container, **stock `bootSplash` kept**:
  `starter desktop gate passed: 300 frames, 21910 colors, 337 asset pixels, brand Orbit Brand verified`,
  exit 0.

### The command the owner runs to see it

```sh
cd /home/joao/.cache/prd375-owner
node <engine>/packages/runtime-native/scripts/verify-starter-desktop.mjs \
  --brand-only --container unpacked/Orbit-Brand \
  --config orbit-brand/.threenative/build/config.json --project orbit-brand
./unpacked/Orbit-Brand/Orbit-Brand --windowed
```

To see it as the OS launcher shows it, the entry and icon are at their XDG paths inside the
container and can be installed into the session; that writes into the operator's own
`~/.local/share`, so it is left as a command to run rather than something this lane did:

```sh
install -Dm644 unpacked/Orbit-Brand/share/applications/com.example.orbitbrand.desktop \
  ~/.local/share/applications/com.example.orbitbrand.desktop
install -Dm644 unpacked/Orbit-Brand/share/icons/hicolor/256x256/apps/com.example.orbitbrand.png \
  ~/.local/share/icons/hicolor/256x256/apps/com.example.orbitbrand.png
update-desktop-database ~/.local/share/applications && gtk-update-icon-cache -f -t ~/.local/share/icons/hicolor
```

## Windows and macOS: machine evidence from CI, per the owner's platform policy

Owner's policy is that what can be built on Linux is built on Linux, and iOS/Windows go through CI.
The brand inspector is therefore wired into the **existing** `desktop` matrix job in
`.github/workflows/native-platforms.yml` — no new job — which already packages a real release
container on Linux, macOS and Windows.

Two steps were added:

1. **Give the scaffolded starter its own authored icon.** The scaffold copies the engine's own art
   to `public/icon.png`, so a stock container carries the engine icon by construction and the
   inspector correctly refuses it. The step overwrites that one file with the same authored icon as
   the Linux run (`.github/fixtures/prd-375-brand-icon.png`). Identity strings are left exactly as
   scaffolded, so every pre-existing assertion in that job reads what it read before.
2. **Inspect the release container's game brand.** Runs `verify-starter-desktop.mjs --brand-only`
   against `$TN_RELEASE_CONTAINER_ROOT` and the config the build resolved, and tees the evidence
   into the existing `release-container-<platform>` artifact. It never launches, so unlike the
   verifier step beside it, **it also runs on Windows** — which is the only place a real
   rcedit-written PE resource section exists.

Windows path handling is explicit: win32 node reads a git-bash `/d/a/_temp/...` path as relative to
the drive root, so the step converts with `cygpath -w` first. The existing launch steps never hit
this because they skip Windows.

**This leg is the first real test of one assumption, and it may go red.** The inspector asserts that
an embedded `RT_ICON` payload equals the authored PNG byte for byte, on the reasoning that `pngToIco`
wraps the PNG verbatim and rcedit stores that image data unchanged. That has never run against real
rcedit output. If CI reds there, the assumption was wrong and the assertion gets **corrected to match
what rcedit actually writes** — not deleted or softened. `native-platforms` is `required: false` in
`scripts/ci-change-scope.mjs`, so a red will not block the merge verdict; it is still the only
Windows and macOS evidence there is, and a red leg is a finding, not an acceptable state.

### Red then green for `--brand-only`

| Step | Command | Result |
| --- | --- | --- |
| Red | `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-brand.test.mjs` | **3 failed / 68 passed (71)**, exit 1 |
| Green | `... tests/starter-brand.test.mjs tests/starter-desktop.test.mjs` | **2 files, 95 passed**, exit 0 |

Four rows: `--brand-only` inspects without launching; it still fails on a mismatched brand; it is
refused without `--config` rather than reporting nothing to check; and it resolves the container's
integrity records too, so a file swapped after packaging fails `TN_DESKTOP_CONTAINER_TAMPERED`
— the short path is not a weaker path.

Both the launching and non-launching routes now go through one `inspectContainer` helper, so they
cannot drift apart.

### Gates

| Command | Result |
| --- | --- |
| the desktop family (6 files) | **209 passed**, exit 0 |
| `pnpm typecheck` / `pnpm lint` / `pnpm check:docs` | exit 0 / exit 0 / clean |
| `pnpm budgets` | **budgets ok**, no census drift |
| `ci-structure`, `ci-needs`, `check-doc-links`, `evidence-budget`, `primary-docs` | **5 files, 153 passed**, exit 0 |

## Independent confirmation of the documentation-only commit

The reviewer verified that `5e00d3324..9dbe51a05` is genuinely documentation-only —
`git diff --name-only` returns exactly two `.md` files — and ran its own gates on the final head:
3 files / 132 passed, CI-structure plus prose 5 files / 156 passed (a different file selection from
the 5 files / 153 passed recorded above, not a disagreement), `check:docs` 2130 links across 1101
files exit 0, and Biome with 0 errors. It did **not** run `pnpm typecheck`, `pnpm budgets` or the
census check, so those three remain this lane's own unreplicated results.

## Independent reviewer: PASS on `3f478b40c`

Verdict **PASS**, scoped to phase-2 **code correctness only**. The diff is two `.md` files and no
code; the corrected wording was accurate on every point checked; and the reviewer re-ran the
falsification itself under `bash` rather than accepting the correction — `m=$(find "" …)` under
`set -euo pipefail` exits 1 and `REACHED` never prints — so the reachability finding holds under the
right instrument. No blocking findings.

The PASS does **not** cover platform acceptance. The user-verification checkpoint stays open until
the Windows and macOS `native-platforms` legs actually run for a candidate, and until the owner has
looked at the Linux container.

## Merge hazard: PR #256 relocates the file this lane hardened

**Nothing is wrong today and nothing in this branch needs changing.** This is a warning for whoever
merges second.

PR #256 (`prd-366/consumer-gameplay-native`) splits `verify-starter-desktop.mjs` into a **router**
that re-exports `verify-starter-desktop-base.mjs` and `verify-starter-consumer.mjs` and spawns one of
them, moving all CLI parsing into the base file. Verified directly against
`origin/prd-366/consumer-gameplay-native`:

- `verify-starter-desktop-base.mjs:340` carries `if (flag === '--container' && value)` — **the exact
  defect this lane fixed, preserved verbatim**, along with the unguarded `Number(value)` for
  `--frames` at `:341`.
- that file has no `--config` and no `--brand-only`, so a naive merge silently loses **all** of this
  phase's CLI surface: strict flag validation, the brand inspection the CI legs invoke, and
  `verifyContainerBrand`.

Whoever merges second must move this phase's CLI hardening into
`packages/runtime-native/scripts/verify-starter-desktop-base.mjs` rather than leaving it in the
router, and re-export `verifyContainerBrand` alongside it.

**The existing tests do catch this, and that was checked rather than assumed.** The CLI-hygiene rows
in `tests/starter-brand.test.mjs` spawn `verify-starter-desktop.mjs` as a real process and assert on
its exit code and stderr. After #256 that path is the router, which forwards `argv` and propagates
the child's exit status, and `--brand-only` is not one of the router's consumer triggers — so those
rows execute against the post-merge base file and go red if the hardening is lost, rather than
passing against a router that no longer owns the parsing. Re-run them after any rebase and confirm
by test, not by reading.

## Loading progress was not monotonic — found while closing AC4, fixed here

The acceptance criterion asks that loading progress be "measured rather than fabricated". Asked to
prove it rather than defer it, the answer split in two.

**It is not fabricated.** `ctx.startup.progress` is computed from real load state in
`packages/core/src/game.ts`: `settledBytes / requestedBytes` when the manifest knows sizes and
`settled / requested` file counts when it does not, then milestone steps at 0.8 (world entered) and
0.9 (first-use compilation settled), then registered holds owning the last tenth, then 1 at
readiness. There is no wall-clock term anywhere in it.

**It was not monotonic, despite claiming to be** — in the API contract (`scene.ts`, "0 to 1,
monotonic and honest") and in the implementation comment ("Honest and monotonic"). Two independent
breaks:

1. The denominator grows. A request registered after an earlier one settled shrinks
   `settled / requested`: measured, a second texture requested after the first settled took the
   reported value **from 0.7 to 0.35**.
2. The branch switch. `requestedBytes` is credited a microtask after `requested`, so the first
   weighed manifest entry flips the calculation from the file-count branch to the byte branch, and
   the two can disagree — a partially weighed set can read lower than the file ratio it replaced.

A bar that jumps backwards reads to a player as the load restarting, which is the same class of
dishonest reporting this phase exists to reject; it was simply in the loading screen rather than in
the brand inspector.

**Fix:** progress is now an enforced high-water mark over the measured state. The measured value is
computed by `measuredProgress()` and may still fall; what is reported never does. The API contract
now says monotonicity is enforced rather than assumed, and says why.

### Red then green

| Step | Command | Result |
| --- | --- | --- |
| Red | `pnpm exec vitest run packages/core/__tests__/startup-progress-honesty.spec.ts` | **1 failed / 2 passed (3)**, exit 1 — `sample 3 fell from 0.7 to 0.35` |
| Green | `... startup-progress-honesty.spec.ts startup-timeline.spec.ts startup-readiness.spec.ts startup-ready-bound.spec.ts` | **4 files, 22 passed**, exit 0 |
| No regression | `pnpm exec vitest run packages/core/__tests__/` | **120 files, 1339 passed**, exit 0 |

The new spec asserts both halves of the criterion, because monotonicity alone cannot catch a
fabricated source — a wall-clock ramp is perfectly monotonic:

- **never goes backwards** while assets are requested during load (this is the row that was red);
- **does not move while nothing settles** — four samples taken across real elapsed time with load
  state frozen must be identical, which is what a timer-backed value fails;
- a control row showing the checker rejects both shapes, so the assertion is known to discriminate
  rather than merely passing.

The implementation was not changed to match the test: the test was written to the documented
contract, the contract was false, and the implementation was corrected to meet it.

## Windows launch blocked by a PRD-365 packaging defect — filed as #264

`rcedit` embeds the icon and version strings into the staged `.exe` **after** the runtime compiler
appended the game payload as an overlay, so rewriting the PE resource section leaves the binary
unable to find its payload and it falls back to the runtime CLI. The workflow already documents this
and skips both Windows launch steps because of it.

Consequence for this PRD: Windows can produce **no** container launch, therefore no capture and no
loading/playable-frame handoff evidence. Moving acceptance to CI does not resolve it — the artifact
does not run. Filed as
[#264](https://github.com/ThreeNativeHQ/threenative/issues/264) against the packager, with the fix
direction (embed resources before appending the payload, or re-append after `rcedit`) and an
acceptance list that includes keeping `--brand-only` green so the fix does not trade the icon away
for the launch. Deliberately **not** fixed here, by owner decision not to widen this phase again.

Windows brand inspection is unaffected and does run: `--brand-only` reads the PE resource directory
without launching anything.

### No playtest scenario for the progress fix, and why — flagged, not skipped quietly

The repository rule is that a change with runtime behaviour gets a playtest scenario. This one does
not have a new scenario, deliberately, and the reason is named here rather than left as an omission.

The playtest assertion surface has a `startup` kind
(`packages/playtest/src/assertion-schema.ts:559`) but it bounds **timings** only — `maxEnteredMs`,
`maxReadyMs`. It cannot express "this value never decreased across the run". Asserting monotonicity
through a playtest would mean adding a new assertion kind: schema entry, evaluator, validator and a
`runtime.*` capability. That is a new public engine surface, on a PRD whose file budget has already
been widened twice by owner decision, to prove a property the unit spec already proves against the
**real** runtime — `defineGame` with a real asset loader, a real `Scene.load`, and `game.start()`,
with nothing mocked but the renderer and canvas.

Recommendation, for the owner rather than for this lane to decide: a `startup.progressMonotonic`
assertion kind would be worth having, because it is the only way a *game* could catch its own
loading bar going backwards. It is not created here.

### Spec typing, and a cast that was removed rather than kept

The first version of the new spec routed the probe scene through a generic `harness(scene)` helper,
which needed `scenes: { probe: scene as never }` to compile. `pnpm typecheck` caught the underlying
errors before the commit (TS2532 on the sample indexing, TS2345 on the scene constructor), but the
fix left that cast in place. The existing `startup-timeline.spec.ts` casts only the canvas and
renderer stubs and passes its scene class uncast, and that convention exists for a reason: a cast on
the scene would stop the spec type-checking the very scene whose behaviour it exists to check.

The helper now provides the renderer and asset stubs only, and each test constructs its game with
its concrete `Probe` class. Two `as never` casts remain, both on the canvas and renderer stubs, which
is exactly what the neighbouring spec does.

**Negative control on the cleaned-up spec**, so the tidy-up is not taken on trust: removing the
high-water clamp from `packages/core/src/game.ts` reproduces the original failure verbatim —
`sample 3 fell from 0.7 to 0.35` — and restoring it returns 3 passed. The spec still catches the
defect it was written for.

## CI run 35055978321 on `3790d0908` — Windows and macOS brand evidence is real

The first completed `native-platforms` run carrying the brand steps. Every desktop leg green:

| Job | Result |
| --- | --- |
| `native-platforms / macOS desktop core` | **success** |
| `native-platforms / Windows desktop core` | **success** |
| `native-platforms / Scaffolded starter desktop artifact` | **success** |

Both new steps passed on both platforms:

```
Give the scaffolded starter its own authored icon: success
Inspect the release container's game brand: success
```

**The `RT_ICON` byte-equality assumption held against real `rcedit` output.** This was
pre-registered above, before the run, as the one untested assumption in the Windows path: the
inspector asserts that an embedded `RT_ICON` payload equals the authored PNG byte for byte, on the
reasoning that `pngToIco` wraps the PNG verbatim and `rcedit` stores that image data unchanged. It
had never run against a real Windows packaging toolchain. It now has, on a `windows-latest` runner
with `rcedit` v2.0.0, and it is correct. The pre-registered contingency — correct the assertion to
match what `rcedit` actually writes, never delete or soften it — was not needed and was not used.

What this upgrades:

- **Windows is no longer fixture-backed.** The PE resource directory of a real packaged `.exe`,
  written by real `rcedit`, was parsed by the shipped inspector and matched against the consumer
  config: `RT_GROUP_ICON`/`RT_ICON` against the authored icon bytes, and
  `RT_VERSION`/`VS_FIXEDFILEINFO` plus `StringFileInfo` against the container's declared identity.
- **macOS `.icns` and `Info.plist` linkage** were inspected on a real `.app` built by `sips` and
  `iconutil`. Note the standing limitation is unchanged: this proves provenance, payload integrity
  and plist linkage, **not** converted icon pixels.
- Windows brand evidence exists despite the container being unlaunchable
  ([#264](https://github.com/ThreeNativeHQ/threenative/issues/264)), which is exactly why
  `--brand-only` was built: inspection needs no display.

The `cygpath -w` path conversion held too — win32 node received Windows-form paths and resolved the
container, config and project correctly. That code path had never been exercised, because every
pre-existing step passing paths to node skips Windows.

### AC5 re-checked against run 35055978321: the captures it would need do not exist yet

Checked rather than assumed, because the reworded criterion turns on a **capture** existing and
being retained, not on the brand inspection passing. Both are false for that run:

| Platform | `Verify the relocated release container with the installed verifier` | Capture |
| --- | --- | --- |
| macOS | **success** | produced by `inspectStarterScreenshot`, then **discarded** |
| Windows | **skipped** | none, and none possible |

- **Windows produces no capture at all.** The verifier and clean-player launch steps are skipped by
  `if: matrix.platform != 'Windows'` because of
  [#264](https://github.com/ThreeNativeHQ/threenative/issues/264) — the container never launches, so
  nothing draws and nothing can be captured. `--brand-only` deliberately never launches either, which
  is why Windows has brand evidence without capture evidence. AC5's Windows half is blocked on #264
  exactly as AC4's handoff half is.
- **macOS produced a capture and lost it.** The verifier writes `starter-container.png` into
  `$RUNNER_TEMP/threenative-starter-native/artifacts/native/`, which the `native-starter-<platform>`
  upload step has already passed by in step order. The step that retains it,
  *Collect the release container's capture and report*, is `076b954e9` — held back while
  35055978321 ran, so it was not in that run.

So AC5 stays open. Its macOS half becomes satisfiable on the first run carrying `076b954e9`
(35059792538 on `443175e65` is the first), and its Windows half stays impossible until #264 is
fixed. The brand evidence from 35055978321 is unaffected and stands; it simply is not capture
evidence, and the two must not be conflated because both are green.

## Who inspected what — stated plainly

Every visual look recorded in this file was performed by the **implementing agent**, not by a person.
That includes the Linux container capture and the authored icon and splash. It is a real check — it
is the difference between knowing a frame is drawn and trusting a colour histogram — and it is
deliberately recorded, but it does **not** satisfy the human-inspection half of acceptance criterion
5, and no box is ticked on the strength of it.

As of this writing **the owner has not looked at the Linux container**. He was given the launch
command twice and went AFK without reporting a run. Phase 2's user-verification box and acceptance
criterion 5 both stay open partly for that reason.

The distinction matters here more than most places: an agent asserting that its own look satisfies a
human-inspection criterion is the same substitution this PRD exists to reject — SDL window-icon
evidence standing in for installed-app metadata, a UI entry standing in for a configured splash, a
manifest standing in for PE resources. Correcting the wording was prompted by review; the loose
phrasing was this lane's.
