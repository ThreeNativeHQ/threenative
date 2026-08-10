# PRD-055 criterion 2 — touch playability rerun — 2026-08-10

Result: **RED at the shipped-source contract; Android execution BLOCKED at APK setup.**
Criterion 2 is not closed.

## Source contract

The criterion permits either shipped controls or the framework input surface plus twenty
lines. The lane source check was:

```sh
if rg --files packages/create-threenative/templates | rg -q \
  'platformer/src/render/touch-controls\.ts'; then
  echo 'PASS: shipped touch controls found'
else
  echo 'FAIL: no shipped platformer touch-controls.ts'
  exit 1
fi
```

Observed result:

```text
exit_code=1
FAIL: no shipped platformer touch-controls.ts
```

This is an observed red result for the lane source, not a claim that a touch target is
playable.

## Android execution

The declared proof was rerun after the aggregate parity command had bootstrapped the Gradle
wrapper:

```sh
pnpm --dir packages/runtime-native native:verify:android:multitouch \
  --device emulator-5554
```

The emulator was present (`emulator-5554`, API 35), and the proof selected JDK 17, but the
command exited 1 before installing an APK or reaching assertions:

```text
1/4 Building Android debug APK with JDK 17...
FAIL: Command failed (1): bash packages/runtime-native/android/gradlew :app:assembleDebug --console=plain
A problem was found with the configuration of task ':app:extractSdl3JniLibs'
Property '$1' specifies file
'packages/runtime-native/third_party/sdl3-android/SDL3-3.2.8.aar' which doesn't exist.
BUILD FAILED in 390ms
```

The missing AAR is a setup blocker. No positive touch result or negative-control result was
observed, so neither is reported as pass.

## Verdict

PRD-055 criterion 2 remains open: the lane source contract is red, and the device proof is
blocked before runtime execution.
