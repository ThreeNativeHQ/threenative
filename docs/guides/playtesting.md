# Test gameplay with playtests

Write a playtest scenario that drives the running game and checks what happened, then run it
against the browser or a native build.

## Run a scenario

A scenario is a JSON file that lists input steps and the results to check. Generated projects keep
them in `playtests/`. Run one against your dev server:

```sh
npx @threenative/playtest playtests/movement.playtest.json \
  --url http://127.0.0.1:5173 \
  --server-command "npm run dev"
```

`--server-command` starts the server before the run. If your target uses WebGPU, pass the Chromium
flags with `--browser-arg`, once per flag:

```sh
npx @threenative/playtest playtests/movement.playtest.json \
  --url http://127.0.0.1:5173 \
  --browser-arg --enable-unsafe-webgpu \
  --browser-arg --enable-features=Vulkan
```

`pnpm test` in a generated project builds the web target and runs every `playtests/*.playtest.json`.

If the project has no playtest setup, run `npx @threenative/playtest init`. It creates a config, a
smoke scenario and an adapter example without changing your source.

## Write a scenario

This trimmed scenario from the `minimal` template holds the right arrow for 60 ticks, waits, then
checks that the HUD changed and nothing logged an error:

```json
{
  "name": "play",
  "target": "web",
  "schemaVersion": 1,
  "warmupFrames": 60,
  "steps": [
    { "kind": "input", "press": "ArrowRight", "holdTicks": 60, "release": true },
    { "kind": "wait", "waitTicks": 600, "release": true }
  ],
  "assert": {
    "diagnostics": { "noConsoleErrors": true, "runtimeReady": true },
    "components": [{ "entity": "hud", "component": "glyphs", "changed": true }]
  }
}
```

Assert on what the player sees: position, state, camera, visibility. These checks survive a rewrite
of the code behind them.

## Connect the game

Checks on entities, cameras, movement and visibility need a bridge inside the game. Generated
projects install it with the `playtest()` plugin:

```ts
import { playtest } from "@threenative/core/playtest";

const game = defineGame({
  plugins: [rapier(), playtest()],
  // ...
});
```

Without the bridge, these assertions fail with `TN_PLAYTEST_BRIDGE_MISSING`. Input, screenshot,
DOM, console, network and trace checks work without it.

## Read the result

A run passes only when at least one assertion ran against an observation that arrived. The runner
fails a missing entity, an absent resource, an empty effect log and a scenario with no assertions.
It rejects wrong-typed assertion values when it loads the scenario.

## Check the setup

```sh
npx @threenative/playtest doctor --text
npx @threenative/playtest doctor --url http://127.0.0.1:5173 --text
```

The first command checks that this machine can run a playtest. With `--url`, doctor also reports
what the running game exposes.

## Test a native build

The same scenario format runs with `--target browser`, `--target desktop` or `--target android`.
For desktop, pass the packaged executable:

```sh
npx @threenative/playtest playtests/device-smoke.playtest.json \
  --target desktop \
  --executable .threenative/build/ThreeNative
```

The runner hands the native host a temporary mailbox, so the game source stays unchanged. Run
release checks against the extracted or installed build. [Native runtime](native-runtime.md) covers packaging.

Network, DOM and visual-metric assertions are browser-only. On a device target they fail with
`TN_PLAYTEST_UNSUPPORTED_ON_TARGET` and exit code 2. Keep shared gameplay checks in one scenario
and put touch or window checks in target-specific ones.

## Source

- [playtest README](../../packages/playtest/README.md)
- [minimal template game.ts](../../packages/create-threenative/templates/minimal/src/game.ts)
