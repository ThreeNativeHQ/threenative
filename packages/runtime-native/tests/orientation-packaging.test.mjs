import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

import { renderAndroidManifest } from '../scripts/package-android.mjs';
import {
  renderAndroidBuildGradle,
  renderAndroidStrings,
  renderAndroidTheme,
} from '../scripts/package-android.mjs';
import { renderIosInfoPlist } from '../scripts/package-ios.mjs';

const androidManifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const androidStrings = readFileSync(new URL('../android/app/src/main/res/values/strings.xml', import.meta.url), 'utf8');
const androidTheme = readFileSync(new URL('../android/app/src/main/res/values/themes.xml', import.meta.url), 'utf8');
const androidGradle = readFileSync(new URL('../android/app/build.gradle.kts', import.meta.url), 'utf8');
const iosInfoPlist = readFileSync(new URL('../ios/Info.plist', import.meta.url), 'utf8');

test('Android packaging writes every declared orientation into the packaged manifest', () => {
  assert.doesNotMatch(androidManifest, /android:screenOrientation=/u);
  for (const orientation of ['landscape', 'portrait', 'sensor']) {
    const rendered = renderAndroidManifest(androidManifest, orientation);
    assert.match(rendered, new RegExp(`android:screenOrientation="${orientation}"`));
  }
});

test('Android packaging overwrites a hand-edited manifest orientation', () => {
  const handEdited = androidManifest.replace(
    'android:hardwareAccelerated="true">',
    'android:hardwareAccelerated="true" android:screenOrientation="landscape">',
  );
  const rendered = renderAndroidManifest(handEdited, 'portrait');
  assert.match(rendered, /android:screenOrientation="portrait"/u);
  assert.doesNotMatch(rendered, /android:screenOrientation="landscape"/u);
});

test('Android packaging overwrites hand-edited identity resource drift', () => {
  const config = {
    app: {
      id: 'com.studio.foxgame',
      name: 'Fox',
      version: '1.2.3',
      build: 7,
    },
    window: { title: 'Fox Desktop', width: 1024, height: 576, resizable: false },
  };
  const driftedStrings = androidStrings.replace(
    '<string name="app_name">ThreeNative</string>',
    '<string name="app_name">Drifted Name</string>',
  );
  const strings = renderAndroidStrings(driftedStrings, config);
  assert.match(strings, /<string name="app_name">Fox<\/string>/u);
  assert.doesNotMatch(strings, /Drifted Name/u);

  const driftedGradle = androidGradle
    .replace('applicationId = "com.threenative.game"', 'applicationId = "com.drifted.game"')
    .replace('versionName = "0.1.0"', 'versionName = "9.9.9"');
  const gradle = renderAndroidBuildGradle(driftedGradle, config);
  assert.match(gradle, /applicationId = "com\.studio\.foxgame"/u);
  assert.match(gradle, /versionName = "1\.2\.3"/u);
  assert.doesNotMatch(gradle, /com\.drifted\.game|9\.9\.9/u);
});

test('iOS packaging writes the declared orientation keys', () => {
  const expected = {
    landscape: ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'],
    portrait: ['UIInterfaceOrientationPortrait'],
    sensor: [
      'UIInterfaceOrientationPortrait',
      'UIInterfaceOrientationPortraitUpsideDown',
      'UIInterfaceOrientationLandscapeLeft',
      'UIInterfaceOrientationLandscapeRight',
    ],
  };
  for (const [orientation, entries] of Object.entries(expected)) {
    const rendered = renderIosInfoPlist(iosInfoPlist, orientation);
    for (const entry of entries) assert.match(rendered, new RegExp(`<string>${entry}</string>`));
    for (const other of Object.values(expected).flat().filter((entry) => !entries.includes(entry))) {
      assert.doesNotMatch(rendered, new RegExp(`<string>${other}</string>`));
    }
  }
});

