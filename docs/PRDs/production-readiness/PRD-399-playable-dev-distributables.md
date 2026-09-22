# PRD-399 — Playable dev distributables with responsive React UI

**Status:** IN PROGRESS
**Complexity:** 9 → HIGH; risk override: release integrity and cross-platform execution.
**Owner:** Codex, thread 01a0c7c0-0940-75b1-80f4-7da03413d298
**Depends on:** Existing packaging and playtest mechanisms from PRD-365/366; UI work from PRD-393/398 is evaluated before reuse.

## Context

The requested outcome is a smooth development release flow: simple commands produce conventional, playable distributables on every supported platform. React WebUI must ship whenever selected, be the default, and visibly track gameplay in real time on native. Building a binary or asserting a bridge message alone does not prove these outcomes.

The initial audit found Windows release output is a ZIP rather than an installer, the config resolver defaults UI to `native`, macOS signing writes its integrity manifest after sealing the bundle, and main's latest native-release run (35586254701) fails in `Require the triggering CI completion` before building any platform. Historical successes do not qualify this candidate.

Task checkout: `/home/joao/projects/threenative/threenative-engine/.worktrees/dev-release`, branch `fix/dev-release`, base `215de303dd2ef919519c355c67db5994da5f412e` (`origin/develop`). Owner above; cleanup pending delivery. The primary checkout has unrelated active changes and is preserved.

