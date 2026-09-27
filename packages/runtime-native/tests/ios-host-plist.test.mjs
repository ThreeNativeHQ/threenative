import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { test } from 'vitest';

test('raw iOS host does not advertise asset-catalog launch resources it does not compile', () => {
  const plist = readFileSync(new URL('../ios/Info.plist', import.meta.url), 'utf8');
  assert.doesNotMatch(plist, /<key>UILaunchScreen<\/key>/u);
  assert.doesNotMatch(plist, /<key>CFBundleIconName<\/key>/u);
  assert.doesNotMatch(plist, /<key>UI(?:Color|Image)Name<\/key>/u);
});
