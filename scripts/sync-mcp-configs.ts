#!/usr/bin/env tsx
// Writes the project-scoped MCP config every agent host reads into every scaffold template, from
// the one server table in `@threenative/core`. Eight templates times seven hosts is fifty-six files
// nobody keeps correct by hand, and a template missing one hands that host's agent a game with no
// asset, sculpt or capability tools — which reads as a framework that lacks the feature.
//
//   pnpm sync:mcp            rewrite the templates
//   pnpm sync:mcp --check    fail when one is stale (CI)
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error — the installer is plain JavaScript so a postinstall can run it unbuilt.
import { MCP_HOSTS, ensureHostMcpConfigs } from "../packages/core/mcp/install.mjs";

interface IHost {
  readonly file: string;
  readonly id: string;
  readonly label: string;
}

const hosts = MCP_HOSTS as readonly IHost[];
const templateRoot = path.resolve("packages/create-threenative/templates");

function templates(): readonly string[] {
  return readdirSync(templateRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function read(directory: string, file: string): string | undefined {
  const target = path.join(directory, file);
  return existsSync(target) ? readFileSync(target, "utf8") : undefined;
}

/** What this template's host configs would be after an install, without touching the template.
 * The writer merges rather than overwrites, so the answer depends on what is already there — the
 * only honest way to compute it is to run the real writer over a copy. */
function wanted(template: string): ReadonlyMap<string, string | undefined> {
  const scratch = mkdtempSync(path.join(tmpdir(), "tn-mcp-sync-"));
  try {
    for (const host of hosts) {
      const source = path.join(templateRoot, template, host.file);
      if (!existsSync(source)) continue;
      const destination = path.join(scratch, host.file);
      mkdirSync(path.dirname(destination), { recursive: true });
      cpSync(source, destination);
    }
    ensureHostMcpConfigs(scratch);
    return new Map(hosts.map((host) => [host.file, read(scratch, host.file)]));
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}

/** Which template host configs differ from what the writer would produce. The `--check` gate and
 * the vitest spec both read this one answer: a spec that re-derived the expectation itself would
 * be a second generator, green against its own copy of the rule rather than against the shipped
 * one. */
export function staleHostConfigs(): readonly string[] {
  const behind: string[] = [];
  for (const template of templates()) {
    const directory = path.join(templateRoot, template);
    const expected = wanted(template);
    for (const host of hosts) {
      const current = read(directory, host.file);
      const target = expected.get(host.file);
      if (target === undefined) {
        throw new Error(`TN_MCP_SYNC: the writer produced no ${host.file} for ${host.label}.`);
      }
      if (current === target) continue;
      behind.push(`${template}/${host.file}`);
    }
  }
  return behind;
}

function main(): void {
  const check = process.argv.includes("--check");
  const behind = staleHostConfigs();
  if (!check) {
    for (const template of templates()) ensureHostMcpConfigs(path.join(templateRoot, template));
  }
  if (behind.length === 0) {
    process.stdout.write(
      `MCP host configs current: ${templates().length} templates × ${hosts.length} hosts\n`,
    );
    return;
  }
  if (check) {
    process.stderr.write(
      `TN_MCP_SYNC_STALE: run \`pnpm sync:mcp\` — stale host configs:\n${behind.map((line) => `  ${line}`).join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`rewrote:\n${behind.map((line) => `  ${line}`).join("\n")}\n`);
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  main();
}
