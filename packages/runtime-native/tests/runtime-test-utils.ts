import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
export const runtimeBinary = join(runtimeRoot, "build", "mystral");

type Skip = (note?: string) => never;

export function requireFiles(
  skip: Skip,
  requirements: ReadonlyArray<{ label: string; path: string }>,
): void {
  const missing = requirements.filter(({ path }) => !existsSync(path));
  if (missing.length > 0) {
    skip(`requires ${missing.map(({ label, path }) => `${label} (${path})`).join(", ")}`);
  }
}

export async function runCommand(
  command: string,
  args: readonly string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });

  const timeout = options.timeoutMs
    ? setTimeout(() => child.kill("SIGKILL"), options.timeoutMs)
    : undefined;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
  return { exitCode, stderr, stdout };
}
