import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentsFiles, syncAgentDocs } from "../sync-agent-docs.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "threenative-agent-docs-"));
  await writeFile(path.join(root, "AGENTS.md"), "# root rules\n");
  await mkdir(path.join(root, "packages", "core"), { recursive: true });
  await writeFile(path.join(root, "packages", "core", "AGENTS.md"), "# core rules\n");
  await mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "pkg", "AGENTS.md"), "# not ours\n");
  return root;
}

describe("sync-agent-docs", () => {
  it("should mirror every AGENTS.md and skip node_modules", async () => {
    const root = await fixture();
    try {
      expect(await agentsFiles(root)).toHaveLength(2);
      const first = await syncAgentDocs(root);
      expect(first.changed).toHaveLength(2);
      const mirrored = await readFile(path.join(root, "packages", "core", "CLAUDE.md"), "utf8");
      expect(mirrored).toContain("# core rules");
      expect(mirrored).toContain("Do not edit");
      const second = await syncAgentDocs(root);
      expect(second.changed).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should report drift in check mode without writing", async () => {
    const root = await fixture();
    try {
      await syncAgentDocs(root);
      await writeFile(path.join(root, "CLAUDE.md"), "# stale\n");
      const result = await syncAgentDocs(root, true);
      expect(result.changed).toEqual(["CLAUDE.md"]);
      await expect(readFile(path.join(root, "CLAUDE.md"), "utf8")).resolves.toBe("# stale\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("should keep the repository mirrors in sync", async () => {
    const result = await syncAgentDocs(process.cwd(), true);
    expect(result.changed).toEqual([]);
    expect(result.checked.length).toBeGreaterThan(0);
  });
});
