import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';

/**
 * The three hosts implement one contract, and this is what keeps them doing so.
 *
 * The names below are declared once, in `UI_BRIDGE_GLOBALS` and the message constants in
 * `@threenative/core/ui-layer`. A host that spells one differently has no bridge at all — silently,
 * because nothing throws when a page posts to an object nobody injected. That failure is invisible
 * in every test that does not compare the hosts to each other, which is what this file does.
 *
 * It is also the only automated coverage the iOS host has: this repository has no macOS host, so
 * `ios/ui_overlay_ios.mm` has never been compiled or run. Asserting that it agrees with the two
 * hosts that HAVE run is worth more than asserting nothing.
 */
const core = readFileSync(new URL('../../core/src/ui-bridge.js', import.meta.url).pathname.replace(/\.js$/, '.ts'), 'utf8');
const android = readFileSync(
  new URL('../android/app/src/main/java/com/mystral/engine/TnUiOverlay.java', import.meta.url),
  'utf8',
);
const ios = readFileSync(new URL('../ios/ui_overlay_ios.mm', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../native/ui-overlay/src/abi.rs', import.meta.url), 'utf8');

/** Read a name out of `UI_BRIDGE_GLOBALS` rather than restating it here. */
function globalName(key) {
  const found = new RegExp(`${key}:\\s*"([^"]+)"`, 'u').exec(core)?.[1];
  assert.ok(found, `UI_BRIDGE_GLOBALS.${key} is missing from core; the contract has moved`);
  return found;
}

test('every host injects the page-facing object under the one declared name', () => {
  const host = globalName('uiHost');
  assert.equal(host, 'tnHost');
  assert.match(android, new RegExp(`HOST_OBJECT = "${host}"`, 'u'));
  assert.match(ios, new RegExp(`kHostObject = @"${host}"`, 'u'));
  // Desktop uses wry's own `window.ipc`, which core's transport discovery already knows about;
  // asserting the name it does NOT use would be asserting a coincidence.
  assert.match(desktop, /window\.ipc|with_ipc_handler/u);
});

test('every host calls the one inbound global to reach the page', () => {
  const receive = globalName('uiReceive');
  assert.equal(receive, '__tnUiReceive');
  // Android replies through the injected object's own channel, which surfaces as `onmessage`;
  // the other two evaluate the global directly.
  // Android replies down the channel the page opened, which surfaces there as `tnHost.onmessage`
  // and reaches the same global through core's one inbound path.
  assert.match(android, /proxy\.postMessage\(frame\)/u);
  assert.match(ios, new RegExp(`window\\.${receive}`, 'u'));
  assert.match(desktop, new RegExp(`window\\.${receive}`, 'u'));
});

test('every host keeps hit regions to itself instead of forwarding them to the game', () => {
  const message = /HIT_REGIONS_MESSAGE = "([^"]+)"/u.exec(
    readFileSync(new URL('../../core/src/ui-bridge.ts', import.meta.url), 'utf8'),
  )?.[1];
  assert.equal(message, 'tn:hit-regions');
  assert.match(android, new RegExp(`HIT_REGIONS_MESSAGE = "${message}"`, 'u'));
  assert.match(ios, new RegExp(`kHitRegions = @"${message}"`, 'u'));
  // Desktop's runtime recognises the frame before it reaches the game's bridge.
  const runtime = readFileSync(new URL('../src/runtime.cpp', import.meta.url), 'utf8');
  assert.match(runtime, new RegExp(`"\\\\"${message}\\\\""`, 'u'));
});

test('no host serves the UI from file://', () => {
  // A real origin is what makes fetch, module imports and same-origin rules behave as they do on
  // the web build, which is the equivalence this whole layer exists to keep.
  // Comments stripped first: all three files say "never file://" in prose, and a check that a
  // comment can satisfy is a check that proves nothing.
  const code = (source) =>
    source.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/[^\n]*/gu, '');
  for (const [name, source] of [['android', android], ['ios', ios], ['desktop', desktop]]) {
    assert.doesNotMatch(code(source), /file:\/\//u, `${name} serves the UI from file://`);
  }
  assert.match(android, /appassets\.androidplatform\.net/u);
  assert.match(ios, /threenative:\/\/localhost/u);
  assert.match(desktop, /threenative:\/\/localhost/u);
});

test('the iOS host states that it is unproven', () => {
  // Acceptance criterion 6: iOS is either proven or stated unproven, and no result claims a
  // platform it did not execute. If someone runs it, this assertion is what they update.
  assert.match(ios, /UNPROVEN/u);
});
