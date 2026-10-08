import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTools } from "./verify-android-first-proof.mjs";

// Reuse the Android lane's JDK 17 and SDK discovery; no JS bundle or V8 assets are staged.
const android = fileURLToPath(new URL("../android/", import.meta.url));
try {
  const { javaHome, sdkRoot } = discoverTools();
  const result = spawnSync(
    "sh",
    [
      resolve(android, "gradlew"),
      "-PthreenativeNativeEngine=true",
      ":engine-player:assembleDebug",
      ...process.argv.slice(2),
    ],
    {
      cwd: android,
      env: {
        ...process.env,
        JAVA_HOME: javaHome,
        ANDROID_HOME: sdkRoot,
        ANDROID_SDK_ROOT: sdkRoot,
      },
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (process.exitCode === 0) {
    const output = resolve(android, "../build/android-apk-proof");
    const apk = resolve(output, "native-engine.apk");
    mkdirSync(output, { recursive: true });
    copyFileSync(resolve(android, "engine-player/build/outputs/apk/debug/engine-player-debug.apk"), apk);
    console.log(apk);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
