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

Repository checks completed locally:

| Gate | Result |
| --- | --- |
| `pnpm typecheck` | PASS across all 28 selected workspace projects |
| `pnpm lint` | PASS, inherited complexity diagnostics are warnings |
| changed-file Biome check | PASS, one inherited complexity warning in `ci-structure.spec.ts` |
| `pnpm check:docs` | PASS; 1,745 relative links across 1,023 Markdown files |
| full `pnpm test` | local setup prerequisite failure; 848 passed, 57 skipped, 8 failed because the explicitly required native V8/QuickJS contract executables were not built |

The full test failure is not attributed to this change: its errors are explicit missing-build
messages for `threenative-crash-handler-policy-test`, `threenative-rg11b10-renderable-test`,
`threenative-timestamp-query-test`, `threenative-canvas2d-dirty-test`, and the QuickJS
`mystral`/contract tree. The focused suites that cover this change are green.

## Hosted completion

The hosted required CI and native platform matrix are the final completion evidence for this PRD.
This record is updated with the passing run and exact merge commit before the PRD is archived.
