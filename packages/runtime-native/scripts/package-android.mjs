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
export const NATIVE_ORIENTATIONS = ['landscape', 'portrait', 'sensor'];

function androidPaths(root = runtimeRoot) {
  return {
    androidRoot: join(root, 'android'),
    androidManifest: join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    androidStrings: join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
    androidTheme: join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'themes.xml'),
    androidGradle: join(root, 'android', 'app', 'build.gradle.kts'),
    androidIcon: join(
      root,
      'android',
      'app',
      'src',
      'main',
      'res',
      'mipmap-xxxhdpi',
      'ic_launcher.png',
    ),
  };
}

export const DEFAULT_ANDROID_CONFIG = {
  app: { id: 'com.threenative.game', name: 'ThreeNative', version: '0.1.0', build: 1 },
  display: { orientation: 'landscape', fullscreen: true, keepScreenOn: false },
  window: { title: 'ThreeNative', width: 1280, height: 720, resizable: true },
};

function configValue(value, orientation) {
  const source = value && typeof value === 'object' ? value : {};
  const app = source.app && typeof source.app === 'object' ? source.app : {};
  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const window = source.window && typeof source.window === 'object' ? source.window : {};
  return {
    app: { ...DEFAULT_ANDROID_CONFIG.app, ...app },
    display: {
      ...DEFAULT_ANDROID_CONFIG.display,
      ...display,
      orientation: orientation ?? display.orientation ?? DEFAULT_ANDROID_CONFIG.display.orientation,
    },
    window: { ...DEFAULT_ANDROID_CONFIG.window, ...window },
  };
}

