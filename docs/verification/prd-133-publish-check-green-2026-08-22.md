# PRD-133 publish-check green — 2026-08-22

Closes acceptance criterion 1. The three READMEs, tarball inclusion and the README guard were
proven on 2026-08-17 (`prd-133-package-readmes-2026-08-17.md`); this run retires the five
stale-version findings that kept `pnpm publish:check` red.

## What changed

- `@threenative/{core,physics,playtest,runtime-native,ui}` move to `0.3.0`; the sibling peer
  ranges (`ui`→`core`, `physics`→`core`, `core`→`playtest`) move to the `>=0.3.0 <0.4.0` line.
- `threenative-engine-mcp` joins `.github/workflows/npm-release.yml`'s publish-set list. It was
  the sixth finding: publishable, non-private, never named. It has never been published
  (`npm view threenative-engine-mcp version` → E404), so its manifest stays `0.2.0`.
- The seven template manifests pin what the next release will actually ship (`0.3.0`); they are
  not workspace projects and resolve only through local tarballs in tests or the registry after
  a release. `examples/prd162-replay` keeps its published-version pins because it *is* a
  workspace project resolved against npm today.
- Derived surfaces carried along: root README version rows, `packages/core/src/index.ts`
  version literal (caught by `build.spec.ts`), regenerated CLAUDE.md mirrors.

## Acceptance

| # | Command | Result |
| --- | --- | --- |
| 1 | `pnpm publish:check` | **Exit 0**, pasted below |
| 2 | delete `packages/core/README.md`, re-run #1 | **Observed red**, naming `@threenative/core`, exit 1; restored after |
| 3 | restore it, set core `files` to `["dist"]`, re-run #1 | **Observed red**, naming the `files` list, exit 1; restored after |
| 4 | `pnpm -r --filter "./packages/*" exec npm pack --dry-run` | **Exit 0** for all seven packages; every tarball lists `README.md` |
| 5 | `pnpm test` | **Exit 0**: root Vitest 181 files / 1,703 tests passed, runtime-native 50 files / 330 passed / 37 skipped, engine parity suite 24 passed |

Gates: `pnpm typecheck` exit 0; `pnpm lint` exit 0 (271 pre-existing warnings, the standing
baseline).

### Criterion 1 — green

```text
Checked 7 package(s): @threenative/core, @threenative/physics, @threenative/playtest, @threenative/runtime-native, @threenative/ui, create-threenative, threenative-engine-mcp
Every package is ready to publish.
```

### Criterion 2 — mutation: delete packages/core/README.md

```text
FAIL  @threenative/core: @threenative/core is missing README.md, so its npm page would have no package documentation.
1 finding(s). This tree must not be published as it stands.
```

### Criterion 3 — mutation: revert packages/core/package.json `files` to ["dist"]

```text
FAIL  @threenative/core: @threenative/core has a files list ["dist"] that does not include README.md, so npm would omit it.
```

### Criterion 4 — tarball proof

```text
npm notice 📦  threenative-engine-mcp@0.2.0     README.md present, total files: 2
npm notice 📦  @threenative/playtest@0.3.0      README.md present (3.0kB), total files: 2
npm notice 📦  @threenative/core@0.3.0          README.md present (1.3kB), total files: 11
npm notice 📦  @threenative/runtime-native@0.3.0 README.md present (1.1kB) + android/README.md, total files: 27
npm notice 📦  @threenative/physics@0.3.0       README.md present (925B), total files: 2
npm notice 📦  @threenative/ui@0.3.0            README.md present (2.0kB), total files: 2
npm notice 📦  create-threenative@0.2.3         README.md present (875B), total files: 343
```

### Criterion 5 — full suite

```text
Test Files  50 passed (50)
Tests  330 passed | 37 skipped (367)      ← runtime-native vitest
Test Files   1 passed (1)
Tests       24 passed (24)                ← native parity contract suite
Test Files  181 passed (181)
Tests  1703 passed (1703)                 ← root vitest
suite temporary directory count unchanged: 64
```

## Pre-existing defects found and fixed en route

Both were red at HEAD before this lane started and both are engine-side
(`packages/runtime-native/tests/`), unrelated to README packaging; without them criterion 5
could not go green anywhere.

1. **`parity-contract.test.mjs` did not parse.** A bare `});` after its last test block (landed
   in compacted batch run 8) killed the whole file at import:

   ```text
   Error: Failed to parse source for import analysis because the content contains invalid JS syntax.
     File: packages/runtime-native/tests/parity-contract.test.mjs:290:0
    289 |    });
    290 |    });
        |    ^
   ```

2. **Nested conformance runners registered their own parity lease.** Each spawned
   `run-conformance.mjs` believed it was the outermost lane and called
   `worktree-lifecycle.ts register --phase parity`. Under the suite wrapper the live test-phase
   lease refuses them, so seven tests failed whenever the suite ran whole:

   ```text
   FAIL tests/conformance-runner.test.mjs > dry run validates and bundles implemented rows ...
   Error: Command failed: pnpm exec tsx scripts/worktree-lifecycle.ts register --phase parity ...
   TN_WORKTREE_OWNED: worktree is already owned by joao@joao-cachyos (pid 1055577)
   ```

   Fix: test-spawned runners set `TN_GATE_NESTED=1`, matching the runner's own rule that nested
   lanes are covered by their parent's single record. Verified the spec passes 41/41 standalone
   before and after.

One flake observed once and not reproduced: playtest's orphan-cleanup gate caught Chromium
renderers still shutting down from earlier phases mid-suite; the identical phase passed alone
immediately after, and the final full-suite run was clean.

## What this does not claim

No republish happened; npm pages update at the next `pnpm release`. Nothing was measured on
native or in a browser — no runtime behaviour changed.
