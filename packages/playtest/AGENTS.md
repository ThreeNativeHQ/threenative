# AGENTS.md — @threenative/playtest

Read `/AGENTS.md` first. This file covers the operator CLI and what is different about changing
the harness.

## Running a scenario

```sh
pnpm --filter @threenative/playtest build          # the CLI is built, not checked in
node packages/playtest/dist/runner/cli.js init     # writes playtests/smoke.playtest.json
node packages/playtest/dist/runner/cli.js playtests/smoke.playtest.json \
  --url http://127.0.0.1:5173 --server-command "pnpm --filter abyss-framework dev" \
  --browser-recipe webgpu
```

Exit `0` passed, `1` assertions failed, `2` never reached assertions. `--server-command` needs a
workspace that has a `dev` script — an example or a scaffolded project; there is no root `pnpm dev`.
`--browser-recipe webgpu` supplies the current Chromium WebGPU flags including
`--enable-features=Vulkan`, without which Chromium silently serves WebGPU from SwiftShader and
reports healthy-looking limits from a CPU rasteriser; `--browser-arg` is the escape hatch, and a run
that does not name its adapter is not evidence. For screenshot or `visual` assertions on headless
Linux, prefix with `sh scripts/xvfb.sh` — never `xvfb-run`, whose exit status is its own failing
cleanup kill rather than the command's.

In a scaffolded project the same CLI is `npx @threenative/playtest`, and `diagnostics`, console,
network, screenshot and trace assertions work against any URL. The framework template installs the
bridge with `playtest()` in `defineGame`; a plain Three.js project uses `installThreePlaytestBridge`
from `@threenative/playtest/three`. Semantic assertions (`movement`, `camera`, `visibility`) against
a project with neither bridge fail `TN_PLAYTEST_BRIDGE_MISSING` — that is the harness being right.
Install the bridge or narrow the scenario; never delete the assertion to get green.

## The rule that outranks everything else in this package

**A check that cannot run must fail, never skip.**

v1's harness had 19 validators that returned `undefined` on a wrong-typed value and 13
`.filter()` calls that dropped them silently. One misspelled assertion type meant the
scenario ran with zero assertions and **reported green**. That is the single most dangerous
failure mode in an agent loop, because the agent optimizes against the report.

Concretely, when you touch this package:

- A malformed assertion **throws at load** (`invalidScenario(...)`). Never dropped, coerced,
  or defaulted.
- Never add a `.filter()` that removes an assertion, an observation, or a step.
- A missing entity, an absent resource, an empty effect log, or a scenario with no assertions
  is a **failure**, not a pass.
- A run reports `pass` only when at least one assertion was evaluated against an observation
  that actually arrived.
- New assertion types need a test proving the wrong-typed case fails. `__tests__/` already
  holds the shape: `vacuous-assertion.spec.ts`, `silent-drop.spec.ts`,
  `evidence-required.spec.ts`. Add to those rather than starting a new pattern.

## One scenario, four targets

`--target browser|android|desktop|ios` runs the same scenario file against a browser, an Android
device or emulator, a native desktop executable, and an iOS simulator or device
(`runner/androidRunner.ts`, `runner/desktopRunner.ts`, `runner/iosRunner.ts`,
`runner/deviceTransport.ts`). Desktop requires `--executable`; the runner owns a temporary local
mailbox and passes its root to the native host through `TN_PLAYTEST_MAILBOX_ROOT`. Keep it that way:
an assertion that only
means something on one target is a fork of the harness.

A device target that cannot be reached fails `TN_PLAYTEST_DEVICE_FAILED`; it never degrades
to a browser run. Where a target genuinely lacks an observer — device transport has no CDP
network observer — the assertion **errors and names the working target**, it does not skip.
The negative-control scenarios in `examples/native-smoke/playtests/` (`-misspelled`,
`-wrong-value`) prove the device path still fails closed; run them when you change transport
or observation code.

## Determinism

Scenario steps count fixed-step ticks, not milliseconds — use `holdTicks`, `waitTicks`. The
deprecated `holdFrames` and `waitFrames` aliases remain accepted for compatibility and are
treated as ticks when the bridge exposes `runtime.fixedStep`; `warmupFrames` remains a genuine
requestAnimationFrame warmup. Never introduce a wall-clock sleep or a millisecond-based step
into scenario semantics.

## This is salvaged code

Lifted from `threejs-to-bevy` and deliberately standalone: it runs against **plain Three.js
with zero ThreeNative dependencies**, and that independence is a product decision, not an
accident. `three` and `playwright` are optional peers. Do not add a `@threenative/core`
dependency.

It is also excluded from the framework LOC budget and from `biome.json`, so its style differs
from the rest of the repo. Match the file you are editing, not the root convention.

## Test layout, and a trap

Vitest at the root only collects `packages/**/__tests__/**/*.spec.ts`. The co-located
`src/**/*.test.ts` files here are **not** run by `pnpm test`. Put anything that must gate CI
in `__tests__/`, or run the co-located ones explicitly and say that you did.
