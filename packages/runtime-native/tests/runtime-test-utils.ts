import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
export const runtimeBinary = join(runtimeRoot, "build", "tn-linux", "mystral");

type Skip = (note?: string) => never;

export function requireGpuTestOptIn(skip: Skip): void {
  if (process.env.TN_RUNTIME_GPU_TESTS !== "1") {
    skip("requires TN_RUNTIME_GPU_TESTS=1 and a working native GPU/display");
  }
}

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
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ exitCode: number | null; stderr: string; stdout: string }> {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    env: options.env,
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

/**
 * The command a YAML block scalar actually produces, rather than the text it is written as.
 *
 * `reactivecircus/android-emulator-runner` reads `script` as one string and hands it to the
 * emulator shell, so what the lane runs is the *folded* value: under `>-` the argument list is a
 * single line however the file wraps it, and under `|` every line after the first is a separate
 * command. Two contract tests matched the raw workflow text for
 * `--target android --device emulator-5554`, which pins a wrapping rather than a command — the
 * mirror image of the `|` block that silently dropped every argument after the first line and
 * left the lane running the whole matrix with none. Reading the folded value fails when the
 * arguments go missing and stays quiet when the line merely wraps somewhere else.
 */
export function workflowBlockScalars(source: string, key: string): readonly string[] {
  const header = new RegExp(`^([ \\t]*)${key}:[ \\t]*([|>])[+-]?[ \\t]*$`, "u");
  const lines = source.split("\n");
  const scalars: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = header.exec(lines[index] ?? "");
    if (match === null) continue;
    const indent = (match[1] ?? "").length;
    const literal = match[2] === "|";
    const body: string[] = [];
    let cursor = index + 1;
    for (; cursor < lines.length; cursor += 1) {
      const line = lines[cursor] ?? "";
      if (line.trim() === "") {
        body.push("");
        continue;
      }
      if (line.search(/\S/u) <= indent) break;
      body.push(line.trim());
    }
    index = cursor - 1;
    while (body.length > 0 && body.at(-1) === "") body.pop();
    // A literal scalar keeps every newline, which is what made the broken lane run one bare
    // command; a folded scalar joins each run of non-empty lines with a space.
    scalars.push(literal ? body.join("\n") : foldLines(body));
  }
  return scalars;
}

function foldLines(body: readonly string[]): string {
  return body
    .reduce<string[]>((chunks, line) => {
      const last = chunks.at(-1);
      if (line === "" || last === undefined || last === "") chunks.push(line);
      else chunks[chunks.length - 1] = `${last} ${line}`;
      return chunks;
    }, [])
    .join("\n");
}
