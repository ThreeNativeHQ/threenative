import { expect, test } from "vitest";

import { rotatedTouchPosition } from "../src/runner/android.js";

test.each([
  [0, [8192, 24575]],
  [1, [24575, 24575]],
  [2, [24575, 8192]],
  [3, [8192, 8192]],
] as const)("Android protocol-B coordinates honor display rotation %s", (rotation, expected) => {
  expect(rotatedTouchPosition(0.25, 0.75, rotation)).toEqual(expected);
});

test("Android protocol-B coordinates reject an unknown rotation", () => {
  expect(() => rotatedTouchPosition(0.5, 0.5, 4)).toThrow(/rotation 4 is invalid/u);
});
