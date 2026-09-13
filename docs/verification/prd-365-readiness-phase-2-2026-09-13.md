# PRD-365 phase 2 — public packaging and player prerequisites (partial, in progress)

Candidate: branch `prd-365/desktop-distribution-phase-1`, starting from `181587b54`, PR
**https://github.com/ThreeNativeHQ/threenative/pull/224** (draft, base `develop`, label
`prd:25%`). Host: linux-x64, Node v20.19.6, pnpm 10.25.0, worktree `.worktrees/prd-365-phase1`.
Revised 2026-09-13.

**This record is partial.** It covers the container-aware verifier and its focused tests. The
phase's clean-player user verification and its independent review have not run, and no
Windows/macOS host executed the prerequisite paths.

## What changed

- `packages/runtime-native/scripts/verify-starter-desktop.mjs` now inspects and launches the
  installed release container. `verifyStarterContainer({ root })` resolves the container from
  wherever it was unpacked (`resolveContainer`, so integrity records are checked first), refuses to
  launch when a recorded system prerequisite cannot be resolved (`assertPlayerPrerequisites`), then
  judges the same markers and capture the raw debug path uses. A `--container <unpacked-directory>`
  flag exposes it through the CLI.
- `playerPrerequisiteHint` names the missing library and its OS install command. WebKitGTK 4.1 and
  WebView2 are named explicitly; every other library gets a generic package-manager instruction.
  The phase's required failure is a missing player-side WebView runtime, so the loader's bare
  `not found` is replaced with the concrete install step.
- The raw debug route is unchanged in behavior; the shared launch/judge code was extracted so both
  routes assert the same markers.
- `packages/runtime-native/package.json` already ships `scripts/desktop-distribution.mjs` and
  `scripts/verify-starter-desktop.mjs`; the verifier now imports the helper, and the package
  `files` list already contains both.
- `packages/runtime-native/README.md` documents the release container, the player prerequisites per
  OS, the `--container` verifier, and the standard distribution recipe.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs` | **24 passed**, exit 0 (5 new). |
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs tests/desktop-container.test.mjs` | **74 passed**, exit 0 at `da48d7aaa` (the file later gained phase-3 cases). |
| `pnpm exec biome check packages/runtime-native/scripts/verify-starter-desktop.mjs packages/runtime-native/tests/starter-desktop.test.mjs` | exit 0. |

### Required tests (phase 2)

- `a relocated release container launches without developer tools` (linux-x64): a fixture container
  root outside the project, resolved by its real manifest/integrity records, launched through the
  packaged `xvfb.sh` with `PATH=/usr/bin:/bin` only, judging the same 300-frame markers and a
  non-blank capture.
- `a missing player-side WebView runtime is named with its install step`: a fixture `ldd` census
  with `libwebkit2gtk-4.1.so.0 => not found` throws `TN_NATIVE_STARTER_PREREQUISITE_MISSING` and
  names the WebKitGTK 4.1 install command.
- `a resolvable player-side WebView runtime passes the prerequisite check`: a resolved
  `libwebkit2gtk-4.1.so.0` returns no missing libraries.
- `the container flag routes the verifier to the unpacked container`: `--container <empty dir>`
  reaches the container resolver and reports `TN_DESKTOP_CONTAINER_MANIFEST_MISSING`, proving the
  flag populates the resolver root rather than the raw-artifact guard.

## Observed red, then restored green

Making `assertPlayerPrerequisites` return `[]` (a no-op prerequisite gate) failed the missing-WebView
row:

```
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs -t 'missing player-side WebView'
=> Tests  1 failed | 23 skipped (24)
# restored
=> Tests  24 passed (24)
```

## Review correction

An independent read-only reviewer returned **NEEDS CORRECTION** and found the `--container` CLI
route was broken (`parseCliFlags` stored `options.container` while `verifyStarterContainer`
destructured `root`), that `assertPlayerPrerequisites` ignored the manifest, and that the
Windows/macOS prerequisite paths were not tested. The first is fixed with the new CLI test above;
`assertPlayerPrerequisites` now uses the recorded prerequisites to choose the install hint; the
README and this record now scope Linux as the machine-checked prerequisite host. After the fixes the
three desktop suites run **105 passed / 0 failed**.

## Clean-player verification (linux-x64, 2026-09-13)

The starter was scaffolded with the local workspace packages (`packageLocalFramework` +
`createProject({ template: "starter", install: true })`), its release container built with the
checkout host binary (`THREENATIVE_RUNTIME_BINARY`, unsigned), and unpacked under a path containing
a space.

- container `starter.tar.gz` sha256 `f91f48538be8fd44f5eea53700f5e1b8092edb19468a0f9f9cad1a5cd6465c8e`
- executable launched from an **isolated unprivileged bubblewrap sandbox**: fresh `HOME`,
  `PATH=/nonexistent` (no Node/pnpm/compiler on PATH), `/home` unbound so no engine checkout exists,
  `--unshare-net` (networking disabled), GPU `/dev` and the Xvfb `:11` socket bound.
- observed: `TN_NATIVE_SMOKE_READY:webgpu`, `TN_NATIVE_STARTER_ASSETS_LOADED:texture,glb`,
  `TN_UI_OVERLAY:{"attached":true}`, `TN_STARTUP_CAPTURE_READY:1`, `Rendered 300 frames in 12796ms`,
  `TN_PRESENTS:257`, and a non-blank 1280x686 capture (sha256
  `234883a673af49ec3a7696e8863f94aa2629d63368648b149f53fea5c2ff85b5`, 20 891 distinct colours).
- **missing-WebView control on the real host**: the same sandbox with the WebKitGTK shared object
  overlaid by `/dev/null` made the verifier refuse before launch with
  `TN_NATIVE_STARTER_PREREQUISITE_MISSING` naming `libwebkit2gtk-4.1.so.0` and the
  apt/dnf/pacman install commands (exit 1).
- **the installed verifier end to end**: `verify-starter-desktop.mjs --container <real container>`
  in the same sandbox resolved the container's integrity records, passed the prerequisite check and
  launched it through its own `xvfb.sh`: `starter desktop gate passed: 300 frames, 21684 colors,
  338 asset pixels`, report `pass: true` with a 1280x720 capture (sha256
  `acfc77ec4eb29895c366d4231a51b2ad7f968431b9bb6063bca43182f9fd14d7`, 21 684 colours, 523 magenta
  and 338 cyan proof pixels). `overlayAttached` was false there because the verifier's own Xvfb has
  no compositor; the direct run above attached the HUD on the compositor-present display.

Scope: this is an isolated sandbox on the same linux-x64 host, **not** a second physical machine or
OS user and **not** a registry-package consumer. It proves the artifact is relocatable, needs no
Node/engine/build tools, runs offline, and enforces the documented WebView prerequisite; the literal
second-machine/public-consumer run remains delegated to PRD-060/366.

## Not run

- **Second physical machine / separate OS user**: the clean-player run above is an isolated sandbox
  on this host, not a distinct machine or account.
- **Windows/macOS execution**: the WebView2 and system-WebKit prerequisite paths are documented, not
  machine-checked — `missingPlayerLibraries` enforces prerequisites on Linux only, and no Windows or
  macOS host ran.
- **Independent reviewer**: PASS on re-review (2026-09-13); it confirmed the `--container` CLI route reaches the container resolver, the manifest-driven hint, and the Linux-scoped wording. Its only note was a missing negative case for the manifest use, now added as `an unrecorded missing library still fails with the generic install step`.
- `pnpm publish:check` and the full workspace gates for this change: not run here; CI runs them.
