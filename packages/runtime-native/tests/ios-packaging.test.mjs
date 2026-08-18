import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, test } from 'vitest';

import {
  packageIosSimulator,
  runIosPackageCli,
  stageIosSimulatorApp,
} from '../scripts/package-ios.mjs';

const roots = [];
const VALID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXUlEQVR4AaXBQRHEAAgEwclWHGDivIBckIWG3Hf/dD/frz9MdOK2BhedOHEkjsTRG524rcFFJ25rcOJIHImjd2tw0YnbGlx04sSROBJHb3TitgYXnbitwYkjcSSO/o/fGRJxtqYFAAAAAElFTkSuQmCC',
  'base64',
);
const infoPlist = `<plist><dict>
  <key>UISupportedInterfaceOrientations</key>
  <array>
    <string>UIInterfaceOrientationLandscapeLeft</string>
    <string>UIInterfaceOrientationLandscapeRight</string>
  </array>
</dict></plist>`;
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

test('staging replaces the bundle and records every packaged game asset checksum', () => {
  const root = makeTempDirSync('threenative-ios-stage-');
  roots.push(root);
  const templateApp = join(root, 'template.app');
  const output = join(root, 'dist', 'game.app');
  const bundle = join(root, 'game.js');
  const assets = join(root, 'public');
  mkdirSync(templateApp);
  mkdirSync(join(templateApp, 'game'), { recursive: true });
  mkdirSync(join(assets, 'models'), { recursive: true });
  mkdirSync(join(assets, 'textures'), { recursive: true });
  writeFileSync(join(templateApp, 'Info.plist'), infoPlist);
  writeFileSync(join(templateApp, 'threenative-ios'), 'prebuilt-host');
  writeFileSync(join(templateApp, 'native-smoke.js'), 'old-game');
  writeFileSync(join(templateApp, 'game', 'stale.bin'), 'stale');
  writeFileSync(bundle, 'new-game');
  writeFileSync(join(assets, 'models', 'level.glb'), 'model');
  writeFileSync(join(assets, 'textures', 'x.png'), 'texture');

  const report = stageIosSimulatorApp({ assets, bundle, orientation: 'portrait', output, templateApp });
  assert.equal(readFileSync(join(output, 'threenative-ios'), 'utf8'), 'prebuilt-host');
  assert.equal(readFileSync(join(output, 'native-smoke.js'), 'utf8'), 'new-game');
  assert.equal(readFileSync(join(output, 'game', 'textures', 'x.png'), 'utf8'), 'texture');
  assert.equal(existsSync(join(output, 'game', 'stale.bin')), false);
  assert.equal(report.host, 'ios-simulator-arm64');
  assert.equal(report.orientation, 'portrait');
  assert.match(readFileSync(join(output, 'Info.plist'), 'utf8'), /UIInterfaceOrientationPortrait/u);
  assert.doesNotMatch(
    readFileSync(join(output, 'Info.plist'), 'utf8'),
    /UIInterfaceOrientationLandscape/u,
  );
  assert.equal(report.bundleSha256, createHash('sha256').update('new-game').digest('hex'));
  assert.deepEqual(report.assets, [
    {
      path: 'models/level.glb',
      sha256: createHash('sha256').update('model').digest('hex'),
    },
    {
      path: 'textures/x.png',
      sha256: createHash('sha256').update('texture').digest('hex'),
    },
  ]);
  assert.deepEqual(JSON.parse(readFileSync(`${output}.json`, 'utf8')), report);

  writeFileSync(join(output, 'game', 'textures', 'x.png'), 'corrupted');
  assert.notEqual(
    createHash('sha256')
      .update(readFileSync(join(output, 'game', 'textures', 'x.png')))
      .digest('hex'),
    report.assets.find(({ path }) => path === 'textures/x.png').sha256,
  );
});

test('iOS no-config staging preserves the compatibility version in the artifact', () => {
  const root = makeTempDirSync('threenative-ios-defaults-');
  roots.push(root);
  const templateApp = join(root, 'template.app');
  const output = join(root, 'game.app');
  const bundle = join(root, 'game.js');
  mkdirSync(templateApp, { recursive: true });
  writeFileSync(join(templateApp, 'Info.plist'), infoPlist);
  writeFileSync(join(templateApp, 'threenative-ios'), 'prebuilt-host');
  writeFileSync(join(templateApp, 'native-smoke.js'), 'old-game');
  writeFileSync(bundle, 'new-game');

  const report = stageIosSimulatorApp({ bundle, output, templateApp });
  const plist = readFileSync(join(output, 'Info.plist'), 'utf8');
  assert.match(plist, /<key>CFBundleShortVersionString<\/key>\s*<string>0\.1\.13<\/string>/u);
  assert.equal(report.version, '0.1.13');
});

