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

## Real artifact observation (2026-09-11)

A source build from the worktree's runtime-native package (QuickJS/x86_64 to avoid the missing V8
build receipt) produced `game-release.apk` (23,544,301 bytes, sha256
`beae53e2aa6d3e240560adb802b7c2c3f1257d0c4604affc93187c51fac7058a`). `aapt dump badging` reports:

```text
package: name='com.threenative.game' versionCode='1' versionName='0.1.0' compileSdkVersion='36'
sdkVersion:'24'
targetSdkVersion:'36'
```

So the packaged subject really carries the API 36 submission level, not just the source text.

## Not run

- Independent reviewer PASS — not requested in this session.
- A published-install consumer build — the prebuilt Android release artifacts the consumer path
  downloads are still absent (PRD-078); the artifact above came from the engine source checkout.

