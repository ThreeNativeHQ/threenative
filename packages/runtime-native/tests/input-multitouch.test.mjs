import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(join(root, path), 'utf8');

test('SDL finger events deliver stable DOM touch pointers in pixel coordinates', () => {
  const input = read('src/platform/input.cpp');
  const window = read('src/platform/window.cpp');

  for (const type of ['DOWN', 'MOTION', 'UP', 'CANCELED']) {
    assert.match(window, new RegExp(`SDL_EVENT_FINGER_${type}`));
  }
  assert.match(window, /processTouchEvent\(event\.tfinger\)/);
  assert.match(input, /TouchKey key\{event\.touchID, event\.fingerID\}/);
  assert.match(input, /g_nextTouchPointerId = 2/);
  assert.match(input, /event\.x \* width/);
  assert.match(input, /event\.y \* height/);
  assert.match(input, /pointerType = "touch"/);
  assert.match(input, /data\.type = "pointercancel"/);
});

test('SDL synthetic touch mouse events suppress only duplicate pointer delivery', () => {
  const input = read('src/platform/input.cpp');
  const mouseCallbacks = input.match(/if \(g_mouseCallback\)/gu) ?? [];
  const suppressedPointers = input.match(/g_pointerCallback && event\.which != SDL_TOUCH_MOUSEID/gu) ?? [];

  assert.ok(mouseCallbacks.length >= 2, 'mouse callbacks must remain enabled for motion and buttons');
  assert.equal(suppressedPointers.length, 2, 'motion and button pointer duplicates must be suppressed');
});
