import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'vitest';

import { makeTempDirSync } from '../../../test-support/temp-dir.js';
import { renderAndroidManifest, stageAndroidUi } from '../scripts/package-android.mjs';
import { stageDesktopUi } from '../scripts/package-desktop.mjs';
import { stageIosUi } from '../scripts/package-ios.mjs';

const androidManifest = readFileSync(
  new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url),
  'utf8',
);
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function temp(prefix) {
  const root = makeTempDirSync(prefix);
  roots.push(root);
  return root;
}

/** A game that never states a renderer must ship no overlay — acceptance criterion 5. */
test('an unstated ui.renderer packages as the native renderer', () => {
  const rendered = renderAndroidManifest(androidManifest, {});
  assert.match(rendered, /android:name="TN_UI_RENDERER" android:value="native"/u);
});

test('ui.renderer web is the only value that turns the overlay on', () => {
  const web = renderAndroidManifest(androidManifest, { ui: { renderer: 'web' } });
  assert.match(web, /android:name="TN_UI_RENDERER" android:value="web"/u);
  // Fail closed on a value nobody defined rather than guessing the expensive one.
  for (const renderer of ['native', 'webview', 'WEB', '']) {
    const rendered = renderAndroidManifest(androidManifest, { ui: { renderer } });
    assert.match(rendered, /android:name="TN_UI_RENDERER" android:value="native"/u);
  }
});

test('a native-renderer game stages no UI bundle at all', () => {
  const destination = join(temp('threenative-ui-none-'), 'ui');
  assert.deepEqual(stageAndroidUi(undefined, 'native', destination), []);
  assert.equal(existsSync(destination), false);
});

test('a UI bundle staged for a native-renderer game is a build failure', () => {
  const root = temp('threenative-ui-unexpected-');
  const ui = join(root, 'ui');
  mkdirSync(ui, { recursive: true });
  writeFileSync(join(ui, 'index.html'), '<!doctype html>');
  assert.throws(
    () => stageAndroidUi(ui, 'native', join(root, 'out')),
    /TN_UI_BUNDLE_UNEXPECTED/u,
  );
});

// The most expensive shape of wrong: an APK that installs, launches, and shows a blank overlay
// over a working game, with clean logs.
test('a web-renderer game with no built UI is a build failure, and so is one with no page', () => {
  const root = temp('threenative-ui-missing-');
  assert.throws(
    () => stageAndroidUi(undefined, 'web', join(root, 'out')),
    /TN_UI_BUNDLE_MISSING/u,
  );
  const ui = join(root, 'ui');
  mkdirSync(ui, { recursive: true });
  writeFileSync(join(ui, 'main.js'), 'export {};');
  assert.throws(() => stageAndroidUi(ui, 'web', join(root, 'out')), /TN_UI_BUNDLE_MISSING/u);
});

test('a web-renderer game stages its page and every asset beside it', () => {
  const root = temp('threenative-ui-staged-');
  const ui = join(root, 'ui');
  mkdirSync(join(ui, 'assets'), { recursive: true });
  writeFileSync(join(ui, 'index.html'), '<!doctype html><div id="tn-ui"></div>');
  writeFileSync(join(ui, 'assets', 'hud.css'), '.hud{color:#fff}');
  const destination = join(root, 'out');
  assert.deepEqual(stageAndroidUi(ui, 'web', destination), ['assets/hud.css', 'index.html']);
  assert.equal(existsSync(join(destination, 'index.html')), true);
  assert.equal(readFileSync(join(destination, 'assets', 'hud.css'), 'utf8'), '.hud{color:#fff}');
});

// Desktop stages the UI beside the executable rather than inside it: the overlay's web view reads
// its page from a real path, which is what gives it a real origin the way WebViewAssetLoader does
// on Android. Same two refusals as Android, because the same two mistakes are possible.
test('desktop stages a web-renderer UI and refuses both mismatches', () => {
  const root = temp('threenative-ui-desktop-');
  const ui = join(root, 'ui');
  mkdirSync(join(ui, 'assets'), { recursive: true });
  writeFileSync(join(ui, 'index.html'), '<!doctype html><div id="tn-ui"></div>');
  writeFileSync(join(ui, 'assets', 'hud.css'), '.hud{color:#fff}');

  const staged = join(root, 'out');
  assert.deepEqual(stageDesktopUi(ui, 'web', staged).sort(), ['assets', 'index.html']);
  assert.equal(existsSync(join(staged, 'assets', 'hud.css')), true);

  const none = join(root, 'none');
  assert.deepEqual(stageDesktopUi(undefined, 'native', none), []);
  assert.equal(existsSync(none), false);

  assert.throws(() => stageDesktopUi(undefined, 'web', join(root, 'a')), /TN_UI_BUNDLE_MISSING/u);
  assert.throws(() => stageDesktopUi(ui, 'native', join(root, 'b')), /TN_UI_BUNDLE_UNEXPECTED/u);
});

// iOS stages the bundle into the app, where WKURLSchemeHandler serves it. The host that reads it
// has never run — see ios/ui_overlay_ios.mm — so this covers the packaging half only, and says so.
test('iOS stages a web-renderer UI and refuses both mismatches', () => {
  const root = temp('threenative-ui-ios-');
  const ui = join(root, 'ui');
  mkdirSync(ui, { recursive: true });
  writeFileSync(join(ui, 'index.html'), '<!doctype html><div id="tn-ui"></div>');

  assert.deepEqual(stageIosUi(ui, 'web', join(root, 'out')), ['index.html']);
  assert.deepEqual(stageIosUi(undefined, 'native', join(root, 'none')), []);
  assert.equal(existsSync(join(root, 'none')), false);
  assert.throws(() => stageIosUi(undefined, 'web', join(root, 'a')), /TN_UI_BUNDLE_MISSING/u);
  assert.throws(() => stageIosUi(ui, 'native', join(root, 'b')), /TN_UI_BUNDLE_UNEXPECTED/u);
});
