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

test('Android touch coordinates use the presented surface orientation with fallbacks', () => {
  const input = read('src/platform/input.cpp');

  assert.match(
    input,
    /#include <android\/native_window\.h>/u,
  );
  assert.match(input, /SDL_PROP_WINDOW_ANDROID_WINDOW_POINTER/u);
  assert.match(input, /ANativeWindow_getWidth\(surface\)/u);
  assert.match(input, /ANativeWindow_getHeight\(surface\)/u);
  assert.match(
    input,
    /void setPointerCallback\(PointerCallback callback\)[\s\S]*?SDL_GetWindowSizeInPixels\(window, &width, &height\)[\s\S]*?g_presentedTouchWidth = width/u,
    'the presented drawable must be captured before Android replaces the SDL window orientation',
  );
  assert.match(
    input,
    /width = g_presentedTouchWidth;[\s\S]*?height = g_presentedTouchHeight;/u,
    'touches must prefer the captured presented drawable dimensions',
  );
  assert.match(
    input,
    /ANativeWindow_getHeight\(surface\)[\s\S]*?SDL_GetWindowSizeInPixels\(window, &width, &height\)/u,
    'an unavailable Android surface must fall back to SDL drawable pixels',
  );
  assert.match(
    input,
    /SDL_GetWindowSizeInPixels\(window, &width, &height\)[\s\S]*?getWindowSize\(&width, &height\)/u,
    'invalid drawable dimensions must retain the existing logical-size fallback',
  );
  assert.match(input, /data\.clientX = event\.x \* width/u);
  assert.match(input, /data\.clientY = event\.y \* height/u);
});

test('Android touch mapping refreshes after callback registration and resize', () => {
  const input = read('src/platform/input.cpp');
  const callbackBlock = input.match(
    /void setPointerCallback\(PointerCallback callback\) \{[\s\S]*?\n\}\n\nvoid setWheelCallback/u,
  )?.[0];
  const resizeBlock = input.match(
    /void processResize\(int width, int height\) \{[\s\S]*?\n\}\n\n\/\*\*\n \* Get gamepad state/u,
  )?.[0];

  assert.ok(callbackBlock, 'pointer callback registration must capture the initial dimensions');
  assert.match(callbackBlock, /g_presentedTouchWidth = width;/u);
  assert.match(callbackBlock, /g_presentedTouchHeight = height;/u);
  assert.ok(resizeBlock, 'resize processing must update the touch dimensions');
  assert.match(
    resizeBlock,
    /#if defined\(__ANDROID__\)[\s\S]*?if \(width > 0 && height > 0\) \{[\s\S]*?g_presentedTouchWidth = width;[\s\S]*?g_presentedTouchHeight = height;[\s\S]*?#endif[\s\S]*?if \(!g_resizeCallback\) return;/u,
    'the resize must replace the post-registration dimensions before the callback guard',
  );
  assert.match(
    input,
    /void processTouchEvent\(const SDL_TouchFingerEvent& event\)[\s\S]*?width = g_presentedTouchWidth;[\s\S]*?height = g_presentedTouchHeight;/u,
    'touches must consume the dimensions refreshed by the resize path',
  );
});

test('Android post-registration resize rejects orientation swaps but accepts same orientation', () => {
  const input = read('src/platform/input.cpp');
  const resizeBlock = input.match(
    /void processResize\(int width, int height\) \{[\s\S]*?\n\}\n\n\/\*\*\n \* Get gamepad state/u,
  )?.[0];

  assert.ok(resizeBlock, 'resize processing must be available for orientation regression coverage');
  assert.match(
    resizeBlock,
    /const bool hasPresentedDimensions =[\s\S]*?g_presentedTouchWidth > 0 && g_presentedTouchHeight > 0;[\s\S]*?const bool presentedIsLandscape = g_presentedTouchWidth > g_presentedTouchHeight;[\s\S]*?const bool resizeIsLandscape = width > height;[\s\S]*?if \(!hasPresentedDimensions \|\| presentedIsLandscape == resizeIsLandscape\) \{[\s\S]*?g_presentedTouchWidth = width;[\s\S]*?g_presentedTouchHeight = height;/u,
    'post-registration cache refresh must be guarded by the captured surface orientation',
  );

  const sameOrientation = (cachedWidth, cachedHeight, resizeWidth, resizeHeight) =>
    (cachedWidth > cachedHeight) === (resizeWidth > resizeHeight);
  assert.equal(
    sameOrientation(2400, 1080, 1080, 2400),
    false,
    'the portrait logical resize must not replace the captured landscape surface',
  );
  assert.equal(
    sameOrientation(2400, 1080, 1920, 900),
    true,
    'a later landscape resize must refresh the captured surface dimensions',
  );
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
