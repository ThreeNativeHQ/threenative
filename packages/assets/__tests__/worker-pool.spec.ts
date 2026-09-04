import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

describe("asset worker pool lifetime", () => {
  it("terminates every worker when disposed", async () => {
    const moduleUrl = pathToFileURL(path.resolve("packages/assets/src/worker-pool.ts")).href;
    const script = `void import(${JSON.stringify(moduleUrl)}).then(async ({ createPassPool }) => {
      const pool = createPassPool(2, [{ kind: "texture", options: {} }], process.cwd());
      await pool.run("plain.txt", Buffer.from("unchanged"));
      await pool.dispose();
      process.stdout.write("disposed\\n");
    });`;
    const result = await new Promise<{ readonly output: string; readonly timedOut: boolean }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", "--eval", script], {
          cwd: process.cwd(),
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.once("error", reject);
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ output, timedOut: true });
        }, 5_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve({ output, timedOut: false });
        });
      },
    );

    expect(result.output).toContain("disposed");
    expect(result.timedOut).toBe(false);
  }, 10_000);
});
