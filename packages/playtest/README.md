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