test('packagers reject an unrecognised orientation with the named code', () => {
  assert.throws(() => renderAndroidManifest(androidManifest, 'sideways'), /TN_NATIVE_ORIENTATION_INVALID/u);
  assert.throws(() => renderIosInfoPlist(iosInfoPlist, 'sideways'), /TN_NATIVE_ORIENTATION_INVALID/u);
});

test('Android and iOS package every declared identity, display, window, and renderer-adjacent field', () => {
  const config = {
    app: {
      id: 'com.studio.foxgame',
      name: 'Fox & Sons',
      version: '1.2.3',
      build: 7,
      icon: 'public/icon.png',
    },
    display: { orientation: 'portrait', fullscreen: false, keepScreenOn: true },
    window: { title: 'Fox Desktop', width: 1024, height: 576, resizable: false },
  };

  const android = renderAndroidManifest(androidManifest, config);
  assert.match(android, /android:icon="@mipmap\/ic_launcher"/u);
  assert.match(android, /android:screenOrientation="portrait"/u);
  assert.match(android, /android:name="TN_KEEP_SCREEN_ON" android:value="true"/u);
  assert.match(android, /android:name="TN_FULLSCREEN" android:value="false"/u);
  assert.match(renderAndroidStrings(androidStrings, config), /<string name="app_name">Fox &amp; Sons<\/string>/u);
  assert.match(renderAndroidStrings(androidStrings, config), /<string name="window_title">Fox Desktop<\/string>/u);
  const theme = renderAndroidTheme(androidTheme, config);
  assert.match(theme, /parent="android:Theme\.NoTitleBar"/u);
  assert.match(theme, /android:windowFullscreen">false<\/item>/u);
  const gradle = renderAndroidBuildGradle(androidGradle, config);
  assert.match(gradle, /namespace = "com\.studio\.foxgame"/u);
  assert.match(gradle, /applicationId = "com\.studio\.foxgame"/u);
  assert.match(gradle, /versionCode = 7/u);
  assert.match(gradle, /versionName = "1\.2\.3"/u);

  const ios = renderIosInfoPlist(iosInfoPlist, config);
  assert.match(ios, /<key>CFBundleIdentifier<\/key>\s*<string>com\.studio\.foxgame<\/string>/u);
  assert.match(ios, /<key>CFBundleDisplayName<\/key>\s*<string>Fox &amp; Sons<\/string>/u);
  assert.match(ios, /<key>CFBundleShortVersionString<\/key>\s*<string>1\.2\.3<\/string>/u);
  assert.match(ios, /<key>CFBundleVersion<\/key>\s*<string>7<\/string>/u);
  assert.match(ios, /<string>UIInterfaceOrientationPortrait<\/string>/u);
  assert.match(ios, /<key>TNFullscreen<\/key>\s*<false\/>/u);
  assert.match(ios, /<key>TNKeepScreenOn<\/key>\s*<true\/>/u);
  assert.match(ios, /<key>TNWindowTitle<\/key>\s*<string>Fox Desktop<\/string>/u);
  assert.match(ios, /<key>TNWindowWidth<\/key>\s*<integer>1024<\/integer>/u);
  assert.match(ios, /<key>TNWindowHeight<\/key>\s*<integer>576<\/integer>/u);
  assert.match(ios, /<key>TNWindowResizable<\/key>\s*<false\/>/u);
  assert.match(ios, /<key>CFBundleIconName<\/key>\s*<string>AppIcon<\/string>/u);
});

test('runtime sources do not retain the former game identity defaults', () => {
  const runtimeRoot = fileURLToPath(new URL('..', import.meta.url));
  for (const formerIdentity of [
    'com.mystral.engine',
    '<string name="app_name">Mystral</string>',
    '<string>Mystral</string>',
  ]) {
    const result = spawnSync(
      'git',
      [
        'grep',
        '-n',
        '--fixed-strings',
        formerIdentity,
        '--',
        '.',
        ':(exclude)tests/orientation-packaging.test.mjs',
      ],
      { cwd: runtimeRoot, encoding: 'utf8' },
    );
    assert.equal(result.status, 1, `${formerIdentity}\n${result.stdout}\n${result.stderr}`);
  }
});
