import { expect, test } from "vitest";

import {
  AdbAndroidDriver,
  keyboardIsShown,
  parseAndroidTouchViewport,
  rotatedTouchPosition,
  tapCommand,
  touchPositionForViewport,
  touchRotationFromWindowDump,
  viewportPresentationCommands,
  viewportPresentationObserved,
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

test("raw multitouch coordinates target the letterboxed Android viewport", () => {
  const viewport = parseAndroidTouchViewport(`
    Viewport INTERNAL: displayId=0, uniqueId=local:1, port=0, orientation=0,
    logicalFrame=[0, 0, 1280, 720], physicalFrame=[0, 896, 1080, 1503], deviceSize=[1080, 2400], isActive=[1]
  `);

  expect(touchPositionForViewport(0.2, 0.5, viewport)).toEqual([6553, 16377]);
  expect(touchPositionForViewport(0.8, 0.5, viewport)).toEqual([26214, 16377]);
});

test("an explicit touch rotation supplies a missing viewport orientation", () => {
  const viewport = parseAndroidTouchViewport(`
    Viewport INTERNAL: displayId=0, uniqueId=local:1, port=0,
    logicalFrame=[0, 0, 1280, 720], physicalFrame=[0, 896, 1080, 1503], deviceSize=[1080, 2400], isActive=[1]
  `);

  expect(viewport.orientation).toBeUndefined();
  expect(touchPositionForViewport(0.2, 0.5, viewport, 1)).toEqual([16377, 26214]);
  expect(() => touchPositionForViewport(0.2, 0.5, viewport)).toThrow(
    /TN_PLAYTEST_ANDROID_TOUCH_ORIENTATION_UNKNOWN/u,
  );
});

test.each([
  [
    "square",
    "Viewport INTERNAL: displayId=0, uniqueId=local:1, port=0, orientation=0, logicalFrame=[0, 0, 1000, 1000], physicalFrame=[0, 0, 1000, 1000], deviceSize=[1000, 1000], isActive=[1]",
  ],
  [
    "non-square",
    "Viewport INTERNAL: displayId=0, uniqueId=local:1, port=0, orientation=0, logicalFrame=[0, 0, 1280, 720], physicalFrame=[0, 0, 1280, 720], deviceSize=[1280, 720], isActive=[1]",
  ],
] as const)("explicit rotations match rotatedTouchPosition on an unletterboxed %s viewport", (_name, dump) => {
  const viewport = parseAndroidTouchViewport(dump);
  for (const rotation of [0, 1, 2, 3] as const) {
    expect(touchPositionForViewport(0.2, 0.3, viewport, rotation)).toEqual(
      rotatedTouchPosition(0.2, 0.3, rotation),
    );
  }
});

test.each([
  [0, [6553, 14719]],
  [1, [14719, 26214]],
  [2, [26214, 18048]],
  [3, [18048, 6553]],
] as const)("explicit rotation %i preserves letterboxing before display rotation", (rotation, expected) => {
  const viewport = parseAndroidTouchViewport(`
    Viewport INTERNAL: displayId=0, uniqueId=local:1, port=0, orientation=0,
    logicalFrame=[0, 0, 1280, 720], physicalFrame=[0, 896, 1080, 1503], deviceSize=[1080, 2400], isActive=[1]
  `);

  expect(touchPositionForViewport(0.2, 0.3, viewport, rotation)).toEqual(expected);
});

test("the Android driver uses the observed viewport when injecting a pointer", async () => {
  const sent: string[][] = [];
  let sizeRead = 0;
  const driver = new AdbAndroidDriver({
    activity: ".MystralActivity",
    adbPath: "/nonexistent/adb",
    packageName: "com.example.game",
  });
  (driver as unknown as { adb: (args: readonly string[]) => Promise<string> }).adb = async (args) => {
    if (args.join(" ") === "shell wm size") {
      sizeRead += 1;
      return sizeRead === 1
        ? "Physical size: 1080x2400\n"
        : "Physical size: 1080x2400\nOverride size: 360x640\n";
    }
    if (args[0] === "get-serialno") return "emulator-5554\n";
    if (args[0] === "emu") {
      sent.push([...args.slice(3)]);
      return "OK\n";
    }
    if (args.join(" ") === "shell dumpsys window") return "mRotation=1\n";
    if (args.join(" ") === "shell dumpsys input") {
      return "Viewport INTERNAL: displayId=0, uniqueId=local:1, port=0, orientation=0, logicalFrame=[0, 0, 1280, 720], physicalFrame=[0, 896, 1080, 1503], deviceSize=[1080, 2400], isActive=[1]\n";
    }
    if (args.join(" ") === "shell am get-current-user") return "0\n";
    return "";
  };

  await driver.prepare("http://127.0.0.1:41777/playtest", undefined, { height: 360, width: 640 });
  await driver.setPointers([{ id: 7, x: 0.2, y: 0.5 }]);

  expect(sent[0]).toEqual([
    "EV_ABS:ABS_MT_SLOT:0",
    "EV_ABS:ABS_MT_POSITION_X:6553",
    "EV_ABS:ABS_MT_POSITION_Y:16377",
    "EV_ABS:ABS_MT_TOUCH_MAJOR:1",
    "EV_ABS:ABS_MT_PRESSURE:512",
    "EV_SYN:0:0",
  ]);
});

test("an explicit touch rotation overrides a disagreeing observed viewport orientation", async () => {
  const sent: string[][] = [];
  let sizeRead = 0;
  const driver = new AdbAndroidDriver({
    activity: ".MystralActivity",
    adbPath: "/nonexistent/adb",
    packageName: "com.example.game",
    touchRotation: 1,
  });
  (driver as unknown as { adb: (args: readonly string[]) => Promise<string> }).adb = async (args) => {
    if (args.join(" ") === "shell wm size") {
      sizeRead += 1;
      return sizeRead === 1
        ? "Physical size: 1080x2400\n"
        : "Physical size: 1080x2400\nOverride size: 360x640\n";
    }
    if (args[0] === "get-serialno") return "emulator-5554\n";
    if (args[0] === "emu") {
      sent.push([...args.slice(3)]);
      return "OK\n";
    }
    if (args.join(" ") === "shell dumpsys input") {
      return "Viewport INTERNAL: displayId=0, uniqueId=local:1, port=0, orientation=0, logicalFrame=[0, 0, 1280, 720], physicalFrame=[0, 896, 1080, 1503], deviceSize=[1080, 2400], isActive=[1]\n";
    }
    if (args.join(" ") === "shell am get-current-user") return "0\n";
    return "";
  };

  await driver.prepare("http://127.0.0.1:41777/playtest", undefined, { height: 360, width: 640 });
  await driver.setPointers([{ id: 7, x: 0.2, y: 0.5 }]);

  expect(sent[0]).toEqual([
    "EV_ABS:ABS_MT_SLOT:0",
    "EV_ABS:ABS_MT_POSITION_X:16377",
    "EV_ABS:ABS_MT_POSITION_Y:26214",
    "EV_ABS:ABS_MT_TOUCH_MAJOR:1",
    "EV_ABS:ABS_MT_PRESSURE:512",
    "EV_SYN:0:0",
  ]);
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
      ["shell", "wm", "user-rotation", "lock", "1"],
    ]);
});

