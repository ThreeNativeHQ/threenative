# AGENTS.md — @threenative/playtest

Read `/AGENTS.md` first. This file only covers what is different here.

## The rule that outranks everything else in this package

**A check that cannot run must fail, never skip.**

v1's harness had 19 validators that returned `undefined` on a wrong-typed value and 13
`.filter()` calls that dropped them silently. One misspelled assertion type meant the
scenario ran with zero assertions and **reported green**. That is the single most dangerous
failure mode in an agent loop, because the agent optimizes against the report.

Concretely, when you touch this package:

- A malformed assertion **throws at load** (`invalidScenario(...)`). It is never dropped,
  coerced, or defaulted.
- Never add a `.filter()` that removes an assertion, an observation, or a step.
- A missing entity, an absent resource, an empty effect log, or a scenario with no
  assertions is a **failure**, not a pass.
- A run only reports `pass` when at least one assertion was evaluated against an observation
  that actually arrived.
- New assertion types need a test proving the wrong-typed case fails. `__tests__/`
  already holds the shape: `vacuous-assertion.spec.ts`, `silent-drop.spec.ts`,
  `evidence-required.spec.ts`. Add to them rather than starting a new pattern.

## Determinism

Scenario steps count frames, not milliseconds — `holdFrames`, `waitFrames`. The harness
drives the fixed-step clock instead of racing it. Never introduce a wall-clock sleep or a
millisecond-based step into scenario semantics.

## This is salvaged code

Lifted from `threejs-to-bevy` and deliberately standalone: it runs against **plain Three.js
with zero ThreeNative dependencies**, and that independence is a product decision, not an
accident. `three` and `playwright` are optional peers. Do not add a `@threenative/core`
dependency.

It is also excluded from the framework LOC budget and from `biome.json`, so its style
differs from the rest of the repo. Match the file you are editing, not the root convention.

## Test layout, and a trap

Vitest at the root only collects `packages/**/__tests__/**/*.spec.ts`. The co-located
`src/**/*.test.ts` files here are **not** run by `pnpm test`. Put anything that must gate CI
in `__tests__/`, or run the co-located ones explicitly and say that you did.

## Running the operator CLI

Use `--browser-recipe webgpu` for the current Chromium WebGPU flags. For screenshot or
`visual` assertions on a headless Linux machine, prefix the command with
`xvfb-run -a -s '-screen 0 1600x900x24'`. `--browser-arg` remains the escape hatch for
custom Chromium flags. Exit code `0` means pass, `1` means assertions failed, and `2`
means the run never reached assertions.
