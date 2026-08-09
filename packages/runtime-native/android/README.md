# Mystral Native - Android Build

## Prerequisites

1. **Android Studio** (or command-line SDK tools)
2. **Android NDK** r25 or later
3. **CMake** 3.22.1+
4. **Mystral dependencies** downloaded

## Download Dependencies

```bash
# From the repository root
cd /path/to/threejs-mystral

# Download Android-specific dependencies
node scripts/download-deps.mjs --android

# Also need the shared header-only and JavaScript-engine dependencies
node scripts/download-deps.mjs --only stb
node scripts/download-deps.mjs --only quickjs
```

This downloads:
- `wgpu-android` - WebGPU implementation (aarch64, x86_64)
- `sdl3-android` - SDL3 Android development package

## Build with Android Studio

1. Open the `android/` folder in Android Studio
2. Let Gradle sync (will download Android SDK components)
3. Build > Make Project

## Build from Command Line

```bash
# From the repository root. The gate discovers adb, Android SDK, and JDK 17.
npm run test:android:first-proof
```

The gate performs the complete first-proof sequence:

1. Builds the debug APK and reproducible upstream Three.js WebGPU bundle.
2. Installs and launches `com.mystral.engine/.MystralActivity` on the only online device.
3. Captures app logcat to `artifacts/android/first-proof-logcat.txt`.
4. Requires the exact `first proof cube ready` marker and a live process after a 3-second stability window.
5. Rejects fatal signals, `RangeError`, WebGPU validation failures, and shader errors.

When more than one device is online, select one explicitly:

```bash
npm run test:android:first-proof -- --device emulator-5554
```

The gate checks `THREENATIVE_ADB`, `THREENATIVE_ANDROID_SDK`, and
`THREENATIVE_JAVA_HOME` before standard SDK/JDK locations. To capture a visual
proof with PNG dimensions and SHA-256 metadata in the JSON report:

```bash
npm run test:android:first-proof -- \
  --screenshot artifacts/android/first-proof.png
```

For a manual Gradle-only build:

```bash
cd android

# Debug build
bash ./gradlew assembleDebug

# Release build
bash ./gradlew assembleRelease

# Install on connected device
bash ./gradlew installDebug
```

## Architecture Support

| ABI | Description | Notes |
|-----|-------------|-------|
| `arm64-v8a` | ARM64 (most devices) | Primary target |
| `x86_64` | Intel/AMD 64-bit | Emulator support |

## Project Structure

```
android/
├── app/
│   ├── build.gradle.kts     # App build config with NDK/CMake settings
│   ├── proguard-rules.pro   # ProGuard config
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/mystral/engine/
│       │   └── MystralActivity.java    # SDL Activity subclass
│       └── res/
│           └── values/
│               ├── strings.xml
│               └── themes.xml
├── build.gradle.kts         # Root build file
├── gradle.properties        # Gradle/NDK settings
└── settings.gradle.kts      # Project settings
```

## How It Works

1. **SDLActivity** handles the Android lifecycle and creates a native window
2. **wgpu-native** creates a Vulkan surface from the ANativeWindow
3. **QuickJS** runs the JavaScript game code
4. **SDL3** provides input (touch, gamepad) and audio

## Loading Scripts

Scripts can be loaded from:
- **Assets**: `asset://scripts/main.js`
- **Internal storage**: `/data/data/com.mystral.engine/files/game.js`
- **External URL**: `https://example.com/game.js` (requires INTERNET permission)

## Debugging

```bash
# View native logs
adb logcat -s Mystral SDL

# View all logs from app
adb logcat --pid=$(adb shell pidof com.mystral.engine)
```

Run the gate's emulator-free unit coverage with:

```bash
npm run test:android:first-proof:unit
```

## Known Issues

1. **Vulkan 1.1 required** - Devices must support Vulkan 1.1 (Android 7.0+)
2. **No Canvas 2D yet** - Skia Android builds not integrated
3. **HTTP uses curl** - Should migrate to Java HttpURLConnection for better Android integration
