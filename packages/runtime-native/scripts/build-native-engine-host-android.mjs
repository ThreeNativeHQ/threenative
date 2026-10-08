// Builds tn-native-engine-host (the CP1 game host: a workload on V8 through the adapter, or its C++
// twin) for arm64 Android as a plain executable. It draws offscreen through wgpu-native's Vulkan
// device, so `adb shell` runs it with no window; `pnpm bench:engines --target android` pushes it.
// The Android payloads (V8 with its snapshot, wgpu-native, SDL3) come from scripts/download-deps.mjs
// --android; the V8 one is a source build (see build-android-v8.mjs) and carries a receipt.
//
//   node scripts/build-native-engine-host-android.mjs [-j N]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? join(homedir(), "Android", "Sdk");
const NDK_VERSION = "28.2.13676358";
const ndk = process.env.ANDROID_NDK_HOME ?? join(sdk, "ndk", NDK_VERSION);
const buildDirectory = join(root, "build", "tn-android-host");
const jobsIndex = process.argv.indexOf("-j");
const jobs = jobsIndex === -1 ? "4" : process.argv[jobsIndex + 1];

if (!existsSync(join(ndk, "build", "cmake", "android.toolchain.cmake"))) {
  console.error(`TN_ANDROID_NDK_MISSING: ${ndk}; install NDK ${NDK_VERSION} or set ANDROID_NDK_HOME`);
  process.exit(1);
}
const ninja = join(sdk, "cmake", "3.22.1", "bin", "ninja");

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// The tn-android preset's options, minus what an executable for `adb shell` does not need.
run("cmake", [
  "-S", root,
  "-B", buildDirectory,
  "-G", "Ninja",
  ...(existsSync(ninja) ? [`-DCMAKE_MAKE_PROGRAM=${ninja}`] : []),
  "-DCMAKE_BUILD_TYPE=Release",
  `-DCMAKE_TOOLCHAIN_FILE=${join(ndk, "build", "cmake", "android.toolchain.cmake")}`,
  "-DANDROID_ABI=arm64-v8a",
  "-DANDROID_PLATFORM=android-26",
  "-DANDROID_STL=c++_shared",
  "-DCMAKE_POSITION_INDEPENDENT_CODE=ON",
  "-DMYSTRAL_USE_V8=ON",
  "-DMYSTRAL_USE_JSC=OFF",
  "-DMYSTRAL_USE_QUICKJS=OFF",
  "-DMYSTRAL_USE_DAWN=OFF",
  "-DMYSTRAL_USE_WGPU=ON",
  "-DTN_ENABLE_CANVAS2D=OFF",
  "-DTN_ENABLE_VIDEO=OFF",
  "-DTN_ENABLE_RAYTRACING=OFF",
  "-DTN_ENABLE_WEBTRANSPORT=OFF",
  "-DTN_ENABLE_NATIVE_GLTF=OFF",
  "-DTN_ENABLE_DRACO=OFF",
  "-DTN_ENABLE_DEBUG_SERVER=OFF",
  "-DTN_ENABLE_NATIVE_PHYSICS=OFF",
]);
run("cmake", ["--build", buildDirectory, "--target", "tn-native-engine-host", "-j", jobs]);
console.log(join(buildDirectory, "tn-native-engine-host"));
