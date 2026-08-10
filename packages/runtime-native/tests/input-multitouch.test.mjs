import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import {
  androidMultitouchScript,
  MULTITOUCH_PROOF_POINTS,
  MULTITOUCH_PROOF_ROTATION,
  parseAndroidTouchDevice,
} from '../conformance/android-touch.mjs';

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

test('Android proof emits two contacts in one protocol-B report and releases both', () => {
  const device = parseAndroidTouchDevice(`add device 1: /dev/input/event2
  name:     "qemu touchscreen"
  events:
    ABS (0003): ABS_MT_SLOT (002f) : value 0, min 0, max 9, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_X (0035): value 0, min 0, max 1079, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_Y (0036): value 0, min 0, max 719, fuzz 0, flat 0, resolution 0
`);
  const down = androidMultitouchScript(device, MULTITOUCH_PROOF_POINTS, true, MULTITOUCH_PROOF_ROTATION);
  const up = androidMultitouchScript(device, MULTITOUCH_PROOF_POINTS, false, MULTITOUCH_PROOF_ROTATION);

  assert.match(down, /sendevent \/dev\/input\/event2 3 47 0/);
  assert.match(down, /sendevent \/dev\/input\/event2 3 57 7/);
  assert.match(down, /sendevent \/dev\/input\/event2 3 57 3/);
  assert.match(down, /sendevent \/dev\/input\/event2 3 53 540/);
  assert.match(down, /sendevent \/dev\/input\/event2 3 54 144/);
  assert.match(down, /sendevent \/dev\/input\/event2 3 54 575/);
  assert.match(down, /sendevent \/dev\/input\/event2 0 0 0/);
  assert.match(up, /sendevent \/dev\/input\/event2 3 57 -1/gu);
  assert.equal((up.match(/sendevent \/dev\/input\/event2 3 57 -1/gu) ?? []).length, 2);
});
