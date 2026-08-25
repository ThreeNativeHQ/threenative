import { expect, test } from "vitest";

import {
  touchRotationFromWindowDump,
  viewportPresentationCommands,
  viewportRestoreCommands,
} from "../src/runner/android.js";

/**
 * Measured on emulator-5554 (android-35 google_apis, 1080x2400 natural, landscape-locked game)
 * against the host's own `TN_UI_HITTEST` trace, 2026-08-25:
 *
 * - `dumpsys window` reports `mRotation=1` for the game's window.
 * - Feeding rotation 1 to `rotatedTouchPosition` delivered a (640, 428) request to view
 *   (640.0, 291.99) — `owns:false`.
 * - Feeding rotation 3 delivered the same request to view (640.0, 427.98) — `owns:true`.
 *
 * `mRotation` states how far the content is turned from the panel's natural frame, and the
 * table converts a point the other way — content to panel — so the value it needs is the
 * inverse. Applying the forward rotation is a 180-degree error on either odd rotation, which is
 * exactly the discrepancy the earlier six-variant calibration kept reading and could not name.
 */
test.each([
  ["  mRotation=0 mDeferredRotationPauseCount=0", 0],
  ["  mRotation=1 mDeferredRotationPauseCount=0", 3],
  ["  mRotation=2 mDeferredRotationPauseCount=0", 2],
  ["  mRotation=3 mDeferredRotationPauseCount=0", 1],
])("the window's %s becomes touch rotation %i", (dump, expected) => {
  expect(touchRotationFromWindowDump(dump)).toBe(expected);
});

test("a window dump with no rotation reports none rather than guessing zero", () => {
  expect(touchRotationFromWindowDump("mDeferredRotationPauseCount=0")).toBeUndefined();
});

/**
 * The scenario's viewport is a declared test condition, not a description of the device. The
 * browser target honours it by sizing the window; the Android target has to honour it too, or a
 * coordinate expressed in viewport pixels points at whatever the device's own CSS viewport put
 * there instead. Measured on the same emulator: the starter's `begin` click at viewport
 * (640, 428) landed in the 40-device-pixel gap between the name field and the button, because
 * the UI page laid out at 914x411 CSS pixels rather than the declared 1280x720.
 */
test("a portrait-natural device presents the viewport in its natural frame at one device pixel per CSS pixel", () => {
  expect(viewportPresentationCommands({ height: 720, width: 1280 }, { height: 2400, width: 1080 }))
    .toEqual([
      ["shell", "wm", "size", "720x1280"],
      ["shell", "wm", "density", "160"],
    ]);
});

test("a landscape-natural device presents the same viewport the other way round", () => {
  expect(viewportPresentationCommands({ height: 720, width: 1280 }, { height: 800, width: 1280 }))
    .toEqual([
      ["shell", "wm", "size", "1280x720"],
      ["shell", "wm", "density", "160"],
    ]);
});

test("presenting a viewport with no area fails closed", () => {
  expect(() => viewportPresentationCommands({ height: 0, width: 1280 }, { height: 2400, width: 1080 }))
    .toThrow(/TN_PLAYTEST_ANDROID_VIEWPORT_INVALID/u);
});

test("the override is always undone by reset, never by writing the old numbers back", () => {
  expect(viewportRestoreCommands()).toEqual([
    ["shell", "wm", "size", "reset"],
    ["shell", "wm", "density", "reset"],
  ]);
});
