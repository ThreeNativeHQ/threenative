// Task-owned serial startup proof. No screenshots, scene restart or camera mutations.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, readlink, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function launchOrder(count = 40) {
  assert.ok(Number.isSafeInteger(count) && count > 0 && count % 2 === 0);
  return Array.from({ length: count / 2 }, () => ["before", "after", "after", "before"]).flat();
}
export function statistics(values) {
  assert.ok(values.length > 0 && values.every((value) => Number.isFinite(value) && value >= 0));
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maximum: sorted.at(-1),
    method: "nearest rank ceil(0.95*n), one-based",
  };
}
async function treeFingerprint(root) {
  const files = [];
  async function walk(directory) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (["node_modules", ".git", "dist", ".vite", "artifacts"].includes(entry.name)) continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile())
        files.push({
          path: relative(root, path),
          sha256: createHash("sha256")
            .update(await readFile(path))
            .digest("hex"),
        });
      else if (entry.isSymbolicLink())
        files.push({
          path: relative(root, path),
          symlinkTarget: await readlink(path),
          policy: "target text retained; never traversed",
        });
      else throw new Error(`Unqualified source-tree entry: ${path}`);
    }
  }
  await walk(root);
  return { root, files, sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex") };
}
export function validateSample(provenance, readiness, observed) {
  assert.equal(provenance.rendererKind, "webgpu");
  assert.equal(provenance.target, "web");
  assert.equal(provenance.adapter.vendor, "nvidia");
  assert.equal(provenance.adapter.architecture, "turing");
  assert.deepEqual(provenance.viewport, { width: 1280, height: 720 });
  assert.equal(readiness.rule, "sustained-frames");
  const startup = readiness.startup;
  assert.equal(startup.phase, "ready");
  const { readyMs, loadStartedMs } = startup.timeline;
  assert.ok(
    Number.isFinite(readyMs) &&
      Number.isFinite(loadStartedMs) &&
      readyMs >= loadStartedMs &&
      loadStartedMs >= 0,
  );
  assert.equal(observed.backendWebGL, false);
  assert.equal(observed.width, 1280);
  assert.equal(observed.height, 720);
  assert.equal(observed.samples, 4);
  assert.ok(!startup.holds?.some((hold) => hold.expired));
  assert.ok((startup.warmup?.observed?.failed ?? 0) === 0, "Reported startup compilation failed");
  return { navigationReadyMs: readyMs, sceneLoadToReadyMs: readyMs - loadStartedMs };
}
async function run() {
  const { parseStandalonePlaytestArgs, withBrowserCapture } = await import(
    "../../../../playtest/dist/runner/index.js"
  );
  const output = resolve(process.argv[2] ?? "artifacts/backlight-defaults/startup-series1");
  await mkdir(output, { recursive: true });
  // Refuse accidentally replacing an existing series.
  assert.equal((await readdir(output)).length, 0, "Output directory must be empty");
  const roots = {
    before: resolve("artifacts/backlight-defaults/clean-starter-before2"),
    after: resolve("artifacts/backlight-defaults/clean-starter-after3"),
  };
  const frozen = {
    before: await treeFingerprint(roots.before),
    after: await treeFingerprint(roots.after),
  };
  await writeFile(resolve(output, "frozen-trees.json"), JSON.stringify(frozen, null, 2));
  const flags = [
    "--ozone-platform=x11",
    "--enable-unsafe-webgpu",
    "--disable-gpu-sandbox",
    "--ignore-gpu-blocklist",
    "--enable-features=Vulkan",
    "--use-angle=vulkan",
    "--use-vulkan=native",
    "--disable-vulkan-fallback-to-gl-for-testing",
  ];
  const samples = [];
  let matched;
  for (const [index, arm] of launchOrder().entries()) {
    const directory = resolve(output, `${String(index + 1).padStart(3, "0")}-${arm}`);
    const row = { index: index + 1, arm, success: false, directory };
    try {
      assert.equal(
        (await treeFingerprint(roots[arm])).sha256,
        frozen[arm].sha256,
        "Frozen source changed",
      );
      const config = parseStandalonePlaytestArgs([
        "--scenario",
        "packages/create-threenative/__tests__/fixtures/backlight-defaults/cost.playtest.json",
        "--url",
        `http://127.0.0.1:${arm === "before" ? 5194 : 5195}/`,
        "--timeout",
        "60000",
        "--artifacts",
        directory,
        ...flags.flatMap((flag) => ["--browser-arg", flag]),
      ]);
      await withBrowserCapture(config, async (session) => {
        row.provenance = session.provenance;
        row.captureSession = JSON.parse(
          await readFile(resolve(directory, "capture-session.json"), "utf8"),
        );
        row.snapshot = await session.bridge.sample({
          include: ["components", "state", "scene", "runtimeObservations"],
          label: "startup-series-ready",
        });
        row.observed = await session.page.evaluate(async () => {
          const { default: game } = await import("/src/game.ts");
          const raw = game.ctx.renderer.raw;
          return {
            backendWebGL: raw.backend.isWebGLBackend === true,
            width: raw.domElement.width,
            height: raw.domElement.height,
            samples: raw.samples,
            camera: {
              position: game.ctx.camera.position.toArray(),
              rotation: game.ctx.camera.quaternion.toArray(),
            },
          };
        });
        assert.ok(
          !row.snapshot.diagnostics?.some(
            (value) => value && typeof value === "object" && value.severity === "error",
          ),
          "Runtime diagnostics reported an error",
        );
        row.metrics = validateSample(row.provenance, row.captureSession.startup, row.observed);
        const identity = {
          browserArgs: row.provenance.browserArgs,
          adapter: row.provenance.adapter,
          clock: row.snapshot.clock,
          camera: row.observed.camera,
          state: row.snapshot.state,
        };
        if (matched === undefined) matched = identity;
        else assert.deepEqual(identity, matched, "Matched launch controls drifted");
        row.success = true;
      });
    } catch (error) {
      row.success = false;
      row.error = { name: error.name, message: error.message, stack: error.stack };
      // Preserve any provenance/readiness artifact emitted before callback failure.
      for (const [key, file] of [
        ["provenance", "capture.json"],
        ["captureSession", "capture-session.json"],
      ]) {
        if (row[key] === undefined)
          try {
            row[key] = JSON.parse(await readFile(resolve(directory, file), "utf8"));
          } catch {}
      }
    }
    samples.push(row);
    await writeFile(resolve(output, "samples.json"), JSON.stringify(samples, null, 2));
    console.log(
      `${index + 1}/80 ${arm}: ${row.success ? `${row.metrics.navigationReadyMs} ms` : row.error.message}`,
    );
    if (index < 3 && !row.success) {
      await writeFile(
        resolve(output, "early-stop.json"),
        JSON.stringify(
          {
            pass: false,
            reason: "Initial launch failed; stop before repeating invalid controls",
            sample: row,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
      return;
    }
  }
  const finalTrees = {
    before: await treeFingerprint(roots.before),
    after: await treeFingerprint(roots.after),
  };
  const unchanged = ["before", "after"].every(
    (arm) => frozen[arm].sha256 === finalTrees[arm].sha256,
  );
  const pass = unchanged && samples.length === 80 && samples.every((row) => row.success);
  const arms = Object.fromEntries(
    ["before", "after"].map((arm) => {
      const successes = samples.filter((row) => row.arm === arm && row.success);
      return [
        arm,
        {
          attempted: 40,
          failures: 40 - successes.length,
          navigationReadyMs: successes.length
            ? statistics(successes.map((row) => row.metrics.navigationReadyMs))
            : null,
          sceneLoadToReadyMs: successes.length
            ? statistics(successes.map((row) => row.metrics.sceneLoadToReadyMs))
            : null,
        },
      ];
    }),
  );
  const result = {
    pass,
    unchanged,
    arms,
    p95DeltaMs: pass ? arms.after.navigationReadyMs.p95 - arms.before.navigationReadyMs.p95 : null,
    scope:
      "fresh Chromium process/context/page; engine ready timeline performance.now origin; load-to-ready also retained; no browser launch/lease/server timing",
    cache:
      "fresh page/HTTP cache; OS filesystem and GPU driver shader caches uncontrolled; NOT shader-cold",
    limitations:
      "40 samples/arm is empirical engineering evidence, not a precise population-tail estimate. Failures retained; successful-only statistics are unqualified if any failure occurs. No compileComplete or full restart readiness inferred.",
    samples,
  };
  await writeFile(resolve(output, "summary.json"), JSON.stringify(result, null, 2));
  if (!pass) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
