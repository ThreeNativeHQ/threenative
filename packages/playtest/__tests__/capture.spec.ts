import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { expect, test } from "vitest";

import { assertCaptureNotBlank, inspectFrame } from "../src/capture.js";

function image(colors: readonly (readonly [number, number, number, number])[]): Buffer {
  const png = new PNG({ height: 1, width: colors.length });
  colors.forEach(([red, green, blue, alpha], index) => {
    const offset = index * 4;
    png.data[offset] = red;
    png.data[offset + 1] = green;
    png.data[offset + 2] = blue;
    png.data[offset + 3] = alpha;
  });
  return PNG.sync.write(png);
}

test.each([
  ["black", [0, 0, 0, 255]],
  ["white", [255, 255, 255, 255]],
  ["transparent", [0, 0, 0, 0]],
] as const)("assertCaptureNotBlank rejects uniform %s", (_label, color) => {
  expect(() => assertCaptureNotBlank(image([color]), "fixture.png")).toThrow("TN_CAPTURE_BLANK");
});

test("a blank capture raises the guard code before any visual assertion can consume it", () => {
  try {
    assertCaptureNotBlank(image([[0, 0, 0, 255]]), "after.png");
    throw new Error("expected blank capture to fail");
  } catch (error) {
    expect(error).toMatchObject({ code: "TN_CAPTURE_BLANK", label: "after.png" });
  }
});

test("inspectFrame keeps the stats used to diagnose a capture failure", () => {
  const stats = inspectFrame(image([
    [0, 0, 0, 255],
    [255, 255, 255, 255],
  ]));

  expect(stats).toMatchObject({ height: 1, width: 2 });
  expect(stats.distinctColors).toBe(2);
});

test("a real archived frame remains accepted by the package guard", async () => {
  const path = resolve("docs/benchmark/sweeps/platformer-2026-08-06/proof-artifacts/0/after.png");
  const stats = assertCaptureNotBlank(await readFile(path), path);

  expect(stats.width).toBe(1280);
  expect(stats.height).toBe(720);
  expect(stats.distinctColors).toBeGreaterThanOrEqual(8);
});
