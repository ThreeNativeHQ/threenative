import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

test.setTimeout(120_000);

interface HotDiagnostics {
  reloads: number;
  entities: number;
  sceneObjects: number;
  canvases: number;
  audio: { queued: number; voices: number };
  physics: number | null;
}

interface RuntimeSnapshot {
  diagnostics: HotDiagnostics;
  playerX: number;
  score: number;
  navigationEntries: number;
}

const hotReloadProjectFile = path.join(tmpdir(), "threenative-hot-reload-threejs-webgpu.path");
const sharedProject = (await readFile(hotReloadProjectFile, "utf8").catch(() => "")).trim();
const project =
  process.env.THREENATIVE_HOT_RELOAD_PROJECT ??
  (sharedProject.length > 0 ? sharedProject : undefined);

async function runtimeSnapshot(page: import("@playwright/test").Page): Promise<RuntimeSnapshot> {
  return page.evaluate(() => {
    const tools = (
      window as Window & {
        __THREENATIVE__?: {
          hot?: () => HotDiagnostics;
          snapshot?: () => Record<string, { position?: number[] }>;
        };
      }
    ).__THREENATIVE__;
    const diagnostics = tools?.hot?.();
    const player = tools?.snapshot?.().player?.position;
    const scoreLabel = [...document.querySelectorAll("div")].find(
      (element) => element.textContent?.trim() === "score",
    );
    if (diagnostics === undefined || player?.[0] === undefined)
      throw new Error("Hot reload diagnostics did not expose the player.");
    return {
      diagnostics,
      navigationEntries: performance.getEntriesByType("navigation").length,
      playerX: player[0],
      score: Number(scoreLabel?.nextElementSibling?.textContent ?? Number.NaN),
    };
  });
}

async function heapSize(page: import("@playwright/test").Page): Promise<number> {
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  await client.send("HeapProfiler.collectGarbage");
  const metrics = await client.send("Performance.getMetrics");
  const heap = metrics.metrics.find(({ name }) => name === "JSHeapUsedSize")?.value;
  if (heap === undefined || !Number.isFinite(heap))
    throw new Error("JSHeapUsedSize was not reported.");
  return heap;
}

async function fallDistance(page: import("@playwright/test").Page): Promise<number> {
  await page.keyboard.down("Space");
  await page.waitForTimeout(50);
  await page.keyboard.up("Space");
  return page.evaluate(async () => {
    const playerY = (): number => {
      const position = (
        window as Window & {
          __THREENATIVE__?: { snapshot?: () => Record<string, { position?: number[] }> };
        }
      ).__THREENATIVE__?.snapshot?.().player?.position;
      if (position?.[1] === undefined) throw new Error("Player Y was not observable.");
      return position[1];
    };
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let peak = playerY();
    for (let index = 0; index < 240; index += 1) {
      await frame();
      const y = playerY();
      peak = Math.max(peak, y);
      if (peak - y < 0.08) continue;
      const start = y;
      for (let fallingFrame = 0; fallingFrame < 10; fallingFrame += 1) await frame();
      const distance = start - playerY();
      while (playerY() > 0.52) await frame();
      return distance;
    }
    throw new Error("Player never entered the measured fall window.");
  });
}

async function waitForHotReload(
  page: import("@playwright/test").Page,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await page
      .evaluate((reloads) => {
        try {
          const tools = (
            window as Window & {
              __THREENATIVE__?: {
                hot?: () => HotDiagnostics;
                snapshot?: () => Record<string, { position?: number[] }>;
              };
            }
          ).__THREENATIVE__;
          const diagnostics = tools?.hot?.();
          return (
            diagnostics?.reloads === reloads &&
            diagnostics.canvases === 1 &&
            diagnostics.physics !== null &&
            tools?.snapshot?.().player?.position?.[0] !== undefined
          );
        } catch {
          return false;
        }
      }, expected)
      .catch(() => false);
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`HMR reload ${expected} was not observed within 15 seconds.`);
}

test.afterAll(async () => {
  await rm(hotReloadProjectFile, { force: true });
});

test("preserves starter state and stays flat across ten real HMR updates", async ({ page }) => {
  if (project === undefined) throw new Error("THREENATIVE_HOT_RELOAD_PROJECT was not exported.");
  const errors: string[] = [];
  page.on("console", (entry) => {
    if (entry.type() === "error") errors.push(entry.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.waitForFunction(() => {
    try {
      const diagnostics = (
        window as Window & { __THREENATIVE__?: { hot?: () => HotDiagnostics } }
      ).__THREENATIVE__?.hot?.();
      return diagnostics?.canvases === 1 && diagnostics.physics !== null;
    } catch {
      return false;
    }
  });

  await page.keyboard.down("ArrowRight");
  try {
    await page.waitForFunction(
      () => {
        const scoreLabel = [...document.querySelectorAll("div")].find(
          (element) => element.textContent?.trim() === "score",
        );
        return Number(scoreLabel?.nextElementSibling?.textContent ?? Number.NaN) > 0;
      },
      undefined,
      { timeout: 12_000 },
    );
  } finally {
    await page.keyboard.up("ArrowRight");
  }
  const before = await runtimeSnapshot(page);
  expect(before.score).toBeGreaterThan(0);
  const fallBefore = await fallDistance(page);
  expect(fallBefore).toBeGreaterThan(0);
  const heapBefore = await heapSize(page);
  const playerFile = path.join(project, "src/entities/Player.ts");
  const original = await readFile(playerFile, "utf8");
  const jumpPattern = /const JUMP_SPEED = [^;]+;/u;
  expect(original).toMatch(jumpPattern);

  try {
    for (let reload = 1; reload <= 10; reload += 1) {
      await writeFile(
        playerFile,
        original.replace(jumpPattern, (speed) => `${speed} // HMR cycle ${reload}`),
      );
      await waitForHotReload(page, reload);
      const after = await runtimeSnapshot(page);
      expect(after.diagnostics.reloads).toBe(reload);
      expect(after.diagnostics.canvases).toBe(1);
      expect(after.diagnostics.sceneObjects).toBe(before.diagnostics.sceneObjects);
      expect(after.diagnostics.entities).toBe(before.diagnostics.entities);
      expect(after.diagnostics.physics).toBe(before.diagnostics.physics);
      expect(after.diagnostics.audio).toEqual({ queued: 0, voices: 0 });
      expect(after.score).toBeGreaterThanOrEqual(before.score);
      expect(Math.abs(after.playerX - before.playerX)).toBeLessThan(0.25);
    }
    const after = await runtimeSnapshot(page);
    expect(after.diagnostics.reloads).toBe(10);
    expect(after.navigationEntries).toBe(1);
    const fallAfter = await fallDistance(page);
    expect(Math.abs(fallAfter - fallBefore) / fallBefore).toBeLessThanOrEqual(0.05);
    expect(await heapSize(page)).toBeLessThanOrEqual(
      Math.max(heapBefore * 1.5, heapBefore + 10_000_000),
    );
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await writeFile(playerFile, original);
  }
});
