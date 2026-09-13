---
prd_contract: v1
---

# PRD-217 — The default React HUD works on every supported desktop

**Status:** PARTIAL — cross-platform backends written and cross-compile-checked; the Wayland/Xwayland doctor false failure is fixed and evidenced (2026-09-12); hosted Windows/macOS build+run, live HUD input and human verification open. Revised 2026-09-12; implementation in flight.
**Complexity:** 10 → HIGH (+3 files, +2 platform modules, +2 event/input state, +2 multi-package, +1 OS WebView integration).
**Problem:** The default starter chooses web UI, but desktop WebView builds are currently refused on Windows/macOS and can fail in Linux Wayland/Xwayland sessions.

Batch contract and dependency order: [production-readiness](README.md). Baseline: [the assessment](../../verification/production-readiness-2026-09-08.md), source `912a567e3e7592e6b437e49fe6318a3987d1f7c1`. iOS is outside this batch; no iOS readiness credit is created or removed.

## Integration ledger

| # | New or revised thing | Live caller at planning time | Replaces | Old path removed? | Negative control |
| --- | --- | --- | --- | --- | --- |
| 1 | Windows overlay backend | packages/runtime-native/src/platform/ui_overlay.cpp: attachDesktopUiOverlay → tn_ui_overlay_attach | X11-only desktop attachment | Platform dispatch replaces X11-only assumption in existing functions | Disable attach/input callback; starter HUD operation fails |
| 2 | macOS overlay backend | packages/runtime-native/src/platform/ui_overlay.cpp: attachDesktopUiOverlay; CMakeLists.txt:1459 overlay linkage | missing system WebView host | Same bridge dispatch, no new public UI system | Drop UI intent; state observation fails |
| 3 | Desktop consumer capability and session selection | packages/create-threenative/src/build.ts:89; packages/runtime-native/src/platform/window.cpp: window creation | blank/unsupported default HUD | Build guard enabled only with packaged working backend | Force unavailable backend; doctor/build must reject |
| 4 | Release-compiled overlay artifact | .github/workflows/native-platforms.yml: starter desktop invocation; scripts/build-native-ui-overlay.mjs | core-only success interpreted as starter success | Keep core checks; add actual default starter lane | Remove UI directory; gameplay/UI lane fails |

## Current behavior and ownership

Current build.ts assertNativeUiRendererCompatible accepts Linux desktop only. ui_overlay.cpp reads an X11 window number and the Rust overlay uses wry plus Linux GTK/X11 helpers. The existing TnUiOverlay, hit regions, state bridge and generated React UI already own the correct seams. Historic Pixel and Linux input evidence is useful but cannot prove Windows/macOS.

Engine platform mechanism. All styles/layout/React stay in the game. Reuse the original PRD-217 bridge and native UI opt-out; no CEF/Electron or renderer replacement. [PRD-365](PRD-365-consumer-desktop-distribution.md) owns distribution of required platform components; [PRD-153](../done/PRD-153-game-branding-from-launch-to-play.md) owns visible branding; [PRD-366](PRD-366-one-consumer-game-proves-supported-platforms.md) owns candidate game qualification.

## Approach and boundaries

Implement platform WebViews behind the same TnUiOverlay contract using existing wry/platform APIs. No backend name enters game config. Windows uses its OS WebView runtime, macOS its system WebKit, Linux the supported compositor/backend path with prerequisite reporting. Preserve transparent rendering, hit-test islands, focus, text input, resize/DPI, minimize/restore and teardown. Do not accept switching ui.renderer to native as proof of React UI portability. Native mode must still ship no WebView overlay.

Data/migration: no application database migration. New build metadata and evidence extend the existing package/config/artifact contracts; no parallel scene, project or release framework.

```mermaid
flowchart LR
    U[Consumer command in game project] --> C[Existing caller named in ledger]
    C --> V{Validate inputs and prerequisites}
    V -->|valid| A[Target artifact or observed behavior]
    V -->|invalid or missing| E[Named failure with actionable next step]
    A --> G{Real consumer gate and negative control}
    G -->|pass| P[Evidence for this exact candidate]
    G -->|fail or absent| E
```

```mermaid
sequenceDiagram
    actor Developer
    participant CLI as Existing build or release caller
    participant Target as Installed target or external service
    Developer->>CLI: Invoke documented project workflow
    CLI->>Target: Validate and execute declared inputs
    alt Successful execution and observation
        Target-->>CLI: Artifact identity and measured result
        CLI-->>Developer: Output path and precise supported claim
    else Missing prerequisite or failed observation
        Target-->>CLI: Concrete failure
        CLI-->>Developer: Non-success with location, cause and fix
    end
```

