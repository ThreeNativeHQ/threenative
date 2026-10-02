import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertCaptureNotBlank } from "../packages/playtest/dist/capture.js";
import {
  WEBGPU_BROWSER_ARGS,
  runStandalonePlaytest,
} from "../packages/playtest/dist/runner/index.js";
import { assertVelocityCaptureDiagnostics } from "./velocity-capture-proof.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "artifacts/velocity-history");
await mkdir(output, { recursive: true });
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
await writeFile(
  path.join(output, "attempt.json"),
  `${JSON.stringify({ sourceSha, status: "started" }, null, 2)}\n`,
);
try {
  execFileSync("pnpm", ["exec", "vite", "build", "--config", "velocity.vite.config.ts"], {
    cwd: path.join(root, "examples/abyss-framework"),
    stdio: "inherit",
  });
  const results = [];
  for (const variant of ["without-history", "tracked", "instanced", "instanced-dynamic"] as const) {
    const query =
      variant === "without-history"
        ? "?without-history"
        : variant === "instanced"
          ? "?instanced"
          : variant === "instanced-dynamic"
            ? "?instanced&dynamic"
            : "";
    const artifactDirectory = path.join(output, variant);
    const report = await runStandalonePlaytest({
      allowSoftwareAdapter: true,
      artifactDirectory,
      browserArgs: [...WEBGPU_BROWSER_ARGS],
      headless: false,
      port: 0,
      projectPath: path.join(root, "examples/abyss-framework"),
      scenarioPath: "playtests/velocity-history.playtest.json",
      server: {
        command:
          "pnpm exec vite preview --config velocity.vite.config.ts --host 127.0.0.1 --port $PORT --strictPort",
        timeoutMs: 60_000,
      },
      timeoutMs: 60_000,
      trace: false,
      url: `http://127.0.0.1:5173/velocity.html${query}`,
    });
    await writeFile(
      path.join(artifactDirectory, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    results.push({ variant, report });
    await writeFile(path.join(output, "reports.json"), `${JSON.stringify(results, null, 2)}\n`);
    assertVelocityCaptureDiagnostics(report.diagnostics, variant === "without-history");
    assert.equal(report.capture?.rendererKind, "webgpu", `${variant}: must render WebGPU`);
    assert.ok(
      report.capture?.adapter &&
        Object.values(report.capture.adapter).some((value) => value.trim() !== ""),
      `${variant}: adapter identity required`,
    );
    const images = (await readdir(artifactDirectory)).filter((name) => name.endsWith(".png"));
    assert.ok(images.includes("after.png"), `${variant}: final runtime screenshot required`);
    for (const name of images)
      assertCaptureNotBlank(
        await readFile(path.join(artifactDirectory, name)),
        `${variant}/${name}`,
      );
    assert.equal(
      report.pass,
      variant !== "without-history",
      `${variant}: ${JSON.stringify(report.diagnostics)}`,
    );
    if (variant === "without-history")
      assert.deepEqual(
        (report.assertionResults ?? []).filter(({ pass }) => !pass).map(({ id }) => id),
        ["resource.motion.movingPixels", "resource.motion.oracleMaxErrorPixels"],
      );
  }
  assert.ok(
    !(await readFile(path.join(output, "without-history/after.png"))).equals(
      await readFile(path.join(output, "tracked/after.png")),
    ),
    "Actual velocity visualization must change when history is removed.",
  );
  await writeFile(
    path.join(output, "summary.json"),
    `${JSON.stringify({ sourceSha, pass: true, qualification: "actual WebGPU velocity MRT readback and screenshots; software pixels only, no native, ghosting or hardware-performance claim", variants: results.map(({ variant, report }) => ({ variant, pass: report.pass, capture: report.capture, motion: report.observations?.resources.motion, diagnostics: report.diagnostics })) }, null, 2)}\n`,
  );
  console.log(
    `Velocity history: missing-history control failed and tracked authored batch and both instance usages passed. Artifacts: ${output}`,
  );
} catch (error) {
  await writeFile(
    path.join(output, "failure.json"),
    `${JSON.stringify({ sourceSha, pass: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, null, 2)}\n`,
  );
  throw error;
}
