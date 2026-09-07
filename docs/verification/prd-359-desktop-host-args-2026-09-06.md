# PRD-359 — the playtest CLI could not launch a desktop game

Recorded 2026-09-06 UTC, worktree `.worktrees/networking-359`, branch `networking-359`.

## The defect

`--target desktop` spawned the native host with **no arguments**. `DesktopPlaytestDriver`
has accepted an `args` list since it was written (`packages/playtest/src/runner/desktop.ts:13`,
used at `desktop.ts:93`), and `verify-desktop-loading.mjs:188` passes `args: ["run", bundle]`
when it constructs the driver directly — but `runDesktopPlaytest` never forwarded one, and the
CLI had no flag to supply one. `--host-arg` existed only in the `perf` subcommand
(`runner/perf.ts:295`), not in the scenario path.

The result is a host with no game. Every desktop scenario driven through the CLI failed the
same way, and the failure looked like a game defect rather than a missing argument.

This is the engine-side reason PRD-359's native lanes could not run: Task 7a's paired-client
proof, Task 6b's live suspend/resume and 100-cycle lane, and every non-browser row of Task 7c
all reach the host through this CLI.

## Red

```text
$ node packages/playtest/dist/runner/cli.js \
    examples/native-smoke/playtests/physics-desktop.playtest.json \
    --target desktop --executable .../build/tn-linux/mystral
exit=2
"frames": 0,
"diagnostics": [
  {
    "code": "TN_PLAYTEST_BRIDGE_MISSING",
    "message": "Scenario requires semantic capabilities but '__THREENATIVE_PLAYTEST_BRIDGE__' is not installed."
  }
]
```

Unit red, before the repair:

```text
× desktop CLI forwards repeated --host-arg to the native host
  PlaytestCliUsageError: Unknown flag '--host-arg'. Run threenative-playtest --help.
× desktop runner passes the configured host arguments to the driver
  Tests  1 failed | 24 skipped (25)
```

## The repair

`--host-arg` is now a repeatable scenario flag, matching the name `perf` already uses.
`IStandalonePlaytestConfig.desktop` carries `hostArgs`, and `runDesktopPlaytest` forwards them
to the driver through the exported `desktopHostArgs`, which returns an empty list rather than
`undefined` so a host that needs no arguments still launches.

## Green

```text
$ node packages/playtest/dist/runner/cli.js \
    <abs>/examples/native-smoke/playtests/physics-desktop.playtest.json \
    --target desktop --executable .../build/tn-linux/mystral \
    --host-arg run --host-arg dist/native-smoke.js \
    --project <abs>/examples/native-smoke
exit=1
"frames": 180
```

The bridge is installed and 180 native frames were observed, so the run now reaches real
resource assertions. This scenario still fails them — `physics-desktop` asserts a physics
scene the plain `native-smoke.js` bundle does not stand up — but that is a scenario/bundle
mismatch being reported honestly, not a host that never started. The point of this record is
the transition from `frames: 0` with no bridge to `frames: 180` with the bridge installed.

Unit green:

```text
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

## Negative control

Removing the forwarding line and making `desktopHostArgs` return a constant empty list:

```text
× desktop runner passes the configured host arguments to the driver
  Tests  1 failed | 24 passed (25)
```

Restored:

```text
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

## Scope

This is the harness fix only. It makes a desktop lane runnable; it is not evidence that any
networking lane passed. `packages/playtest/AGENTS.md` now names the flag and the
`TN_PLAYTEST_BRIDGE_MISSING` symptom so the next lane does not rediscover it;
`scripts/__tests__/primary-docs.spec.ts` passes 7/7 against the change.