test('iOS staging allows missing assets, clears stale files, and rejects a file path', () => {
  const root = makeTempDirSync('threenative-ios-assets-missing-');
  roots.push(root);
  const templateApp = join(root, 'template.app');
  const output = join(root, 'game.app');
  const bundle = join(root, 'game.js');
  mkdirSync(join(templateApp, 'game'), { recursive: true });
  writeFileSync(join(templateApp, 'Info.plist'), infoPlist);
  writeFileSync(join(templateApp, 'threenative-ios'), 'prebuilt-host');
  writeFileSync(join(templateApp, 'native-smoke.js'), 'old-game');
  writeFileSync(join(templateApp, 'game', 'stale.bin'), 'stale');
  writeFileSync(bundle, 'new-game');

  const report = stageIosSimulatorApp({
    assets: join(root, 'missing'),
    bundle,
    output,
    templateApp,
  });
  assert.deepEqual(report.assets, []);
  assert.equal(existsSync(join(output, 'game')), true);
  assert.equal(existsSync(join(output, 'game', 'stale.bin')), false);

  const file = join(root, 'not-a-directory');
  writeFileSync(file, 'no');
  assert.throws(
    () => stageIosSimulatorApp({ assets: file, bundle, output, templateApp }),
    /not a directory/u,
  );
});

test('iOS staging maps configured app fields and compiles a declared icon into the app artifact', () => {
  const root = makeTempDirSync('threenative-ios-icon-');
  roots.push(root);
  const templateApp = join(root, 'template.app');
  const output = join(root, 'game.app');
  const bundle = join(root, 'game.js');
  const icon = join(root, 'icon.png');
  mkdirSync(templateApp, { recursive: true });
  writeFileSync(join(templateApp, 'Info.plist'), infoPlist);
  writeFileSync(join(templateApp, 'threenative-ios'), 'prebuilt-host');
  writeFileSync(join(templateApp, 'native-smoke.js'), 'old-game');
  writeFileSync(bundle, 'new-game');
  writeFileSync(icon, VALID_PNG);

  const report = stageIosSimulatorApp({
    assets: undefined,
    bundle,
    config: {
      app: {
        id: 'com.studio.vulpine',
        name: 'Vulpine',
        version: '9.8.7',
        build: 42,
        icon,
      },
      display: { orientation: 'portrait', fullscreen: false, keepScreenOn: true },
      window: { title: 'Vulpine Window', width: 1111, height: 777, resizable: false },
    },
    output,
    templateApp,
    compileIcon: (catalog, compiled) => {
      assert.equal(readFileSync(join(catalog, 'AppIcon.appiconset/AppIcon-1024.png')).equals(VALID_PNG), true);
      writeFileSync(join(compiled, 'Assets.car'), Buffer.from('compiled-app-icon'));
    },
  });

  assert.equal(readFileSync(join(output, 'native-smoke.js'), 'utf8'), 'new-game');
  assert.equal(readFileSync(join(output, 'Assets.car'), 'utf8'), 'compiled-app-icon');
  assert.equal(existsSync(join(output, 'Assets.xcassets')), false);
  assert.deepEqual(
    {
      appId: report.appId,
      appName: report.appName,
      version: report.version,
      build: report.build,
      orientation: report.orientation,
    },
    {
      appId: 'com.studio.vulpine',
      appName: 'Vulpine',
      version: '9.8.7',
      build: 42,
      orientation: 'portrait',
    },
  );
  const plist = readFileSync(join(output, 'Info.plist'), 'utf8');
  for (const pattern of [
    /<key>CFBundleIdentifier<\/key>\s*<string>com\.studio\.vulpine<\/string>/u,
    /<key>CFBundleDisplayName<\/key>\s*<string>Vulpine<\/string>/u,
    /<key>CFBundleName<\/key>\s*<string>Vulpine<\/string>/u,
    /<key>CFBundleShortVersionString<\/key>\s*<string>9\.8\.7<\/string>/u,
    /<key>CFBundleVersion<\/key>\s*<string>42<\/string>/u,
    /<string>UIInterfaceOrientationPortrait<\/string>/u,
    /<key>TNFullscreen<\/key>\s*<false\/>/u,
    /<key>TNKeepScreenOn<\/key>\s*<true\/>/u,
    /<key>TNWindowTitle<\/key>\s*<string>Vulpine Window<\/string>/u,
    /<key>TNWindowWidth<\/key>\s*<integer>1111<\/integer>/u,
    /<key>TNWindowHeight<\/key>\s*<integer>777<\/integer>/u,
    /<key>TNWindowResizable<\/key>\s*<false\/>/u,
    /<key>CFBundleIconName<\/key>\s*<string>AppIcon<\/string>/u,
  ]) {
    assert.match(plist, pattern);
  }
  assert.doesNotMatch(plist, /UIInterfaceOrientationLandscape/u);
  assert.equal(report.icon, icon);
  assert.equal(report.iconArtifact, 'Assets.car');
});