## Execution phases

**Internal starter route for phases 1–2:** the selected platform integration test in `tests/native-build-ui-overlay.test.mjs` scaffolds the real default starter, resolves its config through `loadConfig`, invokes existing `packages/runtime-native/scripts/bundle.mjs --project <game> --target desktop --entry src/game.ts`, then calls `buildUi` and `writePackagingConfig` from `packages/create-threenative/src/build.ts` and `packageDesktop` from `packages/runtime-native/scripts/package-desktop.mjs` directly with the freshly built runtime. This deliberately avoids `assertNativeUiRendererCompatible` only inside the maintainer proof; public CLI refusal stays until phase 3B. It must run the installed playtest CLI against the produced executable and observe real HUD input/state plus player movement. Add the named test **should run the default starter HUD and gameplay on the selected desktop backend**; the target lane treats absent prerequisites/skipped collection as failure, not PASS.

Before invoking that route, configure the selected existing CMake preset with `TN_ENABLE_UI_OVERLAY=ON` and `THREENATIVE_UI_OVERLAY_LIBRARY` set to the actual Cargo output: `threenative_ui_overlay.lib` on Windows or `libthreenative_ui_overlay.a` on macOS. Explicitly supply the native physics library from `build-native-physics.mjs --desktop` and the existing dependency/toolchain setup. Archive the fully expanded CMake configure/build commands in phase evidence. The selected test owns these invocations; it must not call the current Linux-only native-build overlay branch and assume Windows support. Phase 3A moves this proven path into the normal build script. `pnpm native:verify:desktop` remains an additional core regression check only and cannot satisfy this UI proof.

### Phase 1 — The default starter HUD receives real input on Windows

**Progress:**

- [x] Callers wired and building: `packages/runtime-native/src/platform/ui_overlay.cpp`, `packages/runtime-native/native/ui-overlay/src/lib.rs`, `packages/runtime-native/CMakeLists.txt` (+1 more)
      Hosted `native-platforms` run 34730410868 (windows-2025, commit `79a78df0f`): `pnpm native:build` compiles `threenative_ui_overlay.lib` and links it into `mystral.exe` (the WebView2 loader link fix `291211df3`), then `native:verify:desktop` runs 300 frames. This lane does not attach the starter HUD; that is the required-test box below.
- [ ] Required test green: `packages/runtime-native/tests/native-build-ui-overlay.test.mjs`
- [ ] Observed red recorded, then restored green
- [ ] User verification performed on the named platform
- [ ] Evidence record written: `docs/verification/prd-217-readiness-phase-1-<date>.md`
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `packages/runtime-native/src/platform/ui_overlay.cpp` — dispatch SDL native handle and bridge lifecycle.
- EDIT `packages/runtime-native/native/ui-overlay/src/lib.rs` — Windows attach/post/input/teardown via existing ABI.
- EDIT `packages/runtime-native/CMakeLists.txt` — platform-specific overlay linkage.
- EDIT `packages/runtime-native/tests/native-build-ui-overlay.test.mjs` — Windows compile/attachment contract.
- NEW `docs/verification/prd-217-readiness-phase-1-<date>.md` — commands, identities, red/green and reviewer decision.

**Implementation and wiring:** Use HWND/raw-window-handle and the existing system WebView integration; do not mirror the Three.js scene. Compile and run the default starter UI as the first proof, with game input outside UI islands and UI intent returning to the simulation. Keep public build refusal until the installed runtime actually carries this backend in phase 3B. If Cargo dependencies/lock must change, split a separate bounded delivery phase and reuse wry before adding libraries.

**Required test:** `packages/runtime-native/tests/native-build-ui-overlay.test.mjs`: should attach the default starter web HUD when running on Windows; existing real playtest must observe a HUD intent changing game state and movement through empty UI space.

**Observed-red / revert control:** Disable the platform attachment and separately drop one bridge intent; run the same starter scenario and show nonblank-HUD/state assertions fail. A core-only scene is not an acceptable subject.

