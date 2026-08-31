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
  // One template at a time while iterating on it: the full sweep scaffolds, installs and drives
  // seven projects, and a filtered run is the difference between a ten-minute loop and a one-
  // minute one. Unset — which is what CI is — every template runs.
  const only = process.env.TN_TEMPLATE_ONLY?.split(",").filter((name) => name !== "");
  if (only !== undefined) {
    const unknown = only.filter((name) => !TEMPLATE_NAMES.includes(name));
    if (unknown.length > 0)
      throw new Error(`TN_TEMPLATE_ONLY names no such template: ${unknown.join(", ")}`);
  }
  const packageSources = await packageLocalFramework(root);
  for (const template of only ?? TEMPLATE_NAMES) {
    const target = path.join(root, template);
    await createProject({ install: true, packageSources, target, template });
    await run("pnpm", ["test"], target);
    console.info(`${template}: scaffolded playtests passed.`);
  }
} finally {
  await rm(root, { force: true, recursive: true });
}
