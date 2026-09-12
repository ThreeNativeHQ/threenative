# PRD-212 phase 1 — the game builds against the current Android submission SDK

**Status:** local mechanics verified; independent review and user device verification still open.
**Candidate:** `prd-212-published-install-builds-android` at the phase 1 commit.

## What changed

- `packages/runtime-native/android/app/build.gradle.kts`: `compileSdk`/`targetSdk` 35 → 36. Google
  Play rejects new apps and updates below target API 36 from 2026-08-31.
- `packages/create-threenative/src/doctor.ts`: doctor no longer owns a second SDK literal. It reads
  `android/app/build.gradle.kts` from the installed runtime package and reports that requirement;
  `DEFAULT_ANDROID_COMPILE_SDK = 36` is only the fallback when the package is unreadable.
- `packages/runtime-native/scripts/package-android.mjs`: exports `ANDROID_SUBMISSION_TARGET_SDK`
  (36), `androidGradleTargetSdk`, and `assertAndroidSubmissionTargetSdk`, and refuses a rendered
  project whose `targetSdk` is below the floor before Gradle runs.
- `packages/runtime-native/tests/android-manifest-config-changes.test.mjs`: the packaged subject
  must declare the submission target SDK, and the gate must reject a 35 subject.

## Commands and results

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/android-manifest-config-changes.test.mjs tests/android-packaging.integration.test.mjs
# 2 files, 8 tests passed, exit 0

pnpm exec vitest run packages/create-threenative/__tests__/doctor.spec.ts
# 1 file, 95 tests passed, exit 0

pnpm typecheck   # exit 0
pnpm exec biome check <changed files>   # no errors
```

## Observed red / revert control

`assertAndroidSubmissionTargetSdk` is run against a copy of the shipped Gradle project with
`targetSdk` forced back to 35; it throws `TN_ANDROID_TARGET_SDK_BELOW_SUBMISSION`. The restored
project passes. The revert control is asserted in the test file listed above.

## Not run

- Independent reviewer PASS — not requested in this session.
- User verification on an emulator/device (install, launch, inspect application
  id/version/targetSdk) — not run in this session; the API 35/36 emulator lane is available locally.
- A full Gradle build of the bumped project — public release artifacts for the prebuilt Android
  path are still absent (PRD-078), so the packager's consumer path cannot complete a download.