**Verification commands** (from repository root unless noted; proposed flags are explicitly identified):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-build-ui-overlay.test.mjs
# On this phase's native Windows/macOS host:
cargo build --manifest-path packages/runtime-native/native/ui-overlay/Cargo.toml --release --lib
# The selected test invokes the internal starter route specified below (not native-smoke):
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-build-ui-overlay.test.mjs -t "default starter"
```

**User verification:** On Windows, click a real starter HUD action, type/focus where supported, move with keyboard outside UI, resize at two DPI settings, minimize/restore and close. Record rendered UI, game-state effects and clean teardown.

### Phase 2 — The same HUD receives real input on macOS

**Progress:**

- [x] Callers wired and building: `packages/runtime-native/src/platform/ui_overlay.cpp`, `packages/runtime-native/native/ui-overlay/src/lib.rs`, `packages/runtime-native/CMakeLists.txt` (+1 more)
      Hosted `native-platforms` run 34730410868 (macos-15, commit `79a78df0f`): `pnpm native:build` compiles the objc2 `desktop.rs` backend and links the WebKit/AppKit frameworks into `mystral`, then `native:verify:desktop` runs 300 frames. This lane does not attach the starter HUD; that is the required-test box below.
- [ ] Required test green: `packages/runtime-native/tests/native-build-ui-overlay.test.mjs`
- [ ] Observed red recorded, then restored green
- [ ] User verification performed on the named platform
- [ ] Evidence record written: `docs/verification/prd-217-readiness-phase-2-<date>.md`
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `packages/runtime-native/src/platform/ui_overlay.cpp` — dispatch Cocoa handle through existing bridge.
- EDIT `packages/runtime-native/native/ui-overlay/src/lib.rs` — macOS system WebView integration.
- EDIT `packages/runtime-native/CMakeLists.txt` — macOS system framework linkage.
- EDIT `packages/runtime-native/tests/native-build-ui-overlay.test.mjs` — macOS runtime contract.
- NEW `docs/verification/prd-217-readiness-phase-2-<date>.md` — commands, identities, red/green and reviewer decision.

**Implementation and wiring:** Use the same UI bundle and bridge as Windows. Respect platform main-thread/NSView lifetime and system WebKit; retain one JS game thread and no scene WebView. No platform-specific replacement HUD. Wire attachment and teardown into existing lifecycle, leaving unsupported guard in place until packaged proof in phase 3B.

**Required test:** `packages/runtime-native/tests/native-build-ui-overlay.test.mjs`: should keep the starter HUD and input synchronized when the macOS window changes size or focus.

**Observed-red / revert control:** Detach the overlay or suppress one resize/intent callback in isolation; the same gameplay/UI observation fails.

**Verification commands** (from repository root unless noted; proposed flags are explicitly identified):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-build-ui-overlay.test.mjs
# On this phase's native Windows/macOS host:
cargo build --manifest-path packages/runtime-native/native/ui-overlay/Cargo.toml --release --lib
# The selected test invokes the internal starter route specified below (not native-smoke):
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-build-ui-overlay.test.mjs -t "default starter"
```

**User verification:** On macOS, perform the Windows phase interaction sequence, including Retina scaling and app activation; inspect transparent composition and intent-driven state changes.

### Phase 3A — Normal native builds include the proved desktop overlay

**Progress:**

- [x] Callers wired and building: `packages/runtime-native/scripts/native-build.mjs`, `packages/runtime-native/scripts/build-native-ui-overlay.mjs`, `packages/runtime-native/tests/native-build-ui-overlay.test.mjs`
      `native-build.mjs` builds the overlay on every desktop host (no Linux-only branch) and hands CMake the path the host toolchain wrote. Hosted `native-platforms` run 34730410868 shows the normal `pnpm native:build` compiling and linking the overlay on windows-2025 and macos-15; the Linux plan and link are green locally 2026-09-12.
- [ ] Required test green: `tests/native-build-ui-overlay.test.mjs`
      Left: the per-host filename mapping test and the Linux plan test are green 2026-09-12 (`the Linux native build links the desktop UI overlay into the runtime`, 2/2). The phase demands each supported platform; Windows and macOS are unrun.
- [ ] Observed red recorded, then restored green
- [ ] User verification performed on the named platform
- [ ] Evidence record written: `docs/verification/prd-217-readiness-phase-3a-<date>.md`
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `packages/runtime-native/scripts/native-build.mjs` — invoke overlay compilation for each proved desktop host, removing the Linux-only branch.
- EDIT `packages/runtime-native/scripts/build-native-ui-overlay.mjs` — derive the actual host static-library filename and build result.
- EDIT `packages/runtime-native/tests/native-build-ui-overlay.test.mjs` — require normal-build overlay linkage on Windows/macOS/Linux.
- NEW `docs/verification/prd-217-readiness-phase-3a-<date>.md` — normal build and starter integration evidence.

