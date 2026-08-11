#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { downloadReleaseArtifact } from './install-prebuilt.mjs';

export const NATIVE_ORIENTATIONS = ['landscape', 'portrait', 'sensor'];
export const DEFAULT_IOS_CONFIG = {
  app: { id: 'com.threenative.game', name: 'ThreeNative', version: '0.1.13', build: 1 },
  display: { orientation: 'landscape', fullscreen: true, keepScreenOn: false },
  window: { title: 'ThreeNative', width: 1280, height: 720, resizable: true },
};
const IOS_ORIENTATIONS = {
  landscape: ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
  portrait: ['UIInterfaceOrientationPortrait'],
  sensor: [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ],
};

function configValue(value, orientation) {
  const source = value && typeof value === 'object' ? value : {};
  const app = source.app && typeof source.app === 'object' ? source.app : {};
  const display = source.display && typeof source.display === 'object' ? source.display : {};
  const window = source.window && typeof source.window === 'object' ? source.window : {};
  return {
    app: { ...DEFAULT_IOS_CONFIG.app, ...app },
    display: {
      ...DEFAULT_IOS_CONFIG.display,
      ...display,
      orientation: orientation ?? display.orientation ?? DEFAULT_IOS_CONFIG.display.orientation,
    },
    window: { ...DEFAULT_IOS_CONFIG.window, ...window },
  };
}

function readConfig(configPath) {
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

function plistKey(source, key, value) {
  const rendered = `  <key>${key}</key>\n  <string>${xmlEscape(value)}</string>`;
  const pattern = new RegExp(`\\s*<key>${key}</key>\\s*<(?:string|true|false)>[\\s\\S]*?</(?:string|true|false)>`, 'u');
  if (pattern.test(source)) return source.replace(pattern, `\n${rendered}`);
  return source.replace(/\s*<\/dict>/u, `\n${rendered}\n</dict>`);
}

function plistBoolean(source, key, value) {
  const rendered = `  <key>${key}</key>\n  <${value ? 'true' : 'false'}/>`;
  const pattern = new RegExp(`\\s*<key>${key}</key>\\s*<(?:true|false)\\s*/?>`, 'u');
  if (pattern.test(source)) return source.replace(pattern, `\n${rendered}`);
  return source.replace(/\s*<\/dict>/u, `\n${rendered}\n</dict>`);
}

function plistInteger(source, key, value) {
  const rendered = `  <key>${key}</key>\n  <integer>${value}</integer>`;
  const pattern = new RegExp(`\\s*<key>${key}</key>\\s*<integer>[\\s\\S]*?</integer>`, 'u');
  if (pattern.test(source)) return source.replace(pattern, `\n${rendered}`);
  return source.replace(/\s*<\/dict>/u, `\n${rendered}\n</dict>`);
}

function orientationValue(value = 'landscape') {
  if (typeof value === 'string' && NATIVE_ORIENTATIONS.includes(value)) return value;
  throw new Error(
    'TN_NATIVE_ORIENTATION_INVALID: display.orientation must be landscape, portrait, or sensor.',
  );
}

export function renderIosInfoPlist(source, orientation = 'landscape') {
  const config = configValue(typeof orientation === 'string' ? undefined : orientation, typeof orientation === 'string' ? orientation : undefined);
  const value = orientationValue(config.display.orientation);
  const entries = IOS_ORIENTATIONS[value].map((entry) => `    <string>${entry}</string>`).join('\n');
  const key = /(<key>UISupportedInterfaceOrientations<\/key>\s*<array>)[\s\S]*?(<\/array>)/u;
  if (!key.test(source)) {
    throw new Error(
      'TN_IOS_ORIENTATION_KEYS_MISSING: Info.plist has no UISupportedInterfaceOrientations array.',
    );
  }
  let rendered = source.replace(key, `$1\n${entries}\n  $2`);
  rendered = plistKey(rendered, 'CFBundleIdentifier', config.app.id);
  rendered = plistKey(rendered, 'CFBundleDisplayName', config.app.name);
  rendered = plistKey(rendered, 'CFBundleName', config.app.name);
  rendered = plistKey(rendered, 'CFBundleShortVersionString', config.app.version);
  rendered = plistKey(rendered, 'CFBundleVersion', config.app.build);
  rendered = plistBoolean(rendered, 'TNFullscreen', config.display.fullscreen);
  rendered = plistBoolean(rendered, 'TNKeepScreenOn', config.display.keepScreenOn);
  rendered = plistKey(rendered, 'TNWindowTitle', config.window.title);
  rendered = plistInteger(rendered, 'TNWindowWidth', config.window.width);
  rendered = plistInteger(rendered, 'TNWindowHeight', config.window.height);
  rendered = plistBoolean(rendered, 'TNWindowResizable', config.window.resizable);
  if (config.app.icon !== undefined) rendered = plistKey(rendered, 'CFBundleIconName', 'AppIcon');
  return rendered;
}

function argumentAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1 || !args[index + 1] || args[index + 1].startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return args[index + 1];
}

