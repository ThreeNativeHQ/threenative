# PRD-212 phase 3 — a developer signs a non-debuggable release without editing engine files

**Status:** verified — real signed APK and AAB built and checked with `apksigner`/`jarsigner`/`aapt`,
installed and launched on the API 35 emulator, and independently reviewed PASS. Only a published
registry install (blocked by the absent PRD-078 prebuilt release) remains.
**Candidate:** `prd-212-published-install-builds-android` at commit 56c4b40a2.

## Independent reviewer verdict

An independent reviewer (fresh agent, read-only) re-ran the runtime-native packaging and
manifest suites (24 passed), the create-threenative `build.spec`/`doctor.spec` suites (114 passed),
verified the APK sha256 `b094f3b8…3b99` / AAB sha256 `9a0461b3…093d` and the `CN=ThreeNative Test`
signer, exercised the real `verifyAndroidReleaseArtifact` path against a tampered copy
(`TN_ANDROID_SIGNATURE_INVALID`) and confirmed all seven negative controls. **Verdict: PASS.** It
flagged the previous unreachable `/debuggable/` guard; that is now a real `aapt` read-back of the
packaged APK (`targetSdkVersion` + `application-debuggable`), covered by tests.

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
(QuickJS, to avoid the missing V8 build receipt), `mode: release`, `format: apk`. Re-run after
merging `origin/develop`, so the PRD-221 16 KB align/census path is active on the release route:

```text
BUILD SUCCESSFUL
  16 KB ok: lib/arm64-v8a/libSDL3.so (stored, offset 0xdc000, LOAD 0x4000, 0x4000, 0x4000)
  16 KB ok: lib/arm64-v8a/libmystral-runtime.so (stored, offset 0x2dc000, ...)
  16 KB ok: lib/x86_64/libSDL3.so (stored, offset 0x1488000, ...)
  16 KB ok: lib/x86_64/libmystral-runtime.so (stored, offset 0x16b4000, ...)
ThreeNative Android APK: /tmp/opencode/tn-build/out/game-release.apk — 4 native libraries 16 KB clean, archive offsets confirmed by .../zipalign
```

- Artifact `game-release.apk`, 44,191,135 bytes, sha256
  `b094f3b863880c9cbc200df5a4ae93b446c113f897d2fe762c1ceb2ef4233b99`.
- `apksigner verify --print-certs` after the aligner re-signed it:
  `Signer #1 certificate DN: CN=ThreeNative Test, OU=CI, O=ThreeNative, L=X, ST=X, C=US`,
  `SHA-256 digest: 34cb3c1d65a37748e20af3131fbdefb85e6e5ed40eb3d417d12ba4e45c289a1d` — the consumer
  key survived alignment; it was never replaced by the debug key.
- `aapt dump badging`: `package: name='com.threenative.game' versionCode='1' versionName='0.1.0'
  compileSdkVersion='36'`, `sdkVersion:'24'`, `targetSdkVersion:'36'`,
  `native-code: 'arm64-v8a' 'x86_64'`, and no `debuggable` line.
- Installed on the running API 35 emulator (`adb install -r` → `Success`); `dumpsys package
  com.threenative.game` reports `versionCode=1 minSdk=24 targetSdk=36`; `monkey` launched it
  (pid observed).

This is the phase-3 user-verification observation (agent-run on the emulator). It used the engine
source checkout rather than a published install because PRD-078's Android prebuilt release is still
absent.

## Real signed AAB (2026-09-11)

The same real Gradle path with `format: aab` ran `bundleRelease` and `signReleaseBundle`:
`BUILD SUCCESSFUL`, `ThreeNative Android AAB: .../game-release.aab (signed)`. Artifact
sha256 `9a0461b3aed4a1b7b607d59ef82e9e20b0fbbf53f5c910c1555d8363f750093d`; `jarsigner -verify`
reports `jar verified.` and the bundle carries `base/manifest/AndroidManifest.xml`. Re-run after
merging `origin/develop`; the AAB route skips the APK-only align/census and uses Gradle's bundle
signing.

## Native symbol outputs (2026-09-11)

The release build emits `android/app/build/outputs/native-debug-symbols/release/native-debug-symbols.zip`
(20,853,148 bytes, sha256 `7470658a32ca2197d8b7953fad43f002153f45ef40011fc226168753280fc3f0`). Every
library/ABI the signed APK ships has a matching `.sym` inside it:

```text
APK libs:   lib/arm64-v8a/libmystral-runtime.so, lib/arm64-v8a/libSDL3.so,
            lib/x86_64/libmystral-runtime.so, lib/x86_64/libSDL3.so
symbol zip: arm64-v8a/libmystral-runtime.so.sym, arm64-v8a/libSDL3.so.sym,
            x86_64/libmystral-runtime.so.sym, x86_64/libSDL3.so.sym
```

## Not run

- Independent reviewer PASS — not requested this session.
- The public-registry consumer install with no engine checkout (blocked by the absent PRD-078
  prebuilt Android release); the proofs above came from the engine source checkout.