**Implementation and wiring:** move the actual paths from phase 1/2 internal proof into the existing native-build caller. Reuse the exported library path resolver; remove the independently hardcoded .a path. Do not open the public UI compatibility guard yet. The existing native build now produces a host that the phase 1/2 internal starter route can use without manual CMake overrides.

**Required test:** `tests/native-build-ui-overlay.test.mjs`: should include the desktop overlay in the normal host build on each supported platform. Run the same real default-starter scenario using this normal-build runtime.

**Observed-red / revert control:** restore the Linux-only branch or force the Unix .a filename on Windows; normal build/attachment proof fails on that host. Restore the measured platform mapping and observe green.

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-build-ui-overlay.test.mjs
pnpm native:build
```

**User verification:** a maintainer running the normal host build gets a runtime that renders and handles the unchanged starter HUD through the internal proof route. Final installed consumer enablement remains phase 3B.

### Phase 3B — Installed desktop builds carry and use their proven WebView backend

**Progress:**

- [ ] Callers wired and building: `packages/create-threenative/src/build.ts`, `.github/workflows/native-platforms.yml`, `packages/create-threenative/__tests__/build.spec.ts`
- [ ] Required test green: `packages/create-threenative/__tests__/build.spec.ts`
      Left: `packages/create-threenative/__tests__/build.spec.ts` is 16/16 green 2026-09-11, but the current build guard still rejects `ui.renderer: "web"` on Windows and macOS, so the refusal path is proved and the supported path is not.
- [ ] Observed red recorded, then restored green
- [ ] User verification performed on the named platform
- [ ] Evidence record written: `docs/verification/prd-217-readiness-phase-3b-<date>.md`
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `packages/create-threenative/src/build.ts` — enable proven desktop capabilities without weakening portable-graph guard.
- EDIT `.github/workflows/native-platforms.yml` — default starter HUD/input matrix.
- EDIT `packages/create-threenative/__tests__/build.spec.ts` — supported backend and absent-runtime controls.
- NEW `docs/verification/prd-217-readiness-phase-3b-<date>.md` — commands, identities, red/green and reviewer decision.

**Implementation and wiring:** Consume the normal build outputs proven in phase 3A. Change the build guard only for host+artifact combinations now proved in phases 1/2. Keep TN_NATIVE_WEB_ONLY_UI for React DOM imports in src/game.ts. Native-release consumes this compiled feature through PRD-262, and PRD-365 includes required player-side WebView dependencies. Native opt-out must not create the overlay.

**Required test:** `packages/create-threenative/__tests__/build.spec.ts`: should build the default web HUD on a supported desktop host; should refuse an installed host without the declared overlay capability.

**Observed-red / revert control:** Remove the packaged overlay feature/UI directory and try the same default starter; the build/launch gate must fail. Add react-dom to the portable entry and confirm that separate guard still fails.

**Verification commands** (from repository root unless noted; proposed flags are explicitly identified):

```sh
pnpm exec vitest run packages/create-threenative/__tests__/build.spec.ts
# On each candidate consumer host:
pnpm build:desktop
pnpm test:native
```

**User verification:** A downloaded default starter builds and plays with its unchanged src/ui on Windows, macOS and Linux; no renderer override or runtime source path is supplied.

### Phase 4 — Linux session selection makes the default HUD usable or names the prerequisite

**Progress:**

- [x] Callers wired and building: `packages/runtime-native/src/platform/window.cpp`, `packages/runtime-native/native/ui-overlay/src/argb.rs`, `packages/create-threenative/src/doctor.ts` (+1 more)
      `window.cpp`/`main.cpp` choose SDL's X11 driver and `GDK_BACKEND=x11` before window creation; `argb.rs` measures the compositor selection (`XGetSelectionOwner`) and creates the ARGB container; `doctor.ts` now reports the same measurement. Its `detectX11Compositor` was reading the `_NET_WM_CM_S0` root *property* (always "not found") instead of the selection the runtime checks; it now queries the selection owner and returns `true` on this KWin Wayland/Xwayland session and on Xvfb + `xcompmin`, `false` on a bare Xvfb, `unknown` (warn) when it cannot measure. `doctor.spec.ts` 95/95.
- [ ] Required test green: `packages/runtime-native/tests/native-build-ui-overlay.test.mjs`
      Left: same Linux-only overlay test, and the live HUD input/teardown rows are unrun. The 2026-09-08 assessment's Wayland/Xwayland failure was reproduced and named on 2026-09-12: the overlay's GDK context defaulted to Wayland while the game window is Xwayland, so `argb::create` had no X11 container. The engine already selects the supported backend (`main.cpp` sets `SDL` x11 + `GDK_BACKEND=x11`); the doctor's false "transparent container could not be created" on every Wayland session is fixed. This branch's built runtime passes the desktop overlay input proof 8/8 on `Xvfb :3` (evidence below) — X11 input is green, but that is a bare X server and the `native-smoke` subject, not the Wayland-hosted Xwayland session or the starter HUD, so this box stays open.
- [x] Observed red recorded, then restored green
      Doctor red on this live Wayland/Xwayland session: `{"detail":"the transparent container could not be created on this Wayland/Xwayland session","status":"fail"}`. Green after the fix: `{"detail":"the runtime selects Xwayland (SDL x11, GDK_BACKEND=x11) and the Wayland compositor blends the overlay's alpha","status":"ok"}`; `doctor.spec.ts` 95/95, `native-build-ui-overlay.test.mjs` 2/2.
- [ ] User verification performed on the named platform
- [x] Evidence record written: `docs/verification/prd-217-readiness-phase-4-2026-09-12.md`
- [ ] Independent reviewer returned PASS

**Files (maximum five):**

- EDIT `packages/runtime-native/src/platform/window.cpp` — choose a supported backend before window creation.
- EDIT `packages/runtime-native/native/ui-overlay/src/argb.rs` — measure compositor/transparent container capability.
- EDIT `packages/create-threenative/src/doctor.ts` — report the same measured session capability.
- EDIT `packages/runtime-native/tests/native-build-ui-overlay.test.mjs` — X11 and Wayland-hosted Xwayland scenarios.
- NEW `docs/verification/prd-217-readiness-phase-4-<date>.md` — commands, identities, red/green and reviewer decision.

**Implementation and wiring:** Reproduce the reported Wayland/Xwayland failure on the actual session before changing code. Prefer a measured supported backend chosen by the engine, rather than requiring every game to set SDL_VIDEODRIVER manually. Prove X11 with compositor and a real Wayland session hosting the supported Xwayland path. A bare unsupported compositor remains an explicit environment limitation, never a blank green launch. Scope excludes claiming native Wayland composition without executing it.

**Required test:** `packages/runtime-native/tests/native-build-ui-overlay.test.mjs`: should preserve HUD transparency and input when launched from each supported Linux session; should report missing composition capability before claiming playable launch.

**Observed-red / revert control:** Disable the compositor/capability probe and force a failed transparent-container creation; doctor and launch must not report successful HUD capability.

**Verification commands** (from repository root unless noted; proposed flags are explicitly identified):

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-build-ui-overlay.test.mjs
# In the candidate game on each real session:
pnpm exec threenative doctor --text
pnpm build:desktop
pnpm test:native
```

