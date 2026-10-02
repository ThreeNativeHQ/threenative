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
  const variants = [
    {
      variant: "without-history",
      query: "?without-history",
      kind: "BatchedMesh",
      failures: ["movingPixels", "oracleMaxErrorPixels"],
    },
    { variant: "tracked", query: "", kind: "BatchedMesh", failures: [] },
    { variant: "instanced", query: "?instanced", kind: "InstancedMesh", failures: [] },
    {
      variant: "instanced-dynamic",
      query: "?instanced&dynamic",
      kind: "InstancedMesh",
      failures: [],
    },
    {
      variant: "aggregate-batch",
      query: "?aggregate-history",
      kind: "BatchedMesh",
      failures: ["staticMax", "stationaryMax"],
    },
    {
      variant: "aggregate-instance",
      query: "?instanced&aggregate-history",
      kind: "InstancedMesh",
      failures: ["staticMax", "stationaryMax"],
    },
    { variant: "skinned", query: "?skinned", kind: "SkinnedMesh", failures: [] },
    {
      variant: "skinned-current-history",
      query: "?skinned&current-as-previous",
      kind: "SkinnedMesh",
      failures: ["movingPixels", "oracleMaxErrorPixels"],
    },
    { variant: "late-write", query: "?instanced&late-write", kind: "InstancedMesh", failures: [] },
    {
      variant: "premature-commit",
      query: "?instanced&late-write&premature-commit",
      kind: "InstancedMesh",
      failures: ["movingPixels", "oracleMaxErrorPixels"],
    },
  ];
  for (const { variant, query, kind, failures } of variants) {
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
    assertVelocityCaptureDiagnostics(report.diagnostics, failures.length > 0);
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
      failures.length === 0,
      `${variant}: ${JSON.stringify(report.diagnostics)}`,
    );
    assert.deepEqual(
      (report.assertionResults ?? []).filter(({ pass }) => !pass).map(({ id }) => id),
      failures.map((name) => `resource.motion.${name}`),
    );
    const snapshot = report.observations?.resources.motion?.after;
    assert.ok(snapshot && typeof snapshot === "object" && !Array.isArray(snapshot));
    assert.ok("geometryKind" in snapshot && "lateWrites" in snapshot);
    assert.equal(snapshot.geometryKind, kind, `${variant}: actual geometry class`);
    assert.equal(
      snapshot.lateWrites,
      query.includes("late-write") ? 8 : 0,
      `${variant}: writes after scheduling`,
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
    `Velocity history: missing-history control failed and batch, instance, skinning and ordering cases passed their exact positive/mutation assertions. Artifacts: ${output}`,
  );
} catch (error) {
  await writeFile(
    path.join(output, "failure.json"),
    `${JSON.stringify({ sourceSha, pass: false, error: error instanceof Error ? error.message : String(error), stack: error instanceof Error ? error.stack : undefined }, null, 2)}\n`,
  );
  throw error;
}
