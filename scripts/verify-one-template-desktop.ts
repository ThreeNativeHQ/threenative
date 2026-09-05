// Scaffolds a single template and runs its native lane, so the render chain can be proved on the
// desktop host rather than inferred from a browser run. PRD-278 AC9 is the reason this exists:
// the chain is WebGPU-only by construction and names that as its refusal reason on any other
// renderer, and until a `--target desktop` run confirms the stages actually apply there, the only
// observation is the refusal on browser.
//
// Sibling of `verify-one-template.ts`, which runs the browser lane. The native host is taken from
// `THREENATIVE_RUNTIME_BINARY` when set, so a locally built `mystral` is proved rather than the
// prebuilt a scaffold would download.
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProject } from "../packages/create-threenative/src/index.js";
import { packageLocalFramework } from "./visual-gate.js";

const template = process.argv[2];
if (template === undefined) throw new Error("usage: verify-one-template-desktop.ts <template>");

async function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited ${code ?? "unknown"}.`)),
    );
  });
}

const root = await mkdtemp(path.join(os.tmpdir(), `threenative-${template}-desktop-`));
console.info(`scaffold root: ${root}`);
console.info(
  `runtime binary: ${process.env.THREENATIVE_RUNTIME_BINARY ?? "(the scaffold's prebuilt)"}`,
);
const packageSources = await packageLocalFramework(root);
const target = path.join(root, template);
await createProject({ install: true, packageSources, target, template });
await run("pnpm", ["test:native"], target);
console.info(`${template}: native playtests passed at ${target}`);
