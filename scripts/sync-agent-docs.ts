import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  "test-results",
  ".runtime",
  ".cxx",
  ".gradle",
  ".test-tmp",
  ".linchpin",
  ".worktrees",
  "artifacts",
  "build",
  "target",
  "third_party",
]);

// Hosting is an application root, not a workspace package, but its service rules still need a
// generated CLAUDE.md mirror. Keep this explicit as the hosting tree grows its own subdirectories.
const MIRRORED_APPLICATION_ROOTS = new Set(["hosting"]);

/**
 * Trees whose `AGENTS.md` files are evidence rather than repository rules.
 *
 * A sweep archive is a frozen copy of what a builder was given and what it wrote. Framework-arm
 * archives happen to carry a `CLAUDE.md` because the template ships both, so this never bit until
 * round 9 archived the first vanilla arm — whose `AGENTS.md` the sandbox generates on its own. The
 * mirror check then wanted to write a `CLAUDE.md` into a sealed archive, which would edit evidence
 * to satisfy a rule that does not apply to it. Skipped by path, not by directory name, so an
 * ordinary `sweeps/` elsewhere in the repo would still be mirrored.
 */
const SKIP_PATHS = new Set([path.join("docs", "benchmark")]);

export const BANNER = "<!-- Generated mirror of AGENTS.md. Do not edit; edit AGENTS.md. -->\n";

export async function agentsFiles(root: string, base = root): Promise<string[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name) && !MIRRORED_APPLICATION_ROOTS.has(entry.name)) continue;
      if (SKIP_PATHS.has(path.relative(base, absolute))) continue;
      found.push(...(await agentsFiles(absolute, base)));
    } else if (entry.name === "AGENTS.md") {
      found.push(absolute);
    }
  }
  return found.sort();
}

export function mirrorContent(agents: string): string {
  return `${BANNER}\n${agents}`;
}

export interface SyncResult {
  readonly changed: string[];
  readonly checked: string[];
}

export async function syncAgentDocs(root: string, check = false): Promise<SyncResult> {
  const changed: string[] = [];
  const checked: string[] = [];
  for (const agentsPath of await agentsFiles(root)) {
    const claudePath = path.join(path.dirname(agentsPath), "CLAUDE.md");
    const expected = mirrorContent(await readFile(agentsPath, "utf8"));
    const current = existsSync(claudePath) ? await readFile(claudePath, "utf8") : undefined;
    checked.push(path.relative(root, claudePath));
    if (current === expected) continue;
    changed.push(path.relative(root, claudePath));
    if (!check) await writeFile(claudePath, expected);
  }
  return { changed, checked };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
) {
  const check = process.argv.includes("--check");
  syncAgentDocs(process.cwd(), check)
    .then(({ changed, checked }) => {
      if (check && changed.length > 0) {
        console.error(
          `CLAUDE.md out of sync with AGENTS.md:\n${changed.map((file) => `  ${file}`).join("\n")}\nRun: pnpm sync:agents`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        check
          ? `agent docs in sync: ${checked.length} CLAUDE.md mirrors`
          : `agent docs synced: ${checked.length} mirrors, ${changed.length} written`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
