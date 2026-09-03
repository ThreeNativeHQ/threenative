import { expect, test } from "@playwright/test";

test.describe("the hero", () => {
  test("should copy the install command when the copy button is pressed", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/");
    await page.getByTestId("install-cta").click();
    await expect(page.getByTestId("install-panel")).toBeVisible();
    await page.getByTestId("install-panel").getByTestId("copy-button").click();
    await expect(page.getByTestId("copy-toast")).toContainText("copied");
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain("create threenative");
  });

  test("should rewrite the install command for the chosen package manager", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/");
    await page.getByTestId("install-cta").click();
    await expect(page.getByTestId("install-command")).toContainText("pnpm create threenative");
    await page.getByTestId("package-manager-npm").click();
    await expect(page.getByTestId("install-command")).toContainText("npm create threenative");
    await expect(page.getByTestId("install-command")).toContainText("npm run dev");
  });
});
