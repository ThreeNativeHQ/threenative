import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { WEBGPU_BROWSER_ARGS } from "../src/runner/browser.js";
import { exitCodeForReport } from "../src/runner/cli.js";
import { runStandalonePlaytest } from "../src/runner/runner.js";
import type { IStandalonePlaytestConfig } from "../src/runner/config.js";

// End-to-end proof for the generated shooter's mouse path: relative pointer look, right-button
// aim hold/release, and left-button fire through the real input bridge of a scaffolded project.
//
// This is the integration arm the unit suites cannot stand in for: it packs the local framework
// packages, scaffolds the shooter template like a user's machine would (tarballs, no workspace),
// boots its dev server, and drives the committed `input-control.playtest.json` against it. The
// negative control mutates a copy — right-button delivery removed — and demands a semantic red,
// not a parse error.

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const SCENARIO_PATH = path.join(
  REPO_ROOT,
  "packages/create-threenative/templates/shooter/playtests/input-control.playtest.json",
);
const SCAFFOLDER_ENTRY = path.join(REPO_ROOT, "packages/create-threenative/dist/index.js");

// Mirrors scripts/visual-gate.ts LOCAL_FRAMEWORK_PACKAGES: every @threenative/* the generated
// package.json could resolve, redirected to freshly packed local tarballs.
const LOCAL_PACKAGES = [
  ["@threenative/playtest", "threenative-playtest-"],
  ["@threenative/core", "threenative-core-"],
  ["@threenative/physics", "threenative-physics-"],
  ["@threenative/runtime-native", "threenative-runtime-native-"],
  ["@threenative/ui", "threenative-ui-"],
  ["create-threenative", "create-threenative-"],
  ["threenative-engine-mcp", "threenative-engine-mcp-"],
] as const;

const PACKAGE_FLAG_BY_NAME: Record<string, string> = {
  "@threenative/core": "--core-package",
  "@threenative/physics": "--physics-package",
  "@threenative/playtest": "--playtest-package",
  "@threenative/runtime-native": "--runtime-native-package",
  "@threenative/ui": "--ui-package",
  "create-threenative": "--cli-package",
  "threenative-engine-mcp": "--engine-mcp-package",
};

// WebGPU under Chromium needs a real display server on Linux; the focused gate wraps this spec
// in `sh scripts/xvfb.sh`. Without one the run cannot execute at all, so it is skipped with that
// prerequisite named rather than failed — the wrapper command is the fix, not a code change.
const needsDisplay =
  process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;

let workspaceRoot: string | undefined;
let projectPath: string | undefined;

