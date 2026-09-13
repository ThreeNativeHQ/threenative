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

## Desktop release containers and player prerequisites

`build --target desktop` produces the raw host executable by default. `--mode release` wraps the
compiled executable, the built `ui/` bundle and the shared libraries that executable actually loads
into one relocatable container for the host OS:

```sh
pnpm exec threenative build --target desktop --mode release
```

- **Linux** — a `tar.gz` with the executable, `ui/`, non-system libraries under `lib/`, and a
  `.desktop` entry plus icon under `share/`.
- **macOS** — a `<Name>.app` inside a ZIP, with `Contents/MacOS/<exe>`, `Contents/Resources` and an
  `Info.plist` carrying the game's id, name, version and build.
- **Windows** — a ZIP with `<Name>.exe` (icon and version embedded), `ui/` and non-system DLLs.

Each container carries `threenative-container.json`: the app identity, the executable, every
bundled dependency with a SHA-256, and every system library recorded as a player prerequisite. All
of it resolves relative to the container root, so a container can be unpacked and moved anywhere; a
resource that is missing or whose bytes changed is refused. Release containers are **unsigned** —
signing and notarization are a separate step.

### Player prerequisites

The container does not ship the platform's WebView or windowing stack. The player machine provides:

| OS | Prerequisite | Install |
| --- | --- | --- |
| Linux | WebKitGTK 4.1 and GTK 3 | Debian/Ubuntu: `sudo apt-get install -y libwebkit2gtk-4.1-0 libgtk-3-0`; Fedora: `sudo dnf install webkit2gtk4.1 gtk3`; Arch: `sudo pacman -S webkit2gtk-4.1 gtk3` |
| Windows | Microsoft Edge WebView2 Evergreen Runtime | <https://developer.microsoft.com/microsoft-edge/webview2/> |
| macOS | System WebKit | included with macOS |

The verifier inspects an unpacked container, refuses to launch when a player prerequisite is
absent, and names the missing library with its install step rather than a bare loader error:

```sh
node node_modules/@threenative/runtime-native/scripts/verify-starter-desktop.mjs --container <unpacked-directory>
```

### Standard distribution recipe

1. Build: `pnpm exec threenative build --target desktop --mode release`.
2. Verify on a player image with no Node and no engine checkout:
   `verify-starter-desktop.mjs --container <unpacked-directory>`.
3. Hand the archive to your installer or store depot, signing it first where the store requires it.

## Release builds and signing

`build --target android` produces a debug APK by default. Release output is an explicit request:

```sh
pnpm exec threenative build --target android --mode release --format apk   # signed APK
pnpm exec threenative build --target android --mode release --format aab   # Play app bundle
```

A release is signed with **your** key. There is no debug-key fallback: when signing is not
configured the packager refuses the release rather than shipping an unsigned or debug-signed
artifact. Supply the key as the four Gradle project properties below, from the game's build
environment. Paths are resolved relative to the project; nothing is written into the engine.

| Environment variable | Meaning |
| --- | --- |
| `ORG_GRADLE_PROJECT_threenativeKeystore` | Path to the keystore (`.jks`/`.keystore`). |
| `ORG_GRADLE_PROJECT_threenativeKeystoreAlias` | Key alias inside the keystore. |
| `ORG_GRADLE_PROJECT_threenativeKeystorePassword` | Keystore password. |
| `ORG_GRADLE_PROJECT_threenativeKeyPassword` | Key password. |

Values are read only inside the signing subprocess and are never printed or serialized into
packaging output. The final APK is verified with `apksigner`, and its packaged `targetSdkVersion`
and non-debuggable state are read back with `aapt`; a release AAB is verified with `jarsigner`. A
signature, target level or debuggable check that cannot be satisfied fails the build. Native symbols
are stripped from the artifact by the Android Gradle plugin and are produced separately for symbol
archives.

## Links

- [Repository](https://github.com/ThreeNativeHQ/threenative)
- [MIT License](https://github.com/ThreeNativeHQ/threenative/blob/main/LICENSE)
- Start a project with `pnpm create threenative my-game`.
