import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("should reach a non-black frame within 5s", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("#startBtn")).toBeVisible();
  await page.locator("#startBtn").click();
  await expect(page.locator("canvas")).toBeVisible({ timeout: 5_000 });
  const screenshot = PNG.sync.read(await page.screenshot());
  const luminance =
    screenshot.data.reduce((sum, value, index) => {
      if (index % 4 === 3) return sum;
      return sum + value / 255;
    }, 0) /
    (screenshot.width * screenshot.height * 3);
  const expectedWebGpuBackendErrors = new Set([
    "Instance dropped in popErrorScope",
    "Failed to execute 'createBuffer' on 'GPUDevice': createBuffer failed, size (720) is too large for the implementation when mappedAtCreation == true",
  ]);
  const unexpectedErrors = errors.filter((error) => !expectedWebGpuBackendErrors.has(error));
  expect(unexpectedErrors).toEqual([]);
  expect(luminance).toBeGreaterThan(0.02);
});