describe.skipIf(needsDisplay)("generated shooter input proof", () => {
  beforeAll(async () => {
    workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "generated-shooter-input-"));
    const packageDirectory = path.join(workspaceRoot, "packages");
    await mkdir(packageDirectory, { recursive: true });
    const packageSources: Record<string, string> = {};
    for (const [name, prefix] of LOCAL_PACKAGES) {
      await execFileAsync(
        "pnpm",
        ["--filter", name, "pack", "--pack-destination", packageDirectory],
        { cwd: REPO_ROOT },
      );
      const archive = (await readdir(packageDirectory)).find(
        (file) => file.startsWith(prefix) && file.endsWith(".tgz"),
      );
      if (archive === undefined) throw new Error(`local pack for ${name} produced no tarball`);
      packageSources[name] = path.join(packageDirectory, archive);
    }
    projectPath = path.join(workspaceRoot, "shooter-input-proof");
    const flags = Object.entries(packageSources).flatMap(([name, archive]) =>
      PACKAGE_FLAG_BY_NAME[name] === undefined ? [] : [PACKAGE_FLAG_BY_NAME[name]!, archive],
    );
    await execFileAsync(
      process.execPath,
      [SCAFFOLDER_ENTRY, projectPath, "--template", "shooter", ...flags],
      { cwd: REPO_ROOT },
    );
  }, 900_000);

  afterAll(async () => {
    if (workspaceRoot !== undefined) {
      const root = workspaceRoot;
      workspaceRoot = undefined;
      await rm(root, { force: true, recursive: true }).catch(() => undefined);
    }
  });

  async function runScenario(
    scenarioPath: string,
    artifactDirectory: string,
  ): Promise<Awaited<ReturnType<typeof runStandalonePlaytest>>> {
    if (projectPath === undefined) throw new Error("scaffold did not produce a project");
    const config: IStandalonePlaytestConfig = {
      allowSoftwareAdapter: false,
      artifactDirectory,
      browserArgs: [...WEBGPU_BROWSER_ARGS],
      headless: false,
      // Port 0 asks the runner for a free managed port; the URL must carry no port of its own
      // or that placeholder would win over the dynamic one.
      port: 0,
      projectPath,
      scenarioPath,
      server: {
        command: "pnpm dev --host 127.0.0.1 --port $PORT --strictPort",
        cwd: projectPath,
        timeoutMs: 120_000,
      },
      timeoutMs: 60_000,
      trace: false,
      url: "http://127.0.0.1/",
    };
    return runStandalonePlaytest(config);
  }

  test("should turn, aim, and fire the generated shooter", async () => {
    expect(projectPath).toBeDefined();
    const report = await runScenario(SCENARIO_PATH, path.join(projectPath!, "artifacts-positive"));

    expect(report.pass).toBe(true);
    expect(exitCodeForReport(report)).toBe(0);
    // The adapter must be named hardware: the runner fails TN_PLAYTEST_SOFTWARE_ADAPTER otherwise.
    const capture = JSON.parse(
      await readFile(path.join(projectPath!, "artifacts-positive", "capture.json"), "utf8"),
    ) as { adapter?: Record<string, string>; rendererKind?: string };
    console.info(`webgpu adapter: ${JSON.stringify(capture.adapter ?? {})}`);
    expect(capture.rendererKind).toBe("webgpu");

    const results = new Map((report.assertionResults ?? []).map(({ id, pass }) => [id, pass]));
    for (const id of [
      "resource.state.aiming.atSteps",
      "resource.state.yawDegrees.atSteps",
      "resource.state.shotsFired.atSteps",
      "resource.state.aimedShots.atSteps",
      "resource.state.demoTargetAlive",
      "resource.state.demoDamage",
      "signal.aim-engaged",
      "signal.fired",
      "signal.hit",
      "signal.defeated",
      "signal.aim-released",
    ]) {
      expect(results.get(id), `${id} must be evaluated`).toBeDefined();
      expect(results.get(id), `${id} must pass`).toBe(true);
    }
    const after = report.after as { state?: Record<string, unknown> } | undefined;
    console.info(
      "raw observations:",
      JSON.stringify({
        demoDamage: after?.state?.demoDamage,
        demoTargetAlive: after?.state?.demoTargetAlive,
        shotsFired: after?.state?.shotsFired,
      }),
    );
  }, 600_000);

  test("negative control: removing right-button delivery leaves the input state unchanged", async () => {
    expect(projectPath).toBeDefined();
    const scenario = JSON.parse(await readFile(SCENARIO_PATH, "utf8")) as {
      steps: Array<{ label?: string; pointerPosition?: { buttons?: number; x: number; y: number } }>;
    };
    // The named mutation: strip right-button delivery from the aim step, leaving everything else
    // byte-identical. Aim must never engage, so the aimed shot can never be counted.
    const aimStep = scenario.steps.find(({ label }) => label === "aim-down");
    expect(aimStep?.pointerPosition?.buttons).toBe(2);
    delete aimStep!.pointerPosition!.buttons;
    const mutatedPath = path.join(projectPath!, "input-control-negative.playtest.json");
    await writeFile(mutatedPath, JSON.stringify(scenario));

    const report = await runScenario(mutatedPath, path.join(projectPath!, "artifacts-negative"));

    console.info("RED observed: generated shooter input state unchanged");
    console.info(
      "failed assertions:",
      JSON.stringify(
        (report.assertionResults ?? []).filter(({ pass }) => !pass).map(({ id }) => id),
      ),
    );
    expect(report.pass).toBe(false);
    expect(exitCodeForReport(report)).toBe(1);
    const failed = new Set(
      (report.assertionResults ?? []).filter(({ pass }) => !pass).map(({ id }) => id),
    );
    // The red must name the input state itself, not a transport or parse failure.
    expect(failed.has("resource.state.aiming.atSteps")).toBe(true);
    expect(failed.has("resource.state.aimedShots.atSteps")).toBe(true);
  }, 600_000);

  test("scenario keeps a no-input control ahead of every input step", async () => {
    const scenario = JSON.parse(await readFile(SCENARIO_PATH, "utf8")) as {
      assert?: { resources?: Array<{ atSteps?: Array<{ equals: unknown; label: string }> }> };
      steps: Array<{ kind?: string; label?: string }>;
    };
    expect(scenario.steps[0]).toMatchObject({ kind: "wait", label: "no-input-control" });
    // The aiming row's control leg pins the initial unaimed value at the no-input label, so the
    // scenario cannot pass from initial state.
    const aiming = scenario.assert?.resources?.find((row) =>
      row.atSteps?.some(({ label }) => label === "aim-down"),
    );
    expect(aiming?.atSteps).toContainEqual({ label: "aim-down", equals: 1 });
  });
});
