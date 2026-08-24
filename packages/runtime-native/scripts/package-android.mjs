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
import { downloadReleaseArtifact, releaseManifestUrl, verifyChecksum } from './install-prebuilt.mjs';
import { assertAndroidAssetsDecodable, deriveAndroidWebpSupport } from './asset-preflight.mjs';

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const GRADLE_WRAPPER_URL =
  'https://raw.githubusercontent.com/gradle/gradle/v8.5.0/gradle/wrapper/gradle-wrapper.jar';
export const GRADLE_WRAPPER_SHA256 =
  'd3b261c2820e9e3d8d639ed084900f11f4a86050a8f83342ade7b6bc9b0d2bdd';

export const ANDROID_ABIS = ['arm64-v8a', 'x86_64'];
export const ANDROID_ENGINES = ['quickjs', 'v8'];

/**
 * The QuickJS prebuilt set. Unchanged, and still the meaning of the unqualified release keys.
 *
 * `libmystral-runtime.so` here is the QuickJS-linked runtime: the interpreter is compiled *into*
 * it, which is why the V8 set below needs a different runtime binary rather than the same one plus
 * a library.
 */
export const ANDROID_PREBUILT_ASSETS = {
  'android-arm64-v8a-runtime': 'jniLibs/arm64-v8a/libmystral-runtime.so',
  'android-arm64-v8a-sdl3': 'jniLibs/arm64-v8a/libSDL3.so',
  'android-sdl3-aar': 'SDL3-3.2.8.aar',
  'android-x86_64-runtime': 'jniLibs/x86_64/libmystral-runtime.so',
  'android-x86_64-sdl3': 'jniLibs/x86_64/libSDL3.so',
};

/**
 * The V8 prebuilt set, added 2026-08-16 by PRD-130 Phase 4.
 *
 * Before this, the prebuilt path could not express V8 at all: it shipped four files, none of them
 * V8, so a project built from a release artifact got QuickJS **whatever the default said**. Flipping
 * the engine default without this would have produced a default only operators with an NDK ever
 * received.
 *
 * The runtime binary is engine-qualified rather than shared, because it genuinely differs — 60.4 MB
 * linked against V8 against 66.6 MB with QuickJS compiled in. Publishing one runtime and bolting a
 * library onto it would produce a process that reports the wrong engine, which is exactly the class
 * of failure `--expect-engine` exists to catch.
 */
export const ANDROID_PREBUILT_V8_ASSETS = {
  'android-arm64-v8a-runtime-v8': 'jniLibs/arm64-v8a/libmystral-runtime.so',
  'android-arm64-v8a-sdl3': 'jniLibs/arm64-v8a/libSDL3.so',
  'android-arm64-v8a-v8': 'jniLibs/arm64-v8a/libv8android.so',
  'android-arm64-v8a-libcxx': 'jniLibs/arm64-v8a/libc++_shared.so',
  'android-arm64-v8a-v8-snapshot': 'assets/v8/arm64-v8a/snapshot_blob.bin',
  'android-sdl3-aar': 'SDL3-3.2.8.aar',
  'android-x86_64-runtime-v8': 'jniLibs/x86_64/libmystral-runtime.so',
  'android-x86_64-sdl3': 'jniLibs/x86_64/libSDL3.so',
  'android-x86_64-v8': 'jniLibs/x86_64/libv8android.so',
  'android-x86_64-libcxx': 'jniLibs/x86_64/libc++_shared.so',
  'android-x86_64-v8-snapshot': 'assets/v8/x86_64/snapshot_blob.bin',
};

/** The prebuilt set one engine needs. The engine name is the same one the source path uses. */
export function androidPrebuiltAssets(engine = 'v8') {
  const name = String(engine).toLowerCase();
  if (!ANDROID_ENGINES.includes(name)) {
    throw new Error(`Unknown Android JS engine '${engine}'; expected one of ${ANDROID_ENGINES.join(', ')}.`);
  }
  return name === 'v8' ? ANDROID_PREBUILT_V8_ASSETS : ANDROID_PREBUILT_ASSETS;
}
export const NATIVE_ORIENTATIONS = ['landscape', 'portrait', 'sensor'];