function valueAfter(args, flag) {
  return resolve(argumentAfter(args, flag));
}

function checksum(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of readdirSync(join(directory, relative), { withFileTypes: true })) {
    const path = relative ? posix.join(relative, entry.name) : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(directory, path));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Unsupported iOS asset entry: ${join(directory, path)}`);
  }
  return files.sort();
}

function findApp(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name.endsWith('.app')) return path;
    if (entry.isDirectory()) {
      const nested = findApp(path);
      if (nested) return nested;
    }
  }
  return undefined;
}

function compileIosIcon(catalog, output) {
  const result = spawnSync(
    'xcrun',
    [
      'actool',
      '--compile',
      output,
      '--app-icon',
      'AppIcon',
      '--platform',
      'iphonesimulator',
      '--minimum-deployment-target',
      '13.0',
      '--target-device',
      'iphone',
      '--target-device',
      'ipad',
      catalog,
    ],
    { encoding: 'utf8' },
  );
  if (result.error) {
    throw new Error(
      `TN_IOS_ICON_COMPILER_MISSING: xcrun actool is required to compile AppIcon.appiconset: ${result.error.message}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `TN_IOS_ICON_COMPILE_FAILED: actool exited with code ${result.status ?? 'unknown'}: ${result.stderr || result.stdout || 'no output'}`,
    );
  }
}

