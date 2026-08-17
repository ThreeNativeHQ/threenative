# Contributing

## Setup

Install Node 20 and pnpm, then run:

```sh
pnpm install --frozen-lockfile
```

Native compilation is opt-in. The default gate needs no CMake, NDK, or Xcode.

Third-party runtime provenance is recorded in [`packages/runtime-native/NOTICE`](packages/runtime-native/NOTICE).

## The gate

Before opening a pull request, run:

```sh
pnpm typecheck && pnpm lint && pnpm test
```

`pnpm lint` prints roughly 215 warnings on a clean tree. Only errors fail the build, so read the
error count rather than the warning count.

## Tests are not optional

Add a unit test in `<package>/__tests__/*.spec.ts` for every change. A change with runtime
behaviour also needs a playtest scenario. Add the test in the same commit as the change.

## Where a change goes

See [`AGENTS.md`](AGENTS.md) for the complete contributor instructions. Route additions here:

| What you are adding | Where it belongs |
| --- | --- |
| Anything a screenshot shows — materials, shaders, TSL, lights, tonemapping, post, camera framing | `packages/create-threenative/templates/*/src/render/`, as generated user source |
| Gameplay | an example or a template — never a package |
| Plumbing every game repeats and no game should write | `packages/core/src/` |
| Physics or navigation (carries the WASM dep) | `packages/physics/src/` |
| React HUD/menu bindings (carries the React dep) | `packages/ui/src/` |
| C++ host, platform bring-up, native systems | `packages/runtime-native/` |
| Scenario harness / assertions | `packages/playtest/` |
| Proof that any of it works | `<package>/__tests__/*.spec.ts` and a playtest scenario |

## Rules that close a pull request

If a competent developer could write it in under 20 lines, keep it in the example or template
instead of adding it to the framework.

Anything a screenshot shows belongs in generated `src/render/` source, not in framework package
code or a framework option.

`CLAUDE.md` files are generated: edit `AGENTS.md`, then run `pnpm sync:agents`; CI reverts a
hand-edited mirror.

The project will not accept an IR, a scene format, an editor, a preset system, a code-first ECS,
or a bespoke CLI vocabulary. These decisions are closed with evidence and are not reopened in a
pull request.

## Licence

By contributing, you agree that your contribution is licensed under the MIT licence. Do not
introduce a CLA.
