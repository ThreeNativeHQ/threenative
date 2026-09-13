# PRD-365 phase 1 — a game command creates a complete native desktop container

Candidate: branch `prd-365/desktop-distribution-phase-1`, implementation commit **`264153102`**,
based on `origin/develop` at `97e1ba7e8`. Pull request:
**https://github.com/ThreeNativeHQ/threenative/pull/224** (draft, base `develop`, label `prd:25%`).
Host: linux-x64, Node v20.19.6, pnpm 10.25.0. Worktree: `.worktrees/prd-365-phase1`.

Local-input path: phase 1 is implemented and proved against local inputs as the batch README allows
("212/365 can implement against local inputs before 262 publishes downloads"). The real host binary
used for the end-to-end run is the untracked maintainer build
`packages/runtime-native/build/tn-linux/mystral` (sha256
`7d48d511b6605519eec2f20874249144260b0e921988acb629c2360c7f188fbb`), passed explicitly with
`--runtime`; no registry package or public download is claimed.

## What changed

`threenative build --target desktop --mode release` now passes the release mode to
`packages/runtime-native/scripts/package-desktop.mjs`, which compiles the game as before and then
delegates to `scripts/desktop-distribution.mjs`. The helper stages the compiled executable, the
built `ui/` bundle and the shared libraries discovered from that executable into one top-level
directory and archives it per host OS:

- **Linux** — `tar.gz` with the executable, `ui/`, non-system libraries under `lib/`, a
  `share/applications/<app.id>.desktop` entry whose `Exec`/`TryExec` are bare installed names, and
  `share/icons/hicolor/256x256/apps/<app.id>.png`.
- **macOS** — `<Name>.app` (in a zip) with `Contents/MacOS/<exe>` and `Contents/MacOS/ui`,
  `Contents/Resources/<Name>.icns` built through `sips`/`iconutil`, and an `Info.plist` carrying
  the game's id, name, version and build.
- **Windows** — a zip with `<Name>.exe` (icon and version resource embedded through `rcedit`),
  `ui/` and non-system DLLs.

Every container carries `threenative-container.json`: the app identity, the executable path, each
bundled dependency with a SHA-256, and every system library recorded as a player prerequisite.
`resolveContainer` addresses all of them relative to the container root, so a move is legal; a
resource that is absent or whose bytes changed is refused. Debug mode (`--mode` omitted or
`debug`) keeps the original raw executable with `ui/` beside it, byte-for-byte.

The helper is imported lazily by the release path only, so a debug build never loads it. It ships in
`package.json` `files` (follow-up commit `adcedf82e`), so a published `--mode release` consumer
resolves it; the publish-state guard scans every shipped module's imports and requires it. No signing
or notarization is claimed; that is phase 3.

## Commands and results

| Command | Result |
| --- | --- |
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs` | **47 passed**, exit 0 (5 new). |
| `pnpm exec tsc --noEmit -p tsconfig.json` | clean, exit 0. |
| `pnpm exec biome check <5 changed files>` | exit 0; the pre-existing 13 warnings in the fixture file are unchanged. |
| `pnpm budgets` | **exit 0** — framework LOC 63 499 and native runtime LOC 150 816 print the review trigger, not a failure. The `native census drift` lines are pre-existing on `origin/develop` (verified: the same four areas drift there without this change). |
| End-to-end local release package (below) | archive produced, extracted and resolved. |

### End-to-end release container (real host binary)

```
node packages/runtime-native/scripts/package-desktop.mjs \
  --mode release --bundle game.js --ui ui --config config.json \
  --runtime packages/runtime-native/build/tn-linux/mystral --output dist/e2e
