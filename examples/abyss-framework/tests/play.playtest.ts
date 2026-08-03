import { expect, test } from "@playwright/test";

test("should pass the framework interaction scenario", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.locator("#score")).toHaveText("0");
  await page.locator("#startBtn").click();

  await page.keyboard.down("ArrowRight");
  await page.keyboard.down("Space");
  await page.waitForTimeout(2_500);
  await page.keyboard.up("Space");
  await page.keyboard.up("ArrowRight");

  await expect(page.locator("#score")).toHaveText("1", { timeout: 5_000 });
  const expectedWebGpuErrors = new Set([
    "Instance dropped in popErrorScope",
    "Failed to execute 'createBuffer' on 'GPUDevice': createBuffer failed, size (720) is too large for the implementation when mappedAtCreation == true",
  ]);
  expect(errors.filter((error) => !expectedWebGpuErrors.has(error))).toEqual([]);
});
