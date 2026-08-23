<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->

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

Exit `0` passed, `1` assertions failed, `2` never reached assertions, and `75` when the capture
lock queue timed out — that one prints the holder and queue depth and is explicitly **not** a test
failure. `--server-command` needs a workspace that has a `dev` script — an example or a scaffolded
project; there is no root `pnpm dev`. `--browser-recipe webgpu` supplies the current Chromium WebGPU
flags including `--enable-features=Vulkan`, without which Chromium silently serves WebGPU from
SwiftShader and reports healthy-looking limits from a CPU rasteriser; `--browser-arg` is the escape
hatch, and a run that does not name its adapter is not evidence. On headless Linux the runner now
provisions its own private Xvfb for pixel-producing runs (stripping Wayland env itself) and takes a
capture lock only when it detects competing runners — or always with `CAPTURE_LOCK=1`; lock state is
printed to stderr either way. `sh scripts/xvfb.sh` remains as an optional compatibility wrapper —
never `xvfb-run`, whose exit status is its own failing cleanup kill rather than the command's.

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

## Scenario-controlled spawn & aim

The scenario `setup` block carries a placement vocabulary so capturing a vantage frame is
one scenario, not a patch-run-revert ceremony:

- `setup.spawn { x, z }` (+ optional `y`) overrides the SUBJECT player start's position.
  An absent `y` preserves the game's own height (eye or ground line); it is never silently
  defaulted to zero. Requires `subject`.
- `setup.aim { yaw, pitch }` overrides the SUBJECT player start's aim; both angles are
  radians, Three.js convention (forward is -Z at yaw 0, pitch positive up). Requires
  `subject`.
- `setup.place[]` entries `{ entity, at: {x,y,z}, facing?: {yaw} | lookAt?: {x,y,z}, frozen?: boolean }`
  put named entities at explicit transforms. `frozen` sets `PLAYTEST_FROZEN_MARKER`
  (`__threenativeFrozen`) on the entity's userData — data the game reads to suppress
  physics motion, never a runner-side teleport loop.

Presence semantics are explicit and fail closed: an unknown entity id, an entity missing
from the registry at apply time, or a target coincident with the subject is a NAMED error
(`TN_PLAYTEST_SETUP_UNAPPLIED`), never a silent skip. One entity may be placed by only one
of `setup.entities` / `setup.place`.

Steps can also carry `{ kind: "aimAt", target: { x, z } | { entity }, pitch?, waitTicks?, screenshot?, label? }`.
The runner samples the subject's current position, computes yaw/pitch toward the target,
and applies them through the setup channel as quaternion data — no CDP mouse events and no
OS-focus dependency. An `aimAt` step cannot also deliver input (`press`, pointers) or
ignored holds (`holdTicks`/`holdFrames`); follow it with a `waitTicks` step to hold the pose.

Every requested override rides into the run report as `setup.requested` next to what
applied (`setup.applied`). A run whose placement cannot apply fails with the reason named —
an overridden spawn must be visible in diagnostics, never green-with-silence. The game keeps
its own spawn constants; scenarios override them for determinism, through this one channel.
The template-teaching copy of this vocabulary ships via the create-threenative shared
fragment when games adopt it; until then this section is the harness contract.

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
