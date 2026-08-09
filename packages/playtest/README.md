# @threenative/playtest

Run a schema-version-1 browser scenario against any development URL:

```bash
npx @threenative/playtest playtests/movement.playtest.json \
  --url http://127.0.0.1:5173 --server-command "npm run dev"
```

Install the bridge from `@threenative/playtest/three` when semantic entity, camera,
movement, or visibility assertions are required. Browser-only input, screenshot,
DOM, console, network, and trace evidence does not require an adapter. Run
`npx @threenative/playtest init` to create a config, smoke scenario, and adapter
example without changing application source.

Pass chromium flags with `--browser-arg`, repeated once per flag. A WebGPU
target does not start without them:

```bash
npx @threenative/playtest playtests/movement.playtest.json \
  --url http://127.0.0.1:5173 \
  --browser-arg --enable-unsafe-webgpu \
  --browser-arg --enable-features=Vulkan
```

## Device targets

The same scenario format runs through `--target browser`, `--target android`, or
`--target ios`. An iOS simulator run installs a built app, launches it with `simctl`, and
uses the app data-container mailbox:

```bash
npx @threenative/playtest playtests/device-smoke.playtest.json \
  --target ios --app build/threenative-ios.app \
  --bundle-id dev.threenative.runtime --device booted
```

For a signed physical build, add `--ios-transport device --device <devicectl-id>`.
Network, DOM, and visual-metric assertions are unsupported on device targets and fail
`TN_PLAYTEST_UNSUPPORTED_ON_TARGET` with exit code 2. Default CI does not run Android or
iOS device scenarios. `.github/workflows/native-platforms.yml` is an explicit opt-in
platform lane; an absent run is not a pass.

## What a passing run means

A scenario only reports `pass` when at least one assertion was evaluated
against an observation that actually arrived. Assertions fail closed: a missing
entity, an absent resource, an empty effect log, or a scenario with no
assertions at all is a failure, never a silent pass. Wrong-typed assertion
values are rejected when the scenario loads rather than dropped, so a scenario
cannot quietly run with fewer checks than its author wrote.
