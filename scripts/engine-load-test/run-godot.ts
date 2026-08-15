// PRD-117 Phase 2: export the Godot control arm with **release** templates and hand back the
// directory to serve. Opt-in — nothing in `pnpm test` reaches this file, and a machine without
// Godot never runs it.
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

export const GODOT_PROJECT = "benchmark/godot-load-test";

export async function exportGodotWeb(repoRoot: string): Promise<string> {
  const godot = process.env.GODOT_BIN ?? "godot";
  const projectDir = path.join(repoRoot, GODOT_PROJECT);
  const exportDir = path.join(repoRoot, "artifacts/engine-load-test/godot-web");
  await rm(exportDir, { force: true, recursive: true });
  await mkdir(exportDir, { recursive: true });

  // `--export-release`, never `--export-debug`: PRD-066 measured that exact mistake costing a
  // 5.5x frame-time difference on the same phone with the same source.
  const args = [
    "--headless",
    "--path",
    projectDir,
    "--export-release",
    "Web",
    path.join(exportDir, "index.html"),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(godot, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.once("error", (error) =>
      reject(new Error(`TN_BENCH_GODOT_MISSING: could not run \`${godot}\` (${error.message})`)),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`TN_BENCH_GODOT_EXPORT_FAILED: exit ${code ?? "unknown"}`)),
    );
  });
  return exportDir;
}
