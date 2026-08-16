<!-- schemaVersion: 1 -->

# The registry install path, end to end — 2026-08-16

PRD-119 Phase 2 and Phase 3. **Seven packages are published and a stranger can install ThreeNative
from `registry.npmjs.org` and build a game.** This file records what it took, including two
defects that only the clean room could have found.

No mobile-readiness, physical-device or iOS claim is made. The native runtime is published but its
prebuilt binaries are not — see *What is still broken*.

## What is live

| Package | Version |
|---|---|
| `@threenative/core` | 0.2.0 |
| `@threenative/playtest` | 0.2.0 |
| `@threenative/studio` | 0.2.0 |
| `@threenative/runtime-native` | 0.2.0 |
| `@threenative/physics` | **0.2.1** |
| `@threenative/ui` | **0.2.1** |
| `create-threenative` | **0.2.2** |

Published from this machine with `pnpm publish`, not from CI: the repository has no `NPM_TOKEN`
secret, so a tag push would have run the gates and then failed at the publish step — which is how
PRD-078's ten release tags died.

## The run a stranger makes

```console
$ npx --yes create-threenative@0.2.2 my-game --template starter --no-install
Created starter project at /home/joao/.cache/tn-tmp/final/my-game
Templates: minimal (smallest), starter (default), platformer. Choose with --template <name>.

$ cd my-game && npm install
(no ERESOLVE)

$ grep -cE '"(file|link):' package-lock.json
0

$ npm run build
✓ built in 440ms
```

Every `@threenative/*` entry in the lockfile resolves to `https://registry.npmjs.org/…`. **Zero
`file:` and zero `link:` specifiers** — that assertion is what separates this from
`verify-golden-path.ts`, which resolves packed tarballs by design and would have reported green
throughout everything below.

## Two defects the clean room found, and nothing else could have

### 1. `create-threenative@0.2.0` was a no-op

Installed from the registry it exited `0`, printed nothing, and created no project.

```console
$ npx --yes create-threenative@0.2.0 my-game --template starter
--- exit=0
--- contents of cwd:
.
..
```

The entry guard was:

```js
path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
```

A package manager installs a `bin` as a **symlink**, so the CLI runs as
`node_modules/.bin/create-threenative` while the module knows itself as `dist/index.js`.
`path.resolve` normalises a path but does not follow symlinks, so the comparison was never true
and `main()` never ran.

**Every existing test invoked `dist/index.js` by its real path** — the one arrangement in which
this bug is invisible. `packages/playtest` had the identical bug and fixed it with `realpathSync`;
`packages/studio` uses `invokedAsCli` for the same reason. `create-threenative` was the one that
never got the fix, and it is the first command in the documented golden path.

Fixed with `realpathSync`, and `packages/create-threenative/__tests__/cli-bin.spec.ts` now runs
the CLI through a symlink. Observed red against the published 0.2.0 build:

```console
× the installed CLI runs when its entry path traverses a package-manager symlink
AssertionError: the CLI produced no output through a symlink: expected 0 to be greater than 0
```

### 2. `@threenative/physics@0.2.0` and `@threenative/ui@0.2.0` could not be installed

```console
$ npm install
npm error ERESOLVE unable to resolve dependency tree
npm error Found: @threenative/core@0.2.0
npm error Could not resolve dependency:
npm error peer @threenative/core@">=0.1.0 <0.2.0" from @threenative/physics@0.2.0
```

Both declared a peer range on `@threenative/core` that **excluded the core released beside them**.
The range is hand-maintained and had to move with the release; nothing made it.

`pnpm publish:check` now refuses this. It is the same class as the three version literals the
0.2.0 bump broke — a hand-maintained value standing in for a property — and it is now the
preflight's job rather than a person's:

```console
$ pnpm publish:check
FAIL  @threenative/physics: @threenative/physics declares peer @threenative/core@'>=0.1.0 <0.2.0',
      which excludes the 0.2.0 being published beside it. Installing both fails with ERESOLVE.
FAIL  @threenative/ui: … same
2 finding(s). This tree must not be published as it stands.
```

Its range evaluator refuses a form it cannot parse rather than assuming `true`, and it implements
npm's 0.x caret rule (`^0.2.0` is `>=0.2.0 <0.3.0`, not `<1.0.0`) — guessing either would let the
preflight bless a range npm then rejects at install, which is the failure it exists to prevent.

### Why 0.2.1 was not enough for the CLI

`create-threenative@0.2.1` carried the CLI fix but shipped templates still pinning
`@threenative/physics@0.2.0`, because the templates were packed before physics was repaired. A
scaffold from it still hit ERESOLVE. `0.2.2` is the first version whose templates pin versions
that can actually be installed together — which is exactly why PRD-119 required template pins to
move in the same commit as the packages, and a lesson about ordering that the PRD did not state.

## What is still broken, and is not claimed fixed

- **The native runtime has no binaries.** `@threenative/runtime-native@0.2.0` is published, and its
  installer fetches prebuilts from a GitHub release tagged `runtime-native-v0.2.0`. **Zero releases
  exist.** It is an `optionalDependency` in every template, so `npm install` does not hard-fail —
  the web path works and the native path does not. That is PRD-078's lane.
- **Publishing happened from a laptop, not from CI.** `.github/workflows/npm-release.yml` is
  authored and has still never run. Until `NPM_TOKEN` exists as a repository secret, the reviewed
  lane cannot execute and releases stay manual.
- **`npm run dev` and `npm test` were not run in the clean room.** Scaffold, install and build were.
- **No claim that every template installs.** `starter` was the one exercised.
- **`0.2.0` of `create-threenative`, `physics` and `ui` are burned.** npm versions are immutable;
  those three are published and broken, and can only be deprecated, never replaced.

```alpha-bar
row: A2
status: pass
detail: npx create-threenative@0.2.2 scaffolds, npm install resolves every package from registry.npmjs.org with zero file:/link: specifiers, and npm run build succeeds.
source: npx --yes create-threenative@0.2.2 my-game --template starter && npm install && npm run build, in a directory with no workspace above it
```
