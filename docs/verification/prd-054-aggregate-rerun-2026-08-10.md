# PRD-054 criterion 1 — aggregate parity rerun — 2026-08-10

Result: **RED / incomplete on browser and desktop; Android blocked before execution.** The
declared aggregate command exited `1`; criterion 1 is not closed.

## Command and literal runner output

```sh
pnpm parity
```

Exit code: `1`.

The relevant runner output was:

```text
Error: listen EPERM: operation not permitted 127.0.0.1
Node.js v20.19.6
{
  "wrote": "/home/joao/projects/threejs-webgpu/.worktrees/batch-2026-08-10-unblock/packages/runtime-native/artifacts/conformance/desktop/report.json",
  "target": "desktop",
  "mode": "execution",
  "summary": {
    "pass": 0,
    "fail": 0,
    "blocked": 67,
    "planned": 0,
    "validated": 0
  }
}
{
  "wrote": "/home/joao/projects/threejs-webgpu/.worktrees/batch-2026-08-10-unblock/packages/runtime-native/artifacts/conformance/android/report.json",
  "target": "android",
  "mode": "execution",
  "summary": {
    "pass": 0,
    "fail": 0,
    "blocked": 67,
    "planned": 0,
    "validated": 0
  }
}
```

The browser listener failed before a web report was written. The desktop and Android report
summaries are literal runner output, not inferred parity results.

| Target | Pass | Fail | Blocked | Observed result |
| --- | ---: | ---: | ---: | --- |
| browser | — | — | — | `listen EPERM: operation not permitted 127.0.0.1`; no report |
| Linux desktop | 0 | 0 | 67 | runtime build blocked: `TN_PARITY_DESKTOP_RUNTIME_BUILD_BLOCKED: automatic native provisioning failed: spawnSync /home/joao/.nvm/versions/node/v20.19.6/bin/node EPERM` |
| Android emulator | 0 | 0 | 67 | ADB blocked: `TN_PARITY_ANDROID_ADB_BLOCKED: spawnSync /home/joao/Android/Sdk/platform-tools/adb EPERM` |

The Android missing-AAR blocker is now a later fail-closed preflight and has a unit test. This
rerun did not reach it because ADB was denied first. No Android row executed, so no Android
parity pass or parity failure is claimed.

## Verdict

Browser and desktop remain non-green, Android remains setup-blocked, and the aggregate command
exited `1`. PRD-054 criterion 1 remains open.

## Other declared gates

Observed lane gate results:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS; exit 0 |
| `pnpm lint` | PASS; Biome checked 391 files |
| `pnpm test` | setup-blocked at `@publint/pack`: `Failed to find packed tarball file` although the pack subprocess returned exit 0 |
| `pnpm test:templates` | setup-blocked at `tsx` IPC: `listen EPERM /tmp/tsx-1000/26.pipe`; direct-loader retry reached the same `@publint/pack` failure |
| `pnpm budgets` | setup-blocked at `tsx` IPC: `listen EPERM /tmp/tsx-1000/13.pipe`; direct check passed with review trigger 61,554 / 50,000 |

Those gates cannot turn the non-green parity matrix into a pass.
