# PRD-375 phase 1 evidence — the installed Android release carries the game brand

Date: 2026-09-12
PRD: [PRD-375](../PRDs/production-readiness/PRD-375-release-artifacts-carry-the-game-brand.md)
Branch: `prd375/android-brand-phase1` (base `origin/develop` @ `051b5de03`)
Layer: engine (`packages/runtime-native/`) — packaging mechanism; the artwork stays game config.

## What this phase proves

A game's authored icon, monochrome icon and boot-splash image, plus its application id, label and
version, are written into the packaged Android artifact and are observable launcher-to-gameplay on a
real emulator. Invalid declared artwork is refused before any build runs.

The branding render/install plumbing (`renderAndroidBrandingResources`, `installAndroidFiles`,
`config.ts` brand validation) already existed from PRD-153. What this phase added is the missing
*signed-release* proof and the packaging-level missing-variant refusal, and the on-device
observation the earlier work never made.

## Required test (green)

```sh
cd packages/runtime-native
../../node_modules/.bin/vitest run --config vitest.config.ts tests/android-packaging.integration.test.mjs
# Test Files  1 passed (1)
# Tests      36 passed (36)
```

Three tests were added (the other 33 pre-existed):

- `a release-mode artifact preserves the configured icon, splash and identity resources` —
  packages with `--mode release`, then reads the APK and asserts the manifest `icon`/`roundIcon`,
  the label, application id, `versionCode`/`versionName`, the `values/branding.xml` background
  colours, and byte-identical `mipmap-xxxhdpi/ic_launcher.png`,
  `drawable-nodpi/ic_launcher_foreground.png`, `ic_launcher_monochrome.png` and
  `tn_boot_splash.png`. Each variant is written with distinct bytes and compared against its own
  declared source, so copying one asset into another's slot fails. The signature verifier is the
  injected seam and alignment is off (the fixture archive is hand-assembled); the real signature and
  16 KB paths have their own tests in the same file.
- `an Android App Bundle release carries the same configured brand resources` — the `bundleRelease`
  AAB is inspected for the manifest icon, the monochrome drawable and the boot splash.
- `a declared Android icon variant whose file is missing is refused before Gradle runs` — a config
  whose `icons.android.monochrome` file does not exist is refused with
  `TN_CONFIG_BRAND_ANDROID_MONOCHROME_MISSING`, and `last-task.txt` is absent, so no Gradle build
  ran. The refusal happens in `installAndroidFiles` (package-android.mjs:628-632), before the
  `spawnSync` Gradle invocation (package-android.mjs:1043), which is why the absent task file is
  sound evidence.

## Observed red, then restored green

1. **Disconnected splash staging.** Made `installAndroidFiles` skip the `tn_boot_splash` copy
   (`if (false && branding.splash !== undefined)`), reran the release test:
   `FAIL … Command failed: unzip -p …/fox.apk drawable-nodpi/tn_boot_splash.png` →
   `filename not matched`. Source restored; green again.
2. **Variant cross-copy.** Made the monochrome slot receive the foreground bytes
   (`copyFileSync(branding.foreground, androidMonochrome)`); the AAB test failed on the monochrome
   entry not matching its declared source. Source restored; green again.
3. **Config layer, real build (not manufactured).** A foreground PNG with no alpha channel was
   declared for the real starter project; `threenative build --target android --allow-source-build`
   refused before any Gradle work:
   `TN_CONFIG_BRAND_ANDROID_FOREGROUND_ALPHA_INVALID: … app.icons.android.foreground must include
   an alpha channel: brand/foreground.png`.

## Real artifact (source/consumer build)

```sh
THREENATIVE_RUNTIME_SOURCE=<engine>/packages/runtime-native \
THREENATIVE_GRADLE_ARGS="-PthreenativeJsEngine=quickjs" \
node packages/create-threenative/dist/threenative.js build --target android --allow-source-build
# BUILD SUCCESSFUL in 1m 48s
# ThreeNative Android APK: /tmp/opencode/prd375-game/dist-native/prd377-consumer2.apk
```

