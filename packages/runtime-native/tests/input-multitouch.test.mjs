import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import {
  androidMultitouchScript,
  MULTITOUCH_PROOF_POINTS,
  parseAndroidTouchDevice,
  parseAndroidTouchViewport,
} from '../conformance/android-touch.mjs';

// The emulator lane's real geometry: `wm size 1280x720` letterboxes a landscape display into a
// band of the 1080x2400 panel that the touch device addresses.
const EMULATOR_DUMPSYS_INPUT = `      Viewports:
        Viewport INTERNAL: displayId=0, uniqueId=local:4619827259835644672, port=0, orientation=0, logicalFrame=[0, 0, 1280, 720], physicalFrame=[0, 896, 1080, 1503], deviceSize=[1080, 2400], isActive=[1]
`;

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
  const viewport = parseAndroidTouchViewport(EMULATOR_DUMPSYS_INPUT);
  const down = androidMultitouchScript(device, MULTITOUCH_PROOF_POINTS, true, viewport);
  const up = androidMultitouchScript(device, MULTITOUCH_PROOF_POINTS, false, viewport);

  assert.match(down, /send_event \/dev\/input\/event2 3 47 0/);
  assert.match(down, /send_event \/dev\/input\/event2 3 57 7/);
  assert.match(down, /send_event \/dev\/input\/event2 3 57 3/);
  // 0.2 and 0.8 across the panel's full width, and both rows inside the letterboxed band —
  // 896 + 0.5 * 607 = 1199.5 of 2400, which is 359 of the device's 0..719 vertical range.
  assert.match(down, /send_event \/dev\/input\/event2 3 53 216/);
  assert.match(down, /send_event \/dev\/input\/event2 3 53 863/);
  assert.match(down, /send_event \/dev\/input\/event2 3 54 359/);
  assert.match(down, /send_event \/dev\/input\/event2 0 0 0/);
  assert.match(up, /send_event \/dev\/input\/event2 3 57 -1/gu);
  assert.equal((up.match(/send_event \/dev\/input\/event2 3 57 -1/gu) ?? []).length, 2);
  assert.match(down, /su 0 sendevent "[$]@"/u);
  assert.match(down, /send_event \/dev\/input\/event2 3 55 0/u);
  assert.match(down, /send_event \/dev\/input\/event2 3 48 1/u);
  assert.match(down, /send_event \/dev\/input\/event2 3 49 1/u);
  assert.match(down, /send_event \/dev\/input\/event2 3 58 512/u);
});

test('Android proof parses current getevent output without numeric event codes', () => {
  const device = parseAndroidTouchDevice(`add device 3: /dev/input/event2
  name:     "virtio_input_multi_touch_1"
  events:
    ABS (0003): ABS_MT_SLOT           : value 0, min 0, max 10, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_X     : value 0, min 0, max 32767, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_Y     : value 0, min 0, max 32767, fuzz 0, flat 0, resolution 0
`);

  assert.deepEqual(device, {
    name: 'virtio_input_multi_touch_1',
    path: '/dev/input/event2',
    slot: { min: 0, max: 10 },
    x: { min: 0, max: 32767 },
    y: { min: 0, max: 32767 },
  });
});

test('Android proof aims contacts at the letterboxed display, not the whole panel', () => {
  const viewport = parseAndroidTouchViewport(EMULATOR_DUMPSYS_INPUT);
  assert.deepEqual(viewport, {
    orientation: 0,
    panel: { height: 2400, width: 1080 },
    physical: { bottom: 1503, left: 0, right: 1080, top: 896 },
  });

  const device = parseAndroidTouchDevice(`add device 3: /dev/input/event2
  name:     "virtio_input_multi_touch_1"
  events:
    ABS (0003): ABS_MT_SLOT           : value 0, min 0, max 10, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_X     : value 0, min 0, max 32767, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_Y     : value 0, min 0, max 32767, fuzz 0, flat 0, resolution 0
`);
  const down = androidMultitouchScript(device, MULTITOUCH_PROOF_POINTS, true, viewport);
  const rows = [...down.matchAll(/send_event \S+ 3 54 (\d+)/gu)].map((match) => Number(match[1]));

  assert.equal(rows.length, 2);
  // Treating the raw range as the viewport would place y = 0.5 at 16383, which is 1200 of 2400
  // on the panel — outside the [896, 1503] band, where Android dispatches the contact to no
  // window at all and the app never observes a pointer.
  for (const row of rows) {
    const panelY = (row / 32767) * 2400;
    assert.ok(panelY > 896 && panelY < 1503, `row ${row} maps to panel y ${panelY}, outside the display`);
  }
});

