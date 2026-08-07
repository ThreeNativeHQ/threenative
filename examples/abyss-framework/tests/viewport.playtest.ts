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
