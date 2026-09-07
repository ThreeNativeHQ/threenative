# PRD-359 isolated build prerequisites — 2026-09-05

Worktree `.worktrees/networking-359`, branch `networking-359`, engine base `356cbe9f`.
Task 0 commit `f20e7c3e` changes policy only. No networking runtime source was changed
for these baseline builds. This record proves build prerequisites, not multiplayer acceptance.

| Command | Exit | Observation |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Workspace dependencies installed without lockfile changes. |
| `pnpm build` | 0 | Workspace packages built; primary-docs imports now resolve. |
| `node scripts/download-deps.mjs` from runtime-native | 0 | Supported downloader provisioned desktop dependencies in this worktree. |
| `cmake --preset tn-linux` | 1 | Ninja missing from PATH; no source defect. |
| `cmake --preset tn-linux -DCMAKE_MAKE_PROGRAM=/home/joao/Android/Sdk/cmake/3.22.1/bin/ninja` | 0 | Used installed SDK Ninja; isolated V8+Dawn/quiche configuration. |
| `cmake --build build/tn-linux --target mystral threenative-webtransport-wire-test threenative-webtransport-surface-test -j 6` | 0 | All 400 compilation/link steps completed. |
| `ctest --test-dir build/tn-linux -R 'threenative-webtransport-(wire|surface)-test' --output-on-failure` | 0 | Two existing contracts executed and passed. |

```text
[398/400] Linking CXX static library libmystral-runtime.a
[399/400] Linking CXX executable mystral
[400/400] Linking CXX executable threenative-webtransport-surface-test

1/2 Test #1: threenative-webtransport-wire-test ...... Passed
2/2 Test #2: threenative-webtransport-surface-test ... Passed
100% tests passed out of 2
```

Fresh binary SHA256: `5d58e875c0d6a5cad3445ed15a4f62b20ca811bda7448dccb1c716bac6387be0`.
The earlier fixture-prerequisite probe used a copied main-tree binary with SHA256
`92fc51519ef420c934615f772a496d66823ab09373caed14b588d3aeee9de48a`; subsequent
live runs must identify the freshly built executable instead.

Available probes: Playwright Chromium executable exists at
`/home/joao/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`;
ADB reports physical Pixel 8 `37251FDJH0037Z` in device state. Availability is not
browser or Android networking proof. All multiplayer platform lanes remain unverified.
Local full logs: `/tmp/networking-359-{build,native-deps,native-configure,native-build,native-contracts}.log`.
