# `@threenative/core` at HEAD cannot build for Android

**Filed:** 2026-08-23. **Severity:** blocker. **Layer:** `packages/core` (engine).
**Status:** open, unowned at filing.

Found by the PRD-214 lane while trying to get any frame at all on a physical Pixel 8. It is not
that lane's bug and it is not in the mobile-stability batch's six PRDs, but it sits on the critical
path of at least two of them: PRD-210 and PRD-211 both need an Android build to take their device
proofs.

## Symptom

`threenative build --target android` fails:

```
TN_NATIVE_WASM_ON_MOBILE: android bundle contains WebAssembly. Move web-only WASM imports out of
src/game.ts or provide a threenative-native conditional backend; mobile navigation is owned by
PRD-052.
```

The gate is `packages/create-threenative/src/build.ts:73-81` and it is doing its job. The bundle
really does contain `WebAssembly`.

The same game built fine against an older `@threenative/core` tarball, so this is a regression
introduced with the KTX2 path added by the android-ktx2-unsupported fix.

## Cause

`createAssetLoader` constructs the shared KTX2 loader eagerly whenever a renderer is passed
(`packages/core/src/assets.ts:252-256`), and `createKtx2Loader` reaches
`await import("three/addons/loaders/KTX2Loader.js")` (`:221`).

The import is dynamic, but it is a static string, so the bundler resolves and inlines it rather
than leaving it as a runtime fetch. `KTX2Loader.js` carries the Basis transcoder, which carries
`WebAssembly`. The construction being lazy at *runtime* does not help: the cost is paid at
*bundle* time, and it is paid by every game whether or not it ships a single `.ktx2`.

The sandbox game that hit this ships no `.ktx2` asset at all, so the transcoder it was refused for
would never have been constructed.

## Why the obvious workaround is wrong

The PRD-214 lane bypassed it with a local, uncommitted patch after checking the sandbox ships no
`.ktx2`. That was correct for taking one measurement and is not a fix: it turns a fail-closed gate
off for a game that might later add a compressed texture, and it lives in one sandbox rather than
in the framework.

## Shape of a real fix

The Basis transcoder is a browser WASM worker. There is no native transcoder, so the honest
position is that **native targets have no KTX2 path at all**, and the bundle should not carry one.
That means the arm is excluded from native bundles rather than merely unused in them, and a
`.ktx2` texture request on a native target fails by name — the way `TN_ASSETS_KTX2_UNSUPPORTED`
already fails a browser renderer that supports no compressed format.

Constraints any fix has to respect:

- **Fail closed.** A game that genuinely ships `.ktx2` and builds for Android must get a named
  refusal at build time, not a silent fallback and not a runtime surprise.
- **Do not weaken the gate.** `TN_NATIVE_WASM_ON_MOBILE` caught this correctly. The fix is to stop
  putting WebAssembly in the bundle, never to stop noticing it.
- The framework owns this: a game cannot write around a bundler decision portably.

## Evidence

- PRD-214's device campaign, 2026-08-23, physical Pixel 8 — it could not produce an APK from HEAD
  without patching this out locally.
- `packages/core/src/assets.ts:221`, `:252-256`; `packages/create-threenative/src/build.ts:73-81`.

## Two sibling blockers found in the same session

Recorded here so they are not lost; both have owners already.

1. **OGG audio is a hard startup failure on native.** With the asset preflight skipped,
   `decodeAudioData` rejects and core turns it into `TN_NATIVE_START_FAILED`, so the game never
   presents. **Owned by PRD-211 Phase 1** (stb_vorbis decode), in progress. The preflight was right
   to refuse; the fix is to make the container decodable, not to soften the refusal.
2. **A stale `public/assets.manifest.json` in the sandbox Bayview tree** lists
   `models/enemy-terrorist.glb` while the game asks for `assets/enemy-terrorist.glb`, and core's
   manifest gate rejects the game. This is game-side, in someone's in-flight asset move — the file
   is 4564 bytes, mtime 18:54. Not an engine bug; noted so whoever owns that move knows the game
   does not start with it in place.