function androidPaths(root = runtimeRoot) {
  return {
    androidRoot: join(root, 'android'),
    androidManifest: join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'),
    androidStrings: join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'),
    androidTheme: join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'themes.xml'),
    androidBranding: join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'branding.xml'),
    androidGradle: join(root, 'android', 'app', 'build.gradle.kts'),
    androidAdaptiveIcon: join(
      root,
      'android',
      'app',
      'src',
      'main',
      'res',
      'mipmap-anydpi-v26',
      'ic_launcher.xml',
    ),
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
    androidForeground: join(
      root,
      'android',
      'app',
      'src',
      'main',
      'res',
      'drawable-nodpi',
      'ic_launcher_foreground.png',
    ),
    androidMonochrome: join(
      root,
      'android',
      'app',
      'src',
      'main',
      'res',
      'drawable-nodpi',
      'ic_launcher_monochrome.png',
    ),
    androidSplash: join(
      root,
      'android',
      'app',
      'src',
      'main',
      'res',
      'drawable-nodpi',
      'tn_boot_splash.png',
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
  const bootSplash = source.bootSplash && typeof source.bootSplash === 'object' ? source.bootSplash : {};
  return {
    app: { ...DEFAULT_ANDROID_CONFIG.app, ...app },
    display: {
      ...DEFAULT_ANDROID_CONFIG.display,
      ...display,
      orientation: orientation ?? display.orientation ?? DEFAULT_ANDROID_CONFIG.display.orientation,
    },
    window: { ...DEFAULT_ANDROID_CONFIG.window, ...window },
    ...(source.bootSplash === undefined ? {} : { bootSplash: { ...bootSplash } }),
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

function androidIcons(config) {
  const app = config.app ?? {};
  return app.icons?.android ?? {};
}

function hasAndroidIcon(config) {
  return iconForeground(config) !== undefined;
}

function appIcon(config) {
  return config.app?.icon;
}

function iconForeground(config) {
  return androidIcons(config).foreground ?? appIcon(config);
}

function iconMonochrome(config) {
  return androidIcons(config).monochrome ?? iconForeground(config);
}

function iconBackground(config) {
  return androidIcons(config).background ?? config.bootSplash?.backgroundColor ?? '#000000';
}

function bootSplashBackground(config) {
  return config.bootSplash?.backgroundColor ?? '#000000';
}

function setThemeItem(source, name, value) {
  const item = new RegExp(`<item\\s+name="${name}">[\\s\\S]*?<\\/item>`, 'u');
  const rendered = `<item name="${name}">${value}</item>`;
  if (item.test(source)) return source.replace(item, rendered);
  return source.replace(/\s*<\/style>/u, `\n        ${rendered}\n    </style>`);
}

export function renderAndroidBrandingResources(config) {
  const icons = androidIcons(config);
  const hasIcon = hasAndroidIcon(config);
  const adaptive = hasIcon
    ? `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/tn_icon_background" />
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <monochrome android:drawable="@drawable/ic_launcher_monochrome" />
</adaptive-icon>
`
    : undefined;
  const colors = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="tn_icon_background">${xmlEscape(iconBackground(config))}</color>
    <color name="tn_boot_splash_background">${xmlEscape(bootSplashBackground(config))}</color>
</resources>
`;
  return {
    adaptive,
    colors,
    foreground: icons.foreground ?? appIcon(config),
    monochrome: icons.monochrome ?? icons.foreground ?? appIcon(config),
    splash: config.bootSplash?.image,
  };
}

/**
 * Insert or replace an `<activity>`-scoped `<property>` element.
 *
 * `<property>` is not `<meta-data>`: the platform reads compat properties only from the former, so
 * `upsertApplicationMetadata` cannot express this.
 */
function upsertActivityProperty(source, name, value) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const existing = new RegExp(`\\s*<property\\s+android:name="${escapedName}"[^>]*/>`, 'u');
  const element = `\n            <property android:name="${name}" android:value="${value}" />`;
  if (existing.test(source)) return source.replace(existing, element);
  const activity = /<activity\b[^>]*>/u.exec(source);
  if (!activity) return source;
  return source.replace(activity[0], `${activity[0]}${element}`);
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
  rendered = rendered.replace(
    /<application\b[^>]*>/u,
    (tag) => setXmlAttribute(tag, 'icon', hasAndroidIcon(config) ? '@mipmap/ic_launcher' : undefined),
  );
  rendered = rendered.replace(
    /<application\b[^>]*>/u,
    (tag) => setXmlAttribute(tag, 'roundIcon', hasAndroidIcon(config) ? '@mipmap/ic_launcher' : undefined),
  );
  const renderedActivity = setXmlAttribute(
    activity[0],
    'screenOrientation',
    value,
  );
  rendered = rendered.replace(activity[0], renderedActivity);
  // Opt out of the platform's orientation override.
  //
  // Android 16+ applies `SCREEN_ORIENTATION_FULL_USER` on top of an app's declared orientation for
  // apps it considers non-adaptive, which is why a manifest reading
  // `android:screenOrientation="landscape"` still came up portrait on a Pixel 8 —
  // `dumpsys activity activities` showed `overrideOrientation=SCREEN_ORIENTATION_FULL_USER` and the
  // window simply followed the device. This property is the documented way to decline that
  // override, and it is only set when the game actually asked for a fixed orientation: a game
  // configured `sensor` wants the platform behaviour and must not opt out of it.
  if (value !== 'sensor') {
    rendered = upsertActivityProperty(
      rendered,
      'android.window.PROPERTY_COMPAT_ALLOW_ORIENTATION_OVERRIDE',
      'false',
    );
  }
  rendered = upsertApplicationMetadata(rendered, 'TN_KEEP_SCREEN_ON', String(config.display.keepScreenOn));
  rendered = upsertApplicationMetadata(rendered, 'TN_WINDOW_TITLE', '@string/window_title');
  rendered = upsertApplicationMetadata(rendered, 'TN_FULLSCREEN', String(config.display.fullscreen));
  // Also carried as metadata, not only as `android:screenOrientation`: the activity re-requests it
  // in `onCreate`, because the manifest attribute alone did not hold a landscape game in landscape
  // on a Pixel 8.
  return upsertApplicationMetadata(rendered, 'TN_ORIENTATION', config.display.orientation);
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
  rendered = item.test(rendered)
    ? rendered.replace(item, `<item name="android:windowFullscreen">${fullscreen}</item>`)
    : rendered.replace(/\s*<\/style>/u, `\n        <item name="android:windowFullscreen">${fullscreen}</item>\n    </style>`);
  rendered = setThemeItem(rendered, 'android:windowSplashScreenBackground', '@color/tn_boot_splash_background');
  if (hasAndroidIcon(config)) {
    rendered = setThemeItem(rendered, 'android:windowSplashScreenAnimatedIcon', '@drawable/ic_launcher_foreground');
  }
  if (configValue(config).bootSplash?.image !== undefined) {
    rendered = setThemeItem(rendered, 'android:windowSplashScreenBrandingImage', '@drawable/tn_boot_splash');
  }
  return rendered;
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
    androidBranding,
    androidGradle,
    androidAdaptiveIcon,
    androidIcon,
    androidForeground,
    androidMonochrome,
    androidSplash,
  } = androidPaths(root);
  const branding = renderAndroidBrandingResources(config);
  const requiredAssets = [
    [branding.foreground, 'TN_CONFIG_BRAND_ANDROID_FOREGROUND_MISSING'],
    [branding.monochrome, 'TN_CONFIG_BRAND_ANDROID_MONOCHROME_MISSING'],
    [branding.splash, 'TN_CONFIG_BRAND_SPLASH_MISSING'],
  ];
  for (const [file, code] of requiredAssets) {
    if (file !== undefined && (!existsSync(file) || !statSync(file).isFile())) {
      throw new Error(`${code}: declared Android brand asset does not exist: ${file}`);
    }
  }
  const originals = new Map([
    [androidManifest, readFileSync(androidManifest)],
    [androidStrings, readFileSync(androidStrings)],
    [androidTheme, readFileSync(androidTheme)],
    [androidGradle, readFileSync(androidGradle)],
  ]);
  const generated = [androidBranding, androidAdaptiveIcon, androidForeground, androidMonochrome, androidSplash];
  const generatedOriginals = new Map(
    generated.map((file) => [file, existsSync(file) ? readFileSync(file) : undefined]),
  );
  const iconOriginal = existsSync(androidIcon) ? readFileSync(androidIcon) : undefined;
  writeFileSync(androidManifest, renderAndroidManifest(originals.get(androidManifest).toString('utf8'), config));
  writeFileSync(androidStrings, renderAndroidStrings(originals.get(androidStrings).toString('utf8'), config));
  writeFileSync(androidTheme, renderAndroidTheme(originals.get(androidTheme).toString('utf8'), config));
  writeFileSync(androidGradle, renderAndroidBuildGradle(originals.get(androidGradle).toString('utf8'), config));
  writeFileSync(androidBranding, branding.colors);
  if (branding.adaptive !== undefined) {
    mkdirSync(dirname(androidAdaptiveIcon), { recursive: true });
    writeFileSync(androidAdaptiveIcon, branding.adaptive);
  } else {
    rmSync(androidAdaptiveIcon, { force: true });
  }
  if (branding.foreground !== undefined) {
    mkdirSync(dirname(androidForeground), { recursive: true });
    copyFileSync(branding.foreground, androidForeground);
  } else {
    rmSync(androidForeground, { force: true });
  }
  if (branding.monochrome !== undefined) {
    mkdirSync(dirname(androidMonochrome), { recursive: true });
    copyFileSync(branding.monochrome, androidMonochrome);
  } else {
    rmSync(androidMonochrome, { force: true });
  }
  if (branding.splash !== undefined) {
    mkdirSync(dirname(androidSplash), { recursive: true });
    copyFileSync(branding.splash, androidSplash);
  } else {
    rmSync(androidSplash, { force: true });
  }
  if (branding.foreground !== undefined) {
    mkdirSync(dirname(androidIcon), { recursive: true });
    copyFileSync(branding.foreground, androidIcon);
  } else {
    rmSync(androidIcon, { force: true });
  }
  return () => {
    for (const [file, original] of originals) restoreFile(file, original);
    restoreFile(androidIcon, iconOriginal);
    for (const [file, original] of generatedOriginals) restoreFile(file, original);
  };
}

export async function prepareAndroidPrebuilts(options = {}) {
  // Defaults to the engine the source path defaults to. Two names for one choice is how the flag
  // gets forgotten, so the prebuilt path takes the same engine names the Gradle property does.
  const engine = String(options.engine ?? 'v8').toLowerCase();
  const assets = androidPrebuiltAssets(engine);
  // Name the source the download will really read. `downloadReleaseArtifact` prefers
  // THREENATIVE_PREBUILT_MANIFEST over the release URL, so reporting the URL when the env hook is
  // set sends a reader to a 404 that had nothing to do with their failure.
  const expectedSource =
    options.manifestPath ??
    process.env.THREENATIVE_PREBUILT_MANIFEST ??
    options.manifestUrl ??
    releaseManifestUrl(options.version);
  const downloadOptions = {
    ...options,
    manifestUrl: options.manifestUrl ?? releaseManifestUrl(options.version),
  };
  const downloads = await Promise.all(
    Object.keys(assets).map(async (key) => {
      try {
        return [key, await downloadReleaseArtifact(key, downloadOptions)];
      } catch (error) {
        throw new Error(
          `Android prebuilt '${key}' expected from '${expectedSource}': ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
  const prebuiltRoot = resolve(options.outputRoot ?? join(runtimeRoot, 'android', 'prebuilt'));
  for (const [key, contents] of downloads) {
    const output = join(prebuiltRoot, assets[key]);
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
  runtimeSource = runtimeRoot,
) {
  rmSync(destination, { force: true, recursive: true });
  mkdirSync(destination, { recursive: true });
  if (!assets || !existsSync(assets)) return [];
  if (!statSync(assets).isDirectory()) {
    throw new Error(`Android assets path is not a directory: ${assets}`);
  }
  // Read the assets before copying them. Everything this catches — OGG the decoder rejects, WebP
  // the runtime was built without, interleaved buffers WebGPU refuses to make a pipeline for —
  // otherwise ships in an APK that installs, launches and draws nothing.
  // Derived from the runtime this build is about to pack, not declared here. A hardcoded claim
  // goes stale the moment the build changes under it, which is exactly what happened to WebP.
  assertAndroidAssetsDecodable(assets, { webp: deriveAndroidWebpSupport(runtimeSource) });
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
  // `THREENATIVE_RUNTIME_SOURCE` points the packager at a runtime **source checkout**, which is
  // the only route that works today for a consumer install.
  //
  // A game in a sandbox resolves `runtime-native` to the published tarball, which ships no
  // `CMakeLists.txt`, so the check below always takes the download path — and the download path
  // fetches a GitHub release that does not exist, in a repository that is private. Every consumer
  // on 0.2.0 gets `HTTP 404` naming a URL and no next step. `packageAndroid` has always accepted
  // `options.runtimeRoot`; it simply was not reachable from the CLI or the environment.
  const packageRoot = resolve(
    options.runtimeRoot ?? process.env.THREENATIVE_RUNTIME_SOURCE ?? runtimeRoot,
  );
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
    try {
      await preparePrebuilts();
    } catch (error) {
      // Name the cause and the way out. The bare HTTP status told a person which URL failed and
      // nothing about why a published install can never satisfy it.
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n\n` +
          `This install has no runtime source checkout at ${packageRoot}, so it tried to download\n` +
          'prebuilt Android artifacts from a GitHub release. Point the packager at a source\n' +
          'checkout of @threenative/runtime-native instead:\n\n' +
          '  THREENATIVE_RUNTIME_SOURCE=/path/to/packages/runtime-native pnpm build:android\n',
        { cause: error },
      );
    }
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
  stageAndroidAssets(assets, join(generatedAssets, 'game'), packageRoot);
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
