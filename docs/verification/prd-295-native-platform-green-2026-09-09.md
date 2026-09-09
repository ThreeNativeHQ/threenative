# PRD-295 — native platform lane repair

Date: 2026-09-09. Source branch: `codex/prd-295-native-platform-green`.

## Defect and owning layer

This is an engine and CI defect. The Linux starter lane links native PIE executables against SDL3's
static archive. SDL3 contributed a non-PIC `SDL_appid.c.o` member, so Ubuntu's linker rejected the
archive when `mystral-tools` was linked:

```text
/usr/bin/ld: sdl3-build/libSDL3.a(SDL_appid.c.o): relocation R_X86_64_PC32 against absolute symbol SDL_appid.c in section .eh_frame is disallowed
```

The failure was recorded from Actions run `34394025867`, job `102610028946`, in the
`Build and pack the scaffold dependencies` step. The local fix sets
`POSITION_INDEPENDENT_CODE ON` on both `SDL3-static` and `SDL_uclibc` after SDL3 is added to the
native build. The second target contributes objects to the same archive and must carry the same
property.

The CI ownership defect was separate: the native workflow had direct event triggers and was
advisory, while the primary `ci.yml` board did not require it. The native workflow now exposes
`workflow_call`; `ci.yml` invokes it as the `native-platforms` job after the shared scope decision,
and the run summary reports that job. Push, pull-request, and nightly scheduling remain owned by
`ci.yml`, so the matrix is not run twice.

The first hosted run of that required lane, Actions run `34400099680` at `f89f80e7`, exposed a
second Linux-only failure after the original SDL linker error was fixed. The scaffolded starter
desktop leg failed while linking `mystral-tools` with the same `SDL_appid.c.o` relocation; its
restored compiler cache contained an object compiled before the PIC fix because the restore-key
prefix ignored the CMake input hash. The completed macOS and Windows legs passed. The hosted
`budgets` leg also rejected the run because adding this evidence file made the committed retention
index stale; regenerating the index is included below. Android and iOS were still running when
this record was first updated.

The follow-up fix makes the Linux preset explicitly position independent and adds the same
`hashFiles(CMakeLists.txt, CMakePresets.json, **/*.cmake)` expression to every native compiler-cache
restore prefix in `ci.yml` and `native-platforms.yml`. This prevents a cache entry built against a
different native configuration from being selected as a warm starting tree.

## Red controls

Each mutation was restored before the green run.

### SDL archive regression

Temporary mutation: remove the two `set_target_properties(... POSITION_INDEPENDENT_CODE ON)` blocks
from `packages/runtime-native/CMakeLists.txt`.

```text
$ pnpm --filter @threenative/runtime-native exec vitest run tests/native-platform-workflow.test.mjs
Test Files  1 failed | 0 passed
Tests       1 failed | 17 passed
```

The failing assertion named the missing PIC configuration. Restoring the blocks made the test pass.

For the follow-up fix, the temporary mutation removed `CMAKE_POSITION_INDEPENDENT_CODE` from the
`tn-linux` preset and removed the CMake hash from every native compiler-cache restore key.

```text
$ pnpm --filter @threenative/runtime-native exec vitest run tests/native-platform-workflow.test.mjs
Test Files  1 failed | 0 passed
Tests       2 failed | 18 passed
```

The failures named the missing Linux PIC preset and the unqualified native cache restore keys.
Restoring both controls made the suite pass with 20/20 tests.

### Required workflow regression

Temporary mutation: remove the `native-platforms` reusable job from `.github/workflows/ci.yml`.

```text
$ pnpm --filter @threenative/runtime-native exec vitest run tests/native-platform-workflow.test.mjs
Test Files  1 failed | 0 passed
Tests       1 failed | 18 passed
```

The failing assertion named the absent required native job. Restoring the job and its
`run-summary.needs` entry made the test pass.

## Green evidence

The focused regression suite passed after both fixes:

```text
$ pnpm --filter @threenative/runtime-native exec vitest run tests/native-platform-workflow.test.mjs tests/starter-desktop.test.mjs
Test Files  2 passed (2)
Tests       38 passed (38)
```

The CI structure, dependency ordering, and primary-document contracts passed:

```text
$ pnpm exec vitest run scripts/__tests__/ci-structure.spec.ts scripts/__tests__/ci-needs.spec.ts scripts/__tests__/primary-docs.spec.ts
Test Files  3 passed (3)
Tests       105 passed (105)
```

The native V8 build passed after the CMake change:

```text
$ pnpm --filter @threenative/runtime-native native:build
[307/307] built successfully
```

The generated Ninja compile flags for `SDL_appid.c.o` include `-fPIC`; both `mystral` and
`mystral-tools` link successfully as PIE executables. The workspace package archive loop also
completed for all 11 packages without the linker error.

The CI-equivalent QuickJS build also passed after configuring its separate tree:

```text
$ cmake --build build/tn-linux-quickjs --target threenative-timestamp-query-test \
    --target threenative-rg11b10-renderable-test --target mystral --parallel "$(nproc)"
[100%] Built target threenative-timestamp-query-test
[100%] Built target threenative-rg11b10-renderable-test
[100%] Built target mystral
```

Repository checks completed locally:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS across all 28 selected workspace projects |
| `pnpm lint` | PASS, inherited complexity diagnostics are warnings |
| changed-file Biome check | PASS, one inherited complexity warning in `ci-structure.spec.ts` |
| `pnpm check:docs` | PASS; 1,746 relative links across 1,024 Markdown files |
| `pnpm --filter @threenative/runtime-native test` | PASS; 105 files, 857 passed, 57 skipped; physics parity and publint also passed |
| `pnpm test` | PASS; 411 files, 4,742 tests passed, 2 files and 8 tests skipped |

## Hosted completion

The hosted required CI and native platform matrix are the final completion evidence for this PRD.
This record is updated with the passing run and exact merge commit before the PRD is archived.
