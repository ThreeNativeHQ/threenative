#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function packageAndroid(bundle, requestedOutput) {
  const gradlew = join(runtimeRoot, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (!existsSync(gradlew) || !existsSync(join(runtimeRoot, 'CMakeLists.txt'))) {
    throw new Error(
      'Android target is OPEN: no prebuilt Gradle runtime is published; the source project requires an NDK.',
    );
  }
  if (!existsSync(bundle)) throw new Error(`Missing native bundle: ${bundle}`);
  const assetBundle = join(runtimeRoot, 'android', 'app', 'src', 'main', 'assets', 'scripts', 'main.js');
  mkdirSync(dirname(assetBundle), { recursive: true });
  copyFileSync(bundle, assetBundle);
  const command = process.platform === 'win32' ? gradlew : 'sh';
  const args = process.platform === 'win32'
    ? ['assembleDebug', '-x', 'buildAndroidFirstProofBundle']
    : [gradlew, 'assembleDebug', '-x', 'buildAndroidFirstProofBundle'];
  const result = spawnSync(command, args, {
    cwd: join(runtimeRoot, 'android'),
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Gradle exited with code ${result.status ?? 'unknown'}.`);
  const apk = join(runtimeRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!existsSync(apk)) throw new Error(`Gradle did not produce the expected APK: ${apk}`);
  const output = requestedOutput ? resolve(requestedOutput) : apk;
  if (output !== apk) {
    mkdirSync(dirname(output), { recursive: true });
    copyFileSync(apk, output);
  }
  console.log(`ThreeNative Android APK: ${output}`);
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const bundleIndex = process.argv.indexOf('--bundle');
  const outputIndex = process.argv.indexOf('--output');
  if (bundleIndex === -1 || !process.argv[bundleIndex + 1]) {
    console.error('Usage: package-android.mjs --bundle FILE');
    process.exitCode = 1;
  } else {
    try {
      packageAndroid(
        resolve(process.argv[bundleIndex + 1]),
        outputIndex === -1 ? undefined : process.argv[outputIndex + 1],
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
