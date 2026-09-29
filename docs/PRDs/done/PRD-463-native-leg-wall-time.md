# PRD-463 — Native leg wall time

Status: DONE — phase 1 and phase 2 shipped and proven in CI. The native leg measures 40 min 50 s in
run 36459512880, against ~3 h in run 36357493470.

## Problem

The `native-platforms` leg takes about three hours wall clock (run 36357493470: 23:05 → 02:07).
Two of those hours are one job, `Android V8 source payload`, cold-building V8 on every run although
its payload is cached by recipe hash. The cache never holds it: the nightly saved
`android-v8-payload-…f543358d` at 12:06 on 2026-09-28 and it was gone by 15:48. The repository's
10 GiB Actions cache is shared by every lane, and multi-GB entries that never pay for themselves
evict it — the Android SDK cache (240 s to save, ~40 s to reinstall), the NDK cache (90 s to save,
2 s to reinstall, preinstalled on the image) and 3 GB V8 source-state saves from superseded PR runs.
Actions caches are also branch-scoped, so a payload a PR builds is invisible to every other PR.
`android-emulator-parity` waits on that job, so the Android leg finishes ~2.5 h after start.

With V8 off the critical path the next one is `Desktop web/native parity`: 46 of its 53 minutes are
`run-conformance --target desktop`, 74 rows run one after another (~37 s each).

### Phase 1 — V8 payload off the critical path, cache budget back

- [x] V8 payload published as release asset `ci-v8-android/v8-android-<recipe hash>.tgz`. proof:
  run 36448456340 (branch temporarily allowed, reverted in b69a74870) uploaded
  `v8-android-f543358d….tgz`, 26.6 MB, pre-release, repo "latest" unchanged; run 36459512880's
  `Android V8 source payload` downloaded that asset — job 33 s (17:39:45 → 17:40:18), download step
  2.5 s, `Restore the pinned Android V8 payload` skipped — against 2 h 1 min cold. `publish-android-v8`
  skipped on the PR, as designed.
- [x] A downloaded payload still passes the receipt check, and a stale one rebuilds. proof: run
  36459512880 logged `Verified Android V8 11.0.226.16: both ABI/snapshot/STL payloads` and
  `v8-android: OK` on the download path (build step 1.2 s, verify step 0.2 s); the stale path is
  `Replacing stale Android V8 cache: …` in `provisionAndroidV8`, covered by
  `packages/runtime-native/tests/android-16kb-alignment.test.mjs`.
- [x] The NDK and Android SDK caches are deleted. proof: `scripts/__tests__/ci-structure.spec.ts`
  fails if the Android job names `system-images/android-35` (green in the `test` job, 201 passed
  locally) and run 36459512880's Android emulator job has no `Restore the Android SDK packages`
  step.
- [x] A superseded PR run no longer saves 3 GB of V8 source state. proof: the save step's guard is
  `steps.build.outcome == 'failure' || (cancelled && github.event_name != 'pull_request')`, asserted
  by `packages/runtime-native/tests/native-platform-workflow.test.mjs`, and run 36459512880 ended
  with both `Save the prebuilt Android V8 payload` and `Save resumable V8 source state` skipped.
- [x] A cold V8 build uses every runner core (`THREENATIVE_V8_BUILD_JOBS=$(nproc)`, was 3). proof:
  the next cold build's duration against 2 h 1 min (run 36357493470). — run 36448456340: cold
  (no payload, no source state restored), build step 16:06 → 17:10, 1 h 4 min.
- [x] Every executed conformance row logs its wall time. proof: `[conformance] <id> <status> <s>`
  lines in the desktop parity log. — run 36459512880: 74 lines, 6.5–6.8 s each; run 36448456340
  before the startup-gate fix: 74 lines, 36–39 s each.

### Phase 2 — Desktop parity off the critical path

- [x] Conformance rows stop waiting out the native startup gate. proof: run 36459512880's desktop
  parity job logged zero `startup gate never opened within 30s` lines and
  `74 passed, 0 failed, 19 blocked by this machine's capabilities, 0 unexpectedly blocked` — the CI
  baseline — at 6.5–6.8 s per row. Local before/after with `--only-tests
  01-basic-cube,82-fetch-local-asset`: 41.4/42.0 s → 11.8/11.3 s.
- [x] Desktop parity ≤ 30 min on a full run. proof: run 36459512880, 17:44:19 → 17:57:03 = 12 min
  44 s (was 53 min).

Why not shards or concurrency: every row, trivial or not, took 36–39 s and logged `startup gate
never opened within 30s`. Nothing in a conformance scene installs core's startup readiness, so
`runScreenshotMode` waited its full 30 s budget per row after rendering at 60 fps. The entry now
sets `__TN_STARTUP_READY__` once `startScene` resolves.

## Acceptance criteria

- [x] Full native-platforms run ≤ 70 min wall clock, `scope` to last job (~3 h today). proof: run
  36459512880 — `Change scope` 17:39:05 → last native job `Native collector evidence coverage`
  18:19:55 = 40 min 50 s; the whole run 41 min 34 s. The V8 payload came from the published release
  asset, so this is the published-recipe shape.

That run's verdict was red on two jobs that are not the native leg — a unit assertion that pinned
the action's YAML spelling, and `ci-required`. `ci-required` compares the merge commit's parents
(`3788ce79e`, `b69a74870`) against the base/head the event payload reported (`4ced4e2529`,
`b69a74870`): the payload named the `develop` tip as it stood when the PR was opened, a minute
before `#364` landed. Both are fixed in the commit that finishes this PRD; the merge of `develop`
realigns the payload's base with the merge ref, and the finishing run is the proof of that.

## Decisions

- 2026-09-28: the durable store is a release asset rather than a larger cache, because the Actions
  budget is fixed at 10 GiB and branch-scoped. Only `main`/`develop` non-PR runs publish; a PR that
  changes the V8 recipe builds its own payload, and a `workflow_dispatch` on develop after merge
  publishes the new one ahead of the nightly.
