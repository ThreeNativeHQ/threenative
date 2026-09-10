# PRD-262 phase 2 — installed consumer builds without engine compilers

**Date:** 2026-09-10 (America/Vancouver).
**Status:** Local mechanics verified; **phase readiness BLOCKED**, independent review **PENDING**. This is not a public-release or native-platform acceptance record.
**Base:** `f947bae99` (PR #169, Phase 1). Package version `0.3.1`.

PRD: [matching public native runtime artifacts](../PRDs/production-readiness/PRD-262-the-runtime-native-prebuilt-release-exists.md).

## Scope and wiring

Engine distribution layer, not game code. Six files in this phase: the existing release
workflow, both packagers, the distribution suite, the coverage digest restamp (mechanically
required — the digest hashes every file under `packages/runtime-native/tests/`), and this
record. The restamp changes one hex line; no measured coverage or floor moved.

| Existing caller | Change and retained contract |
| --- | --- |
| `packages/runtime-native/scripts/package-desktop.mjs:resolveDesktopRuntime` | NEW resolver, WIRED: explicit `--runtime` keeps the original sync path; a missing `--runtime` installs from the release manifest via Phase 1 `installPrebuilt`; a set `THREENATIVE_RUNTIME_SOURCE` with no `--runtime` fails naming the override and its fix. `parseArgs` no longer requires `--runtime`, and `packageDesktop` delegates the missing-runtime branch to the resolver (review finding 2 fixed). The variable stays the decoder-preflight source only — it never selects the runtime binary. |
| `packages/runtime-native/scripts/package-android.mjs:packageAndroid` | NEW source-checkout guard before the wrapper/manifest checks: a resolved checkout without `{ allowSourceBuild: true }` fails naming the checkout and the opt-in. CLI gains `--allow-source-build` spelling the opt-in (review finding 3 fixed). The existing `THREENATIVE_RUNTIME_SOURCE` maintainer test still passes; the guard only fires when the resolved root actually is a checkout. |
| `.github/workflows/native-release.yml:clean-consumer` | Consumer job now asserts provenance: `install-status.json.ok === true` after install, no `CMakeLists.txt` in the consumer install before the Android build, and the toolchain log still absent after each build. Masking, SDK exposure, desktop launch, and emulator steps unchanged. |
| `packages/runtime-native/tests/distribution.test.mjs` | Four new consumer-gate tests (see below). All 32 pre-existing tests untouched and green. |
| `docs/verification/native-coverage-2026-08-28.md` | Source digest restamped (`e3325bf1…`), same method as PR #169's `988feab13`: the digest hashes every file under `packages/runtime-native/tests/`, so new Node tests invalidate it. No measured coverage changed; no floors moved. |

## Executed mechanics and negative controls

Environment: Linux x64, Node `v20.19.6`, worktree at Phase 1 base `f947bae99`. Fixture
releases served on loopback with synthetic payloads; no GPU adapter, rendered session,
Android device, or native gameplay was exercised. No tags, releases, or npm publications.

| Command/control | Exit | Observed result |
| --- | --- | --- |
| 4 new consumer-gate tests against ORIGINAL packagers (implementations stashed, tests kept) | 1 | 3 failed, 33 passed: desktop override silently ignored, android checkout guard absent (both variants). The explicit-runtime desktop test passed — it exercises unchanged behavior. |
| Restore implementations, rerun distribution suite | 0 | 36 passed (32 existing + 4 new) |
| `tests/desktop-assets.test.mjs` (preflight contract) | 0 | 8 passed |
| `tests/android-packaging.integration.test.mjs` (source-override + 404 contracts) | 0 | 5 passed |
| `tests/ios-packaging.test.mjs` | 0 | passed (in 62-test combined run) |
| Combined: distribution + desktop-assets + android-integration + ios-packaging | 0 | 62 passed, 0 failed |
| `pnpm lint` | 0 | 678 warnings (none in touched files), exit 0 |
| `pnpm budgets` (after build + digest restamp) | 0 | pass |
| `node --check` on both packagers + distribution suite | 0 | syntax accepted |
| YAML parse of `native-release.yml` | 0 | valid |
| `pnpm typecheck` | 2 | PRE-EXISTING red on clean tree (same 2 errors with changes stashed): `create-threenative/src/config.ts` missing `@threenative/assets`, `doctor.ts` missing `threenative-blender-mcp/bridge`. Unrelated to this phase; not introduced here. |

Selected retained output (red):

```text
FAIL tests/distribution.test.mjs > the desktop consumer gate fails closed on a source override with no runtime
FAIL tests/distribution.test.mjs > the android consumer gate fails closed on a source checkout without opt-in
FAIL tests/distribution.test.mjs > the android source-checkout failure names the prebuilt path, not the toolchain
Test Files 1 failed (1); Tests 3 failed | 33 passed (36)
```

Selected retained output (green):

```text
Test Files 3 passed (3); Tests 49 passed (49)   # distribution + desktop-assets + android-integration
Test Files 4 passed (4); Tests 62 passed (62)   # + ios-packaging
```

## Required gates not completed

- `pnpm typecheck` clean: blocked by the two pre-existing errors above, present on the
  untouched base. Not introduced by this phase; recorded, not fixed here (surgical rule).
- Prescribed `pnpm test`, full `pnpm test:playtest`, and affected hosted lanes
  (`clean-consumer` on `ubuntu-24.04`, iOS consumer): not run locally; the workflow edits
  are YAML-validated and the toolchain-mask assertions they add mirror the existing
  `test ! -e "$TN_TOOLCHAIN_LOG"` pattern, but only CI executes them.
- Required `engine_search_capabilities` preflight: executed (request-scope, verdict
  `matched`); no packager/distribution symbol constrains this change — the hits concern
  React overlays, playtest runners, and render passes, none of which this phase touches.
  Implementation reuses the PRD's named packagers and installer rather than a parallel path.
- Real PRD-078 exact-SHA outputs, PRD-221 Android inputs, public manifest/artifact
  URL/status/hash verification, and registry-installed (non-workspace) consumer proof:
  not executed. Fixture payloads are synthetic (`payload:<key>`); no public acceptance
  credit is claimed.
- Independent Phase 2 review decision: first round returned **NEEDS CORRECTION**
  (dead-code resolver, missing android CLI opt-in, six-vs-five file budget). All three
  were fixed: resolver wired through `parseArgs` + `packageDesktop`, `--allow-source-build`
  added, record counts six files. Re-review of the fixes: **PENDING**.
  No self-awarded PASS.

## Review checkpoint and remaining work

Before phase 2 can close: run the required repository gates and hosted `clean-consumer`
lane on a real candidate SHA, bind real PRD-078/PRD-221 inputs, verify every public
manifest URL/status/hash without credentials, and obtain the PRD's independent review
decision. PRD-060 retains publication and default-tag closure.

No PRD acceptance box is checked by this record. This record supplies reproducible
mechanics, not release readiness.
