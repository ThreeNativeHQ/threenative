import { expect, test } from "vitest";

import { parseAndroidConsole } from "../src/runner/android.js";

test("Android console ignores SurfaceSyncGroup framework noise that names MystralActivity", () => {
  const entries = parseAndroidConsole([
    "E/SurfaceSyncGroup( 4270): Failed to receive transaction ready for VRI[MystralActivity]",
    "I/SDL     ( 4270): [Mystral] Runtime initialized",
    "E/SDL     ( 4270): [Mystral] Error: authored script failed",
    "E/chromium( 4270): THREENATIVE bridge failed",
  ].join("\n"));

  expect(entries).toEqual([
    { text: "I/SDL     ( 4270): [Mystral] Runtime initialized", type: "log" },
    { text: "E/SDL     ( 4270): [Mystral] Error: authored script failed", type: "error" },
    { text: "E/chromium( 4270): THREENATIVE bridge failed", type: "error" },
  ]);
});

/**
 * The WebView's own C++ diagnostics are not the game's console.
 *
 * Measured on emulator-5554, 2026-08-25: a first launch after `adb install -r` writes five
 * `E/chromium` lines — a missing variations-seed signature and an empty HTTP cache directory —
 * and every one of them failed the starter's `noConsoleErrors`. On browser that assertion means
 * the page's console; scraping logcat made it mean "no process on this device logged at error
 * level", which is a different assertion wearing the same name.
 *
 * The lines stay in the observation. Only their severity changes, because an observation that
 * disappears is how a harness learns to lie.
 */
test("Android console classifies WebView internals as log and page console as error", () => {
  const parsed = parseAndroidConsole([
    "E/chromium( 6585): [0825/065120.946206:ERROR:variations_seed_loader.cc(37)] Seed missing signature.",
    "E/chromium( 6585): [ERROR:simple_index_file.cc(614)] Could not reconstruct index from disk",
    'E/chromium( 6585): [ERROR:CONSOLE(12)] "Uncaught TypeError: game.begin is not a function", source: https://appassets.androidplatform.net/ui/main.js (12)',
    "E/Mystral ( 6585): TN_UI_OVERLAY_UNSUPPORTED: this device's WebView has no WEB_MESSAGE_LISTENER",
  ].join("\n"));
  expect(parsed.map(({ type }) => type)).toEqual(["log", "log", "error", "error"]);
  expect(parsed).toHaveLength(4);
});
