# PRD-262 phase 3 — the published release carries the desktop build tool helper

**Date:** 2026-09-11 (America/Vancouver).
**Status:** Local mechanics verified with an observed red control; **phase readiness BLOCKED on hosted execution**, independent review **PENDING**. This is not a public-release acceptance record — no release, tag, publication or registry state was mutated.
**Base:** `7e6dffc1e7d67908d0ceb43388db45bb2d16964b` (`main`). Implementation commit `93ac0ce21073e2f7c6506f80c84a5e0338e3a1e1` on `fix/prd-262-publish-build-tool-helper`. Package version `0.3.1`. Node `v20.19.6`, pnpm `10.25.0`, Linux.

PRD: [matching public native runtime artifacts](../PRDs/production-readiness/PRD-262-the-runtime-native-prebuilt-release-exists.md).

## The gap this phase closes

`packages/runtime-native/src/cli/tool_dispatch.cpp:52` dispatches `threenative build --target desktop`
to a `mystral-tools` binary resolved from the runtime executable's own directory. `native:build`
produces it. The release build matrix staged only `release/<runtime asset>`, and
`PREBUILT_ASSET_NAMES` declared no tools asset, so **no release has ever published it**. A public
consumer that installed `@threenative/runtime-native` from a release could not build desktop at all:

```text
Error: build tool helper is missing: .../@threenative/runtime-native/prebuilt/linux-x64/mystral-tools
Runtime packager exited with code 127.
```

PR #180 (PRD-078) worked around this by downloading the helper as a same-run artifact
(`tools-linux-x64`) and `install`-ing it beside the runtime before the consumer build, and recorded
that publishing it is PRD-262's contract. This phase publishes it, and removes the workaround so the
consumer job proves the published path rather than its own artifacts.

## Scope and wiring

Engine distribution layer, not game code. Five files: the asset map and installer, the release
workflow, both affected suites, and this record.

| Existing caller | Change and retained contract |
| --- | --- |
| `packages/runtime-native/scripts/install-prebuilt.mjs:13` `PREBUILT_ASSET_NAMES` | Three new keys — `linux-x64-tools`, `darwin-arm64-tools`, `win32-x64-tools` → `threenative-tools-linux-x64`, `threenative-tools-darwin-arm64`, `threenative-tools-win32-x64.exe`. They are non-iOS keys, so `validateReleaseManifest`'s existing default `requiredKeys` rejects a candidate that omits any of them before a desktop artifact is selected, and `generateReleaseManifest`'s exact-directory check rejects a release staged without them. |
| `packages/runtime-native/scripts/install-prebuilt.mjs:installPrebuilt` | Downloads the runtime and then its matching helper, and publishes both through the same atomic path. `publishBinary` owns its own temp name (the single `temporary` the function used before could not serve two outputs). The success marker is written only after both binaries land, so a runtime present with no helper can no longer carry `ok: true`. |
| `packages/runtime-native/scripts/install-prebuilt.mjs:isVerifiedInstall` | Reuse now requires `status.toolsSha256`, a present non-empty helper, a checksum match, and — when a local lock pins it — agreement with the pinned `sha256`/`size`. A cached runtime whose helper was deleted is re-installed rather than reused. |
| `packages/runtime-native/scripts/install-prebuilt.mjs:beginInstall` / `recordInstallFailure` | Both now remove the helper alongside the runtime, so a failed install or retry leaves neither binary usable. |
| `.github/workflows/native-release.yml:291` `build` matrix | Each desktop row gains `tools_asset`. The staging step copies both executables into `release/`, and the `runtime-${{ matrix.key }}` upload carries both with `if-no-files-found: error`. The separate `tools-${{ matrix.key }}` artifact is gone. `publish` and `gates` already collect `pattern: runtime-*` with `merge-multiple`, so both the public lock and the same-run proof lock are generated from the complete set with no further change. |
| `.github/workflows/native-release.yml:clean-consumer` | The "Place the same-run build tool helper" step and its `install -m 0755` line are removed. The job now asserts `test -x .../prebuilt/linux-x64/mystral-tools` **before** `build --target desktop`, so the helper can only come from the release the install just read. A regression in what the release publishes now fails this job instead of being masked. |
| `packages/runtime-native/tests/distribution.test.mjs` | Three new tests (below) and four fixtures updated to advertise the helper the cohort now requires. All pre-existing tests untouched in substance and green. |
| `scripts/__tests__/native-release-proof.spec.ts:582` | The workaround assertions are replaced by their durable counterparts, including two `assert.doesNotMatch` guards that fail if the same-run placement ever returns. |

## Required tests

- `a desktop install places the dispatched build tool helper beside the runtime` — the helper lands
  at the path `tool_dispatch.cpp:52` resolves, and the status marker records both checksums.
- `a missing or corrupt build tool helper leaves no usable runtime and no success marker` — two
  cases: the helper absent from the candidate, and advertised with a checksum its bytes fail. Both
  leave no runtime, no helper and `ok: false`.
- `a cached runtime without its verified helper is never reused` — a `reuse: true` install with the
  helper deleted restores it instead of returning a runtime the packager would die on.
