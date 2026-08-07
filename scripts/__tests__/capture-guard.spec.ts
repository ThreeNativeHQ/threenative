import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { assertFrameShowsSomething, inspectFrame } from "../capture-guard.js";

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

describe("capture guard", () => {
  it.each([
    ["black", [0, 0, 0, 255]],
    ["white", [255, 255, 255, 255]],
    ["transparent", [0, 0, 0, 0]],
  ] as const)("rejects uniform %s", (_label, color) => {
    expect(() => assertFrameShowsSomething(image([color]), "fixture.png")).toThrow(
      "TN_CAPTURE_BLANK",
    );
  });

  it("rejects a two-color image below the distinct-color floor", () => {
    const png = image([
      [0, 0, 0, 255],
      [255, 255, 255, 255],
    ]);
    expect(() => assertFrameShowsSomething(png, "two-color.png")).toThrow(
      "only 2 distinct color(s)",
    );
  });

  it("rejects a mostly dark frame with HUD-sized bright content", () => {
    const colors: Array<readonly [number, number, number, number]> = Array.from(
      { length: 100 },
      (_, index) => {
        return [index % 32, Math.floor(index / 32), 0, 255] as const;
      },
    );
    colors[0] = [255, 255, 255, 255];
    colors[1] = [255, 255, 255, 255];

    expect(() => assertFrameShowsSomething(image(colors), "hud-only.png")).toThrow(
      "bright pixel ratio",
    );
  });

  it("accepts a real archived frame", () => {
    const path = resolve(
      process.cwd(),
      "docs/benchmark/sweeps/platformer-2026-08-06/proof-artifacts/0/after.png",
    );
    const stats = assertFrameShowsSomething(readFileSync(path), path);
    expect(stats.width).toBe(1280);
    expect(stats.height).toBe(720);
    expect(stats.distinctColors).toBeGreaterThanOrEqual(8);
    expect(inspectFrame(readFileSync(path))).toEqual(stats);
  });
});