=> ThreeNative desktop container: /tmp/opencode/prd365-e2e/dist/e2e.tar.gz
```

- archive sha256 `08ca44a63c7ee322980cc5ef911f299b0eb753c874e61046077cc6cb3d452697`, 43 230 586 bytes.
- 15 tar entries: `E2E-Game/` executable, `ui/index.html`, `ui/assets/app.js`,
  `share/applications/com.example.e2e.desktop`, `share/icons/.../com.example.e2e.png`, and
  `threenative-container.json`.
- manifest: `app {id: com.example.e2e, name: "E2E Game", version: 9.9.9, build: 3}`, `format
  tar.gz`, `platform linux-x64`, `ui {entry: ui/index.html}`, 0 bundled dependencies, 149 system
  prerequisites (the GTK/WebKit/X11 player stack). `ldd` was the dependency tool; every library
  resolved from a system path, so none was copied into the container.
- relocation: extracted to `/tmp/opencode/prd365 e2e located with spaces/` and launched from
  `/tmp`; the process reached the runtime event loop (`TN_PRESENTS_TICK` present in the log). The
  fixture entry is a no-op, so it drew no frame and the rendered starter / OS-identity check
  remains **unrun**.

## Observed red, then restored green

The relocation row is the red control this phase asks for: it removes `ui/index.html`, then the
declared native dependency, then tampers with the dependency's bytes, and requires each to be
refused. Observed red on the implementation: deleting the dependency's `record(destination)` call
made that row fail.

```
# desktop-distribution.mjs: dependency recording removed
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs -t 'relocated container missing'
=> Tests  1 failed | 46 skipped (47)
# recording restored
=> Tests  1 passed | 46 skipped (47)
```

The generic-icon brand control is `assertContainerIdentity`: a manifest whose `app.iconSha256`
does not match the configured icon's bytes throws `TN_DESKTOP_BRAND_MISMATCH`.

## Independent review

An independent reviewer (a read-only reviewer pinned to a different model, given the PRD phase, the
diff at `264153102`, the test file and this record) returned **PASS**. It confirmed that
`build --target desktop --mode release` reaches the helper while debug mode falls through to the
unchanged `compileDesktopArtifact`; that the negative controls are real observations rather than
tautologies; that the lazy import is justified (and it found the helper was not yet in the tarball, which
the follow-up commit `adcedf82e` then fixed); and that no unrun
gate is overclaimed. Its non-blocking notes (a manifest-path containment hardening, a `layout()`
default guarded by earlier validation, `@rpath` dependencies failing closed) are recorded here but
do not change the verdict; the manifest containment note is the one addressed in a later phase if
the payload ever becomes externally supplied.

## User verification (executed autonomously on the user's instruction)

The real `examples/native-smoke` game and its overlay were built with the native bundler, packaged
by the release path into a container, and launched from a relocated path containing spaces, outside
any project directory. This is the actual product artifact, not the earlier no-op fixture.

```
# bundle the real game and its overlay, then package --mode release
node packages/runtime-native/scripts/bundle.mjs --project examples/native-smoke \
  --entry examples/native-smoke/src/game.ts --target desktop --output <work>/game.js
node packages/runtime-native/scripts/package-desktop.mjs --mode release --bundle <work>/game.js \
  --ui <work>/ui --config <work>/config.json \
  --runtime packages/runtime-native/build/tn-linux/mystral --output <work>/dist/native-smoke
# unpack to "/tmp/opencode/prd365 user relocated" and launch on an Xvfb + compositor session
DISPLAY=:9 SDL_VIDEODRIVER=x11 GDK_BACKEND=x11 <relocated>/Native-Smoke/Native-Smoke --frames 300
```

Observed:

- container sha256 `5d2982435ab33847a817d63fb67dbd4fee800ccb4ef09ccaaf2ad8236544b134`.
- **Assets**: `TN_NATIVE_SMOKE_READY:webgpu`, 4 textures / 52 MB resident, `Rendered 300 frames in
  14095ms`, `TN_PRESENTS:301`. The runtime capture `shot-hud.png` (sha256 `0907f36c…`) is
  non-blank and carries the scene.
- **HUD**: `TN_UI_OVERLAY:{"attached":true}` with a compositing manager present. A root-window
  capture `root.png` (1920x1080, sha256 `13f61206…`, 427 distinct colours) contains 41 653
  plate-like pixels and 412 pixels matching the overlay's `#e8eef7` text colour, so the web UI
  rendered over the game.
- **OS identity**: the window title is `Native Smoke`; the container's
  `share/applications/com.threenative.native-smoke.desktop` names `Native Smoke` with
  `Exec`/`TryExec` = `Native-Smoke` and `Icon` = `com.threenative.native-smoke`; the
  `threenative-container.json` app block records `{id: com.threenative.native-smoke, name: "Native
  Smoke", version: 1.4.2, build: 9}` and the configured icon's SHA-256.

The one environment caveat, recorded rather than hidden: the overlay attaches only when a
compositing manager is running; without one the host logs
`TN_UI_OVERLAY:{"attached":false,"reason":"no compositing manager is running"}` and the game still
renders. That is PRD-217's Linux compositor prerequisite, not a container defect.

## Not run

- **macOS and Windows container execution**: the phases and metadata are unit-tested, but no
  macOS or Windows host ran here, so no mac/Windows launch claim is made. Windows identity also
  needs `rcedit`, macOS `.icns` needs `sips`/`iconutil`; both fail closed with a named code when
  absent.
- **Signing/notarization**: phase 3.