Draft [PR #279](https://github.com/ThreeNativeHQ/threenative/pull/279) targets develop. The release run above was triggered by successful **scheduled** CI (35581076683), while its gate only accepts main **push** CI; it is not evidence of a broken platform compile. Host discovery: Linux browser tooling and Android API 35/16 KB AVDs are installed, no Android device is currently attached, no self-hosted repository runners were returned, and no signing-related repository secrets were listed. iOS, macOS and Windows require their native hosts. No credential values were read.

## Solution

Fix the shared engine/config/packaging mechanisms and reuse the existing `threenative build`, playtest runner, consumer qualification and release workflows. No new CLI command or distribution framework. Final proof must follow a single frozen candidate through package hashes, installation/extraction and real gameplay, including the React HUD, pointer input, restart, assets and offline native launch. Native UI proof measures state-to-visible-update latency and update cadence during continuous changes, rather than treating "overlay attached" as responsive UI.

Use local browser/Linux/Android lanes first and native Windows/macOS/iOS CI hosts for host-specific checks. Simulator evidence is labelled as such; physical iOS installation/signing remains required to call an iOS device distributable playable. Signing credentials and available hosts are checked, never assumed. Publishing a public package or release is a separate final approval after a concrete candidate is qualified.

## Integration Ledger

| Capability | Consumer path | Reuse / disposition | Evidence |
| --- | --- | --- | --- |
| Default React WebUI | generated project → config resolver → UI bundle → target packager → native WebView | existing UiLayer and platform overlays | Phase 1 |
| Responsive native UI | gameplay frame → existing UI state bridge → React commit → platform presentation | inspect existing per-frame and snapshot work before changing | Phase 2 |
| Installable desktop game | `threenative build --target desktop --mode release` → desktop packager → installed app | extend existing container packaging | Phase 3 |
| Final-build verification | target build → package identity → install/extract → existing playtest | existing cross-target consumer scenario | Phase 4 |
| Repeatable dev release | documented build commands / CI completion → release qualification | existing release workflows, exact-candidate checks | Phase 5 |

## Execution Phases

### Phase 1 — Default UI reaches every build

**Status:** PARTIAL
**Files:** config resolver, scaffold configs, build/packager tests and affected docs.

- [x] [local; agent] Omitted UI selection resolves to React WebUI; explicit native remains supported, including the intentionally UI-free minimal template. Regression covers actual config loading. Evidence: two config-loader failures (`native` instead of `web`) before correction; config/scaffold/build plus core regressions now **240 passed**. Scaffold hashes regenerated from actual `createProject` output after the shared UI guidance and minimal override changed.
- [ ] [local/shared; agent and native CI] Every selected WebUI build carries HTML, JavaScript, CSS and assets into its final package; a missing bundle fails with an actionable error. Partial: the no-config CLI regression builds real UI output and checks nonempty HTML-linked JavaScript/CSS plus `--ui` forwarding for desktop, Android and iOS. All 43 consumer/template tests pass; independent review passes. The packagers in this regression are stubs, so final-platform inclusion remains open.
- [ ] [local; agent] Generated project commands and help match the supported build paths without undocumented setup or silent target downgrades. Partial: all ten templates now route `pnpm test` through `pnpm build:web` and Vite's production preview. Ten command regressions failed before the change; all 109 scaffold/playtest-contract tests pass afterward, with hashes recomputed from actual scaffolds. The installed starter's exact new `pnpm test` command exits 0: 24 production scenarios and 130 assertions pass. The web CLI also now launches the installed Vite JavaScript entry through Node, avoiding Windows `.cmd` execution without a shell. Its regression uses no shell shim and preserves an output path containing spaces and `&`; it fails before the change and passes afterward. All 62 build/consumer/template tests pass. Actual Windows execution and remaining target commands are pending.

### Phase 2 — Native React UI visibly tracks live gameplay

**Status:** PARTIAL
**Files:** existing UI bridge/state and native overlay implementations; existing UI verification scenarios.

- [x] [local; agent] Continuous game state reaches React on each rendered game frame without a fixed 100 ms publishing throttle; idle UI does not accumulate a message backlog. Regression tests exercise the real owner path. Evidence: `game.spec.ts` drives `defineGame`, actual `Scene.render` writes and `subscribeUiState`; default delivery red, explicit interval green, then both green. Independent review found and fixed a one-frame delay for render-hook writes; flush now follows those hooks. The final sustained test drives 64 callbacks, requires at least eight actual world renders, and passes both default and explicit 100 ms cases. The native read-only probe exposed another owner-path defect: without an authored `game.ui` access, no bridge receiver existed. Startup now connects automatically and failed startup closes the channel; both host and in-process rejection regressions fail before and pass after cleanup. The owner publishes its already-coalesced snapshot synchronously, avoiding an extra host microtask boundary. All 65 game/state/bridge tests pass. The packaged Linux React probe records approximately 60 receipts and commits per second, p95 render-state-to-receipt and render-state-to-React-commit of 1 ms, and zero state messages during two-second idle periods. This closes state delivery, not visible presentation.
- [ ] [local; agent] Linux final build proves visible UI animation/state changes and pointer input, with measured presentation cadence and state-to-paint latency; no attachment-only substitute. Partial: the installed release's OS capture (`linux-release/os-after.png`) shows the React HUD; its renderer-only screenshot omits the separate WebView. The published v0.3.2 runtime fails the React pause-button scenario. The exact same consumer packaged with this checkout's freshly compiled runtime passes pause/resume and movement over 402 frames, three assertions, zero diagnostics (`linux-source-ui-input-clean/`). Latency/cadence measurement remains open. WebKit's optional HTTP inspector stalled on both published and source hosts; the diagnostic-only developer-extras experiment was reverted. Measure OS-visible response instead. An opaque sequence/complement barcode in an external React probe matches actual OS pixels to game-render state IDs, eliminating the transparent starter HUD’s ambiguous pixel hashes. Capture calibration is 1–9 ms with one encoder thread; final measurements include that overhead, not a subtracted estimate. Source-built probe runs reach about 60 native FPS, but visible p95 varies from 38 to 92 ms and one run sustains about 30 UI updates/s. Instrumentation locates the delay after React commit (p95 about 70 ms); a diagnostic second Linux event pump before GPU presentation did not reliably fix it and was reverted. A 240 FPS capture calibrated to 0–5 ms overhead still measured p95 88 ms and about 30 visible updates/s. In that run React committed about 60 updates/s with p95 1 ms latency, while page requestAnimationFrame fell to about 30/s during changes and recovered to about 60/s when idle. The existing primary-checkout offscreen runtime, repackaged with the identical telemetry probe, passes two calibrated OS-ID comparisons at p95 29 and 31 ms with about 60 visible updates/s; the interleaved current-backend run fails at 54 ms. This is reuse evidence for that existing implementation, not candidate qualification: its source changes are not yet integrated here. No third pump tweak is justified. Visible smoothness acceptance remains open.
- [ ] [shared; native Windows/macOS/Android/iOS hosts] The same UI verification runs per platform and records cadence, latency, dropped/stale updates and screenshots. At a stable 60 FPS workload, target p95 state-to-visible-update latency is at most 50 ms with no sustained 10/15/30 Hz UI cap; report actual device/refresh rate and failures.

### Phase 3 — Conventional, integrity-checked desktop distributions

**Status:** IN PROGRESS
**Files:** existing desktop container/signing adapters, shipped build command and platform tests.

macOS signing decision, independently reviewed: sign staged dependencies first, hash their final bytes and the resources, write the internal manifest, then sign the outer application once. The main executable uses an explicit Apple-signature integrity record because its signature seals the manifest; a whole-file hash inside that manifest creates a cycle. Resolution must verify the actual application signature and reject signature records on other payloads/platforms. Real macOS signing, relocation and tamper checks remain required.

- [ ] [local/shared; agent and Windows CI] Windows release creates a standard installer with game identity, shortcuts, uninstall support and complete runtime/UI dependencies; install, launch and uninstall execute on Windows.
- [ ] [shared; macOS CI] macOS produces a relocatable `.app` distribution, validates bundle identity/resources and signing order, launches after extraction and carries the React HUD. Real trust/notarization is qualified only with real credentials. Partial: the signing-order and required JIT-entitlement regressions fail before correction. Nested code is now signed and hashed before the manifest, then the outer app is signed without recursively rewriting dependencies. The executable has an explicit signature record; resolution checks the sealed manifest location, inventory, hashes and strict app signature, and refuses unsupported records or unavailable verification. Final payloads are rechecked after stapling. All 121 packaging tests pass, with the real macOS test skipped on Linux; independent review passes. The macOS workflow now runs real signed extraction/tampering and MAP_JIT checks, then packages its playable React starter with ad-hoc signing. Those hosted checks are not yet executed; ad-hoc signing does not prove Developer ID trust/notarization.
- [ ] [local/shared; agent and architecture hosts] Linux produces a relocatable archive/application with launch metadata, complete required payload and explicit system prerequisites; extraction and launch execute on each advertised architecture.

### Phase 4 — Test the exact final artifacts

**Status:** PARTIAL
**Files:** existing consumer qualification/release jobs and playtest scenarios, only where coverage is missing.

- [x] [local; agent] Web production output is served without a dev server and passes gameplay/HUD/input/restart assertions in a real browser. Checkpoint `7e50c5256`: packed cohort installed normally outside the repository, `pnpm build:web`, then production-readiness and pause scenarios against `vite preview`; exit 0, seven assertions passed, zero diagnostics, NVIDIA Turing WebGPU adapter. Captured React score/lives/position HUD and pause/restart controls are visible. Local artifacts: `artifacts/prd399/web/`; command log `/tmp/threenative-prd399-web-playtest.log`. Final candidate must rerun after later changes.
- [ ] [local/shared; target hosts] Linux x64/arm64 final distributions pass the consumer scenario from a relocated path containing spaces, outside the source tree. Partial: Linux x64 `pnpm build:desktop --mode release` produced an integrity-checked archive with `ui/index.html`; extraction to `/home/joao/projects/threenative/sandbox/prd399/relocated game/consumer` and its executable passed five consumer assertions over 941 frames on RTX 2080/Vulkan. The runtime-requested capture omits the separate overlay; OS capture and visible UI proof remain pending. ARM64 is unrun.
- [ ] [shared; Windows CI] The installed Windows x64 game passes the consumer scenario from its installed location.
- [ ] [shared; macOS CI] macOS arm64/x64 final applications pass the consumer scenario after extraction.
- [ ] [local; Android emulator/device] Exact signed Android APK installs and plays, the release AAB validates, and the chosen signing/application identity is recorded. 16 KB compatibility and React UI are covered. Observed default-path failure: installed `pnpm build:android` exits 1 because the published v0.3.2 `prebuilt-lock.json` omits `android-arm64-v8a-v8-snapshot`. The current release producer stages both ABI snapshots; the old published cohort cannot qualify this source. Source build and a complete new prebuilt cohort are pending.
- [ ] [shared/unreachable until host discovery; iOS host/device] iOS simulator runs the final simulator app; an exported signed device IPA installs and plays on a real iOS device. Simulator success cannot close the device row.

### Phase 5 — Release commands, qualification and delivery

**Status:** PARTIAL
**Files:** existing release workflows/commands and their regression tests; relevant user-facing instructions.

- [ ] [local/shared; agent and CI] Repair demonstrated release-flow failures while preserving candidate identity, prerequisite coverage and fail-closed publication. Execute local regressions and observe the corresponding real workflow. Partial: `gates` skips CI completions whose originating event is not `push`; its exact-main-push verdict and all tag checks remain intact. Schedule/manual/PR regressions fail before the fix; 58 release refusal/staging tests pass afterward. Independent review passes the trigger and template-command changes. Hosted execution remains pending.
- [ ] [local/shared; agent and CI] One clean immutable candidate owns every final package hash and its programmatic verification; all required repository checks pass, with no stale or mixed-build evidence.
- [ ] [local; agent] Publish concise executable build/test instructions, obtain an independent review, keep one draft PR against develop, and retire this checkout after authorized integration/completion with its needed artifacts preserved.

## Acceptance and remaining limits

2026-09-22 implementation checkpoint after startup/publication, portable Vite and macOS signing fixes: full `pnpm test` passes, including 1323 runtime-native tests (57 skipped), its 29 ABI tests and 5498 workspace tests (eight skipped). The native package's physics parity and package validation commands also pass. Full `pnpm lint` passes with 772 existing warnings; `pnpm check:docs` validates 2196 links. Workflow structure/dependency tests pass all 125 cases. A concurrent typecheck briefly saw declarations removed by the test command's rebuild; the sequential full `pnpm typecheck` rerun passes. The V8 and QuickJS hosts and required native regression executables were built locally before the full unit run. Independent read-only reviews pass the default UI, frame publishing/startup cleanup, portable Vite and macOS signing changes. These checks do not qualify unexecuted platform artifacts: macOS real signing/JIT and the signed starter workflow remain pending, alongside the other open phase boxes.

Installed checkpoint provenance: JavaScript/package source `7e50c52560344c58054e959565cfaef124b663db`; tarballs under `artifacts/prd399/cohort`, installed consumer `/home/joao/projects/threenative/sandbox/prd399/consumer`. Normal installation downloaded the pinned v0.3.2 Linux x64 prebuilt (runtime SHA-256 `7d48d511b6605519eec2f20874249144260b0e921988acb629c2360c7f188fbb`, tools `078ab5977492409618808179a39039d3317bdd7c3c9d361900b1ec55a1a8a178`). This checkpoint proves that published consumer path; it is not a rebuilt native runtime at the candidate SHA and does not close immutable final-cohort acceptance.

Every phase box is required acceptance evidence; none is satisfied by a plan, a mocked host, a different source revision or historical evidence. Windows/macOS signing and iOS device access are initially unverified, not waived. Report exact supported OS/architecture, simulator/device, trust and prerequisite limits. This task does not promise the absence of every possible defect; it must demonstrate a playable final artifact and responsive selected UI on every claimed platform.
