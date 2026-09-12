# PRD-212 phase 3 — a developer signs a non-debuggable release without editing engine files

**Status:** local mechanics verified; independent review, real apksigner signing and device
verification still open.
**Candidate:** `prd-212-published-install-builds-android` at the phase 3 commit.

## What changed

- `packages/runtime-native/android/app/build.gradle.kts`: a property-backed `signingConfigs`
  release config reads `threenativeKeystore`, `threenativeKeystoreAlias`,
  `threenativeKeystorePassword`, `threenativeKeyPassword`; the release build type is signed only
  when all four are present, and is `isDebuggable = false`. No debug-key fallback.
- `packages/runtime-native/scripts/package-android.mjs`: `ANDROID_RELEASE_SIGNING_PROPERTIES`,
  `androidReleaseSigning` (resolves the keystore against the consumer project), and
  `verifyAndroidReleaseArtifact` (fail-closed `apksigner`/`jarsigner` verification). A release
  request with incomplete signing is refused with `TN_ANDROID_SIGNING_INCOMPLETE` naming only the
  missing property names; an unsigned release artifact is refused with
  `TN_ANDROID_RELEASE_UNSIGNED`; signing values are forwarded to Gradle through the child
  environment and never logged or serialized.
- `packages/create-threenative/src/build.ts`: passes `--project-root <game>` so a relative keystore
  resolves against the game, not the engine.
- `packages/runtime-native/tests/android-packaging.integration.test.mjs`: failure controls for
  incomplete inputs, unsigned output, verifier rejection and a missing verifier; the signed path
  asserts the resolved keystore and that password sentinels never reach the packaging output.
- `packages/runtime-native/README.md`: the game-side signing recipe and the four names.

## Commands and results

```sh
pnpm --filter @threenative/runtime-native exec vitest run --config vitest.config.ts \
  tests/android-packaging.integration.test.mjs tests/android-manifest-config-changes.test.mjs
# 2 files, 24 tests passed, exit 0
pnpm exec vitest run packages/create-threenative/__tests__/build.spec.ts packages/create-threenative/__tests__/doctor.spec.ts
# 114 passed, exit 0
pnpm exec vitest run packages/create-threenative/__tests__/cli.spec.ts
# 5 passed, exit 0
pnpm exec tsc --noEmit -p packages/create-threenative/tsconfig.json   # exit 0
```

## Observed red / revert control

- Incomplete signing: only `ORG_GRADLE_PROJECT_threenativeKeystore` set → the packager throws
  `TN_ANDROID_SIGNING_INCOMPLETE` naming the other three, without echoing the supplied path.
- AGP leaves the release unsigned → `TN_ANDROID_RELEASE_UNSIGNED`.
- The verifier rejects → `TN_ANDROID_SIGNATURE_INVALID`; no verifier is a blocker
  (`TN_ANDROID_SIGNATURE_TOOL_MISSING`), not a pass.

## Not run

- A real `apksigner`/`jarsigner` run against a keytool-generated test keystore and a real Gradle
  release build — the prebuilt Android release artifacts remain absent (PRD-078), so the consumer
  build cannot complete; the verifier path is exercised through its injectable seam.
- Independent reviewer PASS and user verification on emulator/device — not run this session.