export function readAndroidConfig(configPath) {
  if (configPath === undefined) return configValue();
  try {
    return configValue(JSON.parse(readFileSync(configPath, 'utf8')));
  } catch (error) {
    throw new Error(`TN_CONFIG_FILE_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function xmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function setXmlAttribute(tag, name, value) {
  const attribute = `android:${name}`;
  const pattern = new RegExp(`\\s${attribute}="[^"]*"`, 'u');
  if (value === undefined) return tag.replace(pattern, '');
  const rendered = ` ${attribute}="${xmlEscape(value)}"`;
  return pattern.test(tag) ? tag.replace(pattern, rendered) : tag.replace(/>$/u, `${rendered}>`);
}

function upsertApplicationMetadata(source, name, value) {
  const rendered = `        <meta-data android:name="${name}" android:value="${xmlEscape(value)}" />`;
  const existing = new RegExp(`\\n[ \\t]*<meta-data\\b[^>]*android:name="${name}"[^>]*/>`, 'gu');
  const withoutExisting = source.replace(existing, '');
  return withoutExisting.replace(/\s*<\/application>/u, `\n${rendered}\n    </application>`);
}

function orientationValue(value = 'landscape') {
  if (typeof value === 'string' && NATIVE_ORIENTATIONS.includes(value)) return value;
  throw new Error(
    'TN_NATIVE_ORIENTATION_INVALID: display.orientation must be landscape, portrait, or sensor.',
  );
}

export function renderAndroidManifest(source, orientation = 'landscape') {
  const config = configValue(typeof orientation === 'string' ? undefined : orientation, typeof orientation === 'string' ? orientation : undefined);
  const value = orientationValue(config.display.orientation);
  const application = /<application\b[^>]*>/u.exec(source);
  if (!application) throw new Error('TN_ANDROID_MANIFEST_APPLICATION_MISSING: no application was found.');
  const activity = /<activity\b[^>]*>/u.exec(source);
  if (!activity) throw new Error('TN_ANDROID_MANIFEST_ACTIVITY_MISSING: no activity was found.');
  let rendered = source.replace(
    application[0],
    setXmlAttribute(application[0], 'icon', config.app.icon === undefined ? undefined : '@mipmap/ic_launcher'),
  );
  const renderedActivity = setXmlAttribute(
    activity[0],
    'screenOrientation',
    value,
  );
  rendered = rendered.replace(activity[0], renderedActivity);
  rendered = upsertApplicationMetadata(rendered, 'TN_KEEP_SCREEN_ON', String(config.display.keepScreenOn));
  rendered = upsertApplicationMetadata(rendered, 'TN_WINDOW_TITLE', '@string/window_title');
  return upsertApplicationMetadata(rendered, 'TN_FULLSCREEN', String(config.display.fullscreen));
}

export function renderAndroidStrings(source, config) {
  const value = configValue(config);
  let rendered = source.replace(/(<string\s+name="app_name">)[\s\S]*?(<\/string>)/u, `$1${xmlEscape(value.app.name)}$2`);
  if (!/<string\s+name="window_title">/u.test(rendered)) {
    rendered = rendered.replace(/\s*<\/resources>/u, `\n    <string name="window_title">${xmlEscape(value.window.title)}</string>\n</resources>`);
  } else {
    rendered = rendered.replace(/(<string\s+name="window_title">)[\s\S]*?(<\/string>)/u, `$1${xmlEscape(value.window.title)}$2`);
  }
  return rendered;
}

export function renderAndroidTheme(source, config) {
  const value = configValue(config);
  const fullscreen = String(value.display.fullscreen);
  const parent = value.display.fullscreen ? 'android:Theme.NoTitleBar.Fullscreen' : 'android:Theme.NoTitleBar';
  let rendered = source.replace(/(parent=")[^"]*(")/u, `$1${parent}$2`);
  const item = /<item\s+name="android:windowFullscreen">[\s\S]*?<\/item>/u;
  if (item.test(rendered)) return rendered.replace(item, `<item name="android:windowFullscreen">${fullscreen}</item>`);
  return rendered.replace(/\s*<\/style>/u, `\n        <item name="android:windowFullscreen">${fullscreen}</item>\n    </style>`);
}

export function renderAndroidBuildGradle(source, config) {
  const value = configValue(config);
  let rendered = source.replace(/(namespace\s*=\s*")[^"]*(")/u, `$1${value.app.id}$2`);
  rendered = rendered.replace(/(applicationId\s*=\s*")[^"]*(")/u, `$1${value.app.id}$2`);
  rendered = rendered.replace(/(versionCode\s*=\s*)\d+/u, `$1${value.app.build}`);
  return rendered.replace(/(versionName\s*=\s*")[^"]*(")/u, `$1${value.app.version}$2`);
}

function restoreFile(file, original) {
  if (original === undefined) rmSync(file, { force: true });
  else writeFileSync(file, original);
}

function installAndroidFiles(config, root = runtimeRoot) {
  const {
    androidManifest,
    androidStrings,
    androidTheme,
    androidGradle,
    androidIcon,
  } = androidPaths(root);
  if (config.app.icon !== undefined && (!existsSync(config.app.icon) || !statSync(config.app.icon).isFile())) {
    throw new Error(`TN_CONFIG_ICON_MISSING: app.icon does not exist: ${config.app.icon}`);
  }
  const originals = new Map([
    [androidManifest, readFileSync(androidManifest)],
    [androidStrings, readFileSync(androidStrings)],
    [androidTheme, readFileSync(androidTheme)],
    [androidGradle, readFileSync(androidGradle)],
  ]);
  const iconOriginal = existsSync(androidIcon) ? readFileSync(androidIcon) : undefined;
  writeFileSync(androidManifest, renderAndroidManifest(originals.get(androidManifest).toString('utf8'), config));
  writeFileSync(androidStrings, renderAndroidStrings(originals.get(androidStrings).toString('utf8'), config));
  writeFileSync(androidTheme, renderAndroidTheme(originals.get(androidTheme).toString('utf8'), config));
  writeFileSync(androidGradle, renderAndroidBuildGradle(originals.get(androidGradle).toString('utf8'), config));
  if (config.app.icon !== undefined) {
    mkdirSync(dirname(androidIcon), { recursive: true });
    copyFileSync(config.app.icon, androidIcon);
  } else {
    rmSync(androidIcon, { force: true });
  }
  return () => {
    for (const [file, original] of originals) restoreFile(file, original);
    restoreFile(androidIcon, iconOriginal);
  };
}

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
  destination = join(runtimeRoot, 'android', 'app', 'build', 'generated', 'threenative', 'assets', 'game'),
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

export async function packageAndroid(
  bundle,
  requestedOutput,
  assets,
  orientation = undefined,
  config = undefined,
  options = {},
) {
  const packageRoot = resolve(options.runtimeRoot ?? runtimeRoot);
  const { androidRoot } = androidPaths(packageRoot);
  const declared = configValue(config, orientation);
  orientationValue(declared.display.orientation);
  const gradlew = join(androidRoot, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  if (!existsSync(gradlew)) throw new Error(`Android Gradle wrapper is missing: ${gradlew}`);
  if (!existsSync(bundle)) throw new Error(`Missing native bundle: ${bundle}`);
  const ensureWrapper =
    options.ensureGradleWrapper ??
    (() => ensureGradleWrapper({ output: join(androidRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar') }));
  await ensureWrapper();
  const sourceCheckout =
    existsSync(join(packageRoot, 'CMakeLists.txt')) &&
    existsSync(join(packageRoot, 'third_party', 'sdl3-android', 'SDL3-3.2.8.aar'));
  if (!sourceCheckout) {
    const preparePrebuilts =
      options.prepareAndroidPrebuilts ??
      (() => prepareAndroidPrebuilts({ outputRoot: join(packageRoot, 'android', 'prebuilt') }));
    await preparePrebuilts();
  }
  const generatedAssets = join(
    packageRoot,
    'android',
    'app',
    'build',
    'generated',
    'threenative',
    'assets',
  );
  rmSync(generatedAssets, { force: true, recursive: true });
  const assetBundle = join(
    generatedAssets,
    'scripts',
    'main.js',
  );
  mkdirSync(dirname(assetBundle), { recursive: true });
  copyFileSync(bundle, assetBundle);
  stageAndroidAssets(assets, join(generatedAssets, 'game'));
  const restoreFiles = installAndroidFiles(declared, packageRoot);
  try {
    const command = process.platform === 'win32' ? gradlew : 'sh';
    // Build variants the app already understands — `-PthreenativeJsEngine=v8`,
    // `-PthreenativeVsync=false` — are only reachable if something can pass them through. Without
    // this the properties exist in `build.gradle.kts` and no caller can ever set them.
    const extraGradleArgs = (process.env.THREENATIVE_GRADLE_ARGS ?? '')
      .split(' ')
      .filter((entry) => entry.length > 0);
    const baseArgs = ['assembleDebug', '-x', 'buildAndroidFirstProofBundle', ...extraGradleArgs];
    const args = process.platform === 'win32' ? baseArgs : [gradlew, ...baseArgs];
    const spawn = options.spawnSync ?? spawnSync;
    const result = spawn(command, args, {
      cwd: androidRoot,
      encoding: 'utf8',
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Gradle exited with code ${result.status ?? 'unknown'}.`);
    const apk = join(
      packageRoot,
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
  } finally {
    restoreFiles();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const bundleIndex = process.argv.indexOf('--bundle');
  const outputIndex = process.argv.indexOf('--output');
  const assetsIndex = process.argv.indexOf('--assets');
  const orientationIndex = process.argv.indexOf('--orientation');
  const configIndex = process.argv.indexOf('--config');
  if (
    bundleIndex === -1 ||
    !process.argv[bundleIndex + 1] ||
    process.argv[bundleIndex + 1].startsWith('--')
  ) {
    console.error(
      'Usage: package-android.mjs --bundle FILE [--output FILE] [--assets DIR] [--orientation landscape|portrait|sensor] [--config FILE]',
    );
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
  } else if (
    orientationIndex !== -1 &&
    (!process.argv[orientationIndex + 1] || process.argv[orientationIndex + 1].startsWith('--'))
  ) {
    console.error('--orientation requires a value.');
    process.exitCode = 1;
  } else if (
    configIndex !== -1 &&
    (!process.argv[configIndex + 1] || process.argv[configIndex + 1].startsWith('--'))
  ) {
    console.error('--config requires a value.');
    process.exitCode = 1;
  } else {
    try {
      const configPath = configIndex === -1 ? undefined : resolve(process.argv[configIndex + 1]);
      await packageAndroid(
        resolve(process.argv[bundleIndex + 1]),
        outputIndex === -1 ? undefined : process.argv[outputIndex + 1],
        assetsIndex === -1 ? undefined : resolve(process.argv[assetsIndex + 1]),
        orientationIndex === -1 ? undefined : process.argv[orientationIndex + 1],
        readAndroidConfig(configPath),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
