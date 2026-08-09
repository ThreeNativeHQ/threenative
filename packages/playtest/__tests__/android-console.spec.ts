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