test('Android proof refuses a viewport it has not executed', () => {
  assert.throws(
    () => parseAndroidTouchViewport('Viewports:\n        <none>\n'),
    /TN_ANDROID_TOUCH_VIEWPORT_MISSING/u,
  );

  const rotated = parseAndroidTouchViewport(
    EMULATOR_DUMPSYS_INPUT.replace('orientation=0', 'orientation=1'),
  );
  const device = parseAndroidTouchDevice(`add device 3: /dev/input/event2
  name:     "virtio_input_multi_touch_1"
  events:
    ABS (0003): ABS_MT_SLOT           : value 0, min 0, max 10, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_X     : value 0, min 0, max 32767, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_Y     : value 0, min 0, max 32767, fuzz 0, flat 0, resolution 0
`);
  assert.throws(
    () => androidMultitouchScript(device, MULTITOUCH_PROOF_POINTS, true, rotated),
    /TN_ANDROID_TOUCH_ORIENTATION_UNSUPPORTED/u,
  );
  assert.throws(
    () => androidMultitouchScript(device, MULTITOUCH_PROOF_POINTS, true, undefined),
    /requires the display viewport/u,
  );
});

test('native scroll conformance records the host source contract without claiming runtime delivery', () => {
  const manifest = JSON.parse(read('shim-manifest.json'));
  const wheelShim = manifest.shims.find((shim) => shim.name === 'WheelEvent');
  assert.ok(wheelShim, 'shim-manifest.json must record the native WheelEvent shim');
  assert.match(wheelShim.evidence, /event-constructors-setup\.js/u);

  const runtime = read('src/runtime.cpp');
  const input = read('src/platform/input.cpp');
  const window = read('src/platform/window.cpp');
  assert.match(input, /void processMouseWheel\(const SDL_MouseWheelEvent& event\) \{[\s\S]*?WheelEventData data;[\s\S]*?data\.type\s*=\s*[^;]+;[\s\S]*?data\.clientX\s*=\s*[^;]+;[\s\S]*?data\.clientY\s*=\s*[^;]+;[\s\S]*?data\.deltaX\s*=\s*[^;]+;[\s\S]*?data\.deltaY\s*=\s*[^;]+;[\s\S]*?data\.deltaZ\s*=\s*[^;]+;[\s\S]*?data\.deltaMode\s*=\s*[^;]+;[\s\S]*?data\.ctrlKey\s*=\s*[^;]+;[\s\S]*?data\.shiftKey\s*=\s*[^;]+;[\s\S]*?data\.altKey\s*=\s*[^;]+;[\s\S]*?data\.metaKey\s*=\s*[^;]+;[\s\S]*?g_wheelCallback\(data\);/u, 'native wheel callback handoff is absent');
  assert.match(runtime, /platform::setWheelCallback\(\[this\]\(const platform::WheelEventData& e\) \{[\s\S]*?dispatchWheelEvent\(e\);\s*\}\);/u, 'native wheel callback must reach dispatchWheelEvent');
  assert.match(runtime, /void dispatchWheelEvent\(const platform::WheelEventData& e\) \{[\s\S]*?dispatchToListeners\("document", e\.type, event\);\s*dispatchToListeners\("window", e\.type, event\);\s*dispatchToListeners\("canvas", e\.type, event\);\s*\}\s*void dispatchGamepadEvent/u, 'native wheel listener dispatch handoff is absent');
  assert.match(window, /SDL_EVENT_MOUSE_WHEEL/u);
  assert.match(window, /processMouseWheel\(event\.wheel\)/u);
  assert.match(input, /void processMouseWheel\(const SDL_MouseWheelEvent& event\)/u);

  const scene = read('conformance/scenes/shared/scroll-input.js');
  assert.match(scene, /addEventListener\(['"]wheel['"]/u);
  assert.match(scene, /input\.axis\(['"]zoom['"]\)/u);
  assert.doesNotMatch(scene, /WheelEvent|dispatchEvent/u);
});

test('native scroll preserves the SDL to DOM wheel sign and pixel scale', () => {
  const input = read('src/platform/input.cpp');

  assert.match(input, /data\.deltaMode = 0/u);
  assert.match(input, /data\.deltaX = event\.x \* 120\.0/u);
  const assignment = input.match(/data\.deltaY = (?<expression>[^;]+);/u);
  assert.ok(assignment?.groups?.expression, 'native input must assign a wheel deltaY expression');

  const convert = new Function('event', `return ${assignment.groups.expression};`);
  assert.equal(convert({ y: 1 }), -120);
  assert.equal(convert({ y: -1 }), 120);
});

test('native conformance keeps scroll delivery source-contract-only until a host run exists', () => {
  const registry = JSON.parse(read('conformance/registry.json'));
  const row = registry.tests.find((entry) => entry.id === '99-scroll-input');
  assert.deepEqual(row, {
    availability: 'source-contract-only',
    category: 'input',
    desktopGate: false,
    id: '99-scroll-input',
    required: true,
    scene: 'conformance/scenes/shared/scroll-input.js',
    status: 'planned',
    title: 'native host scroll source contract',
    tolerance: { perceptualDeltaE: 3, pixelMismatchRatio: 0.01 },
  });
});
