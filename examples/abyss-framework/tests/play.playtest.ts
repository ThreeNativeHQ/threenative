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
  const player = await page.evaluate(() => {
    const host = window as Window & {
      __THREENATIVE__?: { snapshot(): Record<string, Record<string, unknown>> };
    };
    return host.__THREENATIVE__?.snapshot().player;
  });
  expect(player).toMatchObject({ score: 1 });
  expect(player?.hull).toBeGreaterThan(0);
  expect(player?.hull).toBeLessThanOrEqual(100);
  expect(player?.hull).not.toBe(999);
  await page.keyboard.press("`");
  await expect(page.locator('[data-threenative-debug-overlay="true"]')).toBeVisible();
  await expect(page.locator("tbody tr").first()).toContainText("player");
  const unexpectedErrors = errors.filter(
    (error) =>
      error !== "Instance dropped in popErrorScope" &&
      !/^Failed to execute 'createBuffer' on 'GPUDevice': createBuffer failed, size \(\d+\) is too large for the implementation when mappedAtCreation == true$/.test(
        error,
      ),
  );
  expect(unexpectedErrors).toEqual([]);
});
