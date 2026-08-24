# `@threenative/core` builds for Android again — 2026-08-23

`threenative build --target android` failed for **every** game at HEAD, whether or not it shipped a
compressed asset. This records the fix, exactly what executed here, and what did not.

## What was broken

The asset-pipeline series (`95c079b4`, 2026-08-22) gave `packages/core/src/assets.ts` three new
dynamic imports of three's compressed-asset decoders:

| Import | What it drags in |
| --- | --- |
| `three/addons/loaders/KTX2Loader.js` (`assets.ts:221`) | Basis transcoder wiring plus three's inlined zstd decoder, a base64 `data:application/wasm` blob |
| `three/addons/libs/meshopt_decoder.module.js` (`assets.ts:368`) | `WebAssembly.validate` / `WebAssembly.instantiate` |
| `three/addons/loaders/DRACOLoader.js` (`assets.ts:375`) | the `typeof WebAssembly` branch that chooses the wasm decoder |

Each specifier is a static string, so the bundler resolves and inlines it regardless of whether the
game ever calls it — and the native bundle disables code splitting, so the decoders land in the one
emitted file. `createAssetLoader` also builds the shared KTX2 loader eagerly whenever a renderer is
passed (`assets.ts:252-256`), which `defineGame` always does, so the KTX2 branch is reachable from
the module graph of every game. The commit before that series imported only `GLTFLoader` and
carried no WASM at all:

```
$ git show 95c079b4^:packages/core/src/assets.ts | grep -n "await import("
104:        const { AudioLoader: Loader } = await import("three");
115:        const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
135:        const { TextureLoader: Loader } = await import("three");
```

Mobile is where this bites: Android runs QuickJS and iOS runs JSC without a WASM JIT, so neither has
`WebAssembly` (`packages/runtime-native/docs/G4-threading-native-systems.md`). Desktop runs V8 and
does have it, which is why `TN_NATIVE_WASM_ON_MOBILE` skips the desktop target and why desktop
builds stayed green through the regression. PRD-097 claimed "native consumes the same files" on the
strength of a **desktop** gate; no mobile bundle was ever built over compiled assets.

This is an engine bug, fixed in `packages/`. A game cannot write around a bundler's decision to
inline a dependency's dynamic import.

## Red — a game shipping no `.ktx2`, at HEAD

`packages/create-threenative/__tests__/native-ktx2.spec.ts`, first case — the output below is
verbatim from before the case was widened to cover iOS as well, hence the older title. The project is a scaffolded
game's shape: its own `package.json`, the pinned Vite, `@threenative/core` in `node_modules`, and a
`src/game.ts` that is nothing but `export default defineGame({ scenes: {} })`. No assets, no
`.ktx2`, no physics.

