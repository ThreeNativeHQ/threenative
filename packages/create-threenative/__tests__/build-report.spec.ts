import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";
import { build } from "../src/build.js";
import { type IBuildReport, hashArtifact } from "../src/buildReport.js";
import { PERFORMANCE_BUDGET_KEYS, loadConfig } from "../src/config.js";

/** The same fixture, and the same two digests, as `playtest/__tests__/build-report.spec.ts`. */
const FIXTURE_DIRECTORY_SHA256 = "30263b095da6a3cdaba7338a6882fba33c971daf6896338be4d1b6629652ff1c";
const FIXTURE_FILE_SHA256 = "3598ce6f965b2481fe26316c06b30950c46ac7f8e7229f104aa78f579997668d";

/** Set by the failing-build test; the happy path's stub always succeeds. */
let viteExitCode = 0;

// Only Vite's child process is stubbed. The asset compile is the real one, because a report whose
// manifest digest came from a fixture is a report that measured nothing.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { EventEmitter } = await import("node:events");
  const spawn = ((_command: string, args: readonly string[]) => {
    const child = new EventEmitter();
    queueMicrotask(async () => {
      // A real Vite build creates the outDir it was pointed at and fills it, and the web build
      // refuses to publish one that is still missing — so the stub has to be as complete as what it
      // replaces, or the report measures an empty directory and calls it zero bytes.
      const index = args.indexOf("--outDir");
      const out = args[index + 1];
      if (index >= 0 && out !== undefined && viteExitCode === 0) {
        await mkdir(path.resolve(out), { recursive: true });
        await writeFile(
          path.join(path.resolve(out), "index.html"),
          "<!doctype html><title>game</title>",
        );
      }
      child.emit("exit", viteExitCode);
    });
    return child;
  }) as unknown as typeof actual.spawn;
  return { ...actual, spawn };
});

afterEach(() => {
  viteExitCode = 0;
  vi.restoreAllMocks();
});

async function project(declared?: unknown): Promise<string> {
  const root = await makeTempDir("threenative-build-report-");
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "report-game", type: "module" }),
  );
  await writeFile(
    path.join(root, "threenative.config.ts"),
    `export default ${JSON.stringify(declared ?? {}, null, 2)};\n`,
  );
  return root;
}

describe("profile performance budgets", () => {
  it("accepts the harness's own performance fields and refuses a misspelled one", async () => {
    const root = await project({
      buildProfiles: {
        defaults: { web: "capped" },
        profiles: {
          capped: {
            performanceBudget: {
              maxDrawCalls: 1,
              maxFrameMsP95: 16.5,
              maxPassDrawCalls: { main: 120, shadow: 40 },
              maxPassTriangles: { main: 200_000 },
              maxPhaseMsP95: { render: 12 },
              maxTriangles: 300_000,
              minFps: 60,
            },
          },
        },
      },
    });

    await expect(loadConfig(root, { target: "web" })).resolves.toMatchObject({
      buildProfile: {
        name: "capped",
        performanceBudget: {
          maxDrawCalls: 1,
          maxFrameMsP95: 16.5,
          maxPassDrawCalls: { main: 120, shadow: 40 },
          maxPassTriangles: { main: 200_000 },
          maxPhaseMsP95: { render: 12 },
          maxTriangles: 300_000,
          minFps: 60,
        },
      },
    });

    for (const performanceBudget of [
      // The typo this exists for: `maxFrameMsP59` bounds nothing and would read as a green run.
      { maxFrameMsP59: 16 },
      { maxDrawCalls: "1" },
      { maxDrawCalls: -1 },
      { maxPhaseMsP95: { rnder: 12 } },
      { maxPassDrawCalls: {} },
      {},
    ]) {
      const rejected = await project({
        buildProfiles: { profiles: { capped: { performanceBudget } } },
      });
      await expect(loadConfig(rejected, { target: "web" })).rejects.toThrow(
        /TN_CONFIG_(?:PROFILE_INVALID|UNKNOWN_KEY)/u,
      );
    }
  });

  it("keeps its ceiling list identical to the playtest harness's assert.performance", () => {
    // The two packages share no dependency by design, so this list is written twice on purpose.
    // What stops that from rotting is this test: it reads the harness's own closed key list out of
    // its source, so adding a performance field there without adding it here fails the build.
    const source = readFileSync(
      path.resolve(import.meta.dirname, "../../playtest/src/scenario/schema-accessors.ts"),
      "utf8",
    );
    const body =
      /export function validatePerformanceAssertion[\s\S]*?rejectUnknownKeys\(record, \[([^\]]*)\]/u.exec(
        source,
      )?.[1];
    expect(body).toBeDefined();
    const harnessKeys = [...(body ?? "").matchAll(/"([^"]+)"/gu)].map(([, key]) => key as string);
    expect([...PERFORMANCE_BUDGET_KEYS].sort()).toEqual(harnessKeys.sort());
  });
});

describe("threenative build --build-report", () => {
  it("publishes the report beside the artifact, with the artifact's own hash", async () => {
    const root = await project({
      buildProfiles: {
        defaults: { web: "capped" },
        profiles: { capped: { performanceBudget: { maxDrawCalls: 1 } } },
      },
    });
    const lines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      lines.push(String(chunk));
      return true;
    });

    await build({ cwd: root, target: "web" });

    const reportPath = path.join(root, "dist.build-report.json");
    expect(existsSync(reportPath)).toBe(true);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as IBuildReport;
    expect(report.schemaVersion).toBe(1);
    expect(report.target).toBe("web");
    expect(report.profile).toBe("capped");
    expect(report.performanceBudget).toEqual({ maxDrawCalls: 1 });
    expect(report.artifact.kind).toBe("directory");
    expect(report.artifact.name).toBe("dist");
    // The digest is of what was published, recomputed from the published bytes.
    expect(report.artifact.sha256).toBe((await hashArtifact(path.join(root, "dist"))).sha256);
    expect(report.measured.artifactBytes).toBeGreaterThan(0);
    // Nothing that names the machine, the moment, or a path outside the artifact.
    expect(readFileSync(reportPath, "utf8")).not.toContain(root);
  });

  it("publishes no report when the build fails", async () => {
    const root = await project({ buildProfiles: { profiles: { capped: {} } } });
    viteExitCode = 1;

    await expect(build({ cwd: root, target: "web" })).rejects.toThrow(/exited with code 1/u);
    expect(existsSync(path.join(root, "dist.build-report.json"))).toBe(false);
    expect(existsSync(path.join(root, "dist"))).toBe(false);
  });
});

describe("hashArtifact", () => {
  it("is the digest the playtest lane re-derives, byte for byte", async () => {
    const root = await makeTempDir("threenative-report-hash-");
    const artifact = path.join(root, "dist");
    await mkdir(path.join(artifact, "assets"), { recursive: true });
    await writeFile(path.join(artifact, "index.html"), "<!doctype html><title>game</title>");
    await writeFile(path.join(artifact, "assets", "logo.bin"), "logo");

    const file = await hashArtifact(path.join(artifact, "assets", "logo.bin"));
    expect(file).toEqual({ kind: "file", name: "logo.bin", sha256: FIXTURE_FILE_SHA256 });
    const tree = await hashArtifact(artifact);
    expect(tree).toEqual({ kind: "directory", name: "dist", sha256: FIXTURE_DIRECTORY_SHA256 });
  });
});
