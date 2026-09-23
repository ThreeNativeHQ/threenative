import { expect, test } from "@playwright/test";

const BRIDGE = "__THREENATIVE_PLAYTEST_BRIDGE__";

test("viewport resize keeps the canvas and player visible", async ({ page }) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));

  await page.setViewportSize({ height: 720, width: 1280 });
  await page.goto("/?viewport");
  await expect(page.locator("canvas")).toBeVisible();
  await page.keyboard.press("`");
  const overlay = page.locator('[data-threenative-debug-overlay="true"]');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveCSS("position", "fixed");
  await expect(overlay).toHaveCSS("pointer-events", "none");
  await expect.poll(() => canvasSize(page)).toEqual({ height: 720, width: 1280 });

  await page.setViewportSize({ height: 1280, width: 720 });
  await expect.poll(() => canvasSize(page)).toEqual({ height: 1280, width: 720 });
  const player = await page.evaluate(async (bridgeName) => {
    const bridge = (
      globalThis as unknown as Record<string, { sample: (request: unknown) => Promise<unknown> }>
    )[bridgeName];
    if (bridge === undefined) throw new Error("Playtest bridge was not installed.");
    const snapshot = (await bridge.sample({ entities: ["camera.main", "player"] })) as {
      entities?: Array<{ id: string; visible?: boolean }>;
    };
    return snapshot.entities?.find((entity) => entity.id === "player");
  }, BRIDGE);

  expect(player?.visible).toBe(true);
  expect(pageErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

async function canvasSize(page: import("@playwright/test").Page) {
  return page
    .locator("canvas")
    .evaluate((canvas) => ({ height: canvas.height, width: canvas.width }));
}

test("the geometry tab captures per-object cost and outlines the selected row", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ height: 720, width: 1280 });
  await page.goto("/?geometry");
  await expect(page.locator("canvas")).toBeVisible();
  await page.keyboard.press("`");
  const overlay = page.locator('[data-threenative-debug-overlay="true"]');
  await expect(overlay).toBeVisible();

  // The overlay root stays non-interactive so it never eats a click meant for the game; the
  // controls opt themselves back in, which is what makes this click land at all.
  await overlay.getByRole("tab", { name: "Geometry" }).click();
  // Nothing is captured until the button is pressed: opening the tab arms no collection.
  await expect(overlay.getByRole("button", { name: "Capture" })).toBeEnabled();
  await overlay.getByRole("button", { name: "Capture" }).click();

  // A real presented frame feeds the table. Refresh is only offered once a report exists.
  await expect(overlay.getByRole("button", { name: "Refresh" })).toBeVisible({ timeout: 15_000 });
  const rows = overlay.locator(".tn-debug-objects tbody tr");
  await expect.poll(async () => rows.count(), { timeout: 15_000 }).toBeGreaterThan(0);

  // The pass table reconciles what the rows claim against what the frame measured.
  await expect(overlay.locator(".tn-debug-passes")).toContainText("main");
  await expect(overlay).toContainText("rows");

  const selectable = overlay.locator(".tn-debug-select").first();
  const name = (await selectable.textContent()) ?? "";
  await selectable.click();
  await expect(selectable).toHaveAttribute("aria-pressed", "true");
  // Either the captured bounds are outlined, or the row says they are unavailable — never a box
  // drawn somewhere plausible and wrong.
  const outlined = await page.locator(".tn-debug-outline").count();
  if (outlined === 0) await expect(overlay).toContainText("bounds unavailable");
  expect(name.length).toBeGreaterThan(0);

  // Grouping and sorting reuse the captured report; neither asks the game for another frame.
  await overlay.getByLabel("Assets").check();
  await expect(overlay.locator(".tn-debug-assets")).toBeVisible();
  await overlay.getByLabel("Objects").check();
  await overlay.getByLabel("Sort").selectOption("draws");
  await expect(overlay.getByRole("button", { name: "Refresh" })).toBeVisible();

  await expect(overlay.getByRole("button", { name: "Copy JSON" })).toBeVisible();
  // Not `toEqual([])`: a page held open this long in this lane reports "Instance dropped in
  // popErrorScope" from three's GPU timestamp queries whether or not anything is captured — a
  // control run with the same duration and no geometry interaction at all reports the same list.
  // What must stay empty is any error the capture itself caused.
  expect(pageErrors.filter((message) => /geometry|onBeforeRender/iu.test(message))).toEqual([]);
});
