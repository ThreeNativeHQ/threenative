import { expect, test } from "@playwright/test";

test.describe("the code showcase", () => {
  test("should show the React snippet when the React tab is selected", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/");
    const panel = page.locator("#code pre");
    await expect(panel).toContainText("defineGame");
    await page.getByTestId("code-tab-react").click();
    await expect(panel).toContainText("GameCanvas");
    await expect(panel).not.toContainText("defineGame");
  });

  test("should select the tab a deep link asks for", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/?tab=cli");
    await expect(page.locator("#code pre")).toContainText("create threenative");
  });
});
