# PRD-463 — Native leg wall time

Status: PARTIAL — phase 1 in CI (dispatch run 36448456340 building and publishing V8); phase 2 fix
proven locally, awaiting a CI run.

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

- [ ] V8 payload published as release asset `ci-v8-android/v8-android-<recipe hash>.tgz`. proof:
  a develop/main native-platforms run with `publish-android-v8` green, then a PR run whose
  `Android V8 source payload` job takes < 5 min. The publisher is trusted-ref only and checks
  nothing out; `.github/actions/android-v8-source` downloads before trying the Actions cache.
  Published half green: run 36448456340 (branch temporarily allowed, reverted in b69a74870) uploaded
  `v8-android-f543358d….tgz`, 26.6 MB, pre-release, repo "latest" unchanged. PR download open.
- [ ] A downloaded payload still passes the receipt check, and a stale one rebuilds. proof: the
  build step logs `Verified Android V8` on the download path.
- [ ] The NDK and Android SDK caches are deleted. proof: `scripts/__tests__/ci-structure.spec.ts`
  (201 passed locally) and the PR run's Android job has no `Post Restore the Android SDK packages`.
- [ ] A superseded PR run no longer saves 3 GB of V8 source state. proof: the action's save condition.
- [x] A cold V8 build uses every runner core (`THREENATIVE_V8_BUILD_JOBS=$(nproc)`, was 3). proof:
  the next cold build's duration against 2 h 1 min (run 36357493470). — run 36448456340: cold
  (no payload, no source state restored), build step 16:06 → 17:10, 1 h 4 min.
- [x] Every executed conformance row logs its wall time. proof: `[conformance] <id> <status> <s>`
  lines in the PR run's desktop parity log. — run 36448456340: 74 lines, every row 36–39 s,
  total 2711 s.

### Phase 2 — Desktop parity off the critical path

- [x] Conformance rows stop waiting out the native startup gate. proof: local desktop lane,
  `--only-tests 01-basic-cube,82-fetch-local-asset`: 41.4/42.0 s before, 11.8/11.3 s after, both
  pass; full lane after the fix 74 pass / 0 fail / 19 blocked (CI baseline 74/0/19), every
  non-temporal row `TN_STARTUP_CAPTURE_READY:1`.
- [ ] Desktop parity ≤ 30 min on a full run. proof: the run's job timestamps.

Why not shards or concurrency: every row, trivial or not, took 36–39 s and logged `startup gate
never opened within 30s`. Nothing in a conformance scene installs core's startup readiness, so
`runScreenshotMode` waited its full 30 s budget per row after rendering at 60 fps. The entry now
sets `__TN_STARTUP_READY__` once `startScene` resolves.

## Acceptance criteria

- [ ] Full native-platforms run ≤ 70 min wall clock, `scope` to last job (~3 h today). proof: the
  job timestamps of a full run on a published recipe.

## Decisions

- 2026-09-28: the durable store is a release asset rather than a larger cache, because the Actions
  budget is fixed at 10 GiB and branch-scoped. Only `main`/`develop` non-PR runs publish; a PR that
  changes the V8 recipe builds its own payload, and a `workflow_dispatch` on develop after merge
  publishes the new one ahead of the nightly.
