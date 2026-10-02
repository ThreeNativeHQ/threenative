import { execFileSync } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import {
  WEBGPU_BROWSER_ARGS,
  runStandalonePlaytest,
} from "../../../../playtest/dist/runner/index.js";

const fixture = dirname(fileURLToPath(import.meta.url));
const root = resolve(fixture, "../../../../..");
const artifacts = join(root, "artifacts/vq11-decals");
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
  const results = [];
  for (const name of ["static", "motion", "teardown", "restart"]) {
    const directory = join(artifacts, name);
    const report = await runStandalonePlaytest({
      artifactDirectory: directory,
      projectPath: fixture,
      scenarioPath: join(fixture, `${name}.playtest.json`),
      url: "http://127.0.0.1:4173/",
      port: 0,
      server: {
        command: `${JSON.stringify(process.execPath)} ${JSON.stringify(vite)} preview --host 127.0.0.1 --port $PORT --strictPort --outDir ${JSON.stringify(site)}`,
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
    // Keep real partial frames/report even when qualification fails. Never turn lost-device
    // frames into passing proof just because the software-adapter runner downgraded a warning.
    await writeFile(
      join(directory, "report.json"),
      `${JSON.stringify({ sourceSha, ...report }, null, 2)}\n`,
    );
    const last = report.observations?.console
      .filter((entry) => entry.text.startsWith("TN_DECAL_FIXTURE:"))
      .at(-1);
    const measurement =
      last === undefined ? undefined : JSON.parse(last.text.slice("TN_DECAL_FIXTURE:".length));
    const screenshot = join(directory, "after.png");
    const screenshotPresent = await stat(screenshot)
      .then((file) => file.size > 0)
      .catch(() => false);
    const disallowedDiagnostics = report.diagnostics.filter(
      (diagnostic) =>
        diagnostic.severity === "error" || diagnostic.code === "TN_PLAYTEST_SOFTWARE_DEVICE_LOST",
    );
    const qualified =
      report.pass &&
      report.capture?.rendererKind === "webgpu" &&
      Object.values(report.capture.adapter).some((value) => value.length > 0) &&
      disallowedDiagnostics.length === 0 &&
      screenshotPresent &&
      measurement !== undefined &&
      measurement.active === (name === "teardown" ? 128 : 256) &&
      measurement.capacity === 256 &&
      measurement.created >= 321 &&
      measurement.lodHit === true &&
      measurement.renderTriangles === 2 &&
      Number.isFinite(measurement.geometryBytes) &&
      measurement.geometryBytes > 0 &&
      Number.isFinite(measurement.maxDrawCalls) &&
      measurement.maxDrawCalls > 0 &&
      Number.isFinite(measurement.motionError) &&
      measurement.motionError <= 1e-6;
    results.push({
      name,
      sourceSha,
      qualified,
      measurement,
      capture: report.capture,
      screenshot: screenshotPresent ? screenshot : null,
      diagnostics: report.diagnostics,
    });
    await writeFile(
      join(artifacts, "summary.json"),
      `${JSON.stringify({ sourceSha, correctnessOnly: true, results }, null, 2)}\n`,
    );
  }
  if (results.some((result) => !result.qualified))
    throw new Error(
      "VQ11 runtime qualification failed; retained frames are diagnostic only. Inspect artifacts/vq11-decals/summary.json.",
    );
  console.info(
    `VQ11_DECAL_PROOF ${JSON.stringify({ sourceSha, captures: results.length, correctnessOnly: true })}`,
  );
}
