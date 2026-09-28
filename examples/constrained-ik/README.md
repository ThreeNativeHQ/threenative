# Constrained IK grip

Proves the opt-in IK adapter at `examples/integrations/ik/src/constrained-ik.ts` works inside a real
ThreeNative game: a bone hierarchy, an `AnimationMixer` idle clip, and a rifle pose that sweeps
every frame, with both hands solved onto it as full 6-DOF effectors. The scene publishes the
adapter's own measurements on the `ik` entity and `playtests/` reads them off a running frame:
residual in metres and radians, and the largest bone-length change a solve caused.

## Running

```sh
pnpm install                                            # repository root
pnpm --filter constrained-ik run setup                  # the adapter's nested npm deps
pnpm --filter constrained-ik run check                  # tsc --noEmit, adapter source included
node packages/playtest/dist/runner/cli.js examples/constrained-ik/playtests/grip.playtest.json \
  --url http://127.0.0.1:5199 \
  --server-command "pnpm --filter constrained-ik exec vite --host 127.0.0.1 --port 5199 --strictPort" \
  --browser-recipe webgpu
```

`build:web` builds the browser bundle, `build:desktop` the native host's single import-free ESM
file; `grip.desktop.playtest.json` is the same scenario for `--target desktop|android`.

## Why no `build` or `typecheck` script

The root runs `pnpm -r --if-present run build|typecheck` and CI installs the workspace without the
adapter's nested npm dependencies, so a script under either name would be collected by that
recursive run and fail on a dependency CI never installed. `check` is the same `tsc --noEmit`.
`vite.config.ts` dedupes `three` — the adapter imports it beside itself, and a second copy breaks
`instanceof Bone` against the game's bones — and serves the repository root, because the adapter is
imported by relative path rather than as a dependency.
