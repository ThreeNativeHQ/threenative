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

## Real signed artifact (2026-09-11)

The packager was driven for real through the worktree's runtime package and Android project with a
throwaway keytool keystore (`/tmp/opencode/tn-test-release.jks`, alias `tnrelease`), a source build
(QuickJS/x86_64, to avoid the missing V8 build receipt), `mode: release`, `format: apk`:

```text
BUILD SUCCESSFUL in 1m 53s
ThreeNative Android APK: /tmp/opencode/tn-build/out/game-release.apk (signed)
```

- Artifact `game-release.apk`, 23,544,301 bytes, sha256
  `beae53e2aa6d3e240560adb802b7c2c3f1257d0c4604affc93187c51fac7058a`.
- `apksigner verify --print-certs`:
  `Signer #1 certificate DN: CN=ThreeNative Test, OU=CI, O=ThreeNative, L=X, ST=X, C=US`,
  `SHA-256 digest: 34cb3c1d65a37748e20af3131fbdefb85e6e5ed40eb3d417d12ba4e45c289a1d`.
- `aapt dump badging`: `package: name='com.threenative.game' versionCode='1' versionName='0.1.0'
  compileSdkVersion='36'`, `sdkVersion:'24'`, `targetSdkVersion:'36'`, `native-code: 'x86_64'`,
  and no `debuggable` line.
- Installed on the running API 35 emulator (`adb install -r` → `Success`); `dumpsys package
  com.threenative.game` reports `versionCode=1 minSdk=24 targetSdk=36`, `versionName=0.1.0`,
  `primaryCpuAbi=x86_64`; `monkey -p com.threenative.game ... 1` launched it (pid observed).
  Screenshot: `/tmp/opencode/tn-build/release-on-emulator.png`.

This is the phase-3 user-verification observation (agent-run on the emulator). It does not supply
the independent reviewer PASS, and it used the engine source checkout rather than a published
install because PRD-078's prebuilt Android release is still absent.

## Real signed AAB (2026-09-11)

The same real Gradle path with `format: aab` ran `bundleRelease` and `signReleaseBundle`:
`BUILD SUCCESSFUL`, `ThreeNative Android AAB: .../game-release.aab (signed)`. Artifact 19,009,649
bytes, sha256 `b00fcceec802d22960d6a6c9f2b073e0d23896eb36425962fe3902cee544f8af`; `jarsigner -verify`
reports `jar verified.` and the bundle carries `base/manifest/AndroidManifest.xml`.

## Not run

- Independent reviewer PASS — not requested this session.
- The public-registry consumer install with no engine checkout (blocked by the absent PRD-078
  prebuilt Android release); the proofs above came from the engine source checkout.


