#!/usr/bin/env node

/**
 * The default starter's web HUD, driven by real (synthetic) input on a desktop host.
 *
 * PRD-217 phases 1 and 2 require the *default starter* to build and run its own React HUD on
 * Windows and macOS, with a press inside a HUD island producing a game-state change and input
 * outside the islands reaching the game. The public CLI refuses a `web` UI on those hosts until
 * phase 3B, so this route sets `THREENATIVE_INTERNAL_DESKTOP_UI_PROOF=1` (the maintainer bypass in
 * `create-threenative/src/build.ts`) together with a prebuilt runtime, then runs
 * `scenarios/starter-ui-overlay-desktop.playtest.json` against the packaged app through the
 * installed playtest CLI. The scenario asserts the observations; this script only drives the
 * documented route and fails closed when any piece is missing.
 *
 * Usage (the scaffolded starter must already be installed):
 *   node verify-starter-ui-overlay.mjs --project <starter> --runtime <built mystral> [--scenario <file>] [--artifacts <dir>]
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const runtimeRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function flags(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) {
      throw new Error(`TN_STARTER_UI_ARGUMENT_INVALID: ${key}`);
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed.set(key.slice(2), true);
    } else {
      parsed.set(key.slice(2), next);
      index += 1;
    }
  }
  return parsed;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`TN_STARTER_UI_COMMAND_FAILED: ${command} ${args.join(" ")} exited ${result.status}`);
  }
}

function packagedExecutable(project) {
  const { name } = JSON.parse(readFileSync(join(project, "package.json"), "utf8"));
  const stem = join(project, "dist-native", name);
  for (const candidate of process.platform === "win32" ? [`${stem}.exe`, stem] : [stem]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`TN_STARTER_UI_EXECUTABLE_MISSING: ${stem}`);
}

function main() {
  const parsed = flags(process.argv.slice(2));
  const project = resolve(parsed.get("project") ?? ".");
  const runtime = resolve(parsed.get("runtime") ?? "");
  const scenario = resolve(
    parsed.get("scenario") ?? join(runtimeRoot, "scenarios", "starter-ui-overlay-desktop.playtest.json"),
  );
  const artifacts = resolve(parsed.get("artifacts") ?? join(runtimeRoot, "artifacts", "starter-ui-overlay"));
  if (!existsSync(join(project, "package.json"))) {
    throw new Error(`TN_STARTER_UI_PROJECT_MISSING: ${project}`);
  }
  if (!existsSync(runtime)) throw new Error(`TN_STARTER_UI_RUNTIME_MISSING: ${runtime}`);
  if (!existsSync(scenario)) throw new Error(`TN_STARTER_UI_SCENARIO_MISSING: ${scenario}`);
  const cli = join(project, "node_modules", "@threenative", "playtest", "dist", "runner", "cli.js");
  if (!existsSync(cli)) throw new Error(`TN_STARTER_UI_PLAYTEST_MISSING: ${cli}`);
  mkdirSync(artifacts, { recursive: true });

  if (parsed.get("skip-build") !== true) {
    run(pnpm, ["--dir", project, "build:desktop"], {
      env: {
        ...process.env,
        THREENATIVE_INTERNAL_DESKTOP_UI_PROOF: "1",
        THREENATIVE_RUNTIME_BINARY: runtime,
      },
    });
  }
  const executable = packagedExecutable(project);
  run(process.execPath, [
    cli,
    scenario,
    "--target",
    "desktop",
    "--executable",
    executable,
    "--project",
    project,
    "--artifacts",
    artifacts,
  ]);
  console.log(`TN_STARTER_UI_OVERLAY_PASS: ${scenario}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