**User verification:** The default starter opens with usable HUD on the supported X11 and Wayland/Xwayland configurations. Record session/compositor and adapter identity; Xvfb success alone does not cover Wayland.

## Verification contract

Each phase edits its named pre-existing caller and includes the phase evidence record within the five-file budget. File lists are bounded implementation assignments, not permission for adjacent cleanup. If investigation needs more files, split the phase before implementing; do not silently widen it. Query `engine_search_capabilities` and inspect every hit before any qualifying package/helper work, as the repository requires.

Run the phase command, its observed-red control, restore the implementation and rerun green. Record exact candidate SHA, package versions/integrities, source and artifact hashes, platform/adapter/session, command, exit code, assertion count and artifact paths. A missing observation, skipped test, stale artifact or zero-assertion run is not PASS. Fixtures/local tarballs may prove mechanics; public-consumer acceptance requires registry packages and public runtime downloads with no engine checkout, source override or injected manifest.

For executable changes run `pnpm typecheck && pnpm lint && pnpm test`, `pnpm budgets`, and the affected real playtest/platform lane. Generate mirrors with `pnpm sync:agents` if AGENTS changes. Use platform-specific hosted runs for Windows/macOS, emulators for Android behavior, and physical Android only for claims that require hardware. Name unexecuted targets. A runtime change needs a real playtest scenario in the same implementation, not only the focused tests named below.

After every phase, an independent reviewer receives this PRD, diff, commands and artifacts and returns PASS / NEEDS CORRECTION / BLOCKED. It checks caller integration, negative controls, removed/delegating incumbent paths and the actual consumer outcome. No phase starts on a self-awarded PASS. Visual phases also require human inspection of captures; credentialed signing/submission and external-person checkpoints remain PENDING until executed. Do all authorized preparation before requesting any missing external authorization. This planning request does not authorize publishing packages, uploading to stores or contacting external people.

