# @threenative/playtest

Run a schema-version-1 browser scenario against any development URL:

```bash
npx @threenative/playtest playtests/movement.playtest.json \
  --url http://127.0.0.1:5173 --server-command "npm run dev"
```

Use `@threenative/playtest-three` when semantic entity, camera, movement, or
visibility assertions are required. Browser-only input, screenshot, DOM,
console, network, and trace evidence does not require an adapter.

Run `npx @threenative/playtest init` to create a config, smoke scenario, and
adapter example without changing application source.

Pass chromium flags with `--browser-arg`, repeated once per flag. A WebGPU
target does not start without them:

```bash
npx @threenative/playtest playtests/movement.playtest.json \
  --url http://127.0.0.1:5173 \
  --browser-arg --enable-unsafe-webgpu \
  --browser-arg --enable-features=Vulkan
```

## What a passing run means

A scenario only reports `pass` when at least one assertion was evaluated
against an observation that actually arrived. Assertions fail closed: a missing
entity, an absent resource, an empty effect log, or a scenario with no
assertions at all is a failure, never a silent pass. Wrong-typed assertion
values are rejected when the scenario loads rather than dropped, so a scenario
cannot quietly run with fewer checks than its author wrote.