- `a packed consumer runs the allowlisted install hook and verifies its download` (pre-existing)
  gained an assertion that the packed postinstall places the helper.

## Observed red control and restored green

The implementation was committed, then `install-prebuilt.mjs` and `native-release.yml` were reverted
to `main` with the tests kept, and both suites re-run:

```text
git checkout main -- packages/runtime-native/scripts/install-prebuilt.mjs .github/workflows/native-release.yml

pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs
  Tests  4 failed | 35 passed (39)
  FAIL  a packed consumer runs the allowlisted install hook and verifies its download
    Error: ENOENT: no such file or directory, open
      '/tmp/threenative-consumer-eWGDuu/consumer/node_modules/@threenative/runtime-native/prebuilt/linux-x64/mystral-tools'
  FAIL  a desktop install places the dispatched build tool helper beside the runtime
  FAIL  a missing or corrupt build tool helper leaves no usable runtime and no success marker
  FAIL  a cached runtime without its verified helper is never reused
    TypeError: toolsFilename is not a function

pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts
  Tests  1 failed | 34 passed (35)
  FAIL  the consumer gets the build tool helper the runtime dispatches to
    AssertionError: The input did not match the regular expression /tools_asset: threenative-tools-linux-x64/u
```

The packed-consumer `ENOENT` is the behavioural red: a real `pnpm install` of the packed tarball
produced a runtime with no helper beside it. The three `toolsFilename is not a function` rows are
import-level reds and are reported as such, not as behavioural proof.

Restored (`git checkout HEAD -- <both files>`):

```text
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs
  Test Files  1 passed (1)   Tests  39 passed (39)

pnpm exec vitest run scripts/__tests__/native-release-proof.spec.ts
  Test Files  1 passed (1)   Tests  35 passed (35)
```

## Gates run

| Command | Result |
| --- | --- |
| `pnpm build` | exit 0 |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 (694 warnings, all pre-existing on `main`) |
| `pnpm exec vitest run scripts/__tests__/` | 107 files, 1257 passed, 1 skipped, 0 failed |
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/distribution.test.mjs tests/ios-packaging.test.mjs tests/native-platform-workflow.test.mjs tests/dependency-provenance.test.mjs tests/native-sbom.test.mjs` | 97 passed, 0 failed |
| `pnpm exec vitest run scripts/__tests__/release-candidate-gate.spec.ts` | 18 passed — the resolver derives its GitHub subject set from the asset map, so the three new assets extend it with no fixture edit |
| `pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts tests/native-coverage-digest-scope.test.mjs tests/native-coverage.test.mjs tests/native-coverage-generator.test.mjs` | 25 passed — `distribution.test.mjs` is outside the C++ digest scope, so no restamp is required this time |
| `pnpm budgets` | exit 0, `budgets ok`. The four `native census drift` rows reproduce identically on unmodified `main` and are not from this diff. |

**Not run, and why.** The whole-package `runtime-native` suite reports 21 failures across seven
files (`conformance-runner`, `crash-handler-policy`, `production-profile`, `pump-silence`,
`rg11b10-renderable`, `runtime-next-contract`, `timestamp-query`). Every one fails with
`… is not built. Run: cmake --build build/tn-linux --target …` — this worktree has no compiled
native host, and this diff contains no C++. They are not evaluated as evidence either way.
No playtest lane applies: nothing here changes runtime behaviour in a game.

## The published cohort was narrowed to what ships unsigned

Added in the same phase, after the blocker recheck showed the gate demanded credentials for signing
steps this repository does not contain (see the PRD's *Blocker recheck*, and
[`docs/RELEASE-SIGNING.md`](../RELEASE-SIGNING.md)).

`UNPUBLISHED_PREBUILT_KEYS` now holds `darwin-arm64` and `darwin-arm64-tools`. Linux, Windows and
Android publish unsigned; iOS keeps its separate existing gate, untouched. Windows ships unsigned by
the owner's decision: SmartScreen warns on an unsigned download, Gatekeeper refuses one, and only the
macOS reasoning (a Node `fetch()` sets no `com.apple.quarantine` attribute, so the prebuilt is never
evaluated) is unexecuted on real hardware.

The macOS row still builds and verifies on every release run; it uploads under a name the `publish`
and `gates` jobs do not collect, so it is never staged. `releaseFromManifest` refuses those keys with
a named `PREBUILT_RELEASE_UNPUBLISHED` code, and the postinstall treats it like an unpublished
release — warn and continue — rather than failing the whole install.

Covered by `macOS is built but unpublished, and says so instead of 404ing`, which pins the exact
unpublished set, asserts Windows is in the published set, and asserts Linux and Android stay
downloadable from the same candidate. Suite: 40 passed.

## What this phase does not prove

The claim supported is **"the release cohort now contains the helper, and the install places it"**,
proven by unit and packed-consumer mechanics on Linux. It is **not** "a public installation works":

- The hosted `clean-consumer` job has not run on this branch. It is the gate that executes the
  desktop build with every native compiler masked against a real staged cohort.
- `darwin-arm64` and `win32-x64` tools assets are declared and staged but have never been built or
  downloaded; only `linux-x64` was exercised locally.
- No release publishes them yet. See the PRD status for the credential blocker that owns that.