## Verification evidence

Cross-platform backends landed 2026-09-12: `cargo check --release --lib` is green for
`x86_64-unknown-linux-gnu`, `x86_64-pc-windows-msvc` (native) and `aarch64-apple-darwin`
(via a stubbed Apple `cc`/`ar`, Rust type-check only); Linux `cmake --preset tn-linux
-DTN_ENABLE_UI_OVERLAY=ON` configures and `ui_overlay.cpp` compiles; `tests/native-build-ui-overlay.test.mjs`
is 2/2 green. Hosted `native-platforms` run 34730410868 then built and linked the overlay on
`windows-2025` (`threenative_ui_overlay.lib` into `mystral.exe`) and `macos-15` (objc2 backend +
WebKit/AppKit) and ran 300 core frames, so the phases 1/2/3A *callers wired and building* boxes are
ticked. The Linux overlay input proof (`scripts/desktop-ui-overlay-proof.sh`, Xvfb + `xcompmin`,
native-smoke subject) is 8/8 and recorded in `prd-217-readiness-phase-4-2026-09-12.md`.

An independent reviewer (2026-09-12) returned **NEEDS CORRECTION** for phases 1, 2 and 3A. The
required tests are still the weaker build-plan unit test, not the PRD's internal starter route that
runs the installed playtest CLI and observes HUD intent/state plus movement; observed-red and
per-phase evidence files are absent; and the Windows/macOS hit-routing proof cannot be delegated to
hosted CI as the code stands — the playtest `input.pointers` bridge dispatches into the game
runtime and never crosses the OS/compositor hit path (WebView2 container region, `NSView hitTest:`),
so it would prove the bridge, not the mechanism. Closing phases 1/2 needs an OS-level pointer
injection harness (SendInput / CGEvent) targeting island and non-island coordinates, or the claimed
proof must be narrowed. Every hosted Windows/macOS build, live HUD input and human verification
remains NOT RUN; no phase can close with placeholders. Write each phase to
`docs/verification/prd-<id>-readiness-phase-<n>-<date>.md`; fill actual results and non-test
`file:line` callers at implementation time. Acceptance boxes below remain unchecked until all phase
checkpoints pass.

## Acceptance criteria

- [ ] The same generated React/CSS/SVG UI performs observable game actions on Windows, macOS and supported Linux sessions.
- [ ] Mouse/keyboard/text focus, transparent hit regions, resize/DPI, minimize/restore and teardown pass per platform.
- [ ] The installed runtime carries its proven overlay; ui.renderer native opt-out creates no WebView; portable-graph DOM rejection remains intact.
- [ ] Performance is measured against the original PRD-217 overlay-on/off budget (at most 5% median frame-rate regression under matched workload/settings), with raw data and platform named; no invented FPS from CI software rendering.
- [ ] PRD-262/365/366 consume these exact implementations; no native-ready claim comes from core-only screenshots.

## Prior work retained

Moved from `docs/PRDs/done/PRD-217-webview-ui-layer.md` under the owner's 2026-09-08 instruction. This revision replaces the execution scope, not historical test results. [Original plan at the assessed commit](https://github.com/ThreeNativeHQ/threenative/blob/912a567e3e7592e6b437e49fe6318a3987d1f7c1/docs/PRDs/done/PRD-217-webview-ui-layer.md) remains the immutable history. The former done/ document already said PARTIAL. Historical Android and Linux bridge/input evidence remains valid for those subjects; the current work closes missing desktop platforms and session delivery, not the original bridge again.

Historical evidence: [prd-216-2026-08-24.md](../../verification/prd-216-2026-08-24.md).

Historical evidence: [prd-217-criteria-1-and-7-2026-08-24.md](../../verification/prd-217-criteria-1-and-7-2026-08-24.md).

Historical evidence: [prd-217-phase-0-2026-08-24.md](../../verification/prd-217-phase-0-2026-08-24.md).

Historical evidence: [prd-217-phase-2-2026-08-24.md](../../verification/prd-217-phase-2-2026-08-24.md).

Historical evidence: [prd-217-phase-3a-2026-08-24.md](../../verification/prd-217-phase-3a-2026-08-24.md).

Historical evidence: [prd-217-phase-3b-input-2026-08-24.md](../../verification/prd-217-phase-3b-input-2026-08-24.md).
