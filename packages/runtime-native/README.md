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

## Links

- [Repository](https://github.com/ThreeNativeHQ/threenative)
- [MIT License](https://github.com/ThreeNativeHQ/threenative/blob/main/LICENSE)
- Start a project with `pnpm create threenative my-game`.
