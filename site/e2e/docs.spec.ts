import { expect, test } from "@playwright/test";

test.describe("documentation navigation", () => {
  test("moves through docs and preserves the home install anchor", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { exact: true, name: "Docs" })
      .click();
    await expect(page).toHaveURL(/\/docs\/?$/u);
    await page
      .getByRole("navigation", { name: "Documentation", exact: true })
      .getByRole("link", { exact: true, name: "Physics" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Physics and portability" })).toBeVisible();
    await page.locator("header").getByRole("link", { exact: true, name: "Get Started" }).click();
    await expect(page).toHaveURL(/\/#install$/u);
    await expect(page.locator("#install")).toBeVisible();
  });

  test("uses a grouped mobile menu instead of a horizontal nav strip", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/docs");
    const menu = page.getByTestId("mobile-docs-navigation");
    await expect(menu).not.toHaveAttribute("open", "");
    await menu.locator("summary").click();
    await menu.getByRole("link", { exact: true, name: "Benchmarks" }).click();
    await expect(page).toHaveURL(/\/docs\/benchmarks\/?$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "ThreeNative benchmarks and verification" }),
    ).toBeVisible();
    await expect(page.getByTestId("mobile-nav-toggle")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
      true,
    );
  });

  test("searches locally and follows the first result with Enter", async ({ page }) => {
    await page.goto("/docs");
    await page.getByRole("button", { name: /^Search docs/u }).click();
    const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole("searchbox");
    await expect(input).toBeFocused();
    await input.fill("UNREAL engine");
    await expect(
      dialog.getByRole("navigation", { name: "Search results" }).getByRole("link"),
    ).toHaveCount(1);
    await input.press("Enter");
    await expect(page).toHaveURL(/\/docs\/comparison\/?$/u);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Unreal Engine");
  });

  test("handles the keyboard shortcut, no results, Escape and focus restoration", async ({ page }) => {
    await page.goto("/docs/comparison");
    const trigger = page.getByRole("button", { name: /^Search docs/u });
    await trigger.focus();
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search documentation", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("searchbox").fill("no-such-document-xyz");
    await expect(dialog.getByRole("status")).toContainText("No matching topics");
    await dialog.getByRole("searchbox").press("Enter");
    await expect(page).toHaveURL(/\/docs\/comparison\/?$/u);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  test("keeps Tab focus within the native search dialog", async ({ page }) => {
    await page.goto("/docs");
    await page.getByRole("button", { name: /^Search docs/u }).click();
    for (let index = 0; index < 15; index++) {
      await page.keyboard.press("Tab");
      expect(
        await page.locator("dialog").evaluate((dialog) => dialog.contains(document.activeElement)),
      ).toBe(true);
    }
    for (let index = 0; index < 15; index++) {
      await page.keyboard.press("Shift+Tab");
      expect(
        await page.locator("dialog").evaluate((dialog) => dialog.contains(document.activeElement)),
      ).toBe(true);
    }
    await page.keyboard.press("Escape");
  });

  test("focuses the first search result with ArrowDown", async ({ page }) => {
    await page.goto("/docs");
    await page.getByRole("button", { name: /^Search docs/u }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("searchbox").fill("physics");
    await dialog.getByRole("searchbox").press("ArrowDown");
    await expect(
      dialog.getByRole("navigation", { name: "Search results" }).getByRole("link").first(),
    ).toBeFocused();
  });

  test("offers a two-engine view without removing the full comparison", async ({ page }) => {
    await page.goto("/docs/comparison");
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader")).toHaveCount(6);
    await page.getByLabel("Compare ThreeNative with").selectOption("Unity");
    await expect(table.getByRole("columnheader")).toHaveText(["Dimension", "ThreeNative", "Unity"]);
    await expect(table.getByRole("rowheader")).toHaveCount(6);
    await expect(table.getByText("Editor + C#", { exact: true })).toBeVisible();
    await page.getByLabel("Compare ThreeNative with").selectOption("all");
    await expect(table.getByRole("columnheader")).toHaveCount(6);
  });

  test("contains wide comparison and benchmark tables on small screens", async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ height: 844, width });
      for (const path of ["/docs/comparison", "/docs/benchmarks"]) {
        await page.goto(path);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(
          true,
        );
      }
    }
  });

  test("provides heading permalinks and tracks the active section", async ({ page }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/docs/comparison");
    await page.locator("#table h2 a").click();
    await expect(page).toHaveURL(/#table$/u);
    await expect(
      page
        .getByRole("navigation", { name: "On this page", exact: true })
        .getByRole("link", { name: "Side-by-side", exact: true }),
    ).toHaveAttribute("aria-current", "location");
  });
});

test.describe("documentation without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("prerenders comparisons and keeps native mobile navigation usable", async ({ page }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/docs/comparison/");
    await expect(page.getByRole("table").getByRole("columnheader")).toHaveCount(6);
    const menu = page.getByTestId("mobile-docs-navigation");
    await menu.locator("summary").click();
    await menu.getByRole("link", { name: "Benchmarks", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("benchmarks");
    await expect(page.getByText("VOID — no winner is published", { exact: true })).toBeVisible();
  });
});
