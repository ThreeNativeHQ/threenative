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
- [ ] [local/shared; agent and native CI] Every selected WebUI build carries HTML, JavaScript, CSS and assets into its final package; a missing bundle fails with an actionable error.
- [ ] [local; agent] Generated project commands and help match the supported build paths without undocumented setup or silent target downgrades.

### Phase 2 — Native React UI visibly tracks live gameplay

**Status:** PARTIAL
**Files:** existing UI bridge/state and native overlay implementations; existing UI verification scenarios.

- [ ] [local; agent] Continuous game state reaches React on each rendered game frame without a fixed 100 ms publishing throttle; idle UI does not accumulate a message backlog. Regression tests exercise the real owner path. Partial evidence: `game.spec.ts` drives `defineGame`, actual `Scene.render` writes and `subscribeUiState`; default delivery red, explicit interval green, then both green. Independent review found and fixed a one-frame delay for render-hook writes; flush now follows those hooks. The final sustained test drives 64 callbacks, requires at least eight actual world renders, and passes both default and explicit 100 ms cases. This proves publication to the UI mirror; actual React commits and visible native presentation still require the consumer run.
- [ ] [local; agent] Linux final build proves visible UI animation/state changes and pointer input, with measured presentation cadence and state-to-paint latency; no attachment-only substitute.
- [ ] [shared; native Windows/macOS/Android/iOS hosts] The same UI verification runs per platform and records cadence, latency, dropped/stale updates and screenshots. At a stable 60 FPS workload, target p95 state-to-visible-update latency is at most 50 ms with no sustained 10/15/30 Hz UI cap; report actual device/refresh rate and failures.

### Phase 3 — Conventional, integrity-checked desktop distributions

**Status:** NOT STARTED
**Files:** existing desktop container/signing adapters, shipped build command and platform tests.

- [ ] [local/shared; agent and Windows CI] Windows release creates a standard installer with game identity, shortcuts, uninstall support and complete runtime/UI dependencies; install, launch and uninstall execute on Windows.
- [ ] [shared; macOS CI] macOS produces a relocatable `.app` distribution, validates bundle identity/resources and signing order, launches after extraction and carries the React HUD. Real trust/notarization is qualified only with real credentials.
- [ ] [local/shared; agent and architecture hosts] Linux produces a relocatable archive/application with launch metadata, complete required payload and explicit system prerequisites; extraction and launch execute on each advertised architecture.

### Phase 4 — Test the exact final artifacts

**Status:** NOT STARTED
**Files:** existing consumer qualification/release jobs and playtest scenarios, only where coverage is missing.

- [ ] [local; agent] Web production output is served without a dev server and passes gameplay/HUD/input/restart assertions in a real browser.
- [ ] [local/shared; target hosts] Linux x64/arm64 final distributions pass the consumer scenario from a relocated path containing spaces, outside the source tree.
- [ ] [shared; Windows CI] The installed Windows x64 game passes the consumer scenario from its installed location.
- [ ] [shared; macOS CI] macOS arm64/x64 final applications pass the consumer scenario after extraction.
- [ ] [local; Android emulator/device] Exact signed Android APK installs and plays, the release AAB validates, and the chosen signing/application identity is recorded. 16 KB compatibility and React UI are covered.
- [ ] [shared/unreachable until host discovery; iOS host/device] iOS simulator runs the final simulator app; an exported signed device IPA installs and plays on a real iOS device. Simulator success cannot close the device row.

### Phase 5 — Release commands, qualification and delivery

**Status:** NOT STARTED
**Files:** existing release workflows/commands and their regression tests; relevant user-facing instructions.

- [ ] [local/shared; agent and CI] Repair demonstrated release-flow failures while preserving candidate identity, prerequisite coverage and fail-closed publication. Execute local regressions and observe the corresponding real workflow.
- [ ] [local/shared; agent and CI] One clean immutable candidate owns every final package hash and its programmatic verification; all required repository checks pass, with no stale or mixed-build evidence.
- [ ] [local; agent] Publish concise executable build/test instructions, obtain an independent review, keep one draft PR against develop, and retire this checkout after authorized integration/completion with its needed artifacts preserved.

## Acceptance and remaining limits

2026-09-21 implementation checkpoint: baseline whole-workspace `pnpm build` passed; current `pnpm typecheck`, `pnpm lint` and `pnpm check:docs` passed. Seven focused suites passed 240 tests, followed by the strengthened two-case cadence regression passing and a rebuild of the changed core package. All 19 React package tests then passed; primary-doc and agent-mirror tests also passed. An independent read-only reviewer passed the corrected default/cadence diff. Full `pnpm test`, final artifact playtests and native UI latency measurements remain unrun for this change. Current packaging source still advertises additional source-build architectures beyond the downloadable prebuilt set; final claims must distinguish them.

Every phase box is required acceptance evidence; none is satisfied by a plan, a mocked host, a different source revision or historical evidence. Windows/macOS signing and iOS device access are initially unverified, not waived. Report exact supported OS/architecture, simulator/device, trust and prerequisite limits. This task does not promise the absence of every possible defect; it must demonstrate a playable final artifact and responsive selected UI on every claimed platform.
