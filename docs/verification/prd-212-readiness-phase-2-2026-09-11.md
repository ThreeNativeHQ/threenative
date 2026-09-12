# PRD-212 phase 2 — one build command produces an explicitly selected release artifact

**Status:** local mechanics verified; independent review and user device verification still open.
**Candidate:** `prd-212-published-install-builds-android` at the phase 2 commit.

## What changed

- `packages/create-threenative/src/build.ts`: `IBuildOptions` gains `mode` (`debug|release`) and
  `format` (`apk|aab`); `parseBuildArgs` reads and validates them; `build()` refuses a non-Android
  or `debug/aab` request before touching the project; Android dispatch passes `--mode`/`--format`
  and names the output `.aab` or `.apk` by format.
- `packages/runtime-native/scripts/package-android.mjs`: `androidBuildRequest` maps the request to
  `assembleDebug` / `assembleRelease` / `bundleRelease` and rejects an unsupported pair before any
  work; `androidArtifactCandidates` names the exact artifact(s) per route and never the debug APK
  for a release. The result logs signed/unsigned/debug honestly.
- `packages/runtime-native/android/app/build.gradle.kts`: the release build type states
  `isDebuggable = false`.
- `packages/create-threenative/__tests__/build.spec.ts`: CLI-to-artifact mode/format contract.
- `packages/runtime-native/tests/android-packaging.integration.test.mjs`: fake-Gradle lanes for
  `bundleRelease` (AAB), `assembleRelease` (APK), the retained debug default, and a debug-only
  wrapper that a release request must refuse.

## Commands and results

```sh
pnpm exec vitest run packages/create-threenative/__tests__/build.spec.ts
# 18 passed, exit 0
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/android-packaging.integration.test.mjs tests/android-manifest-config-changes.test.mjs
# 13 passed, exit 0
pnpm exec vitest run packages/create-threenative/__tests__/cli.spec.ts packages/create-threenative/__tests__/cli-bin.spec.ts
# 6 passed, exit 0
pnpm exec tsc --noEmit -p packages/create-threenative/tsconfig.json   # exit 0
```

## Observed red / revert control

- With only a debug wrapper present, `packageAndroid(..., { mode: 'release', format: 'apk' })`
  rejects with `TN_ANDROID_ARTIFACT_MISSING` — it does not accept `app-debug.apk`.
- `androidBuildRequest('debug', 'aab')` rejects with `TN_ANDROID_BUILD_UNSUPPORTED` before Gradle.

## Real artifact observation (2026-09-11)

A real `assembleRelease` ran from the worktree's Android project through the packager
(QuickJS/x86_64 to avoid the missing V8 build receipt): `BUILD SUCCESSFUL`,
`ThreeNative Android APK: .../game-release.apk (signed)`. `aapt dump badging` reports package
`com.threenative.game`, `versionCode='1'`, `versionName='0.1.0'`, `targetSdkVersion:'36'`,
`native-code: 'x86_64'`. The same run with `format: aab` executed `bundleRelease`/`signReleaseBundle`
and produced a signed `game-release.aab` (`jarsigner -verify` → `jar verified.`). Full hashes and
signer details are in the phase 3 record.

## Not run

- Independent reviewer PASS — not requested this session.
- The published-install consumer build — the prebuilt Android release artifacts the consumer path
  downloads are still absent (PRD-078); the AAB and APK above were built from the engine source
  checkout.

