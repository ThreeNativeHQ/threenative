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
  colours, 524 magenta / 337 cyan proof pixels). **The capture was inspected by a human-equivalent
  visual read in this session**: an island scene over water with the checkerboard pennant visible;
  it is the starter, drawn, not a loading state.
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

The verdict on `7bb0df3a6` was **NEEDS CORRECTION**. No reviewer PASS is claimed for the corrected
head; a re-review is the next step, and the phase's reviewer box stays open. The reviewer also
reported a further finding it had counted but not itemised; if it is not finding 4 above, it is
still outstanding and this record does not claim otherwise.
