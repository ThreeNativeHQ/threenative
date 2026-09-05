import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../../test-support/temp-dir.js";

describe("asset worker pool lifetime", () => {
  it("exits the real compiler with all passes disabled and no workers", async () => {
    const root = await makeTempDir("threenative-no-passes-");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets/proof.txt"), "unchanged");
    const moduleUrl = pathToFileURL(path.resolve("packages/assets/src/compile.ts")).href;
    const script = `const {compileAssets} = await import(${JSON.stringify(moduleUrl)});
      const result = await compileAssets({cwd:${JSON.stringify(root)}, concurrency:2,
        config:{audio:"none",models:"none",textures:"none"}});
      if(result.concurrencyUsed!==1 || result.passCosts.length!==0) throw new Error("unexpected worker/pass");
      console.log("empty-chain-exited");`;
    const result = await new Promise<{ output: string; code: number | null }>((resolve, reject) => {
      const child = spawn(process.execPath, [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        script,
      ]);
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        output += String(chunk);
      });
      child.once("error", reject);
      const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
      child.once("exit", (code) => {
        clearTimeout(timer);
        resolve({ output, code });
      });
    });
    expect(result.output).toContain("empty-chain-exited");
    expect(result.code).toBe(0);
  }, 10000);

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
