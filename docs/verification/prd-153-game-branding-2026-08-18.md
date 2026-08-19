# PRD-153 branding and launch evidence — 2026-08-18

This record covers the game-owned branding path from generated web/native configuration through
the platform launch surface, live loading layer, and playable handoff. The native review trigger
is intentionally visible; no physical-mobile or performance-parity claim is made.

## Integration ledger

| # | Live caller | Evidence |
| --- | --- | --- |
| 1 | `packages/create-threenative/src/build.ts:229` calls `writePackagingConfig`; `:186` resolves every declared path | `packages/create-threenative/__tests__/build.spec.ts` exercises the live caller and all icon/splash variants. |
| 2 | `packages/create-threenative/templates/platformer/vite.config.ts:7` registers `createWebBrandPlugin`; `index.html:9` owns launch markup; `src/main.ts:24` removes it after two paint frames | All seven template Vite/HTML/main surfaces are checked by `template.spec.ts`; `test:templates` is the Chromium/WebGPU proof. |
| 3 | `packages/runtime-native/scripts/package-android.mjs:349` stages `renderAndroidBrandingResources`; `:313` writes the splash theme reference | The fake packaged APK contains adaptive, monochrome, foreground, splash, manifest, theme and color resources. |
| 4 | `packages/runtime-native/scripts/package-ios.mjs:137` calls `plistLaunchScreen`; `:96` writes the launch image reference | The staged app test checks dark/tinted catalog inputs, `LaunchImage`, `TNLaunchBackground` and compiled assets. |
| 5 | `packages/runtime-native/src/platform/window.cpp:125` calls `applyEmbeddedWindowIcon`; `:65` calls `SDL_SetWindowIcon` | Desktop asset test checks the embedded icon path and SDL consumer; `native:verify:desktop` runs the live window. |
| 6 | `packages/core/src/game.ts:431` passes `platform?.viewport` into `Viewport`; generated loading reads `packages/create-threenative/templates/platformer/src/render/loading.ts:211` | Viewport rotation/asymmetric-inset tests and runtime-native safe-area contract tests pass. Missing capability uses the full drawable rectangle. |
| 7 | `packages/create-threenative/templates/platformer/src/scenes/Level.ts:47` calls `createLoadingScreen`; the other six template scenes have the same live call | Every loading source has a caller; loading unit tests cover no-op, crop/cover, truthful progress, disposal, compile-before-reveal and safe layout. |
| 8 | `packages/runtime-native/scripts/inspect-launch.mjs:414` calls `assertLaunchFrameSequence` | Positive sequence returned `platform-splash → loading → playable`; an off-brand frame failed at its exact index. |

## Positive gates

| Command | Result | Observed evidence |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | PASS | Workspace dependencies bootstrapped with the repository lockfile. |
| Focused branding/native suites | PASS | Loading 14, config 37, web brand 1, template 23, Android 2, iOS 9, desktop 5 and runtime contract tests passed in focused runs. |
| `pnpm typecheck` | PASS | Root plus workspace typechecks completed. |
| `pnpm lint` | PASS | Biome completed; only the repository’s existing complexity warnings remain. |
| `pnpm test` | PASS | Full build, publint and Vitest suite completed after the scaffold fixes below. |
| `pnpm test:templates` | PASS | All seven generated templates built and ran their Chromium/WebGPU playtests under Vulkan; adapter metadata was observed. |
| `pnpm budgets` | PASS | 13,645/15,000 framework LOC; 77,806/50,000 native runtime LOC review trigger reported, hard invariants clear. |
| `pnpm native:verify:desktop` | PASS | 300-frame desktop core run, physics actuation/query/playtest proofs and nonblank capture passed on NVIDIA GeForce RTX 2080 Vulkan. |

The generated loading layer keeps the world opaque while `compileAsync` is pending, then reveals on
completion or after a 1-second bounded warm-up. The timeout is covered by the loading unit suite;
this prevents a Chromium/WebGPU compile promise that never settles from leaving the launch screen
up forever. The final `pnpm test:templates` run passed all seven templates after this repair.

## Observed-red controls

Each control was temporarily broken, run, observed failing, then restored before the final gates.

| Control | Command result |
| --- | --- |
| Missing Android foreground variant | Config harness exited `1`: `TN_CONFIG_BRAND_ANDROID_FOREGROUND_MISSING`, naming `missing-foreground.png`. |
| Reintroduced `config.loading` | Config harness exited `1`: `TN_CONFIG_UNKNOWN_KEY`, naming `config.loading`. |
| Removed web manifest/icon metadata | `web-brand.spec.ts` exited `1`: expected `rel="icon" href="/icon.svg"`. |
| Removed template adapter registration | `template.spec.ts -t "wires the brand adapter"` exited `1`: `platformer` lacked `createWebBrandPlugin()`. |
| Removed Android adaptive XML | Android packaging test exited `1`: APK lacked `mipmap-anydpi-v26/ic_launcher.xml`. |
| Mutated Android splash color | Android packaging test exited `1`: expected `#0d1b2a`, received `#000000`. |
| Omitted iOS launch image reference | iOS packaging test exited `1`: expected `UIImageName/LaunchImage`. |
| Bypassed SDL icon call | Desktop asset test exited `1`: source lacked `SDL_SetWindowIcon(`. |
| Disabled loading no-op path | Loading unit exited `1`: expected zero layer children, received three meshes. |
| Anchored loading bar at the physical edge | Safe-area unit exited `1`: measured bound `-615.4` violated safe bound `-386.000000001`. |
| Bypassed packaging resolution caller | Build unit exited `1`: expected absolute icon path, received `public/icon.png`. |
| Bypassed generated loading caller | Template contract exited `1`: platformer caller observation was `false`. |
| Injected off-brand launch frame | Inspector exited `1`: `TN_LAUNCH_SEQUENCE_OFF_BRAND:index=2`. |

## Platform evidence boundary

- Chromium/WebGPU: executed through the all-template gate with the Vulkan adapter named in the
  capture (`NVIDIA`, Turing architecture).
- Desktop native: executed locally through `pnpm native:verify:desktop`; NVIDIA GeForce RTX 2080,
  Vulkan, 300 frames and a nonblank screenshot.
- Android emulator: **UNVERIFIED** in this operator session; packaging and Java inset contract
  tests ran, but no emulator cold-launch capture is claimed.
- iOS simulator: **UNVERIFIED** in this operator session; staged-artifact tests ran, but the
  hosted Apple simulator lane was not executed here.
- Physical Android/iOS hardware and performance parity: **UNVERIFIED**.