```
 FAIL  packages/create-threenative/__tests__/native-ktx2.spec.ts > KTX2 on native targets > bundles a game that ships no .ktx2 for android without WebAssembly
AssertionError: promise rejected "Error: TN_NATIVE_WASM_ON_MOBILE: android …" instead of resolving
 ❯ packages/create-threenative/__tests__/native-ktx2.spec.ts:53:66

Caused by: Error: TN_NATIVE_WASM_ON_MOBILE: android bundle contains WebAssembly. Move web-only WASM imports out of src/game.ts or provide a threenative-native conditional backend; mobile navigation is owned by PRD-052.
 ❯ assertNativeBundleCompatible packages/create-threenative/src/build.ts:79:9

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

The seven `WebAssembly` occurrences in that bundle, all from three, none from the game:

```
106311: return A || (A = "undefined" != typeof fetch ? fetch("data:application/wasm;base64," + C)…   (zstd, via KTX2Loader)
109523: if (typeof WebAssembly !== "object") return { supported: false };                            (meshopt)
109524: var wasm = WebAssembly.validate(detector) ? unpack(wasm_simd) : unpack(wasm_base);           (meshopt)
109526: var ready = WebAssembly.instantiate(wasm, {}).then(function(result) {                        (meshopt)
109582: var source = "self.ready = WebAssembly.instantiate(new Uint8Array([" + …                     (meshopt)
110005: const useJS = typeof WebAssembly !== "object" || this.decoderConfig.type === "js";            (draco)
110009: if (decoderPaths.dep_js === null) throw new Error("THREE.DRACOLoader: WebAssembly is required…  (draco)
```

## The fix

Two changes, neither of which touches `TN_NATIVE_WASM_ON_MOBILE`.

**1. `packages/runtime-native/scripts/bundle.mjs` — the mobile bundle carries no WASM decoder.**
A `load` hook, registered for `android` and `ios` only, replaces the three decoder modules with
stubs. It matches the resolved module path, not the specifier, so `three/addons/…`,
`three/examples/jsm/…` and a relative import from inside three all land on the same replacement.
The stubs construct and configure exactly like the originals — `new KTX2Loader()` and
`setTranscoderPath()` must keep working, because `createAssetLoader` builds that loader during boot
for every game — and refuse, by name, only when asked to decode. `KTX2Loader.detectSupport()`
throwing is the already-documented "renderer exposed no surface to probe" answer, so
`createKtx2Loader` resolves `undefined`, `compressedTextures.ready` settles, and a game with no
compressed asset boots normally.

The refusal messages deliberately never spell the WASM host object: the guard greps the finished
bundle for that identifier, and a first draft of this fix traded three real hits for three of its
own.

**2. `packages/create-threenative/src/build.ts` — the named build-time refusal.**
`assertNativeAssetsCompatible` runs in `buildNative` immediately after `compileAssets`, the first
moment the build knows what the game ships and before any bundle or APK exists. It reads the
compiled manifest at `<assets.output ?? public>/assets.manifest.json` and refuses a mobile target
that ships either:

- an output ending in `.ktx2` → `TN_NATIVE_KTX2_UNSUPPORTED`, naming the offending logical paths;
- an entry declaring `EXT_meshopt_compression`, `KHR_meshopt_compression` or
  `KHR_draco_mesh_compression` → `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED`.

It fails closed: a manifest that exists but is unparseable, or has no `entries` object, throws
`TN_NATIVE_ASSET_MANIFEST_INVALID` rather than being read as "nothing compressed here". A missing
manifest is the documented no-compiled-assets case and passes. Desktop and web are untouched.

## Green — what executed on this machine

Every line below was run in this worktree on 2026-08-23.

### The eight cases, all green

```
$ npx vitest run packages/create-threenative/__tests__/native-ktx2.spec.ts

 ✓ packages/create-threenative/__tests__/native-ktx2.spec.ts (8 tests) 4936ms
     ✓ bundles a game that ships no compressed asset for mobile without WASM  2108ms
     ✓ keeps three's real decoders on desktop, which has a WASM engine  984ms
     ✓ still fails TN_NATIVE_WASM_ON_MOBILE when the game itself reaches WASM  949ms
     ✓ leaves the browser KTX2 path on three's real loader  879ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

What each proves:

| Case | Proof |
| --- | --- |
| no compressed asset → mobile | the real `android` **and** `ios` bundles pass `assertNativeBundleCompatible` and contain no `WebAssembly`; both carry the two refusal codes, so the stubs are present rather than the modules merely dropped |
| desktop | the same game's desktop bundle still matches `/\bWebAssembly\b/`, still passes its own gate, and contains no stub — the replacement is mobile-only and desktop's KTX2 path is unchanged |
| the guard still fires | a game whose own `src/wasm.ts` calls `WebAssembly.compile` still fails `TN_NATIVE_WASM_ON_MOBILE` on android. This is the planted-WASM control asked for: the gate was not weakened, the bundle was |
| `.ktx2` refused by name | `build({ target: "android" })` on a project whose manifest lists `textures/rock.a1b2c3d4.ktx2` rejects with `TN_NATIVE_KTX2_UNSUPPORTED: android cannot ship compiled KTX2 textures (textures/rock.png)`, and `.threenative/build/game.js` is never written — the refusal precedes the bundle |
| compressed models refused by name | the same for `EXT_meshopt_compression` on `ios` → `TN_NATIVE_MESH_COMPRESSION_UNSUPPORTED` |
| desktop and web accept | the identical manifest passes `assertNativeAssetsCompatible` for `desktop` and `web` |
| fail closed | a manifest containing `{not json` throws `TN_NATIVE_ASSET_MANIFEST_INVALID`, never a silent pass |
| browser | a plain web Vite build of the same game, driven by the project's own Vite with none of our plugins and no native conditions, still contains `class KTX2Loader`, `basis_transcoder` and `WebAssembly`, and neither refusal code |

The browser KTX2 path is additionally covered, unchanged, by `packages/core/__tests__/assets.spec.ts`,
which drives `createAssetLoader` against three's real `KTX2Loader` prototype. `packages/core` was not
modified by this change.

### Gates

```
$ pnpm typecheck; echo $?
… packages/create-threenative typecheck: Done      (11 workspaces Done)
0

$ pnpm lint; echo $?
Checked 935 files in 542ms. No fixes applied.
Found 289 warnings.                                (0 errors; 289 pre-existing complexity warnings)
0

$ pnpm run check:docs
Checked 750 relative documentation links across 578 Markdown files.

$ npx vitest run
 Test Files  1 failed | 193 passed (194)
      Tests  1 failed | 1861 passed (1862)

$ pnpm budgets
capability docs: 43 public class/function exports carry complete doc tags
budgets trigger: framework LOC review trigger: 18260 lines (trigger 15000, +3260)…
budgets ok: 8 framework packages, 8 example workspaces, 18260/15000 framework LOC, 80081/100000 native runtime LOC, 11 PRD files, largest template 2404 LOC, no compiled texture manifests found
ctx-surface supersession table in sync with capabilities.json
capability reference in sync with capabilities.json
examples: no superseded constructs across 51 files
```

The single unit failure is `scripts/__tests__/check-capability-docs.spec.ts`, "should scan subpath
exports", timing out at its 5 s budget under a load average of 37.75 on 24 cores with several lanes
running. Re-run alone it passes in 2.39 s:

```
$ npx vitest run scripts/__tests__/check-capability-docs.spec.ts
 ✓ scripts/__tests__/check-capability-docs.spec.ts (7 tests) 4793ms
     ✓ should scan subpath exports, not only the main package index  2394ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

It touches no file this change edits. `pnpm test` itself stops earlier, in its `package-test` phase,
on `packages/playtest/__tests__/orphan-cleanup.sh` finding a Chromium under
`/tmp/playwright_chromiumdev_profile-X0vg6D` that belongs to another lane; that is the known
environmental failure on this machine, so the `unit` phase was run directly as `npx vitest run`
above. The framework LOC trigger reports rather than fails, and was already over at HEAD (18,183);
this change adds 77 lines to it.

`pnpm census` was re-run because `packages/runtime-native/` changed. It moved `scripts/` from 12,237
to 12,341 (this change) and `native/` from 3,276 to 3,366 (pre-existing drift from another lane,
confirmed by running `pnpm budgets` against a stashed tree).

## What did NOT execute

- **No device ran.** No APK was built, installed, or launched. The Pixel 8 at `192.168.1.192:5555`
  is leased to another lane and `adb` was not run. The green above is a bundler and build-gate
  result: the android bundle now passes the guard that stood between the build and the packager, and
  nothing here claims a frame on a phone.
- **No iOS device or simulator ran.** The `ios` target is covered only by the same bundle-level
  assertions as android.
- **`pnpm native:build`, `pnpm native:verify:desktop`, `pnpm parity` and the conformance registry did
  not run.** No C++ was touched.
- **`pnpm test:playtest` and `pnpm test:templates` did not run.** No runtime game behaviour changed
  on the web target, and the browser bundle is byte-for-byte unaffected by the mobile-only plugin.

## Open

- A mobile game that genuinely wants compressed textures or compressed geometry still has no path.
  The honest position today is that it must compile those assets uncompressed for native. A native
  Basis or Meshopt decoder is a runtime question and is not opened here.
- `assertNativeAssetsCompatible` reads the compiled manifest. A `.ktx2` or a meshopt `.glb` fetched
  from an external URL at runtime is not visible to it and will fail on device against the stub's
  named error rather than at build time.
- Models carrying `KHR_texture_basisu` are not inspected: the manifest records the model's declared
  extensions, and a basisu texture inside a `.glb` is not one of the three this refuses on.
- The templates' `AGENTS.md` was not changed. They already state that Android and iOS fail closed
  for consumers, so no platform claim there is overstated by this change.
