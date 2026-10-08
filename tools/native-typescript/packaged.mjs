// Runs one linked Perry Android library inside a packaged app (PRD-507). The standalone loader
// proves the library runs; this proves it runs the way a game ships: inside an APK, loaded by an
// activity in the app process, with the page alignment AGP gives a packaged library.
//
// The APK is android/corpus-player: a minimal activity built by the engine host's own Gradle
// wrapper, AGP, SDK and NDK. The library is staged through -PcorpusLibs, so the activity needs no
// knowledge of the case. The activity leaves stdout, stderr and the exit code in its files
// directory, which a debuggable build lets `run-as` read back.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTools } from "../../packages/runtime-native/scripts/verify-android-first-proof.mjs";
import { adbRun } from "./device.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const PLAYER = path.join(HERE, "android", "corpus-player");
const HOST_ANDROID = path.join(REPO, "packages", "runtime-native", "android");
export const PACKAGE = "com.threenative.corpusplayer";
const APK = path.join(PLAYER, "app", "build", "outputs", "apk", "debug", "app-debug.apk");

function named(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

/**
 * The Gradle the engine host's Android project pins (gradle-wrapper.properties). The wrapper jar is
 * not checked in, so the distribution the wrapper unpacked into ~/.gradle is used directly; the
 * wrapper script itself is the fallback when a jar is present.
 */
export function resolveGradle(env = process.env) {
  const properties = fs.readFileSync(
    path.join(HOST_ANDROID, "gradle", "wrapper", "gradle-wrapper.properties"),
    "utf8",
  );
  const version = /gradle-([\d.]+)-bin\.zip/u.exec(properties)?.[1];
  if (version === undefined)
    throw named("TN_NATIVE_TS_PACKAGE", "gradle-wrapper.properties pins no gradle");
  const home = env.GRADLE_USER_HOME ?? path.join(os.homedir(), ".gradle");
  const dists = path.join(home, "wrapper", "dists", `gradle-${version}-bin`);
  for (const hash of fs.existsSync(dists) ? fs.readdirSync(dists) : []) {
    const gradle = path.join(dists, hash, `gradle-${version}`, "bin", "gradle");
    if (fs.existsSync(gradle)) return gradle;
  }
  throw named(
    "TN_NATIVE_TS_PACKAGE",
    `gradle ${version} is not unpacked under ${dists}; run packages/runtime-native/android/gradlew once with a wrapper jar`,
  );
}

/** Builds the player APK with `library` as its only native library, and returns the APK path. */
export function buildPlayer(library, { env = process.env } = {}) {
  const { javaHome, sdkRoot } = discoverTools(env);
  const libs = path.join(PLAYER, "corpus-libs");
  fs.rmSync(libs, { recursive: true, force: true });
  fs.mkdirSync(path.join(libs, "arm64-v8a"), { recursive: true });
  fs.copyFileSync(library, path.join(libs, "arm64-v8a", path.basename(library)));
  fs.rmSync(path.dirname(APK), { recursive: true, force: true });
  const gradle = spawnSync(
    resolveGradle(env),
    ["-p", PLAYER, ":app:assembleDebug", `-PcorpusLibs=${libs}`],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      // Environment variable names are SCREAMING_SNAKE and must keep that spelling.
      env: Object.assign(
        { ...env },
        Object.fromEntries([
          ["JAVA_HOME", javaHome],
          ["ANDROID_HOME", sdkRoot],
          ["ANDROID_SDK_ROOT", sdkRoot],
        ]),
      ),
    },
  );
  if (gradle.status !== 0) {
    const tail = `${gradle.stdout}${gradle.stderr}`.trim().split("\n").slice(-12).join("\n");
    throw named("TN_NATIVE_TS_PACKAGE", `gradle exited ${gradle.status}\n${tail}`);
  }
  return APK;
}

/** The library names the APK actually carries, so a stale build cannot pass for the one asked for. */
export function apkLibraries(apk) {
  const listing = spawnSync("unzip", ["-Z1", apk], { encoding: "utf8" });
  if (listing.status !== 0) throw named("TN_NATIVE_TS_PACKAGE", `cannot list ${apk}`);
  return listing.stdout.split("\n").filter((entry) => /^lib\/arm64-v8a\/lib.+\.so$/u.test(entry));
}

async function readRemote(adb, serial, file) {
  const read = await adbRun(adb, serial, ["exec-out", "run-as", PACKAGE, "cat", `files/${file}`]);
  return read.status === 0 ? read.stdout : undefined;
}

/**
 * Installs the APK, launches the activity for `name` and waits for its exit record. The result has
 * the shape of a host run, so the corpus comparison is the same code.
 */
export async function runPackaged({ adb, serial, name, library, timeoutMs = 120_000 }) {
  const apk = buildPlayer(library);
  const expected = `lib/arm64-v8a/lib${name}.so`;
  if (!apkLibraries(apk).includes(expected)) {
    throw named("TN_NATIVE_TS_PACKAGE", `${apk} does not carry ${expected}`);
  }
  await adbRun(adb, serial, ["uninstall", PACKAGE]);
  const install = await adbRun(adb, serial, ["install", "-r", "-t", apk], { timeoutMs: 300_000 });
  if (install.status !== 0 || !install.stdout.toString().includes("Success")) {
    throw named(
      "TN_NATIVE_TS_PACKAGE",
      `adb install failed: ${install.stdout}${install.stderr}`.trim(),
    );
  }
  try {
    const start = await adbRun(adb, serial, [
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      `${PACKAGE}/.CorpusActivity`,
      "--es",
      "lib",
      name,
    ]);
    if (start.status !== 0 || /Error/u.test(start.stdout.toString())) {
      throw named("TN_NATIVE_TS_PACKAGE", `am start failed: ${start.stdout}${start.stderr}`.trim());
    }
    const deadline = Date.now() + timeoutMs;
    let exit;
    while (Date.now() < deadline && exit === undefined) {
      exit = await readRemote(adb, serial, "exit.txt");
      if (exit === undefined) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (exit === undefined) {
      throw named(
        "TN_NATIVE_TS_PACKAGE",
        `the activity left no exit record within ${timeoutMs} ms`,
      );
    }
    const stdout = (await readRemote(adb, serial, "stdout.bin")) ?? Buffer.alloc(0);
    const stderr = (await readRemote(adb, serial, "stderr.txt")) ?? Buffer.alloc(0);
    const status = Number.parseInt(exit.toString().trim(), 10);
    if (!Number.isInteger(status)) {
      throw named(
        "TN_NATIVE_TS_PACKAGE",
        `the exit record is unreadable: ${JSON.stringify(exit.toString())}`,
      );
    }
    return {
      stdout,
      status,
      stderr: stderr.toString(),
      peakRssBytes: 0,
    };
  } finally {
    await adbRun(adb, serial, ["shell", "am", "force-stop", PACKAGE]);
    await adbRun(adb, serial, ["uninstall", PACKAGE]);
  }
}
