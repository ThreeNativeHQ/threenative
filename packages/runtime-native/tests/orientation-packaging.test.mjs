import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

import { renderAndroidManifest } from '../scripts/package-android.mjs';
import { renderIosInfoPlist } from '../scripts/package-ios.mjs';

const androidManifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
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