function stageIosIcon(output, icon, compileIcon = compileIosIcon) {
  if (!existsSync(icon) || !statSync(icon).isFile()) {
    throw new Error(`TN_CONFIG_ICON_MISSING: app.icon does not exist: ${icon}`);
  }
  const temporary = mkdtempSync(join(tmpdir(), 'threenative-ios-icon-'));
  try {
    const catalog = join(temporary, 'Assets.xcassets');
    const appIcon = join(catalog, 'AppIcon.appiconset');
    const compiled = join(temporary, 'compiled');
    mkdirSync(appIcon, { recursive: true });
    mkdirSync(compiled, { recursive: true });
    copyFileSync(icon, join(appIcon, 'AppIcon-1024.png'));
    writeFileSync(
      join(appIcon, 'Contents.json'),
      `${JSON.stringify(
        {
          images: [
            {
              idiom: 'universal',
              platform: 'ios',
              size: '1024x1024',
              scale: '1x',
              filename: 'AppIcon-1024.png',
            },
          ],
          info: { author: 'xcode', version: 1 },
        },
        null,
        2,
      )}\n`,
    );
    compileIcon(catalog, compiled);
    const assetsCar = join(compiled, 'Assets.car');
    if (!existsSync(assetsCar) || !statSync(assetsCar).isFile() || statSync(assetsCar).size === 0) {
      throw new Error('TN_IOS_ICON_COMPILE_FAILED: actool did not produce a usable Assets.car.');
    }
    rmSync(join(output, 'Assets.xcassets'), { force: true, recursive: true });
    copyFileSync(assetsCar, join(output, 'Assets.car'));
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

export function stageIosSimulatorApp({
  assets,
  bundle,
  output,
  templateApp,
  orientation = undefined,
  config = undefined,
  compileIcon = compileIosIcon,
}) {
  const declared = configValue(config, orientation);
  const declaredOrientation = orientationValue(declared.display.orientation);
  for (const [label, path] of [
    ['native bundle', bundle],
    ['verified iOS simulator host', templateApp],
  ]) {
    if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  }
  for (const required of ['Info.plist', 'native-smoke.js', 'threenative-ios']) {
    if (!existsSync(join(templateApp, required))) {
      throw new Error(`Verified iOS simulator host is missing ${required}.`);
    }
  }
  rmSync(output, { force: true, recursive: true });
  mkdirSync(dirname(output), { recursive: true });
  cpSync(templateApp, output, { recursive: true });
  cpSync(bundle, join(output, 'native-smoke.js'));
  const game = join(output, 'game');
  rmSync(game, { force: true, recursive: true });
  mkdirSync(game, { recursive: true });
  const plist = join(output, 'Info.plist');
  writeFileSync(plist, renderIosInfoPlist(readFileSync(plist, 'utf8'), declared));
  if (declared.app.icon !== undefined) stageIosIcon(output, declared.app.icon, compileIcon);
  let assetFiles = [];
  if (assets && existsSync(assets)) {
    if (!statSync(assets).isDirectory()) {
      throw new Error(`iOS assets path is not a directory: ${assets}`);
    }
    assetFiles = listFiles(assets);
    for (const file of assetFiles) {
      const staged = join(game, file);
      mkdirSync(dirname(staged), { recursive: true });
      cpSync(join(assets, file), staged);
    }
  }
  const report = {
    assets: assetFiles.map((path) => ({ path, sha256: checksum(join(game, path)) })),
    bundleSha256: checksum(bundle),
    host: 'ios-simulator-arm64',
    orientation: declaredOrientation,
    appId: declared.app.id,
    appName: declared.app.name,
    version: declared.app.version,
    build: declared.app.build,
    ...(declared.app.icon === undefined ? {} : { icon: declared.app.icon }),
    ...(declared.app.icon === undefined ? {} : { iconArtifact: 'Assets.car' }),
    output,
    outputBundleSha256: checksum(join(output, 'native-smoke.js')),
  };
  writeFileSync(`${output}.json`, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

export async function packageIosSimulator(options) {
  const config = configValue(options.config, options.orientation);
  const orientation = orientationValue(config.display.orientation);
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== 'darwin' || arch !== 'arm64') {
    throw new Error(
      `iOS simulator packaging requires a darwin-arm64 host; received ${platform}-${arch}. Device signing remains OPEN.`,
    );
  }
  const temporary = mkdtempSync(join(tmpdir(), 'threenative-ios-host-'));
  try {
    const suppliedArchive = options.archive ?? process.env.THREENATIVE_IOS_SIMULATOR_ARCHIVE;
    let archive;
    if (suppliedArchive) {
      archive = resolve(suppliedArchive);
      const expected = options.sha256 ?? process.env.THREENATIVE_IOS_SIMULATOR_SHA256 ?? '';
      if (!existsSync(archive) || !/^[a-f0-9]{64}$/u.test(expected)) {
        throw new Error('A local iOS simulator host requires an existing archive and SHA-256.');
      }
      const actual = checksum(archive);
      if (actual !== expected) {
        throw new Error(
          `iOS simulator host checksum mismatch: expected ${expected}, received ${actual}.`,
        );
      }
    } else {
      archive = join(temporary, 'threenative-ios.zip');
      writeFileSync(archive, await downloadReleaseArtifact('ios-simulator-arm64'));
    }
    const result = spawnSync('ditto', ['-x', '-k', archive, temporary], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `ditto failed to unpack ${basename(archive)}: ${result.stderr || result.stdout}`,
      );
    }
    const templateApp = findApp(temporary);
    if (!templateApp) throw new Error('Verified iOS simulator archive contains no .app bundle.');
    return stageIosSimulatorApp({
      assets: options.assets ? resolve(options.assets) : undefined,
      bundle: resolve(options.bundle),
      output: resolve(options.output),
      templateApp,
      orientation,
      config,
    });
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}

export function parseIosPackageArgs(args) {
  return {
    assets: args.includes('--assets') ? valueAfter(args, '--assets') : undefined,
    bundle: valueAfter(args, '--bundle'),
    output: valueAfter(args, '--output'),
    config: args.includes('--config') ? valueAfter(args, '--config') : undefined,
    orientation: args.includes('--orientation')
      ? argumentAfter(args, '--orientation')
      : undefined,
  };
}

export async function runIosPackageCli(args, packageSimulator = packageIosSimulator) {
  const parsed = parseIosPackageArgs(args);
  return packageSimulator({
    archive: process.env.THREENATIVE_IOS_SIMULATOR_ARCHIVE,
    ...parsed,
    config: parsed.config === undefined ? undefined : readConfig(parsed.config),
    sha256: process.env.THREENATIVE_IOS_SIMULATOR_SHA256,
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const report = await runIosPackageCli(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