test("a landscape-natural device presents the same viewport the other way round", () => {
  expect(viewportPresentationCommands({ height: 720, width: 1280 }, { height: 800, width: 1280 }))
    .toEqual([
      ["shell", "wm", "size", "1280x720"],
      ["shell", "wm", "density", "160"],
      ["shell", "wm", "user-rotation", "lock", "0"],
    ]);
});

test("a physical-size viewport is presented when Android omits an override line", () => {
  expect(viewportPresentationObserved(undefined, "1080x2400", { height: 2400, width: 1080 })).toBe(true);
  expect(viewportPresentationObserved(undefined, "720x1280", { height: 2400, width: 1080 })).toBe(false);
});

/**
 * Orientation is half of presenting a viewport, and the half that was missing.
 *
 * Measured on the physical Pixel 8 (`37251FDJH0037Z`), 2026-08-25: the runtime's activity
 * declares no `screenOrientation`, so it takes whatever the device gives. The emulator gave
 * landscape and the phone, lying flat, gave portrait — the same build, the same override, a
 * 720x405 letterbox inside a 720x1280 window. A 1280x720 viewport is a landscape viewport, and a
 * device showing it portrait is not presenting it.
 */
test("a portrait viewport on a portrait-natural device needs no quarter turn", () => {
  expect(viewportPresentationCommands({ height: 1280, width: 720 }, { height: 2400, width: 1080 }))
    .toEqual([
      ["shell", "wm", "size", "720x1280"],
      ["shell", "wm", "density", "160"],
      ["shell", "wm", "user-rotation", "lock", "0"],
    ]);
});

test("presenting a viewport with no area fails closed", () => {
  expect(() => viewportPresentationCommands({ height: 0, width: 1280 }, { height: 2400, width: 1080 }))
    .toThrow(/TN_PLAYTEST_ANDROID_VIEWPORT_INVALID/u);
});

test("the override is always undone by reset, never by writing the old numbers back", () => {
  expect(viewportRestoreCommands()).toEqual([
    ["shell", "wm", "user-rotation", "free"],
    ["shell", "wm", "size", "reset"],
    ["shell", "wm", "density", "reset"],
  ]);
});

/**
 * A tap on a device is delivered in the display's current orientation, which — once the viewport
 * above is presented — is the scenario's viewport, one pixel for one pixel. That is why click
 * steps do not go through `rotatedTouchPosition`: there is nothing to rotate.
 *
 * It also has to be `input tap` rather than the emulator's `adb emu event send` pointer protocol,
 * which exists only on emulators. The physical Pixel 8 failed
 * `TN_PLAYTEST_ANDROID_MULTITOUCH_EMULATOR_REQUIRED` before it ever reached an assertion.
 */
test("a click is one OS tap in viewport pixels, on every Android device", () => {
  expect(tapCommand(640, 428)).toEqual(["shell", "input", "tap", "640", "428"]);
});

test("a fractional click point is rounded to whole device pixels", () => {
  expect(tapCommand(639.6, 427.4)).toEqual(["shell", "input", "tap", "640", "427"]);
});

/**
 * The soft keyboard, measured on the physical Pixel 8 on 2026-08-25 and the reason the night
 * README's steering note was right about hardware.
 *
 * Focusing the name field opens the IME, which is a separate window covering the bottom of the
 * screen, and the WebView reflows into what is left — so the centred menu rides up and `begin`
 * moves from y=428 to about y=213. The scenario's second click then lands on the keyboard, where
 * it does not merely miss: it types a letter into the field it was supposed to submit.
 *
 * The emulator never showed this because it takes hardware-keyboard input and raises no IME,
 * which is why its recorded hit tests show the overlay's dimensions unchanged.
 */
test.each([
  ["      mInputShown=true", true],
  ["      mInputShown=false", false],
  ["mSystemReady=true mInteractive=true", false],
])("the IME state parses from %s", (dump, shown) => {
  expect(keyboardIsShown(dump)).toBe(shown);
});
