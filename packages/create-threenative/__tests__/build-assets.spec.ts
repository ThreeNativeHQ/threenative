import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { build } from "../src/build.js";

const { calls } = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("@threenative/assets", () => ({
  compileAssets: async () => {
    calls.push("compile");
    return { skipped: 0, written: 0 };
  },
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const spawn = ((command: string) => {
    calls.push(`spawn:${path.basename(command)}`);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  }) as typeof actual.spawn;
  return { ...actual, spawn };
});

afterEach(() => {
  calls.splice(0);
});

async function writeProject(root: string): Promise<void> {
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "asset-order" }));
  await writeFile(path.join(root, "src/game.ts"), "export default { start: async () => {} };\n");
}

describe("threenative build asset compilation", () => {
  it("should compile assets before invoking vite", async () => {
    const root = await makeTempDir("threenative-build-assets-web-");
    await writeProject(root);

    await build({ cwd: root, target: "web" });

    const compileIndex = calls.indexOf("compile");
    const spawnIndex = calls.findIndex((call) => call.startsWith("spawn:"));
    expect(compileIndex).toBeGreaterThanOrEqual(0);
    expect(spawnIndex).toBeGreaterThan(compileIndex);
  });

  it("should compile assets before native packaging", async () => {
    const root = await makeTempDir("threenative-build-assets-native-");
    await writeProject(root);

    // Packaging cannot finish in a temp project (no runtime bundle output), but wherever it
    // stops, the asset compile must already have run.
    await expect(build({ cwd: root, target: "desktop" })).rejects.toThrow();
    expect(calls[0]).toBe("compile");
  });
});
