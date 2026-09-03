# Contributing to ThreeNative

Thanks for being here. Issues, discussions, docs fixes and pull requests are all welcome, and a
first contribution does not have to be code.

- **Found a bug?** [Open an issue](https://github.com/ThreeNativeHQ/threenative/issues/new/choose)
  with the reproduction — a scenario file or a scaffolded project beats a description.
- **Have a question or an idea?**
  [Start a discussion](https://github.com/ThreeNativeHQ/threenative/discussions).
- **Wondering what needs doing?** [`docs/CURRENT-CHALLENGES.md`](docs/CURRENT-CHALLENGES.md) is
  the honest list of what the framework does not yet do well, and what the plan is for each.
- **Found a security issue?** Follow [`SECURITY.md`](SECURITY.md) instead of opening an issue.

## Setup

Node 20.19+ and pnpm 10+:

```sh
pnpm install --frozen-lockfile
```

Native compilation is opt-in — the default gate needs no CMake, NDK, or Xcode. Third-party runtime
provenance is recorded in [`packages/runtime-native/NOTICE`](packages/runtime-native/NOTICE).

There is no root `pnpm dev`. Run an example by name: `pnpm --filter abyss-framework dev`.

## The gate

Before opening a pull request:

```sh
pnpm typecheck && pnpm lint && pnpm test
```

`pnpm lint` prints several hundred warnings on a clean tree; only errors fail the build, so read
the error count. If a package's types look stale against a change you did not make, rebuild it —
templates and examples typecheck against `dist/`.

## Tests are not optional

Add a unit test in `<package>/__tests__/*.spec.ts` for every change, in the same commit. A change
with runtime behaviour also needs a playtest scenario, which drives the real build and asserts what
happened.

For a bug fix, write the failing test first and include both the red and the green in the pull
request. A fix with no test that would have caught it is not finished.

## Where a change goes

See [`AGENTS.md`](AGENTS.md) for the complete conventions. In short:

| What you are adding | Where it belongs |
| --- | --- |
| Anything that decides how it looks — materials, shaders, TSL, lights, tonemapping, post, camera framing | `packages/create-threenative/templates/*/src/render/`, as generated user source |
| Gameplay | an example or a template — never a package |
| Plumbing every game repeats and no game should write | `packages/core/src/` |
| Physics or navigation (carries the WASM dep) | `packages/physics/src/` |
| React HUD/menu bindings (carries the React dep) | `packages/ui/src/` |
| C++ host, platform bring-up, native systems | `packages/runtime-native/` |
| Scenario harness / assertions | `packages/playtest/` |
| Proof that any of it works | `<package>/__tests__/*.spec.ts` and a playtest scenario |

Two questions decide whether something belongs in the framework at all, and they are the
[Charter](docs/architecture/CHARTER.md)'s, not a size limit:

1. **Could a game write this portably itself?** If no — it needs a browser global, a platform seam,
   or a backend the game must not know it got — the framework can own it, at any size.
2. **Does it decide how anything looks?** If yes, it ships as generated source in `src/render/`, at
   any size. This one is a veto.

## Things that will close a pull request

- Anything that decides how a frame looks, added to package code or a framework option.
- A hand-edited `CLAUDE.md`. Those files are generated: edit `AGENTS.md`, then run
  `pnpm sync:agents`.
- An IR, a scene format, an editor, a preset/genre system, a code-first ECS, or a bespoke CLI
  vocabulary. These are closed with evidence and are not reopened in a pull request.

None of these are judgements about the code — they are boundaries the project has already paid to
learn. If you think one is wrong, open a discussion rather than a pull request; the Charter can be
amended, and [`docs/architecture/CHARTER-HISTORY.md`](docs/architecture/CHARTER-HISTORY.md) shows
that it has been.

## Code of Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

By contributing, you agree that your contribution is licensed under the MIT licence. There is no
CLA.
