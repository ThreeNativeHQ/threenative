# @threenative/runtime-native

## What it is

`@threenative/runtime-native` is the optional ThreeNative host for running the same portable game
entry on desktop, Android, and iOS. Native compilation is opt-in: installing this package does
not require CMake, an NDK, or Xcode. It is a host, not a second renderer or scene API; upstream
Three.js and the game's `src/game.ts` remain the portable runtime contract.

## Install

Add the optional native host when you want native builds:

```sh
pnpm add @threenative/runtime-native
```

## Example

The `minimal` template ships the native build command:

```sh
pnpm create threenative my-game --template minimal
cd my-game
pnpm install
pnpm build:desktop
```

The template's `threenative.config.ts` uses `nativeEntry: "src/game.ts"`; native builds read that
portable entry and bundle it as the game's single native module.

## Where the native binaries come from

An installed copy of this package contains no C++ and no build system. `build --target android`
therefore downloads prebuilt artifacts for the version you installed, listed in the release's
`prebuilt-lock.json`, and verifies each one against the SHA-256 the manifest records. Only an
Android SDK and a JDK are needed; no NDK, no CMake, and nothing is compiled on your machine.

Two environment variables change where those artifacts come from.

### `THREENATIVE_PREBUILT_MANIFEST`

Points at a local `prebuilt-lock.json` instead of the release URL. Use it to build against
artifacts you already have, or offline. Checksums are still verified, and a manifest missing an
asset still fails by name — it redirects the lookup, it does not relax it.

### `THREENATIVE_RUNTIME_SOURCE` — needs a full engine checkout, not an installed package

Points the packager at a **source checkout** of `packages/runtime-native` from the ThreeNative
repository, so it compiles rather than downloading. It cannot be pointed at an installed copy of
this package, and pointing it at one will not work: the packager only takes the source path when it
finds both `CMakeLists.txt` and a staged `third_party/sdl3-android/SDL3-3.2.8.aar`, and a published
tarball ships neither. The `third_party/` tree is populated by `node scripts/download-deps.mjs`
inside that checkout.

If you have no engine checkout, the prebuilt path above is your path — `THREENATIVE_RUNTIME_SOURCE`
is not a way around a failing download.

## Links

- [Repository](https://github.com/ThreeNativeHQ/threenative)
- [MIT License](https://github.com/ThreeNativeHQ/threenative/blob/main/LICENSE)
- Start a project with `pnpm create threenative my-game`.
