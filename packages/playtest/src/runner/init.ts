import { access, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export async function initStandalonePlaytest(projectPath = process.cwd()): Promise<{ created: string[] }> {
  const files = {
    "playtest.adapter.example.ts": `import { installThreePlaytestBridge } from "@threenative/playtest/three";

installThreePlaytestBridge({
  camera,
  entities: [{ id: "player", object: player }],
  renderer,
  scene,
});
`,
    "playtest.config.json": `${JSON.stringify({
      artifactDirectory: "artifacts/playtest",
      scenario: "playtests/smoke.playtest.json",
      url: "http://127.0.0.1:5173",
    }, null, 2)}\n`,
    "playtests/smoke.playtest.json": `${JSON.stringify({
      assert: { movement: { entity: "player", minDistance: 0.1 } },
      name: "smoke",
      schemaVersion: 1,
      steps: [{ holdTicks: 8, press: "KeyW", release: true }],
      subject: "player",
      target: "web",
      viewport: { height: 720, width: 1280 },
      warmupFrames: 2,
    }, null, 2)}\n`,
  };
  const created: string[] = [];
  for (const relativePath of Object.keys(files)) {
    try {
      await access(resolve(projectPath, relativePath));
      throw new Error(`Refusing to overwrite existing '${relativePath}'. Move it or choose a clean project directory.`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = resolve(projectPath, relativePath);
    await mkdir(resolve(absolutePath, ".."), { recursive: true });
    await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
    created.push(relativePath);
  }
  return { created };
}
