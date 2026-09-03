import { expect, test } from "@playwright/test";

test.describe("the header", () => {
  test("should open the mobile drawer when the menu button is pressed", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/");
    await expect(page.getByTestId("mobile-nav")).toHaveCount(0);
    await page.getByTestId("mobile-nav-toggle").click();
    await expect(page.getByTestId("mobile-nav")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mobile-nav")).toHaveCount(0);
  });

  test("should open a dropdown from the keyboard and close it on Escape", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Product" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("link", { name: "Native runtime The owned C++" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
