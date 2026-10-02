import { execFileSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  WEBGPU_BROWSER_ARGS,
  runStandalonePlaytest,
} from "../../../../playtest/dist/runner/index.js";
import { assertExposureProof } from "./proof.js";

const fixture = dirname(fileURLToPath(import.meta.url));
const root = resolve(fixture, "../../../../..");
const artifacts = join(root, "artifacts/prd339-exposure");
const site = join(artifacts, "site");
await mkdir(artifacts, { recursive: true });
await build({ configFile: false, root: fixture, build: { outDir: site, emptyOutDir: true } });
if (!process.argv.includes("--build-only")) {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const vite = join(
    dirname(fileURLToPath(import.meta.resolve("vite/package.json"))),
    "bin/vite.js",
  );
  const cases = [
    { name: "dark-adapted", query: "bright=0", scenario: "static", applied: true },
    { name: "sunlight-adapted", query: "bright=1", scenario: "static", applied: true },
    {
      name: "eleven-stop-cut",
      query: "bright=0&stops=11&snapGain=0",
      scenario: "cut",
      applied: true,
    },
    { name: "one-stop-cut", query: "bright=0&stops=1&snapGain=0", scenario: "cut", applied: true },
    { name: "fixed-exposure", query: "enabled=0&bright=1", scenario: "static", applied: false },
  ];
  const results = [];
  for (const item of cases) {
    const directory = join(artifacts, item.name);
    await mkdir(directory, { recursive: true });
    const report = await runStandalonePlaytest({
      artifactDirectory: directory,
      projectPath: fixture,
      scenarioPath: join(fixture, `${item.scenario}.playtest.json`),
      url: `http://127.0.0.1:4173/?${item.query}`,
      port: 0,
      server: {
        command: `TN_EXPOSURE_HTTP_LOG=${JSON.stringify(join(directory, "http-errors.jsonl"))} ${JSON.stringify(process.execPath)} ${JSON.stringify(vite)} preview --host 127.0.0.1 --port $PORT --strictPort --outDir ${JSON.stringify(site)}`,
        cwd: fixture,
      },
      timeoutMs: 180_000,
      headless: false,
      trace: false,
      target: "browser",
      browserArgs: WEBGPU_BROWSER_ARGS,
      allowSoftwareAdapter: true,
      captureArtifactScreenshots: true,
    });
    await writeFile(
      join(directory, "report.json"),
      `${JSON.stringify({ sourceSha, ...report }, null, 2)}\n`,
    );
    const measurement = assertExposureProof(report, item.applied);
    const screenshot = join(directory, "after.png");
    if ((await stat(screenshot)).size === 0)
      throw new Error(`${item.name}: runtime screenshot missing.`);
    results.push({ name: item.name, sourceSha, measurement, capture: report.capture, screenshot });
    await writeFile(
      join(artifacts, "summary.json"),
      `${JSON.stringify({ sourceSha, correctnessOnly: true, results }, null, 2)}\n`,
    );
  }
  console.info(
    `PRD339_EXPOSURE_PROOF ${JSON.stringify({ sourceSha, captures: results.length, correctnessOnly: true })}`,
  );
}
