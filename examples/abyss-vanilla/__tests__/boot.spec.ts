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
  expect(errors).toEqual([]);
  expect(luminance).toBeGreaterThan(0.02);
});