Artifact inspection (`aapt` from build-tools 36.0.0, `unzip`, ImageMagick pixel compare):

| Fact | Observed |
| --- | --- |
| package | `com.threenative.prd375brand`, versionCode 1, versionName 1.0.0 |
| application label | `PRD375 Brand` |
| application icon | `@mipmap/ic_launcher` (adaptive) and `roundIcon` same |
| adaptive-icon layers | background + foreground + monochrome present in packaged `mipmap-anydpi-v26/ic_launcher.xml` |
| authored → packaged | `ic_launcher_foreground.png`, `ic_launcher_monochrome.png`, `tn_boot_splash.png`, `mipmap-xxxhdpi/ic_launcher.png` all `magick compare -metric AE` = **0** vs the authored files |

## On-device observation (named platform)

Device: `sdk_gphone16k_x86_64` (16 KB-page AVD), API 36. Installed with `adb install -r`, launched
`com.threenative.prd375brand/com.threenative.runtime.MystralActivity`.

- **OS splash** (`s2.png`): navy `bootSplash.backgroundColor` `#0d1b2a`, the red authored foreground
  icon, and the green authored branding image at the foot — i.e. the adaptive icon foreground
  (`windowSplashScreenAnimatedIcon`) and `tn_boot_splash` (`windowSplashScreenBrandingImage`).
- **Live loading transition** (`s3.png`): the navy loading surface with the progress indicator,
  between the OS splash and the first game frame.
- **Launcher/app metadata** (`appinfo2.png`): the system App info header shows the red adaptive
  launcher icon and the label `PRD375 Brand`.
- **Playable frame** (`game.png`): the default starter scene (blue icosahedron, orange box, magenta
  marker); logcat `TN_SURFACE_FRAME … present 19…28` shows the engine presenting frames.

Montage: [prd-375-phase-1-android-brand-emulator.png](prd-375-phase-1-android-brand-emulator.png)
(OS splash, live loading, playable frame, App info). Raw captures: `/tmp/opencode/prd375-captures/`.

## Honest limits / not claimed

- This is the **emulator**, not a physical OEM launcher. Physical OEM icon-mask appearance remains
  unverified and is a separately named observation.
- The **themed (monochrome) launcher icon** was not observed: the emulator's launcher was not driven
  into its themed-icon mode, so the monochrome variant is proven only in the artifact (byte-identical
  in the packaged drawable) and not on a launcher surface.
- The APK above came from a maintainer **source** build (`--allow-source-build`), not from a
  published-cohort install. Public-cohort artifact acceptance is PRD-060's; this phase proves the
  packager writes and preserves the brand, which is the same code path.
- The 16 KB AVD reported the **debug** APK as not 16 KB aligned (page-size compatibility mode). That
  is the debug path's alignment, owned by PRD-221; it is not a branding defect and this phase makes
  no 16 KB claim.
- The configured-artwork load-bearing value was proven by the config-layer refusal above; the
  positive path uses a distinct authored red/green artwork pixel-identical in the packaged artifact.

## Files changed

- `packages/runtime-native/tests/android-packaging.integration.test.mjs` — the three tests above
  (+`existsSync` import). No production source change was required: the plumbing already carried the
  brand; it had never been proven on a release artifact. `packages/runtime-native/scripts/package-android.mjs`
  and `packages/create-threenative/__tests__/config.spec.ts` were inspected and are unchanged (the
  latter already covers the missing-declared-variant refusal at config.spec.ts:424).

## Next

Phase 2 (distributed desktop app shows the brand) consumes PRD-365 containers; PRD-365 phase 1 is
still a draft PR (`#224`), so no desktop container exists on `develop` yet. Phase 2 is parked on
that dependency rather than claimed.
