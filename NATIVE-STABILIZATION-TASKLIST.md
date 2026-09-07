# Native stabilization — remaining work

Goal: Wildwood and other ThreeNative games work by default across web, desktop,
Android and iOS, with dependable input/loading, comparable visual quality, measured
performance, and regression checks. Completion is **not yet proven**; no percentage
is assigned to the outstanding device and visual verification.

## Verified baseline

Linux desktop loading, Canvas2D drawing/fonts, mouse capture, window configuration,
and cooperative scheduling fixes have local evidence. The rebuilt Wildwood passed
five native gameplay assertions. These results do not establish full visual parity
or steady-state FPS.

Android ARM64 Canvas2D compiled and linked. Automatic dependency setup subsequently
fetched seven pinned source repositories, recovered from the GN-history failure,
built Skia, and staged eight libraries. Cache reuse and a link probe against the
cold-built libraries passed; 37 focused native tests passed. No phone execution
followed this build. Shipping Android/iOS Canvas2D defaults remain unchanged.

At local commit `2a905168`, typecheck passed and the resumed root unit gate passed
4,299 tests with 4 skips. The later source-fetch changes still require integrated
release-branch verification. Root lint previously failed on eight unrelated
`.linchpin` formatting errors; budgets previously failed on a stale screenshot
retention index. Neither failure should be reported as green.

## 1. Finish assembling the isolated release branch

- [ ] Resolve the active documentation conflict in
  `.worktrees/native-stabilization-wrap/packages/runtime-native/docs/G1-desktop-host.md`.
  Cherry-pick stopped at `5fbd85fb`; only `085217c5` and `748dcad3` have been applied
  there, as `6a24555f` and `07178951`. Preserve the ellipse evidence without importing
  unsupported shadow-material receipts merely because they appear in conflict context.
- [ ] Continue the remaining selected commits in order:
  `5fbd85fb`, `56a519a8`, `750c225d`, `af0824a6`, `32e60dd4`, `5643faa6`,
  `19762c4c`, `a0c64c2e`, `20727fe8`, `0871f681`, `293d13d1`, `0fd5cd3d`,
  `2a905168`. Review dependencies on excluded changes instead of blindly replaying them.
- [ ] Transfer and commit the primary checkout's uncommitted source-provisioning
  changes in `packages/runtime-native/scripts/build-skia-android.mjs`,
  `scripts/download-deps.mjs`, and `tests/build-skia-android.test.mjs` into that branch.
  Preserve the primary copies until the transfer is verified.
- [ ] Update the mobile gate documentation with cold-fetch, GN-history recovery,
  cache-hit, and final test evidence. Confirm the PR excludes unrelated local work:
  primary `main` was 30 commits ahead of `origin/main` when release assembly started.
- [ ] Account for Wildwood's separate game-owned artwork changes and package pins.
  Preserve shared web/native source and avoid introducing per-game native workarounds.

## 2. Complete platform-default support

- [ ] Reconnect the physical Android device; `adb devices` is currently empty.
  Package the actual release candidate, verify its application ID and embedded runtime,
  then exercise loading, progress updates, scene entry, touch/input, pause/resume and UI.
- [ ] Finish supported Android ABI/dependency provisioning and enable the intended
  Canvas2D defaults only with build/runtime evidence. The source builder currently
  supports ARM64; audit the other advertised ABI paths and test unsupported selections.
- [ ] Resolve Windows text support: source audit found `SkFontMgr::RefEmpty()` on
  Windows. Investigate the shipped DirectWrite factory/link dependencies, implement
  the engine fix, and execute a Windows build plus text conformance capture.
- [ ] Obtain macOS/iOS execution lanes. Verify fonts, loading/progress, input, native
  UI composition and lifecycle behavior on the actual supported targets. This Linux
  machine has no Xcode; simulator proof does not substitute for physical iOS evidence.
- [ ] Resolve or explicitly gate Android 16 KB-page compatibility. The newly built
  runtime/probe has 16 KB-aligned LOAD segments, but the separate prebuilt V8 library
  remains a known blocker. Do not claim the whole APK is 16 KB-compatible.

