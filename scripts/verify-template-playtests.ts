import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProject } from "../packages/create-threenative/src/index.js";
import { TEMPLATE_NAMES, inspectAllTemplates, packageLocalFramework } from "./visual-gate.js";

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

const root = await mkdtemp(path.join(os.tmpdir(), "threenative-template-playtests-"));
try {
  const structuralErrors = inspectAllTemplates().flatMap(({ errors }) => errors);
  if (structuralErrors.length > 0)
    throw new Error(`TN_VISUAL_STRUCTURE_FAILED:\n${structuralErrors.join("\n")}`);
  if (TEMPLATE_NAMES.length === 0) throw new Error("TN_TEMPLATE_DISCOVERY_EMPTY");
  const packageSources = await packageLocalFramework(root);
  for (const template of TEMPLATE_NAMES) {
    const target = path.join(root, template);
    await createProject({ install: true, packageSources, target, template });
    await run("pnpm", ["test"], target);
    console.info(`${template}: scaffolded playtests passed.`);
  }
} finally {
  await rm(root, { force: true, recursive: true });
}