test('iOS packaging fails closed off darwin-arm64 and on a corrupt local host', async () => {
  await assert.rejects(
    packageIosSimulator({ arch: 'x64', bundle: 'game.js', output: 'game.app', platform: 'linux' }),
    /requires a darwin-arm64 host.*linux-x64.*Device signing remains OPEN/u,
  );

  const root = makeTempDirSync('threenative-ios-checksum-');
  roots.push(root);
  const archive = join(root, 'host.zip');
  writeFileSync(archive, 'corrupt');
  await assert.rejects(
    packageIosSimulator({
      arch: 'arm64',
      archive,
      bundle: join(root, 'game.js'),
      output: join(root, 'game.app'),
      platform: 'darwin',
      sha256: '0'.repeat(64),
    }),
    /checksum mismatch/u,
  );
});

test('iOS CLI forwards the declared orientation before host validation', async () => {
  const forwarded = [];
  const report = await runIosPackageCli(
    ['--bundle', 'game.js', '--output', 'game.app', '--orientation', 'portrait'],
    async (options) => {
      forwarded.push(options);
      return { orientation: options.orientation };
    },
  );
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].orientation, 'portrait');
  assert.equal(report.orientation, 'portrait');
});

test('the published package includes the iOS packager without C++ source', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(manifest.files.includes('scripts/package-ios.mjs'));
  assert.ok(!manifest.files.some((path) => /^(?:src|include|cmake|ios\/main\.mm)/u.test(path)));
});

test('release lane locks and launches the packed simulator host with physics controls', () => {
  const workflow = readFileSync(
    new URL('../../../.github/workflows/native-release.yml', import.meta.url),
    'utf8',
  );
  for (const token of [
    'build-ios-simulator:',
    '"ios-simulator-arm64": "threenative-ios-simulator-arm64.zip"',
    'clean-consumer-ios:',
    'build --target ios',
    'physics-wrong-height.playtest.json',
    'physics-mask.playtest.json',
    'THREENATIVE_PHYSICS_CONTROL=wrong-gravity',
    'TN_PLAYTEST_POSITION_REACH_ASSERTION_FAILED',
    'xcrun simctl list devices available',
    'xcrun simctl boot "$device"',
    'xcrun simctl bootstatus "$device" -b',
    'test ! -e "$TN_IOS_TOOLCHAIN_LOG"',
  ]) {
    assert.match(workflow, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  }
  assert.match(workflow, /^permissions:\n {2}contents: read$/mu);
  assert.match(workflow, /publish:[\s\S]*permissions:\n {6}contents: write/u);
  assert.match(workflow, /gh release create[\s\S]*--prerelease[\s\S]*--latest=false/u);
  assert.match(workflow, /finalize:[\s\S]*needs: \[clean-consumer, clean-consumer-ios\]/u);
  assert.match(workflow, /cleanup-failed-release:[\s\S]*gh release delete/u);
});

test('simulator verification builds only the arm64 architecture carried by the host archive', () => {
  const verifier = readFileSync(
    new URL('../scripts/verify-ios-simulator.mjs', import.meta.url),
    'utf8',
  );
  assert.match(verifier, /-DPLATFORM=SIMULATORARM64/);
  assert.match(verifier, /-DCMAKE_OSX_ARCHITECTURES=arm64/);
  assert.match(verifier, /result\.stdout[\s\S]*result\.stderr/);
});
