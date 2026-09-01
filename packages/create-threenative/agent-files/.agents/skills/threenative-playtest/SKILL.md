---
name: threenative-playtest
description: Diagnose a ThreeNative game, prove behavior, and keep playtests fail-closed.
---

# ThreeNative diagnosis and playtests

For browser, blank-frame, device, or import failures, run `npx threenative doctor` and
`npx @threenative/playtest doctor` first. For a running game, use:

```sh
npx @threenative/playtest doctor --url http://127.0.0.1:5173 --text
npx @threenative/playtest playtests/<name>.playtest.json --browser-recipe webgpu --headed
```

Read visibility, scale, draw cost, frame rate, advancing state, and errors. Missing output means
unobserved, never zero. For a relative-placement question, publish a scene probe with derived
`checks`, drive it with Playwright, sweep candidates in one run, and turn the winning check into a
playtest assertion.

When an `@threenative/*` API is broken, missing, or does not do what you need, replace only that
piece with portable Three.js/plain code. Keep the loop, scenes, input, entity registry, and bridge;
avoid `document`, `window`, `localStorage`, dynamic `import()`, and raw physics handles. **Report
what blocked you**: API, expectation, result, and replacement. Never stall on a framework bug.

Playtests fail closed: a missing entity, absent observation, or empty assertion set fails. Every
`allowTrivial` waiver needs a 20-character reason; `true` alone is invalid, and all-waived
triviality fails `TN_PLAYTEST_SCENARIO_ASSERTS_NOTHING`. Use `holdTicks`/`waitTicks` for fixed-step
time (`holdFrames`/`waitFrames` are compatibility aliases); `warmupFrames` means RAF warmup.
Read `agent-docs/assertion-reference.md` for assertion fields and `agent-docs/debug-surface.md`
for bridge globals. The JSON-safe bridge resource is `state`; `GameState` is a deprecated alias.
