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
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs` | **22 passed**, exit 0 (3 new). |
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs tests/desktop-container.test.mjs` | **74 passed**, exit 0. |
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

## Observed red, then restored green

Making `assertPlayerPrerequisites` return `[]` (a no-op prerequisite gate) failed the missing-WebView
row:

```
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/starter-desktop.test.mjs -t 'missing player-side WebView'
=> Tests  1 failed | 21 skipped (22)
# restored
=> Tests  22 passed (22)
```

## Not run

- **Clean-player image user verification**: no image without Node/engine checkouts/SDKs ran here.
  The required test uses a fixture executable and an injected dependency census, which proves the
  verifier's mechanics, not a real player machine.
- **Windows/macOS execution**: the WebView2 and system-WebKit prerequisite paths are unit-tested
  only; `ldd` is the Linux dependency tool, and no Windows or macOS host ran.
- **Offline launch after prerequisites**: unrun.
- **Independent reviewer**: not yet requested for this phase.
- `pnpm publish:check` and the full workspace gates for this change: not run here; CI runs them.
