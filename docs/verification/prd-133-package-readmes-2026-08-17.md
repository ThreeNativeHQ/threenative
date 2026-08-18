# PRD-133 package README evidence — 2026-08-17

The three missing package pages now exist, and all six publishable package manifests explicitly
carry their root `README.md` when they use a `files` list. The README-specific guard and tarball
proof are green.

## Acceptance

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm publish:check` | **Exit 1**, because four pre-existing stale-version findings remain. The run produced no README finding. |
| 2 | Delete `packages/core/README.md`, then run `pnpm publish:check` | **Observed red**, naming `@threenative/core` as missing `README.md`; exit 1. |
| 3 | Restore the README, set `packages/core` `files` to `["dist"]`, then run `pnpm publish:check` | **Observed red**, naming the `files` list and `README.md`; exit 1. |
| 4 | `pnpm --filter <package> exec npm pack --dry-run` for all six packages | **Exit 0** for every package; output excerpts are pasted below and each lists `README.md`. |
| 5 | `pnpm test` | **Exit 0**; root Vitest 133 files / 1,194 tests, runtime-native Vitest 47 files / 308 passed / 37 skipped, and Rust physics parity 1 passed. |

Criterion 1 is not green in this checkout because the existing publish preflight reports source
drift for versions already on npm. Those findings are unrelated to README packaging:

```text
FAIL  @threenative/core: ... source has 1 commit(s) since ... bump it.
FAIL  @threenative/playtest: ... source has 1 commit(s) since ... bump it.
FAIL  @threenative/runtime-native: ... source has 1 commit(s) since ... bump it.
FAIL  create-threenative: ... source has 3 commit(s) since ... bump it.
4 finding(s). This tree must not be published as it stands.
```

The positive run has no `README.md` finding after adding the manifest entries. The targeted guard
spec passes 17/17 tests.

## Negative controls

Deleting the core page produced this additional finding:

```text
FAIL  @threenative/core: @threenative/core is missing README.md, so its npm page would have no package documentation.
```

Restoring the page but reverting its manifest produced this additional finding:

```text
FAIL  @threenative/core: @threenative/core has a files list ["dist"] that does not include README.md, so npm would omit it.
```

Both controls were restored before the tarball and test runs.

## Tarball proof

The following are the `npm notice` lines from each `pnpm --filter ... exec npm pack --dry-run`
run. Every command exited 0.

```text
$ pnpm --filter @threenative/core exec npm pack --dry-run
npm notice 📦  @threenative/core@0.2.0
npm notice 1.3kB README.md
npm notice total files: 10
```

```text
$ pnpm --filter @threenative/ui exec npm pack --dry-run
npm notice 📦  @threenative/ui@0.2.1
npm notice 1.4kB README.md
npm notice total files: 4
```

```text
$ pnpm --filter @threenative/runtime-native exec npm pack --dry-run
npm notice 📦  @threenative/runtime-native@0.2.0
npm notice 1.1kB README.md
npm notice total files: 26
```

```text
$ pnpm --filter create-threenative exec npm pack --dry-run
npm notice 📦  create-threenative@0.2.2
npm notice 615B README.md
npm notice total files: 320
```

```text
$ pnpm --filter @threenative/physics exec npm pack --dry-run
npm notice 📦  @threenative/physics@0.2.1
npm notice 925B README.md
npm notice total files: 9
```

```text
$ pnpm --filter @threenative/playtest exec npm pack --dry-run
npm notice 📦  @threenative/playtest@0.2.0
npm notice 2.2kB README.md
npm notice total files: 14
```
