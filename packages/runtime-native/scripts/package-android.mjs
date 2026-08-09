#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { downloadReleaseArtifact, verifyChecksum } from './install-prebuilt.mjs';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GRADLE_WRAPPER_URL =
  'https://raw.githubusercontent.com/gradle/gradle/v8.5.0/gradle/wrapper/gradle-wrapper.jar';
export const GRADLE_WRAPPER_SHA256 =
  'd3b261c2820e9e3d8d639ed084900f11f4a86050a8f83342ade7b6bc9b0d2bdd';

export const ANDROID_PREBUILT_ASSETS = {
  'android-arm64-v8a-runtime': 'jniLibs/arm64-v8a/libmystral-runtime.so',
  'android-arm64-v8a-sdl3': 'jniLibs/arm64-v8a/libSDL3.so',
  'android-sdl3-aar': 'SDL3-3.2.8.aar',
  'android-x86_64-runtime': 'jniLibs/x86_64/libmystral-runtime.so',
  'android-x86_64-sdl3': 'jniLibs/x86_64/libSDL3.so',
};

export async function prepareAndroidPrebuilts(options = {}) {
  const downloads = await Promise.all(
    Object.keys(ANDROID_PREBUILT_ASSETS).map(async (key) => [
      key,
      await downloadReleaseArtifact(key, options),
    ]),
  );
  const prebuiltRoot = resolve(options.outputRoot ?? join(runtimeRoot, 'android', 'prebuilt'));
  for (const [key, contents] of downloads) {
    const output = join(prebuiltRoot, ANDROID_PREBUILT_ASSETS[key]);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, contents);
  }
  return prebuiltRoot;
}

export async function ensureGradleWrapper(options = {}) {
  const output = resolve(
    options.output ?? join(runtimeRoot, 'android', 'gradle', 'wrapper', 'gradle-wrapper.jar'),
  );
  const expected = options.sha256 ?? GRADLE_WRAPPER_SHA256;
  if (existsSync(output)) {
    verifyChecksum(readFileSync(output), expected, 'gradle-wrapper');
    return output;
  }
  const url = new URL(options.url ?? GRADLE_WRAPPER_URL);
  if (url.protocol !== 'https:' && process.env.THREENATIVE_ALLOW_INSECURE_PREBUILT !== '1') {
    throw new Error('Gradle wrapper URL must use HTTPS.');
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Gradle wrapper fetch failed: HTTP ${response.status}.`);
  const contents = Buffer.from(await response.arrayBuffer());
  verifyChecksum(contents, expected, 'gradle-wrapper');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, contents);
  return output;
}

function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const path = relative ? posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(directory, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported Android asset entry: ${join(directory, path)}`);
  }
  return files.sort();
}

export function stageAndroidAssets(
  assets,
  destination = join(runtimeRoot, 'android', 'app', 'src', 'main', 'assets', 'game'),
) {
  rmSync(destination, { force: true, recursive: true });
  mkdirSync(destination, { recursive: true });
  if (!assets || !existsSync(assets)) return [];
  if (!statSync(assets).isDirectory()) {
    throw new Error(`Android assets path is not a directory: ${assets}`);
  }
  const files = listFiles(assets);
  for (const file of files) {
    const output = join(destination, file);
    mkdirSync(dirname(output), { recursive: true });
    cpSync(join(assets, file), output);
  }
  return files;
}

export async function packageAndroid(bundle, requestedOutput, assets) {
  const gradlew = join(
    runtimeRoot,
    'android',
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
  );
  if (!existsSync(gradlew)) throw new Error(`Android Gradle wrapper is missing: ${gradlew}`);
  if (!existsSync(bundle)) throw new Error(`Missing native bundle: ${bundle}`);
  await ensureGradleWrapper();
  const sourceCheckout =
    existsSync(join(runtimeRoot, 'CMakeLists.txt')) &&
    existsSync(join(runtimeRoot, 'third_party', 'sdl3-android', 'SDL3-3.2.8.aar'));
  if (!sourceCheckout) await prepareAndroidPrebuilts();
  const assetBundle = join(
    runtimeRoot,
    'android',
    'app',
    'src',
    'main',
    'assets',
    'scripts',
    'main.js',
  );
  mkdirSync(dirname(assetBundle), { recursive: true });
  copyFileSync(bundle, assetBundle);
  stageAndroidAssets(assets);
  const command = process.platform === 'win32' ? gradlew : 'sh';
  const args =
    process.platform === 'win32'
      ? ['assembleDebug', '-x', 'buildAndroidFirstProofBundle']
      : [gradlew, 'assembleDebug', '-x', 'buildAndroidFirstProofBundle'];
  const result = spawnSync(command, args, {
    cwd: join(runtimeRoot, 'android'),
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`Gradle exited with code ${result.status ?? 'unknown'}.`);
  const apk = join(
    runtimeRoot,
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    'debug',
    'app-debug.apk',
  );
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
  const assetsIndex = process.argv.indexOf('--assets');
  if (
    bundleIndex === -1 ||
    !process.argv[bundleIndex + 1] ||
    process.argv[bundleIndex + 1].startsWith('--')
  ) {
    console.error('Usage: package-android.mjs --bundle FILE [--output FILE] [--assets DIR]');
    process.exitCode = 1;
  } else if (
    assetsIndex !== -1 &&
    (!process.argv[assetsIndex + 1] || process.argv[assetsIndex + 1].startsWith('--'))
  ) {
    console.error('--assets requires a value.');
    process.exitCode = 1;
  } else if (
    outputIndex !== -1 &&
    (!process.argv[outputIndex + 1] || process.argv[outputIndex + 1].startsWith('--'))
  ) {
    console.error('--output requires a value.');
    process.exitCode = 1;
  } else {
    try {
      await packageAndroid(
        resolve(process.argv[bundleIndex + 1]),
        outputIndex === -1 ? undefined : process.argv[outputIndex + 1],
        assetsIndex === -1 ? undefined : resolve(process.argv[assetsIndex + 1]),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
