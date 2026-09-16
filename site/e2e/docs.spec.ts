import { expect, test } from "@playwright/test";

test.describe("documentation navigation", () => {
  test("should move from the global nav through docs and preserve the home install anchor", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 900, width: 1440 });
    await page.goto("/");

    const mainNav = page.getByRole("navigation", { name: "Main" });
    await mainNav.getByRole("link", { exact: true, name: "Docs" }).click();
    await expect(page).toHaveURL(/\/docs$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "ThreeNative docs — build, verify and ship" }),
    ).toBeVisible();

    const docsNav = page.getByRole("navigation", { name: "Documentation" });
    await docsNav.getByRole("link", { exact: true, name: "Physics" }).click();
    await expect(page).toHaveURL(/\/docs\/physics$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "Physics and portability" }),
    ).toBeVisible();

    await page.locator("header").getByRole("link", { exact: true, name: "Get Started" }).click();
    await expect(page).toHaveURL(/\/#install$/u);
    await expect(page.locator("#install")).toBeVisible();
  });

  test("should expose the docs manual on a narrow viewport without another global nav row", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await page.goto("/docs");

    await page.getByRole("link", { exact: true, name: "Benchmarks" }).click();
    await expect(page).toHaveURL(/\/docs\/benchmarks$/u);
    await expect(
      page.getByRole("heading", { level: 1, name: "ThreeNative benchmarks and verification" }),
    ).toBeVisible();
    await expect(page.getByTestId("mobile-nav-toggle")).toBeVisible();
  });
});