## 3. Prove visual parity and native end-to-end behavior

- [ ] Capture web and native at matching viewport, camera, quality, exposure and
  temporal state. Compare the complete composed window, including HUD—not native GPU
  readback alone. The previous pair had mismatched HUD visibility and noisier native foliage.
- [ ] Verify the loading artwork fills the viewport without vertical seams/repetition,
  inversion or a brightness change, and that progress completes and the loader disappears.
  Cover resizing and fullscreen/windowed modes; repeat mobile progress checks on hardware.
- [ ] Run the native gameplay flow against the final packaged release candidate:
  readiness, meaningful movement, camera input, UI interaction, cursor capture/release,
  focus regain and lifecycle transitions, with no runtime or GPU validation errors.
- [ ] Verify default fullscreen/window configuration and explicit overrides across
  supported desktop hosts. Confirm touch/pen input does not trigger mouse capture.
- [ ] Replace the unreliable private-compositor capture approach with a verified
  presentation lane. Three game-capture attempts failed; do not blindly retry it or
  interpret a missing capture as proof that the game itself is black.

## 4. Finish performance measurements and regression gates

- [ ] Measure Wildwood on a hardware-backed, OS-foreground, unoccluded display after
  loading/compilation settles. Validate an empty presentation control first; collect
  at least 1,000 steady frames and 30 seconds with representative movement/gameplay.
- [ ] Investigate presentation wait using a valid lane. The private-display sample
  showed about 39 ms host gap versus 12 ms game-frame work, but only 300 settled frames;
  it is diagnostic evidence, not a certified gameplay FPS result. Report p50/p95/p99,
  worst frame, hitches, adapter, resolution, quality, workload and sample count.
- [ ] Repeat representative measurements on available target hardware, respecting
  mobile thermal/battery preflight. Fix measured engine bottlenecks without lowering
  visual quality silently, and rerun the same workload after each change.
- [ ] Verify CI covers source provisioning/cache failures, CMake archive grouping,
  Canvas2D pixels/text/orientation, scheduling, input and native E2E behavior. Keep
  required checks fail-closed; add actual mobile/Windows coverage rather than treating
  a Linux compiler fixture as platform execution.
- [ ] Run the final release-branch gates: typecheck, lint, build, unit/package tests,
  budgets and affected native/playtest/conformance scenarios. Recheck the existing lint
  and retention-index failures; do not silently reformat unrelated work or delete evidence.

## 5. Ship and close honestly

- [ ] Review the final diff and evidence against the full goal, including supported
  platforms, defaults, native E2E, quality parity and performance. Label every unexecuted
  target or unresolved requirement explicitly.
- [ ] Push the isolated branch and open a scoped PR with exact test results and known
  limitations. Do not use `origin/skia-android-deps` wholesale: a prior worker pushed it
  unexpectedly, and it contains unrelated history plus a superseded helper implementation.
- [ ] Monitor required CI and review feedback; repair relevant failures locally and
  rerun affected checks. Do not merge with pending/failing required checks.
- [ ] Squash-merge only after the checks and review are satisfied; verify the remote
  merge and resulting commit. No PR or merge has been completed for this release branch.
- [ ] Clean up only the completed, clean, merged task worktree/branch. Preserve dirty
  primary changes and source/evidence caches unless removal is explicitly authorized.
  Mark the persistent goal complete only when its full requirements are actually verified.

## Evidence and immediate next action

Primary evidence lives in `packages/runtime-native/docs/G3-mobile-bring-up.md`,
`packages/runtime-native/docs/G5-profiling.md`, and
`docs/verification/native-canvas-presentation-2026-09-05.md`.
Local logs are under `artifacts/android-skia-probe-20260905/`,
`artifacts/wildwood-native-profile-20260905/`, and
`artifacts/wildwood-quality-parity-20260905/`.

**Next action:** inspect and resolve the single active G1 documentation conflict,
then continue the paused cherry-pick in `native-stabilization-wrap`.
