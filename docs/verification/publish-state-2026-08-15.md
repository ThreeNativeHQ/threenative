<!-- schemaVersion: 1 -->

# Publish state — PRD-119 Phase 0 — 2026-08-15

The red, recorded before anything is changed. **No package was published, no version was bumped and
no workflow was run by this document.** Every command is pasted with its output. The registry was
reached with the repository-local `.npmrc` passed as `--userconfig`; its contents are neither read
nor printed anywhere in this file.

Phase 0's stop rule: *if `npm create threenative` unexpectedly succeeds, stop — the premise of the
PRD is wrong.* It did not succeed. The premise holds.

## The five commands

```console
$ npm view create-threenative version
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/create-threenative - Not found

$ npm view @threenative/studio version
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@threenative%2fstudio - Not found

$ npm view @threenative/runtime-native version
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/@threenative%2fruntime-native - Not found

$ npm view @threenative/core version time.created
version = '0.1.0'
time.created = '2026-08-09T07:32:33.145Z'
```

The fifth was run from `/home/joao/.cache/tn-tmp`, outside any checkout of this repository:

```console
$ npm create threenative@latest alpha-probe
npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/create-threenative - Not found
npm error 404  The requested resource 'create-threenative@latest' could not be found or you do not
npm error 404  have permission to access it.

$ ls -la alpha-probe
ls: cannot access 'alpha-probe': No such file or directory
```

**The first command of the documented golden path 404s and creates nothing.** That is alpha row A1,
observed rather than asserted.

## The full seven, as of this run

| Package | Workspace version | Registry | State |
|---|---|---|---|
| `@threenative/core` | 0.1.0 | 0.1.0 | published, stale |
| `@threenative/physics` | 0.1.0 | 0.1.0 | published, stale |
| `@threenative/playtest` | 0.1.0 | 0.1.0 | published, stale |
| `@threenative/ui` | 0.1.12 | 0.1.12 | published, stale |
| `create-threenative` | 0.1.0 | **404** | never published |
| `@threenative/studio` | 0.1.0 | **404** | never published |
| `@threenative/runtime-native` | 0.1.14 | **404** | never published |

Reproduced by `pnpm alpha:bar`, which asks the same question as a gate rather than a table:

```console
$ pnpm alpha:bar | sed -n '/^A1/,+2p'
A1  fail        A stranger can install it from the public registry
    3 of 7 publishable package(s) are absent from the registry: @threenative/runtime-native, @threenative/studio, create-threenative.
    evidence: npm view <package> versions --json
```

## How far behind the published four are

PRD-119 §1 measured 83 commits and 649 changed files on 2026-08-15. Re-measured at `HEAD` on the
same day, after the day's work landed:

```console
$ git log --oneline --since=2026-08-09T07:32:33Z -- packages/ | wc -l
144
$ git diff 524db742 HEAD -- packages/ --shortstat
 669 files changed, 55605 insertions(+), 3009 deletions(-)
```

The number moves every hour the tree does; the finding does not. **A stranger installing today gets
the framework as it stood before the batch that exists to make it trustworthy.**

The two `0.1.0`s are not the same software, which is checkable without trusting a commit count:

```console
$ npm view @threenative/core dependencies
{ three: '0.185.1', zustand: '5.x' }
$ node -e "console.log(JSON.stringify(require('./packages/core/package.json').dependencies))"
{"three":"catalog:","three-mesh-bvh":"catalog:","zustand":"catalog:"}
```

`three-mesh-bvh` is absent from the published manifest. Same name, same version string, different
dependency set — so this is different software, not an older build of the same software. npm does
not permit republishing a version that exists, and the 72-hour unpublish window on `0.1.0` closed
2026-08-12. There is no overwrite path, only a bump.

The published manifest also carries **resolved** versions where the workspace carries `catalog:`,
which proves the 2026-08-09 publish went through `pnpm publish`. Phase 2 must do the same: a raw
`npm publish` would leak `catalog:` into the manifest and break every install.

## What was not done

- **Nothing was published.** Phase 2 is the one irreversible step in the batch and it does not run
  without an owner's approval of the exact version numbers. The owner's answer on 2026-08-15 was
  *preflight only, stop before publish*, so this lane stops after Phases 0, 1 and the Phase 3 gate.
- **No version field was bumped.** The `0.2.0` decision recorded in PRD-119 §1 is not applied here;
  applying it is part of the publishing commit.
- **No workflow was triggered.** `.github/workflows/npm-release.yml` is authored and never run; a
  `v*` tag push is what would run it, and none was pushed.
- **No claim is made that publishing would succeed.** The preflight says the tree is *ready* to
  publish. Only a publish proves a publish.
